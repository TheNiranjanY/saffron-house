import re
from datetime import timedelta
from time import perf_counter

import mysql.connector
import psycopg
from flask import Blueprint, jsonify, request

from restaurant.benchmark import run_benchmark
from restaurant.db import (
    cursor,
    mysql_read,
    mysql_row,
    mysql_rows,
    ts_conn,
    ts_row,
    ts_rows,
)
from restaurant.errors import ApiError
from restaurant.events import sync_status
from restaurant.sql_catalog import CATALOG, find
from restaurant.timeutil import date_bounds, iso, now_local, to_mysql

from .utils import as_int, json_body, query_days, query_int, require

analytics_bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")

ACTIVE_SQL = "('PLACED', 'PREPARING', 'PREPARED', 'BILLED')"

READ_ONLY_DENY = re.compile(
    r"\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|"
    r"CALL|EXECUTE|DO|COPY|VACUUM|REINDEX|CLUSTER|COMMENT|SET|RESET|LOCK|UNLOCK|"
    r"LOAD|HANDLER|PREPARE|DEALLOCATE|INTO\s+OUTFILE|INTO\s+DUMPFILE|"
    r"PG_READ_FILE|PG_SLEEP|PG_TERMINATE_BACKEND)\b",
    re.IGNORECASE,
)


def _pct_change(current, previous):
    current = float(current or 0)
    previous = float(previous or 0)
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def _kpi(value, previous):
    return {"value": value, "previous": previous, "change_pct": _pct_change(value, previous)}


def _avg_bill(revenue, bills):
    return round(float(revenue or 0) / bills, 2) if bills else 0.0


def _period_metrics(start, end):
    sales = ts_row(
        """
        SELECT COALESCE(SUM(bills), 0) AS bills,
               COALESCE(SUM(revenue), 0) AS revenue
          FROM sales_hourly
         WHERE bucket >= %s AND bucket < %s
        """,
        (start, end),
    )
    payments = ts_row(
        """
        SELECT COALESCE(SUM(payment_count), 0) AS payments,
               COALESCE(SUM(collected), 0) AS collected
          FROM payments_hourly
         WHERE bucket >= %s AND bucket < %s
        """,
        (start, end),
    )
    activity = ts_row(
        """
        SELECT COALESCE(SUM(orders_placed), 0) AS orders
          FROM order_activity_hourly
         WHERE bucket >= %s AND bucket < %s
        """,
        (start, end),
    )
    kitchen = ts_row(
        """
        SELECT COALESCE(SUM(orders_prepared), 0) AS prepared,
               COALESCE(
                   SUM(COALESCE(avg_prep_seconds, 0) * orders_prepared)
                   / NULLIF(SUM(orders_prepared), 0), 0
               ) AS avg_prep
          FROM kitchen_performance_hourly
         WHERE bucket >= %s AND bucket < %s
        """,
        (start, end),
    )
    cancelled = ts_row(
        """
        SELECT COUNT(*) FILTER (WHERE event_type = 'ORDER_CANCELLED')::int AS cancelled
          FROM order_event
         WHERE event_time >= %s AND event_time < %s
        """,
        (start, end),
    )
    return {
        "revenue": sales["revenue"],
        "bills": int(sales["bills"]),
        "collected": payments["collected"],
        "payments": int(payments["payments"]),
        "orders": int(activity["orders"]),
        "prepared": int(kitchen["prepared"]),
        "avg_prep": round(float(kitchen["avg_prep"] or 0)),
        "cancelled": int(cancelled["cancelled"]),
    }


def _event_totals(start, end):
    """Exact totals from the event log.

    Reconciliation reads raw events, not the continuous aggregates: a
    refresh can briefly overlap the real-time tail inside the open hour,
    so aggregates are eventually consistent while the event stream is exact.
    """
    return ts_row(
        """
        SELECT COUNT(*) FILTER (WHERE event_type = 'BILL_GENERATED') AS bills,
               COALESCE(SUM(amount) FILTER (WHERE event_type = 'BILL_GENERATED'), 0) AS revenue,
               COUNT(*) FILTER (WHERE event_type = 'PAYMENT_RECEIVED') AS payments,
               COALESCE(SUM(amount) FILTER (WHERE event_type = 'PAYMENT_RECEIVED'), 0) AS collected
          FROM order_event
         WHERE event_time >= %s AND event_time < %s
        """,
        (start, end),
    )


