from datetime import timedelta

from flask import Blueprint, jsonify, request

from restaurant.db import cursor, mysql_read, mysql_tx
from restaurant.errors import ApiError
from restaurant.order_service import (
    ACTIVE_STATUSES,
    emit_cancelled,
    emit_item_added,
    emit_order_placed,
    emit_prepared,
    emit_preparing,
    fetch_new_items,
    fetch_order_detail,
    max_line_no,
    order_context,
)
from restaurant.timeutil import from_mysql, now_local, to_mysql

from .utils import (
    as_int,
    enum_value,
    json_body,
    optional_int,
    query_date,
    sync_analytics,
)

orders_bp = Blueprint("orders", __name__, url_prefix="/api/orders")

ORDER_TYPES = ("DINE_IN", "TAKEAWAY", "DELIVERY")
ORDER_STATUSES = ("PLACED", "PREPARING", "PREPARED", "BILLED", "CLOSED", "CANCELLED")
MANUAL_TRANSITIONS = {
    "PLACED": {"PREPARING", "CANCELLED"},
    "PREPARING": {"PREPARED", "CANCELLED"},
    "PREPARED": {"CANCELLED"},
}
ACTIVE_SQL = "('PLACED', 'PREPARING', 'PREPARED', 'BILLED')"


def _normalize_items(raw):
    if not isinstance(raw, list) or not raw:
        raise ApiError("At least one order item is required.")
    if len(raw) > 40:
        raise ApiError("An order can contain at most 40 item lines.")
    items = []
    for index, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            raise ApiError(f"items[{index}] must be an object.")
        items.append(
            {
                "item_id": as_int(entry.get("item_id"), f"items[{index}].item_id", 1),
                "chef_id": as_int(entry.get("chef_id"), f"items[{index}].chef_id", 1),
                "quantity": as_int(
                    entry.get("quantity", 1), f"items[{index}].quantity", 1, 50
                ),
            }
        )
    return items


def _insert_items(conn, order_id, items):
    for item in items:
        with cursor(conn) as cur:
            cur.execute(
                "CALL add_order_item(%s, %s, %s, %s, @line_no)",
                (order_id, item["item_id"], item["chef_id"], item["quantity"]),
            )


def _active_count(conn):
    with cursor(conn) as cur:
        cur.execute(
            f"SELECT status, COUNT(*) AS count FROM orders WHERE status IN {ACTIVE_SQL} GROUP BY status"
        )
        return {row["status"]: int(row["count"]) for row in cur.fetchall()}


