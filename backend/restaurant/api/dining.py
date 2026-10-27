from flask import Blueprint, jsonify, request

from restaurant.db import cursor, mysql_rows, mysql_tx
from restaurant.errors import ApiError

from .utils import enum_value, json_body, require

dining_bp = Blueprint("dining", __name__, url_prefix="/api")

ACTIVE_ORDER_SQL = "('PLACED', 'PREPARING', 'PREPARED', 'BILLED')"


@dining_bp.get("/tables")
def list_tables():
    tables = mysql_rows(
        f"""
        SELECT t.table_id, t.capacity, t.status,
               o.order_id AS current_order_id, o.status AS order_status,
               o.order_type, o.placed_at,
               w.name AS waiter_name,
               COALESCE(oi.item_count, 0) AS item_count,
               oi.subtotal AS order_total,
               b.bill_id, b.grand_total, b.payment_status
          FROM dining_table t
          LEFT JOIN orders o
                 ON o.order_id = (
                        SELECT o2.order_id
                          FROM orders o2
                         WHERE o2.table_id = t.table_id
                           AND o2.status IN {ACTIVE_ORDER_SQL}
                         ORDER BY o2.placed_at DESC, o2.order_id DESC
                         LIMIT 1
                    )
          LEFT JOIN staff w ON w.staff_id = o.waiter_id
          LEFT JOIN (
                SELECT order_id,
                       COUNT(*) AS item_count,
                       SUM(quantity * price_at_order) AS subtotal
                  FROM order_item
                 GROUP BY order_id
               ) oi ON oi.order_id = o.order_id
          LEFT JOIN bill b ON b.order_id = o.order_id
         ORDER BY t.table_id
        """
    )
    for table in tables:
        table["item_count"] = int(table["item_count"])
    free = sum(1 for table in tables if table["status"] == "FREE")
    return jsonify(
        {
            "tables": tables,
            "summary": {
                "total": len(tables),
                "free": free,
                "occupied": len(tables) - free,
                "active_orders": sum(1 for table in tables if table["current_order_id"]),
            },
        }
    )


@dining_bp.get("/staff")
def list_staff():
    role = request.args.get("role")
    if role:
        role = enum_value(role, "role", ("WAITER", "CHEF", "CASHIER"))
    active = request.args.get("active", "1")
    if active not in ("0", "1"):
        raise ApiError("active must be 0 or 1.")

    where = ["s.is_active = %s"]
    params = [active == "1"]
    if role:
        where.append("s.role = %s")
        params.append(role)

    staff = mysql_rows(
        f"""
        SELECT s.staff_id, s.name, s.role, s.contact, s.is_active,
               w.table_section, ch.cuisine_type, ca.counter_no
          FROM staff s
          LEFT JOIN waiter w ON w.staff_id = s.staff_id
          LEFT JOIN chef ch ON ch.staff_id = s.staff_id
          LEFT JOIN cashier ca ON ca.staff_id = s.staff_id
         WHERE {' AND '.join(where)}
         ORDER BY FIELD(s.role, 'WAITER', 'CHEF', 'CASHIER'), s.name
        """,
        tuple(params),
    )
    for member in staff:
        member["is_active"] = bool(member["is_active"])

    summary = {}
    for member in staff:
        summary[member["role"]] = summary.get(member["role"], 0) + 1

    return jsonify({"staff": staff, "summary": summary})


@dining_bp.get("/customers")
def list_customers():
    search = (request.args.get("q") or "").strip()
    limit = min(max(int(request.args.get("limit", 12)), 1), 50)
    if search:
        like = f"%{search}%"
        where = "(c.name LIKE %s OR c.phone LIKE %s OR c.email LIKE %s)"
        params = (like, like, like, limit)
    else:
        where = "1 = 1"
        params = (limit,)

    customers = mysql_rows(
        f"""
        SELECT c.customer_id, c.name, c.email, c.phone, c.created_at,
               (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) AS orders,
               (SELECT COALESCE(SUM(b.grand_total), 0)
                  FROM bill b JOIN orders o ON o.order_id = b.order_id
                 WHERE o.customer_id = c.customer_id) AS spend,
               (SELECT MAX(o.placed_at) FROM orders o
                 WHERE o.customer_id = c.customer_id) AS last_visit
          FROM customer c
         WHERE {where}
         ORDER BY last_visit DESC, c.customer_id DESC
         LIMIT %s
        """,
        params,
    )
    for customer in customers:
        customer["orders"] = int(customer["orders"])
    return jsonify({"customers": customers})


@dining_bp.post("/customers")
def create_customer():
    data = json_body()
    name = require(data, "name", "Customer name")
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None
    if email and "@" not in email:
        raise ApiError("email must be a valid address.")
    if phone and len(phone) < 7:
        raise ApiError("phone must have at least 7 characters.")

    with mysql_tx() as conn, cursor(conn) as cur:
        cur.execute(
            "INSERT INTO customer (name, email, phone) VALUES (%s, %s, %s)",
            (name, email, phone),
        )
        customer_id = cur.lastrowid
        cur.execute(
            "SELECT customer_id, name, email, phone, created_at FROM customer WHERE customer_id = %s",
            (customer_id,),
        )
        customer = cur.fetchone()
        customer["orders"] = 0
        customer["spend"] = 0
        customer["last_visit"] = None

    return jsonify({"customer": customer}), 201