def _live_counts():
    return mysql_row(
        f"""
        SELECT
            (SELECT COUNT(*) FROM orders WHERE status IN {ACTIVE_SQL}) AS open_orders,
            (SELECT COUNT(*) FROM dining_table WHERE status = 'OCCUPIED') AS occupied_tables,
            (SELECT COUNT(*) FROM dining_table) AS total_tables
        """
    )


def _hour_label(hour):
    suffix = "AM" if hour < 12 else "PM"
    display = hour % 12 or 12
    return f"{display} {suffix}"


@analytics_bp.get("/dashboard")
def dashboard():
    days = query_days(7, 365)
    start, end = date_bounds(days)
    previous_start = start - timedelta(days=days)
    now = now_local()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    current = _period_metrics(start, end)
    previous = _period_metrics(previous_start, start)

    hourly_rows = ts_rows(
        """
        SELECT bucket, bills, revenue
          FROM sales_hourly
         WHERE bucket >= %s AND bucket < %s
         ORDER BY bucket
        """,
        (today_start, end),
    )
    by_hour = {row["bucket"].hour: row for row in hourly_rows}
    last_hour = max(now.hour, 10)
    hourly = []
    for hour in range(10, last_hour + 1):
        row = by_hour.get(hour)
        hourly.append(
            {
                "hour": hour,
                "label": _hour_label(hour),
                "revenue": row["revenue"] if row else 0,
                "bills": int(row["bills"]) if row else 0,
            }
        )
    today_rows = hourly_rows
    today_revenue = sum((row["revenue"] for row in today_rows), 0)
    today_bills = sum(int(row["bills"]) for row in today_rows)

    top_items = ts_rows(
        """
        SELECT item_name, category_name,
               SUM(quantity)::int AS quantity,
               SUM(amount) AS revenue
          FROM order_event
         WHERE event_type = 'ITEM_ADDED'
           AND event_time >= %s AND event_time < %s
         GROUP BY item_name, category_name
         ORDER BY revenue DESC
         LIMIT 6
        """,
        (start, end),
    )
    payment_mix = ts_rows(
        """
        SELECT payment_mode,
               COUNT(*)::int AS payments,
               SUM(amount) AS amount
          FROM order_event
         WHERE event_type = 'PAYMENT_RECEIVED'
           AND event_time >= %s AND event_time < %s
         GROUP BY payment_mode
         ORDER BY amount DESC
        """,
        (start, end),
    )
    order_types = ts_rows(
        """
        SELECT order_type, COUNT(*)::int AS orders
          FROM order_event
         WHERE event_type = 'ORDER_PLACED'
           AND event_time >= %s AND event_time < %s
         GROUP BY order_type
         ORDER BY orders DESC
        """,
        (start, end),
    )
    recent_events = ts_rows(
        """
        SELECT event_time, event_type, order_id, table_id, waiter_name,
               item_name, amount, payment_mode
          FROM order_event
         WHERE event_type IN ('ORDER_PLACED', 'ORDER_PREPARED', 'BILL_GENERATED',
                              'PAYMENT_RECEIVED', 'ORDER_CLOSED', 'ORDER_CANCELLED')
           AND event_time >= %s
         ORDER BY event_time DESC, event_id DESC
         LIMIT 15
        """,
        (start,),
    )

    live = _live_counts()
    active_orders = mysql_rows(
        f"""
        SELECT o.order_id, o.order_type, o.status, o.table_id, o.placed_at,
               w.name AS waiter_name,
               (SELECT COUNT(*) FROM order_item oi
                 WHERE oi.order_id = o.order_id) AS item_count,
               (SELECT COALESCE(SUM(oi.quantity * oi.price_at_order), 0)
                  FROM order_item oi WHERE oi.order_id = o.order_id) AS subtotal,
               b.bill_id, b.grand_total, b.payment_status
          FROM orders o
          JOIN staff w ON w.staff_id = o.waiter_id
          LEFT JOIN bill b ON b.order_id = o.order_id
         WHERE o.status IN {ACTIVE_SQL}
         ORDER BY FIELD(o.status, 'PLACED', 'PREPARING', 'PREPARED', 'BILLED'),
                  o.placed_at ASC
         LIMIT 10
        """
    )
    for order in active_orders:
        order["item_count"] = int(order["item_count"])

    today_status = mysql_rows(
        """
        SELECT status, COUNT(*) AS count
          FROM orders
         WHERE placed_at >= %s
         GROUP BY status
         ORDER BY FIELD(status, 'PLACED', 'PREPARING', 'PREPARED', 'BILLED', 'CLOSED', 'CANCELLED')
        """,
        (to_mysql(today_start),),
    )
    for row in today_status:
        row["count"] = int(row["count"])

    mysql_bills = mysql_row(
        """
        SELECT COUNT(*) AS bills, COALESCE(SUM(grand_total), 0) AS revenue
          FROM bill
         WHERE generated_at >= %s AND generated_at < %s
        """,
        (to_mysql(start), to_mysql(end)),
    )
    mysql_payments = mysql_row(
        """
        SELECT COUNT(*) AS payments, COALESCE(SUM(amount), 0) AS collected
          FROM payment
         WHERE payment_status = 'SUCCESS'
           AND payment_date >= %s AND payment_date < %s
        """,
        (to_mysql(start), to_mysql(end)),
    )
    try:
        sync = sync_status()
    except Exception:
        sync = {}

    events = _event_totals(start, end)
    revenue_difference = round(float(mysql_bills["revenue"]) - float(events["revenue"]), 2)
    bills_difference = int(mysql_bills["bills"]) - int(events["bills"])
    payments_difference = int(mysql_payments["payments"]) - int(events["payments"])

    return jsonify(
        {
            "range": {
                "days": days,
                "start": iso(start),
                "end": iso(end),
                "previous_start": iso(previous_start),
                "label": f"Last {days} days",
            },
            "kpis": {
                "revenue": _kpi(current["revenue"], previous["revenue"]),
                "bills": _kpi(current["bills"], previous["bills"]),
                "avg_bill": _kpi(
                    _avg_bill(current["revenue"], current["bills"]),
                    _avg_bill(previous["revenue"], previous["bills"]),
                ),
                "collected": _kpi(current["collected"], previous["collected"]),
                "payments": _kpi(current["payments"], previous["payments"]),
                "orders": _kpi(current["orders"], previous["orders"]),
                "avg_prep_seconds": _kpi(current["avg_prep"], previous["avg_prep"]),
                "cancelled": _kpi(current["cancelled"], previous["cancelled"]),
                "open_orders": live["open_orders"],
                "occupied_tables": live["occupied_tables"],
                "total_tables": live["total_tables"],
            },
            "today": {
                "revenue": today_revenue,
                "bills": today_bills,
            },
            "hourly": hourly,
            "top_items": top_items,
            "payment_mix": payment_mix,
            "order_types": order_types,
            "recent_events": recent_events,
            "active_orders": active_orders,
            "today_status": today_status,
            "reconciliation": {
                "mysql": {
                    "bills": int(mysql_bills["bills"]),
                    "revenue": mysql_bills["revenue"],
                    "payments": int(mysql_payments["payments"]),
                    "collected": mysql_payments["collected"],
                },
                "timescale": {
                    "bills": int(events["bills"]),
                    "revenue": events["revenue"],
                    "payments": int(events["payments"]),
                    "collected": events["collected"],
                },
                "revenue_difference": revenue_difference,
                "bills_difference": bills_difference,
                "payments_difference": payments_difference,
                "matched": revenue_difference == 0
                and bills_difference == 0
                and payments_difference == 0,
                "pending_events": sync.get("pending", 0) if sync else None,
            },
            "sync": sync,
        }
    )


