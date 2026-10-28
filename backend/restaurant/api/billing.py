from datetime import datetime, time, timedelta
from decimal import Decimal

from flask import Blueprint, jsonify, request

from restaurant.config import Config
from restaurant.db import cursor, mysql_read, mysql_row, mysql_rows, mysql_tx
from restaurant.errors import ApiError
from restaurant.order_service import (
    emit_bill_generated,
    emit_closed,
    emit_payment,
    order_context,
)
from restaurant.timeutil import now_local, to_mysql

from .utils import (
    as_decimal,
    as_int,
    enum_value,
    json_body,
    query_date,
    query_int,
    sync_analytics,
)

billing_bp = Blueprint("billing", __name__, url_prefix="/api")

PAYMENT_MODES = ("CASH", "CARD", "UPI", "ONLINE")
BILL_STATUSES = ("UNPAID", "PARTIAL", "PAID")


def _load_bill(bill_id):
    bill = mysql_row(
        """
        SELECT b.bill_id, b.order_id, b.subtotal, b.tax, b.discount_amount,
               b.grand_total, b.payment_status, b.generated_at,
               o.order_type, o.status AS order_status, o.table_id, o.waiter_id,
               o.customer_id, o.cashier_id, o.placed_at, o.prepared_at,
               o.closed_at, o.notes,
               w.name AS waiter_name,
               c.name AS customer_name, c.phone AS customer_phone,
               cash.name AS cashier_name,
               t.capacity,
               (SELECT COUNT(*) FROM order_item oi
                 WHERE oi.order_id = o.order_id) AS item_count,
               COALESCE((
                   SELECT SUM(p.amount) FROM payment p
                    WHERE p.bill_id = b.bill_id AND p.payment_status = 'SUCCESS'
               ), 0) AS paid_amount
          FROM bill b
          JOIN orders o ON o.order_id = b.order_id
          JOIN staff w ON w.staff_id = o.waiter_id
          LEFT JOIN customer c ON c.customer_id = o.customer_id
          LEFT JOIN staff cash ON cash.staff_id = o.cashier_id
          LEFT JOIN dining_table t ON t.table_id = o.table_id
         WHERE b.bill_id = %s
        """,
        (bill_id,),
    )
    if not bill:
        return None

    items = mysql_rows(
        """
        SELECT oi.line_no, oi.item_id, oi.chef_id, oi.quantity,
               oi.price_at_order, oi.quantity * oi.price_at_order AS line_total,
               mi.name AS item_name, mi.is_veg,
               mc.category_name, s.name AS chef_name
          FROM order_item oi
          JOIN menu_item mi ON mi.item_id = oi.item_id
          JOIN menu_category mc ON mc.category_id = mi.category_id
          JOIN staff s ON s.staff_id = oi.chef_id
         WHERE oi.bill_id = %s
         ORDER BY oi.line_no
        """,
        (bill_id,),
    )
    for item in items:
        item["is_veg"] = bool(item["is_veg"])

    payments = mysql_rows(
        """
        SELECT payment_id, amount, payment_mode, payment_date, payment_status
          FROM payment
         WHERE bill_id = %s
         ORDER BY payment_date, payment_id
        """,
        (bill_id,),
    )
    bill["item_count"] = int(bill["item_count"])
    bill["paid_amount"] = Decimal(bill["paid_amount"])
    bill["balance"] = Decimal(bill["grand_total"]) - bill["paid_amount"]
    return {"bill": bill, "items": items, "payments": payments}


