import json
import logging
from datetime import timedelta
from decimal import Decimal

from .db import cursor, mysql_tx, ts_conn
from .timeutil import LOCAL_TZ, to_mysql

log = logging.getLogger(__name__)

VALID_EVENT_TYPES = {
    "ORDER_PLACED",
    "ITEM_ADDED",
    "ORDER_PREPARING",
    "ORDER_PREPARED",
    "BILL_GENERATED",
    "PAYMENT_RECEIVED",
    "ORDER_CLOSED",
    "ORDER_CANCELLED",
}

EVENT_FIELDS = (
    "order_type",
    "table_id",
    "customer_id",
    "waiter_id",
    "waiter_name",
    "chef_id",
    "chef_name",
    "item_id",
    "item_name",
    "category_name",
    "quantity",
    "amount",
    "payment_mode",
    "bill_id",
    "payment_id",
    "prep_seconds",
)

TS_INSERT_SQL = """
INSERT INTO order_event (
    event_time, event_type, order_id, order_type, table_id, customer_id,
    waiter_id, waiter_name, chef_id, chef_name, item_id, item_name,
    category_name, quantity, amount, payment_mode, bill_id, payment_id,
    prep_seconds, source_outbox_id
) VALUES (
    %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s,
    %s, %s
)
ON CONFLICT (source_outbox_id, event_time) DO NOTHING
"""


def _json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Cannot serialize {type(value)!r}")


def record_event(conn, event_type: str, event_time, order_id: int, **fields):
    """Insert one domain event into the transactional outbox."""
    if event_type not in VALID_EVENT_TYPES:
        raise ValueError(f"Unknown event type: {event_type}")

    payload = {"order_id": int(order_id)}
    payload.update({key: fields.get(key) for key in EVENT_FIELDS if key in fields})

    with cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO analytics_outbox (event_time, event_type, payload)
            VALUES (%s, %s, %s)
            """,
            (
                to_mysql(event_time),
                event_type,
                json.dumps(payload, ensure_ascii=False, default=_json_default),
            ),
        )


def _to_ts_row(row):
    payload = row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    event_time = row["event_time"].replace(tzinfo=LOCAL_TZ)
    values = [
        event_time,
        row["event_type"],
        payload.get("order_id"),
        payload.get("order_type"),
        payload.get("table_id"),
        payload.get("customer_id"),
        payload.get("waiter_id"),
        payload.get("waiter_name"),
        payload.get("chef_id"),
        payload.get("chef_name"),
        payload.get("item_id"),
        payload.get("item_name"),
        payload.get("category_name"),
        payload.get("quantity"),
        payload.get("amount"),
        payload.get("payment_mode"),
        payload.get("bill_id"),
        payload.get("payment_id"),
        payload.get("prep_seconds"),
        row["outbox_id"],
    ]
    return tuple(values)


CAGG_VIEWS = (
    "sales_hourly",
    "order_activity_hourly",
    "payments_hourly",
    "kitchen_performance_hourly",
)


def _refresh_hours(event_times):
    """Refresh the hourly buckets touched by a projected batch.

    TimescaleDB's real-time tail cannot expose rows written into a bucket that
    a refresh already materialized, so drain-then-refresh keeps the dashboard
    reconciliation exact without waiting for the 30-minute policy.
    """
    if not event_times:
        return
    earliest = min(event_times).replace(tzinfo=LOCAL_TZ, minute=0, second=0, microsecond=0)
    latest = max(event_times).replace(tzinfo=LOCAL_TZ, minute=0, second=0, microsecond=0)
    end = latest + timedelta(hours=1)
    try:
        with ts_conn() as conn:
            with conn.cursor() as cur:
                for view in CAGG_VIEWS:
                    cur.execute(
                        f"CALL refresh_continuous_aggregate('{view}', %s, %s)",
                        (earliest, end),
                    )
            conn.commit()
    except Exception:
        log.exception("Continuous aggregate refresh failed")


def project_pending(batch_size: int = 500, max_batches: int = 40):
    """Move outbox events into TimescaleDB. Safe to call repeatedly (idempotent)."""
    projected = 0
    batches = 0
    error = None
    projected_times = []

    while batches < max_batches:
        with mysql_tx() as conn:
            with cursor(conn) as cur:
                cur.execute(
                    """
                    SELECT outbox_id, event_time, event_type, payload
                      FROM analytics_outbox
                     WHERE processed_at IS NULL
                     ORDER BY outbox_id
                     LIMIT %s
                     FOR UPDATE SKIP LOCKED
                    """,
                    (batch_size,),
                )
                rows = cur.fetchall()

            if not rows:
                break

            ids = [row["outbox_id"] for row in rows]
            placeholders = ",".join(["%s"] * len(ids))

            try:
                with ts_conn() as ts:
                    with ts.cursor() as tscur:
                        tscur.executemany(TS_INSERT_SQL, [_to_ts_row(row) for row in rows])

                with cursor(conn) as cur:
                    cur.execute(
                        f"""
                        UPDATE analytics_outbox
                           SET processed_at = NOW(6),
                               attempts = attempts + 1,
                               last_error = NULL
                         WHERE outbox_id IN ({placeholders})
                        """,
                        ids,
                    )
            except Exception as exc:  # analytics failures must not roll back POS commits
                error = str(exc)[:480]
                log.exception("Analytics projection failed")
                with cursor(conn) as cur:
                    cur.executemany(
                        """
                        UPDATE analytics_outbox
                           SET attempts = attempts + 1,
                               last_error = %s
                         WHERE outbox_id = %s
                        """,
                        [(error, outbox_id) for outbox_id in ids],
                    )
                break

        projected += len(rows)
        projected_times.extend(row["event_time"] for row in rows)
        batches += 1

    _refresh_hours(projected_times)

    result = {"projected": projected, "batches": batches, "error": error}
    result.update(sync_status())
    return result


def project_pending_safe():
    try:
        return project_pending()
    except Exception as exc:
        log.exception("Analytics projector unavailable")
        return {"projected": 0, "batches": 0, "error": str(exc)[:480]}


def sync_status():
    with mysql_tx() as conn:
        with cursor(conn) as cur:
            cur.execute(
                """
                SELECT
                    COALESCE(SUM(processed_at IS NULL), 0) AS pending,
                    COALESCE(SUM(processed_at IS NULL AND attempts > 0), 0) AS failed,
                    COALESCE(SUM(processed_at IS NOT NULL), 0) AS processed,
                    MAX(processed_at) AS last_processed_at,
                    MAX(created_at) AS last_event_at
                  FROM analytics_outbox
                """
            )
            row = cur.fetchone()
    return {k: (int(v) if isinstance(v, Decimal) else v) for k, v in row.items()}