@analytics_bp.get("/revenue-series")
def revenue_series():
    days = query_days(14, 365)
    start, end = date_bounds(days)

    mysql_daily = mysql_rows(
        """
        SELECT DATE(generated_at) AS day, COUNT(*) AS bills, SUM(grand_total) AS revenue
          FROM bill
         WHERE generated_at >= %s AND generated_at < %s
         GROUP BY DATE(generated_at)
         ORDER BY day
        """,
        (to_mysql(start), to_mysql(end)),
    )
    ts_daily = ts_rows(
        """
        SELECT time_bucket('1 day', bucket, 'Asia/Kolkata')::date AS day,
               SUM(bills)::int AS bills,
               SUM(revenue) AS revenue
          FROM sales_hourly
         WHERE bucket >= %s AND bucket < %s
         GROUP BY day
         ORDER BY day
        """,
        (start, end),
    )
    mysql_map = {row["day"].isoformat(): row for row in mysql_daily}
    ts_map = {row["day"].isoformat(): row for row in ts_daily}

    series = []
    day = start.date()
    while day <= end.date():
        key = day.isoformat()
        mysql_row_ = mysql_map.get(key)
        ts_row_ = ts_map.get(key)
        mysql_revenue = float(mysql_row_["revenue"]) if mysql_row_ else 0.0
        ts_revenue = float(ts_row_["revenue"]) if ts_row_ else 0.0
        series.append(
            {
                "date": key,
                "mysql_revenue": mysql_revenue,
                "timescale_revenue": ts_revenue,
                "mysql_bills": int(mysql_row_["bills"]) if mysql_row_ else 0,
                "timescale_bills": int(ts_row_["bills"]) if ts_row_ else 0,
                "difference": round(mysql_revenue - ts_revenue, 2),
            }
        )
        day += timedelta(days=1)

    mysql_total = round(sum(item["mysql_revenue"] for item in series), 2)
    ts_total = round(sum(item["timescale_revenue"] for item in series), 2)
    return jsonify(
        {
            "days": days,
            "start": iso(start),
            "end": iso(end),
            "series": series,
            "totals": {
                "mysql": mysql_total,
                "timescale": ts_total,
                "difference": round(mysql_total - ts_total, 2),
                "matched": abs(mysql_total - ts_total) < 0.01,
            },
        }
    )