@orders_bp.get("")
def list_orders():
    scope = request.args.get("scope", "today")
    if scope not in ("today", "active", "all"):
        raise ApiError("scope must be today, active or all.")
    status = request.args.get("status")
    if status:
        status = enum_value(status, "status", ORDER_STATUSES)
    order_type = request.args.get("order_type")
    if order_type:
        order_type = enum_value(order_type, "order_type", ORDER_TYPES)
    limit = min(max(int(request.args.get("limit", 25)), 1), 100)
    offset = max(int(request.args.get("offset", 0)), 0)
    search = (request.args.get("q") or "").strip()
    date_filter = query_date()
    if date_filter is None and scope == "today":
        date_filter = now_local().date()

    where = ["1 = 1"]
    params = []
    if scope == "active":
        where.append(f"o.status IN {ACTIVE_SQL}")
    if date_filter:
        where.append("DATE(o.placed_at) = %s")
        params.append(date_filter)
    if status:
        where.append("o.status = %s")
        params.append(status)
    if order_type:
        where.append("o.order_type = %s")
        params.append(order_type)
    if search:
        like = f"%{search}%"
        where.append(
            "(CAST(o.order_id AS CHAR) LIKE %s OR c.name LIKE %s OR w.name LIKE %s)"
        )
        params.extend([like, like, like])

    where_sql = " AND ".join(where)
    base_from = """
          FROM orders o
          JOIN staff w ON w.staff_id = o.waiter_id
          LEFT JOIN customer c ON c.customer_id = o.customer_id
     LEFT JOIN bill b ON b.order_id = o.order_id
     LEFT JOIN (
           SELECT order_id, COUNT(*) AS item_count,
                  SUM(quantity * price_at_order) AS subtotal
             FROM order_item
            GROUP BY order_id
          ) oi ON oi.order_id = o.order_id
    """

    with mysql_read() as conn, cursor(conn) as cur:
        cur.execute(f"SELECT COUNT(*) AS total {base_from} WHERE {where_sql}", tuple(params))
        total = int(cur.fetchone()["total"])
        cur.execute(
            f"""
            SELECT o.order_id, o.order_type, o.status, o.table_id, o.customer_id,
                   o.waiter_id, w.name AS waiter_name, c.name AS customer_name,
                   o.placed_at, o.prepared_at, o.closed_at, o.notes,
                   COALESCE(oi.item_count, 0) AS item_count,
                   oi.subtotal AS items_subtotal,
                   b.bill_id, b.grand_total, b.payment_status
            {base_from}
             WHERE {where_sql}
             ORDER BY o.placed_at DESC, o.order_id DESC
             LIMIT %s OFFSET %s
            """,
            tuple(params + [limit, offset]),
        )
        rows = cur.fetchall()
        for row in rows:
            row["item_count"] = int(row["item_count"])
        active = _active_count(conn)

    return jsonify(
        {
            "orders": rows,
            "total": total,
            "limit": limit,
            "offset": offset,
            "active_summary": active,
        }
    )


@orders_bp.get("/<int:order_id>")
def get_order(order_id):
    detail = fetch_order_detail(order_id)
    if detail is None:
        raise ApiError("Order not found.", 404)
    return jsonify(detail)


@orders_bp.post("")
def create_order():
    data = json_body()
    order_type = enum_value(
        data.get("order_type", "DINE_IN"), "order_type", ORDER_TYPES
    )
    waiter_id = as_int(data.get("waiter_id"), "waiter_id", 1)
    table_id = optional_int(data.get("table_id"), "table_id", 1)
    customer_id = optional_int(data.get("customer_id"), "customer_id", 1)
    notes = (data.get("notes") or "").strip()[:255] or None
    items = _normalize_items(data.get("items"))

    if order_type == "DINE_IN" and table_id is None:
        raise ApiError("A dining table is required for dine-in orders.")
    if order_type != "DINE_IN" and table_id is not None:
        raise ApiError("Only dine-in orders can be assigned to a table.")

    placed_at = now_local()
    with mysql_tx() as conn:
        if table_id is not None:
            with cursor(conn) as cur:
                cur.execute(
                    "SELECT table_id FROM dining_table WHERE table_id = %s FOR UPDATE",
                    (table_id,),
                )
                if not cur.fetchone():
                    raise ApiError("Dining table not found.", 404)
                cur.execute(
                    f"""
                    SELECT order_id FROM orders
                     WHERE table_id = %s AND status IN {ACTIVE_SQL}
                     LIMIT 1
                    """,
                    (table_id,),
                )
                active = cur.fetchone()
                if active:
                    raise ApiError(
                        f"Table {table_id} already has active order #{active['order_id']}.",
                        409,
                    )

        with cursor(conn) as cur:
            cur.execute(
                """
                SELECT s.staff_id, s.name
                  FROM waiter w JOIN staff s ON s.staff_id = w.staff_id
                 WHERE w.staff_id = %s AND s.is_active = TRUE
                """,
                (waiter_id,),
            )
            if not cur.fetchone():
                raise ApiError("Waiter not found or inactive.", 404)
            if customer_id is not None:
                cur.execute(
                    "SELECT customer_id FROM customer WHERE customer_id = %s",
                    (customer_id,),
                )
                if not cur.fetchone():
                    raise ApiError("Customer not found.", 404)
            cur.execute(
                """
                INSERT INTO orders
                    (customer_id, table_id, waiter_id, order_type, status, placed_at, notes)
                VALUES (%s, %s, %s, %s, 'PLACED', %s, %s)
                """,
                (
                    customer_id,
                    table_id,
                    waiter_id,
                    order_type,
                    to_mysql(placed_at),
                    notes,
                ),
            )
            order_id = cur.lastrowid

        _insert_items(conn, order_id, items)

        ctx = order_context(conn, order_id)
        emit_order_placed(conn, ctx, ctx["placed_at"])
        new_items = fetch_new_items(conn, order_id, 0)
        emit_item_added(conn, ctx, new_items, ctx["placed_at"])

    detail = fetch_order_detail(order_id)
    sync = sync_analytics()
    return jsonify({"order": detail, "sync": sync}), 201


