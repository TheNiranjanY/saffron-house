import logging

from flask import Blueprint, jsonify

from restaurant.db import cursor, mysql_read, ts_rows
from restaurant.events import sync_status
from restaurant.timeutil import iso, now_local

from .utils import sync_analytics

log = logging.getLogger(__name__)
system_bp = Blueprint("system", __name__, url_prefix="/api")


@system_bp.get("/health")
def health():
    payload = {
        "status": "ok",
        "checked_at": iso(now_local()),
        "stores": {},
        "counts": {},
        "sync": None,
    }
    try:
        with mysql_read() as conn, cursor(conn) as cur:
            cur.execute("SELECT VERSION() AS version")
            version = cur.fetchone()["version"]
            cur.execute(
                """
                SELECT (SELECT COUNT(*) FROM orders)                 AS orders,
                       (SELECT COUNT(*) FROM bill)                   AS bills,
                       (SELECT COUNT(*) FROM payment)                AS payments,
                       (SELECT COUNT(*) FROM dining_table
                         WHERE status = 'OCCUPIED')                  AS occupied_tables,
                       (SELECT COUNT(*) FROM orders
                         WHERE status IN ('PLACED','PREPARING','PREPARED','BILLED')) AS open_orders,
                       (SELECT COUNT(*) FROM analytics_outbox
                         WHERE processed_at IS NULL)                 AS pending_events
                """
            )
            payload["stores"]["mysql"] = {"ok": True, "version": version}
            payload["counts"] = {k: int(v) for k, v in cur.fetchone().items()}
        try:
            payload["sync"] = sync_status()
        except Exception:
            log.exception("Could not read outbox status")
    except Exception as exc:
        log.exception("MySQL health check failed")
        payload["status"] = "degraded"
        payload["stores"]["mysql"] = {"ok": False, "error": str(exc)}

    try:
        rows = ts_rows(
            """
            SELECT extversion AS version FROM pg_extension WHERE extname = 'timescaledb'
            """
        )
        event_count = ts_rows("SELECT COUNT(*)::bigint AS events FROM order_event")[0]["events"]
        chunks = ts_rows(
            """
            SELECT COUNT(*)::int AS chunks FROM timescaledb_information.chunks
             WHERE hypertable_name = 'order_event'
            """
        )[0]["chunks"]
        payload["stores"]["timescale"] = {
            "ok": True,
            "version": rows[0]["version"] if rows else None,
            "events": int(event_count),
            "chunks": chunks,
        }
        payload["counts"]["events"] = int(event_count)
    except Exception as exc:
        log.exception("TimescaleDB health check failed")
        payload["status"] = "degraded"
        payload["stores"]["timescale"] = {"ok": False, "error": str(exc)}

    return jsonify(payload)


@system_bp.post("/system/sync")
def sync_now():
    return jsonify({"sync": sync_analytics()})