@analytics_bp.get("/peak-hours")
def peak_hours():
    days = query_days(30, 365)
    start, _ = date_bounds(days)
    cells = ts_rows(
        """
        SELECT EXTRACT(ISODOW FROM bucket AT TIME ZONE 'Asia/Kolkata')::int AS dow,
               EXTRACT(HOUR FROM bucket AT TIME ZONE 'Asia/Kolkata')::int AS hour,
               SUM(bills)::int AS bills,
               SUM(revenue) AS revenue
          FROM sales_hourly
         WHERE bucket >= %s
         GROUP BY 1, 2
         ORDER BY 1, 2
        """,
        (start,),
    )
    max_revenue = max((float(cell["revenue"]) for cell in cells), default=0)
    return jsonify(
        {"days": days, "start": iso(start), "cells": cells, "max_revenue": max_revenue}
    )


@analytics_bp.get("/top-items")
def top_items():
    days = query_days(30, 365)
    limit = query_int("limit", 10, 1, 50)
    start, end = date_bounds(days)
    items = ts_rows(
        """
        WITH item_sales AS (
            SELECT item_name, category_name,
                   SUM(quantity)::int AS quantity,
                   SUM(amount) AS revenue
              FROM order_event
             WHERE event_type = 'ITEM_ADDED'
               AND event_time >= %s AND event_time < %s
             GROUP BY item_name, category_name
        )
        SELECT item_name, category_name, quantity, revenue,
               ROUND(100 * revenue / SUM(revenue) OVER (), 2) AS share_pct
          FROM item_sales
         ORDER BY revenue DESC
         LIMIT %s
        """,
        (start, end, limit),
    )
    totals = ts_row(
        """
        SELECT COALESCE(SUM(quantity), 0)::int AS units,
               COALESCE(SUM(amount), 0) AS revenue
          FROM order_event
         WHERE event_type = 'ITEM_ADDED'
           AND event_time >= %s AND event_time < %s
        """,
        (start, end),
    )
    categories = ts_rows(
        """
        SELECT category_name,
               SUM(quantity)::int AS quantity,
               SUM(amount) AS revenue
          FROM order_event
         WHERE event_type = 'ITEM_ADDED'
           AND event_time >= %s AND event_time < %s
         GROUP BY category_name
         ORDER BY revenue DESC
        """,
        (start, end),
    )
    return jsonify(
        {
            "days": days,
            "items": items,
            "categories": categories,
            "totals": totals,
        }
    )