def _fetch_bills(date_from, date_to, status, order_id, limit, offset, outstanding):
    where = ["1 = 1"]
    params = []
    if date_from:
        where.append("b.generated_at >= %s")
        params.append(datetime.combine(date_from, time.min))
    if date_to:
        where.append("b.generated_at < %s")
        params.append(datetime.combine(date_to + timedelta(days=1), time.min))
    if status:
        where.append("b.payment_status = %s")
        params.append(status)
    if outstanding:
        where.append("b.payment_status <> 'PAID'")
    if order_id:
        where.append("b.order_id = %s")
        params.append(order_id)
    where_sql = " AND ".join(where)

    base = """
          FROM bill b
          JOIN orders o ON o.order_id = b.order_id
          JOIN staff w ON w.staff_id = o.waiter_id
          LEFT JOIN customer c ON c.customer_id = o.customer_id
          LEFT JOIN (
                SELECT bill_id, SUM(amount) AS paid
                  FROM payment
                 WHERE payment_status = 'SUCCESS'
                 GROUP BY bill_id
               ) p ON p.bill_id = b.bill_id
    """
    with mysql_read() as conn, cursor(conn) as cur:
        cur.execute(f"SELECT COUNT(*) AS total {base} WHERE {where_sql}", tuple(params))
        total = int(cur.fetchone()["total"])
        cur.execute(
            f"""
            SELECT b.bill_id, b.order_id, b.subtotal, b.tax, b.discount_amount,
                   b.grand_total, b.payment_status, b.generated_at,
                   o.order_type, o.status AS order_status, o.table_id,
                   w.name AS waiter_name, c.name AS customer_name,
                   COALESCE(p.paid, 0) AS paid_amount,
                   b.grand_total - COALESCE(p.paid, 0) AS balance,
                   (SELECT COUNT(*) FROM order_item oi
                     WHERE oi.order_id = o.order_id) AS item_count
            {base}
             WHERE {where_sql}
             ORDER BY b.generated_at DESC, b.bill_id DESC
             LIMIT %s OFFSET %s
            """,
            tuple(params + [limit, offset]),
        )
        bills = cur.fetchall()
        for bill in bills:
            bill["item_count"] = int(bill["item_count"])

        cur.execute(
            f"""
            SELECT COUNT(*) AS bills,
                   COALESCE(SUM(b.grand_total), 0) AS revenue,
                   COALESCE(SUM(COALESCE(p.paid, 0)), 0) AS collected
            {base}
             WHERE {where_sql}
            """,
            tuple(params),
        )
        summary = cur.fetchone()
        summary["bills"] = int(summary["bills"])
        summary["outstanding"] = Decimal(summary["revenue"]) - Decimal(summary["collected"])

    return {
        "bills": bills,
        "total": total,
        "limit": limit,
        "offset": offset,
        "summary": summary,
    }


@billing_bp.get("/bills")
def list_bills():
    date_from = query_date("from_date")
    date_to = query_date("to_date")
    single = query_date("date")
    if single:
        date_from = date_from or single
        date_to = date_to or single
    if date_from is None and date_to is None:
        date_from = date_to = now_local().date()
    if date_from and date_to and date_from > date_to:
        raise ApiError("from_date cannot be after to_date.")

    status = request.args.get("status")
    if status:
        status = enum_value(status, "status", BILL_STATUSES)
    raw_order = request.args.get("order_id")
    order_id = as_int(raw_order, "order_id", 1) if raw_order else None
    limit = min(max(query_int("limit", 40), 1), 200)
    offset = max(query_int("offset", 0), 0)

    return jsonify(
        _fetch_bills(date_from, date_to, status, order_id, limit, offset, False)
    )


@billing_bp.get("/bills/outstanding")
def outstanding_bills():
    limit = min(max(query_int("limit", 50), 1), 200)
    return jsonify(
        _fetch_bills(None, None, None, None, limit, 0, True)
    )


@billing_bp.get("/bills/<int:bill_id>")
def get_bill(bill_id):
    detail = _load_bill(bill_id)
    if detail is None:
        raise ApiError("Bill not found.", 404)
    return jsonify(detail)


