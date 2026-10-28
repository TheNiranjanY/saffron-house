"""Small, honest latency comparison between the two stores.

Both databases run in Docker on the same host, against the same seeded
restaurant history. Medians over warm runs are reported; see notes.
"""

from statistics import mean, median
from time import perf_counter

from .db import mysql_rows, ts_row, ts_rows
from .timeutil import date_bounds, iso, to_mysql


def _stats(samples, row_count):
    ordered = sorted(samples)
    return {
        "samples_ms": [round(value, 3) for value in samples],
        "min_ms": round(ordered[0], 3),
        "median_ms": round(median(ordered), 3),
        "mean_ms": round(mean(ordered), 3),
        "rows": row_count,
    }


def _measure(stores, iterations):
    """Interleave stores so host-load drift does not favour whichever runs first."""
    names = list(stores)
    for fn in stores.values():
        fn()  # warm-up, excluded
    samples = {name: [] for name in names}
    row_counts = {}
    for index in range(iterations):
        order = names if index % 2 == 0 else list(reversed(names))
        for name in order:
            started = perf_counter()
            rows = stores[name]()
            samples[name].append((perf_counter() - started) * 1000)
            row_counts[name] = len(rows)
    return {name: _stats(samples[name], row_counts[name]) for name in names}


def _speedup(baseline, candidate):
    if not candidate["median_ms"]:
        return None
    return round(baseline["median_ms"] / candidate["median_ms"], 2)


def run_benchmark(days=90, iterations=5):
    start, now = date_bounds(days)
    hourly_start, _ = date_bounds(7)
    mysql_start = to_mysql(start)
    mysql_hourly_start = to_mysql(hourly_start)

    def mysql_daily_revenue():
        return mysql_rows(
            """
            SELECT DATE(generated_at) AS day,
                   COUNT(*)           AS bills,
                   SUM(grand_total)   AS revenue
              FROM bill
             WHERE generated_at >= %s
             GROUP BY DATE(generated_at)
             ORDER BY day
            """,
            (mysql_start,),
        )

    def ts_raw_daily_revenue():
        return ts_rows(
            """
            SELECT time_bucket('1 day', event_time, 'Asia/Kolkata')::date AS day,
                   COUNT(*)::int AS bills,
                   SUM(amount)   AS revenue
              FROM order_event
             WHERE event_type = 'BILL_GENERATED'
               AND event_time >= %s
             GROUP BY day
             ORDER BY day
            """,
            (start,),
        )

    def ts_cagg_daily_revenue():
        return ts_rows(
            """
            SELECT time_bucket('1 day', bucket, 'Asia/Kolkata')::date AS day,
                   SUM(bills)::int AS bills,
                   SUM(revenue)   AS revenue
              FROM sales_hourly
             WHERE bucket >= %s
             GROUP BY day
             ORDER BY day
            """,
            (start,),
        )

    def mysql_hourly_revenue():
        return mysql_rows(
            """
            SELECT DATE(generated_at) AS day,
                   HOUR(generated_at) AS hour,
                   COUNT(*) AS bills,
                   SUM(grand_total) AS revenue
              FROM bill
             WHERE generated_at >= %s
             GROUP BY DATE(generated_at), HOUR(generated_at)
             ORDER BY day, hour
            """,
            (mysql_hourly_start,),
        )

    def ts_cagg_hourly_revenue():
        return ts_rows(
            """
            SELECT bucket AS hour, bills, revenue
              FROM sales_hourly
             WHERE bucket >= %s
             ORDER BY bucket
            """,
            (hourly_start,),
        )

    def mysql_top_items():
        return mysql_rows(
            """
            SELECT mi.name AS item_name,
                   SUM(oi.quantity) AS qty,
                   SUM(oi.quantity * oi.price_at_order) AS revenue
              FROM order_item oi
              JOIN menu_item mi ON mi.item_id = oi.item_id
              JOIN orders o ON o.order_id = oi.order_id
             WHERE o.placed_at >= %s
             GROUP BY mi.item_id, mi.name
             ORDER BY revenue DESC
             LIMIT 10
            """,
            (mysql_start,),
        )

    def ts_raw_top_items():
        return ts_rows(
            """
            SELECT item_name,
                   SUM(quantity)::int AS qty,
                   SUM(amount) AS revenue
              FROM order_event
             WHERE event_type = 'ITEM_ADDED'
               AND event_time >= %s
             GROUP BY item_name
             ORDER BY revenue DESC
             LIMIT 10
            """,
            (start,),
        )

    daily = _measure(
        {
            "mysql": mysql_daily_revenue,
            "timescale_raw": ts_raw_daily_revenue,
            "timescale_cagg": ts_cagg_daily_revenue,
        },
        iterations,
    )
    hourly = _measure(
        {"mysql": mysql_hourly_revenue, "timescale_cagg": ts_cagg_hourly_revenue},
        iterations,
    )
    top_items = _measure(
        {"mysql": mysql_top_items, "timescale_raw": ts_raw_top_items},
        iterations,
    )

    results = {
        "daily_revenue": {
            "name": "90-day daily revenue rollup",
            **daily,
            "raw_speedup": _speedup(daily["mysql"], daily["timescale_raw"]),
            "cagg_speedup": _speedup(daily["mysql"], daily["timescale_cagg"]),
        },
        "hourly_revenue": {
            "name": "7-day hourly revenue rollup",
            **hourly,
            "cagg_speedup": _speedup(hourly["mysql"], hourly["timescale_cagg"]),
        },
        "top_items": {
            "name": "Top 10 menu items by revenue",
            **top_items,
            "raw_speedup": _speedup(top_items["mysql"], top_items["timescale_raw"]),
        },
    }

    mysql_revenue = mysql_rows(
        "SELECT COALESCE(SUM(grand_total), 0) AS revenue, COUNT(*) AS bills "
        "FROM bill WHERE generated_at >= %s",
        (mysql_start,),
    )[0]
    ts_revenue = ts_row(
        """
        SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*)::int AS bills
          FROM order_event
         WHERE event_type = 'BILL_GENERATED' AND event_time >= %s
        """,
        (start,),
    )
    events = ts_row(
        "SELECT COUNT(*)::bigint AS events FROM order_event WHERE event_time >= %s",
        (start,),
    )

    return {
        "generated_at": iso(now),
        "window": {"days": days, "start": iso(start), "end": iso(now)},
        "dataset": {
            "events": int(events["events"]),
            "mysql_bills": int(mysql_revenue["bills"]),
            "ts_bills": int(ts_revenue["bills"]),
        },
        "reconciliation": {
            "mysql_revenue": float(mysql_revenue["revenue"]),
            "timescale_revenue": float(ts_revenue["revenue"]),
            "difference": round(float(mysql_revenue["revenue"]) - float(ts_revenue["revenue"]), 2),
            "matched": abs(float(mysql_revenue["revenue"]) - float(ts_revenue["revenue"])) < 0.01,
        },
        "iterations": iterations,
        "results": results,
        "notes": [
            "Both stores run in Docker on the same host; medians exclude one warm-up run.",
            "Samples alternate store order each round so background load does not favour one store.",
            "Windows follow Asia/Kolkata calendar days, so raw scans and continuous aggregates cover identical events.",
            "MySQL reads normalized bill, order_item and menu rows through joins and indexes.",
            "TimescaleDB reads a deliberately denormalized event hypertable.",
            "CAGG timings benefit from pre-computed rollups; raw timings are the closer engine-to-engine comparison.",
            "Roughly 120 restaurant days of seeded history (~30k orders, ~286k events); the 90-day window above holds ~214k of them — directional, not a production benchmark.",
        ],
    }