@analytics_bp.get("/kitchen")
def kitchen():
    days = query_days(14, 365)
    start, end = date_bounds(days)

    summary = ts_row(
        """
        SELECT COUNT(*)::int AS prepared_orders,
               ROUND(AVG(prep_seconds))::int AS avg_seconds,
               COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY prep_seconds)::numeric)::int, 0) AS median_seconds,
               COALESCE(ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY prep_seconds)::numeric)::int, 0) AS p95_seconds,
               MAX(prep_seconds)::int AS max_seconds
          FROM order_event
         WHERE event_type = 'ORDER_PREPARED'
           AND prep_seconds IS NOT NULL
           AND event_time >= %s AND event_time < %s
        """,
        (start, end),
    )
    series = ts_rows(
        """
        SELECT time_bucket('1 day', event_time, 'Asia/Kolkata')::date AS day,
               COUNT(*)::int AS prepared,
               ROUND(AVG(prep_seconds))::int AS avg_seconds,
               MAX(prep_seconds)::int AS max_seconds
          FROM order_event
         WHERE event_type = 'ORDER_PREPARED'
           AND prep_seconds IS NOT NULL
           AND event_time >= %s AND event_time < %s
         GROUP BY day
         ORDER BY day
        """,
        (start, end),
    )
    chefs = ts_rows(
        """
        SELECT chef_name,
               COUNT(*)::int AS lines,
               SUM(quantity)::int AS items,
               SUM(amount) AS line_revenue
          FROM order_event
         WHERE event_type = 'ITEM_ADDED'
           AND chef_name IS NOT NULL
           AND event_time >= %s AND event_time < %s
         GROUP BY chef_name
         ORDER BY items DESC
         LIMIT 8
        """,
        (start, end),
    )
    slowest = ts_rows(
        """
        SELECT order_id, prep_seconds, order_type, waiter_name, event_time
          FROM order_event
         WHERE event_type = 'ORDER_PREPARED'
           AND prep_seconds IS NOT NULL
           AND event_time >= %s AND event_time < %s
         ORDER BY prep_seconds DESC
         LIMIT 8
        """,
        (start, end),
    )
    return jsonify(
        {
            "days": days,
            "summary": summary,
            "series": series,
            "chefs": chefs,
            "slowest": slowest,
        }
    )