@billing_bp.post("/orders/<int:order_id>/bill")
def generate_bill(order_id):
    data = json_body(required=False)
    discount_pct = as_decimal(
        data.get("discount_pct", 0), "discount_pct", minimum=0, maximum=100
    )
    tax_rate = as_decimal(
        data.get("tax_rate", Config.TAX_RATE),
        "tax_rate",
        minimum=0,
        maximum=1,
        scale="0.0001",
    )

    with mysql_tx() as conn:
        with cursor(conn) as cur:
            cur.execute(
                "SELECT order_id, status FROM orders WHERE order_id = %s FOR UPDATE",
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                raise ApiError("Order not found.", 404)
            cur.execute("SELECT bill_id FROM bill WHERE order_id = %s", (order_id,))
            existing = cur.fetchone()
            if existing:
                raise ApiError(
                    f"Bill #{existing['bill_id']} already exists for this order.", 409
                )
            if order["status"] != "PREPARED":
                raise ApiError(
                    f"Only prepared orders can be billed (current status: {order['status']}).",
                    409,
                )
            cur.execute(
                "CALL generate_bill(%s, %s, %s, @bill_id)",
                (order_id, discount_pct, tax_rate),
            )
            cur.execute("SELECT @bill_id AS bill_id")
            bill_id = cur.fetchone()["bill_id"]
            cur.execute(
                "SELECT bill_id, grand_total, generated_at FROM bill WHERE bill_id = %s",
                (bill_id,),
            )
            bill = cur.fetchone()
            cur.execute(
                "SELECT COUNT(*) AS items FROM order_item WHERE order_id = %s",
                (order_id,),
            )
            item_count = int(cur.fetchone()["items"])

        ctx = order_context(conn, order_id)
        emit_bill_generated(
            conn, ctx, bill["generated_at"], bill_id, bill["grand_total"], item_count
        )

    detail = _load_bill(bill_id)
    sync = sync_analytics()
    return jsonify({"bill": detail, "sync": sync}), 201


@billing_bp.post("/bills/<int:bill_id>/payments")
def add_payment(bill_id):
    data = json_body()
    amount = as_decimal(data.get("amount"), "amount", minimum=0.01, maximum=1000000)
    payment_mode = enum_value(data.get("payment_mode"), "payment_mode", PAYMENT_MODES)
    cashier_id = data.get("cashier_id")
    cashier_id = as_int(cashier_id, "cashier_id", 1) if cashier_id is not None else None
    now = now_local()

    with mysql_tx() as conn:
        with cursor(conn) as cur:
            cur.execute(
                """
                SELECT b.bill_id, b.order_id, b.grand_total, b.payment_status,
                       o.status AS order_status
                  FROM bill b
                  JOIN orders o ON o.order_id = b.order_id
                 WHERE b.bill_id = %s
                 FOR UPDATE
                """,
                (bill_id,),
            )
            bill = cur.fetchone()
            if not bill:
                raise ApiError("Bill not found.", 404)
            if bill["order_status"] == "CANCELLED":
                raise ApiError("This order was cancelled.", 409)
            if bill["payment_status"] == "PAID":
                raise ApiError("This bill is already fully paid.", 409)
            if bill["order_status"] == "CLOSED":
                raise ApiError("This order is already closed.", 409)

            cur.execute(
                """
                SELECT COALESCE(SUM(amount), 0) AS paid
                  FROM payment
                 WHERE bill_id = %s AND payment_status = 'SUCCESS'
                """,
                (bill_id,),
            )
            paid = Decimal(cur.fetchone()["paid"])
            balance = Decimal(bill["grand_total"]) - paid
            if balance <= 0:
                raise ApiError("This bill has no outstanding balance.", 409)
            if amount > balance:
                raise ApiError(
                    f"Payment exceeds the outstanding balance of ₹{float(balance):,.2f}.",
                    400,
                )

            if cashier_id is not None:
                cur.execute(
                    """
                    SELECT ca.staff_id
                      FROM cashier ca JOIN staff s ON s.staff_id = ca.staff_id
                     WHERE ca.staff_id = %s AND s.is_active = TRUE
                    """,
                    (cashier_id,),
                )
                if not cur.fetchone():
                    raise ApiError("Cashier not found or inactive.", 404)

            cur.execute(
                """
                INSERT INTO payment (bill_id, amount, payment_mode, payment_date, payment_status)
                VALUES (%s, %s, %s, %s, 'SUCCESS')
                """,
                (bill_id, amount, payment_mode, to_mysql(now)),
            )
            payment_id = cur.lastrowid
            cur.execute(
                """
                SELECT payment_id, amount, payment_mode, payment_date, payment_status
                  FROM payment WHERE payment_id = %s
                """,
                (payment_id,),
            )
            payment = cur.fetchone()

            if cashier_id is not None:
                cur.execute(
                    "UPDATE orders SET cashier_id = %s WHERE order_id = %s",
                    (cashier_id, bill["order_id"]),
                )

        ctx = order_context(conn, bill["order_id"])
        emit_payment(
            conn,
            ctx,
            payment["payment_date"],
            bill_id,
            payment_id,
            payment["amount"],
            payment_mode,
        )

        with cursor(conn) as cur:
            cur.execute(
                "SELECT status FROM orders WHERE order_id = %s", (bill["order_id"],)
            )
            new_status = cur.fetchone()["status"]

        if new_status == "CLOSED" and bill["order_status"] != "CLOSED":
            emit_closed(conn, ctx, payment["payment_date"])

    detail = _load_bill(bill_id)
    sync = sync_analytics()
    return jsonify({"bill": detail, "sync": sync}), 201