@orders_bp.post("/<int:order_id>/items")
def add_items(order_id):
    data = json_body()
    items = _normalize_items(data.get("items"))

    with mysql_tx() as conn:
        with cursor(conn) as cur:
            cur.execute(
                "SELECT status FROM orders WHERE order_id = %s FOR UPDATE",
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                raise ApiError("Order not found.", 404)
            if order["status"] not in ("PLACED", "PREPARING"):
                raise ApiError(
                    f"Ingredients cannot be added while the order is {order['status']}.",
                    409,
                )
            cur.execute("SELECT bill_id FROM bill WHERE order_id = %s", (order_id,))
            if cur.fetchone():
                raise ApiError("This order has already been billed.", 409)

        after = max_line_no(conn, order_id)
        _insert_items(conn, order_id, items)
        ctx = order_context(conn, order_id)
        new_items = fetch_new_items(conn, order_id, after)
        emit_item_added(conn, ctx, new_items, now_local())

    detail = fetch_order_detail(order_id)
    sync = sync_analytics()
    return jsonify({"order": detail, "sync": sync}), 201


@orders_bp.post("/<int:order_id>/status")
def update_status(order_id):
    data = json_body()
    target = enum_value(data.get("status"), "status", ("PREPARING", "PREPARED", "CANCELLED"))
    now = now_local()

    with mysql_tx() as conn:
        with cursor(conn) as cur:
            cur.execute(
                "SELECT status, placed_at FROM orders WHERE order_id = %s FOR UPDATE",
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                raise ApiError("Order not found.", 404)
            allowed = MANUAL_TRANSITIONS.get(order["status"], set())
            if target not in allowed:
                raise ApiError(
                    f"Cannot move order from {order['status']} to {target}.",
                    409,
                )

            if target == "CANCELLED":
                cur.execute("SELECT bill_id FROM bill WHERE order_id = %s", (order_id,))
                if cur.fetchone():
                    raise ApiError(
                        "This order has a bill. Refund the payment instead of cancelling.",
                        409,
                    )
                cur.execute(
                    "UPDATE orders SET status = 'CANCELLED', closed_at = %s WHERE order_id = %s",
                    (to_mysql(now), order_id),
                )
            elif target == "PREPARED":
                prepared_at = to_mysql(now)
                cur.execute(
                    "UPDATE orders SET status = 'PREPARED', prepared_at = %s WHERE order_id = %s",
                    (prepared_at, order_id),
                )
            else:
                cur.execute(
                    "UPDATE orders SET status = 'PREPARING' WHERE order_id = %s",
                    (order_id,),
                )

        ctx = order_context(conn, order_id)

        if target == "PREPARING":
            emit_preparing(conn, ctx, now)
        elif target == "PREPARED":
            placed = from_mysql(order["placed_at"])
            prep_seconds = max(0, int((now - placed).total_seconds()))
            emit_prepared(conn, ctx, now, prep_seconds)
        else:
            emit_cancelled(conn, ctx, now)

    detail = fetch_order_detail(order_id)
    sync = sync_analytics()
    return jsonify({"order": detail, "sync": sync})