@analytics_bp.get("/payments")
def payments():
    days = query_days(14, 365)
    start, end = date_bounds(days)
    daily = ts_rows(
        """
        SELECT time_bucket('1 day', event_time, 'Asia/Kolkata')::date AS day,
               COUNT(*)::int AS payments,
               SUM(amount) AS collected,
               SUM(amount) FILTER (WHERE payment_mode = 'CASH')   AS cash,
               SUM(amount) FILTER (WHERE payment_mode = 'CARD')   AS card,
               SUM(amount) FILTER (WHERE payment_mode = 'UPI')    AS upi,
               SUM(amount) FILTER (WHERE payment_mode = 'ONLINE') AS online
          FROM order_event
         WHERE event_type = 'PAYMENT_RECEIVED'
           AND event_time >= %s AND event_time < %s
         GROUP BY day
         ORDER BY day
        """,
        (start, end),
    )
    mix = ts_rows(
        """
        SELECT payment_mode,
               COUNT(*)::int AS payments,
               SUM(amount) AS amount,
               ROUND(AVG(amount), 2) AS avg_payment,
               ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS payment_share_pct
          FROM order_event
         WHERE event_type = 'PAYMENT_RECEIVED'
           AND event_time >= %s AND event_time < %s
         GROUP BY payment_mode
         ORDER BY amount DESC
        """,
        (start, end),
    )
    summary = ts_row(
        """
        SELECT COUNT(*)::int AS payments,
               COALESCE(SUM(amount), 0) AS collected,
               COALESCE(ROUND(AVG(amount), 2), 0) AS avg_payment,
               COALESCE(MAX(amount), 0) AS largest_payment
          FROM order_event
         WHERE event_type = 'PAYMENT_RECEIVED'
           AND event_time >= %s AND event_time < %s
        """,
        (start, end),
    )
    billed = ts_row(
        """
        SELECT COALESCE(SUM(revenue), 0) AS revenue
          FROM sales_hourly
         WHERE bucket >= %s AND bucket < %s
        """,
        (start, end),
    )
    collected = float(summary["collected"] or 0)
    billed_revenue = float(billed["revenue"] or 0)
    summary["billed_revenue"] = billed["revenue"]
    summary["collection_efficiency_pct"] = (
        round(collected / billed_revenue * 100, 1) if billed_revenue else None
    )
    return jsonify(
        {
            "days": days,
            "daily": daily,
            "mix": mix,
            "summary": summary,
        }
    )


@analytics_bp.get("/order-flow")
def order_flow():
    days = query_days(14, 365)
    start, end = date_bounds(days)
    daily = ts_rows(
        """
        SELECT time_bucket('1 day', event_time, 'Asia/Kolkata')::date AS day,
               COUNT(*) FILTER (WHERE event_type = 'ORDER_PLACED')::int    AS placed,
               COUNT(*) FILTER (WHERE event_type = 'ORDER_PREPARED')::int  AS prepared,
               COUNT(*) FILTER (WHERE event_type = 'BILL_GENERATED')::int  AS billed,
               COUNT(*) FILTER (WHERE event_type = 'ORDER_CLOSED')::int    AS closed,
               COUNT(*) FILTER (WHERE event_type = 'ORDER_CANCELLED')::int AS cancelled
          FROM order_event
         WHERE event_time >= %s AND event_time < %s
         GROUP BY day
         ORDER BY day
        """,
        (start, end),
    )
    funnel = {
        "placed": sum(row["placed"] for row in daily),
        "prepared": sum(row["prepared"] for row in daily),
        "billed": sum(row["billed"] for row in daily),
        "closed": sum(row["closed"] for row in daily),
        "cancelled": sum(row["cancelled"] for row in daily),
    }
    funnel["closure_rate_pct"] = (
        round(funnel["closed"] / funnel["placed"] * 100, 1) if funnel["placed"] else None
    )
    funnel["cancellation_rate_pct"] = (
        round(funnel["cancelled"] / funnel["placed"] * 100, 1) if funnel["placed"] else None
    )
    order_types = ts_rows(
        """
        SELECT order_type, COUNT(*)::int AS orders
          FROM order_event
         WHERE event_type = 'ORDER_PLACED'
           AND event_time >= %s AND event_time < %s
         GROUP BY order_type
         ORDER BY orders DESC
        """,
        (start, end),
    )
    return jsonify(
        {"days": days, "daily": daily, "funnel": funnel, "order_types": order_types}
    )


def _pretty_bytes(value):
    value = float(value or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}"
        value /= 1024


@analytics_bp.get("/storage")
def storage():
    hypertable = ts_row(
        """
        SELECT hypertable_size('order_event')::bigint AS bytes,
               pg_size_pretty(hypertable_size('order_event')) AS pretty
        """
    )
    compression = ts_row(
        """
        SELECT COUNT(*)::int AS total_chunks,
               COUNT(*) FILTER (WHERE compression_status = 'Compressed')::int AS compressed_chunks,
               COALESCE(SUM(before_compression_total_bytes), 0)::bigint AS before_bytes,
               COALESCE(SUM(after_compression_total_bytes), 0)::bigint AS after_bytes
          FROM chunk_compression_stats('order_event')
        """
    )
    chunks = ts_rows(
        """
        SELECT s.chunk_name, s.compression_status,
               c.range_start::date AS range_start,
               c.range_end::date AS range_end,
               s.before_compression_total_bytes AS before_bytes,
               s.after_compression_total_bytes AS after_bytes,
               pg_size_pretty(s.before_compression_total_bytes) AS before_pretty,
               pg_size_pretty(s.after_compression_total_bytes) AS after_pretty
          FROM chunk_compression_stats('order_event') s
          LEFT JOIN timescaledb_information.chunks c
                 ON c.chunk_name = s.chunk_name
                AND c.hypertable_name = 'order_event'
         ORDER BY c.range_start DESC
        """
    )
    caggs = ts_rows(
        """
        WITH sizes AS (
            SELECT view_name,
                   materialization_hypertable_name,
                   pg_total_relation_size(
                       format('%I.%I', materialization_hypertable_schema,
                              materialization_hypertable_name)::regclass
                   ) AS bytes
              FROM timescaledb_information.continuous_aggregates
        )
        SELECT view_name, materialization_hypertable_name, bytes,
               pg_size_pretty(bytes) AS pretty
          FROM sizes
         ORDER BY view_name
        """
    )
    mysql_tables = mysql_rows(
        """
        SELECT table_name       AS table_name,
               table_rows       AS row_count,
               data_length      AS data_bytes,
               index_length     AS index_bytes,
               data_length + index_length AS total_bytes
          FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name IN ('orders', 'order_item', 'bill', 'payment', 'customer',
                              'menu_item', 'analytics_outbox')
         ORDER BY total_bytes DESC
        """
    )
    for table in mysql_tables:
        table["pretty"] = _pretty_bytes(table["total_bytes"])
        table["row_count"] = int(table["row_count"] or 0)
    mysql_total = sum(int(table["total_bytes"] or 0) for table in mysql_tables)
    before = int(compression["before_bytes"] or 0)
    after = int(compression["after_bytes"] or 0)
    try:
        sync = sync_status()
    except Exception:
        sync = {}
    return jsonify(
        {
            "timescale": {
                "hypertable": {
                    "name": "order_event",
                    "bytes": int(hypertable["bytes"]),
                    "pretty": hypertable["pretty"],
                },
                "chunks": {
                    "total": int(compression["total_chunks"]),
                    "compressed": int(compression["compressed_chunks"]),
                    "uncompressed": int(compression["total_chunks"])
                    - int(compression["compressed_chunks"]),
                },
                "compression": {
                    "before_bytes": before,
                    "after_bytes": after,
                    "before_pretty": _pretty_bytes(before),
                    "after_pretty": _pretty_bytes(after),
                    "pct_of_original": round(after / before * 100, 1) if before else None,
                    "chunk_details": chunks,
                },
                "continuous_aggregates": caggs,
            },
            "mysql": {
                "tables": mysql_tables,
                "total_bytes": mysql_total,
                "total_pretty": _pretty_bytes(mysql_total),
            },
            "sync": sync,
        }
    )


SQL_LAB_ROW_LIMIT = 500


def _capped(sql):
    """Bound results server-side so the cursor is always fully consumed.

    MySQL's default cursor is unbuffered: leaving rows unread makes
    cursor.close() raise "Unread result found". One extra row travels back
    so the caller can still flag truncation.
    """
    return f"SELECT * FROM (\n{sql}\n) AS sql_lab_result LIMIT {SQL_LAB_ROW_LIMIT + 1}"


def _prepare_sql(raw):
    sql = (raw or "").strip()
    if not sql:
        raise ApiError("SQL is required.")
    if len(sql) > 12000:
        raise ApiError("SQL must be 12,000 characters or fewer.")
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    if ";" in sql:
        raise ApiError("Only one read-only statement can be executed at a time.")
    while True:
        stripped = sql.lstrip()
        if stripped.startswith("--"):
            newline = stripped.find("\n")
            if newline == -1:
                raise ApiError("SQL statement is empty.")
            sql = stripped[newline + 1 :]
        elif stripped.startswith("/*"):
            end = stripped.find("*/")
            if end == -1:
                raise ApiError("Unclosed SQL comment.")
            sql = stripped[end + 2 :]
        else:
            sql = stripped
            break
    keyword = sql.split(None, 1)[0].upper() if sql else ""
    if keyword not in ("SELECT", "WITH"):
        raise ApiError("Only read-only SELECT or WITH queries are allowed in the SQL Lab.")
    if READ_ONLY_DENY.search(sql):
        raise ApiError("This statement contains a write operation. The SQL Lab is read-only.")
    return sql


def _execute_mysql(sql):
    with mysql_read() as conn:
        try:
            with cursor(conn) as cur:
                cur.execute("SET SESSION MAX_EXECUTION_TIME = 8000")
            conn.commit()
            conn.start_transaction(readonly=True)
            started = perf_counter()
            with cursor(conn) as cur:
                cur.execute(_capped(sql))
                columns = [col[0] for col in (cur.description or [])]
                rows = cur.fetchall()
            elapsed = (perf_counter() - started) * 1000
        except mysql.connector.Error as exc:
            raise ApiError(f"MySQL: {exc.msg}", 400)
        finally:
            try:
                conn.rollback()
            except Exception:
                pass
    return columns, rows, elapsed


def _execute_ts(sql):
    with ts_conn() as conn:
        try:
            conn.execute("BEGIN READ ONLY")
            conn.execute("SET LOCAL statement_timeout = '8000ms'")
            started = perf_counter()
            with conn.cursor() as cur:
                cur.execute(_capped(sql))
                columns = [desc.name for desc in (cur.description or [])]
                rows = cur.fetchall()
            elapsed = (perf_counter() - started) * 1000
        except psycopg.Error as exc:
            message = str(exc)
            diag = getattr(exc, "diag", None)
            if diag is not None and getattr(diag, "message_primary", None):
                message = diag.message_primary
            raise ApiError(f"TimescaleDB: {message}", 400)
        finally:
            try:
                conn.rollback()
            except Exception:
                pass
    return columns, rows, elapsed


@analytics_bp.get("/sql")
def sql_catalog():
    return jsonify(
        {
            "queries": CATALOG,
            "databases": [
                {"id": "timescale", "label": "TimescaleDB", "dialect": "PostgreSQL 17"},
                {"id": "mysql", "label": "MySQL", "dialect": "MySQL 8.4"},
            ],
        }
    )


@analytics_bp.post("/sql")
def run_sql():
    data = json_body()
    query_id = (data.get("query_id") or "").strip()
    if query_id:
        entry = find(query_id)
        if entry is None:
            raise ApiError("Saved query not found.", 404)
        db = entry["db"]
        sql = entry["sql"]
        title = entry["title"]
    else:
        db = data.get("db")
        if db not in ("mysql", "timescale"):
            raise ApiError("db must be mysql or timescale.")
        sql = _prepare_sql(require(data, "sql", "SQL"))
        title = "Ad-hoc query"

    if db == "mysql":
        columns, rows, elapsed = _execute_mysql(sql)
    else:
        columns, rows, elapsed = _execute_ts(sql)

    truncated = len(rows) > SQL_LAB_ROW_LIMIT
    rows = rows[:SQL_LAB_ROW_LIMIT]
    return jsonify(
        {
            "query": {"id": query_id or None, "title": title, "db": db},
            "result": {
                "columns": columns,
                "rows": rows,
                "row_count": len(rows),
                "truncated": truncated,
                "elapsed_ms": round(elapsed, 2),
                "read_only": True,
            },
        }
    )


@analytics_bp.post("/benchmark")
def benchmark():
    data = json_body(required=False)
    days = as_int(data.get("days", 90), "days", 7, 300)
    iterations = as_int(data.get("iterations", 5), "iterations", 2, 10)
    return jsonify(run_benchmark(days=days, iterations=iterations))
