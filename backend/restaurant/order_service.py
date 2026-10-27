from datetime import timedelta
from decimal import Decimal

from restaurant.db import cursor, mysql_read
from restaurant.events import record_event
from restaurant.timeutil import from_mysql, iso, now_local

ACTIVE_STATUSES = ("PLACED", "PREPARING", "PREPARED", "BILLED")
OPEN_STATUSES = ("PLACED", "PREPARING", "PREPARED")
PAYMENT_MODES = ("CASH", "CARD", "UPI", "ONLINE")


def as_bool(value):
    return bool(value) if value is not None else None


def order_context(conn, order_id):
    with cursor(conn) as cur:
        cur.execute(
            """
            SELECT o.order_id, o.table_id, o.customer_id, o.waiter_id, o.cashier_id,
                   o.order_type, o.status, o.placed_at, o.prepared_at, o.closed_at,
                   s.name AS waiter_name
              FROM orders o
              JOIN staff s ON s.staff_id = o.waiter_id
             WHERE o.order_id = %s
            """,
            (order_id,),
        )
        return cur.fetchone()


def order_event_fields(ctx):
    return {
        "order_type": ctx["order_type"],
        "table_id": ctx["table_id"],
        "customer_id": ctx["customer_id"],
        "waiter_id": ctx["waiter_id"],
        "waiter_name": ctx["waiter_name"],
    }


def emit_order_placed(conn, ctx, when):
    record_event(
        conn,
        "ORDER_PLACED",
        when,
        ctx["order_id"],
        **order_event_fields(ctx),
    )


def emit_item_added(conn, ctx, item_rows, base_time):
    for idx, item in enumerate(item_rows):
        record_event(
            conn,
            "ITEM_ADDED",
            base_time + timedelta(milliseconds=250 * (idx + 1)),
            ctx["order_id"],
            **order_event_fields(ctx),
            chef_id=item["chef_id"],
            chef_name=item["chef_name"],
            item_id=item["item_id"],
            item_name=item["item_name"],
            category_name=item["category_name"],
            quantity=item["quantity"],
            amount=item["line_total"],
        )


def emit_preparing(conn, ctx, when):
    record_event(conn, "ORDER_PREPARING", when, ctx["order_id"], **order_event_fields(ctx))


def emit_prepared(conn, ctx, when, prep_seconds):
    record_event(
        conn,
        "ORDER_PREPARED",
        when,
        ctx["order_id"],
        **order_event_fields(ctx),
        prep_seconds=prep_seconds,
    )


def emit_bill_generated(conn, ctx, when, bill_id, grand_total, item_count):
    record_event(
        conn,
        "BILL_GENERATED",
        when,
        ctx["order_id"],
        **order_event_fields(ctx),
        bill_id=bill_id,
        amount=grand_total,
        quantity=item_count,
    )


def emit_payment(conn, ctx, when, bill_id, payment_id, amount, mode):
    record_event(
        conn,
        "PAYMENT_RECEIVED",
        when,
        ctx["order_id"],
        **order_event_fields(ctx),
        bill_id=bill_id,
        payment_id=payment_id,
        amount=amount,
        payment_mode=mode,
    )


def emit_closed(conn, ctx, when):
    record_event(conn, "ORDER_CLOSED", when, ctx["order_id"], **order_event_fields(ctx))


def emit_cancelled(conn, ctx, when):
    record_event(conn, "ORDER_CANCELLED", when, ctx["order_id"], **order_event_fields(ctx))


def fetch_new_items(conn, order_id, after_line_no):
    with cursor(conn) as cur:
        cur.execute(
            """
            SELECT oi.line_no, oi.item_id, oi.chef_id, oi.quantity,
                   oi.price_at_order, oi.quantity * oi.price_at_order AS line_total,
                   mi.name AS item_name, mc.category_name,
                   cs.name AS chef_name
              FROM order_item oi
              JOIN menu_item mi ON mi.item_id = oi.item_id
              JOIN menu_category mc ON mc.category_id = mi.category_id
              JOIN staff cs ON cs.staff_id = oi.chef_id
             WHERE oi.order_id = %s AND oi.line_no > %s
             ORDER BY oi.line_no
            """,
            (order_id, after_line_no),
        )
        return cur.fetchall()


def max_line_no(conn, order_id):
    with cursor(conn) as cur:
        cur.execute(
            "SELECT COALESCE(MAX(line_no), 0) AS n FROM order_item WHERE order_id = %s",
            (order_id,),
        )
        return cur.fetchone()["n"]


def fetch_order_detail(order_id, conn=None):
    def _load(c):
        with cursor(c) as cur:
            cur.execute(
                """
                SELECT o.order_id, o.customer_id, o.table_id, o.waiter_id, o.cashier_id,
                       o.order_type, o.status, o.placed_at, o.prepared_at, o.closed_at,
                       o.notes,
                       dt.capacity AS table_capacity,
                       cust.name AS customer_name, cust.phone AS customer_phone,
                       waiter_s.name AS waiter_name,
                       cashier_s.name AS cashier_name
                  FROM orders o
                  LEFT JOIN dining_table dt ON dt.table_id = o.table_id
                  LEFT JOIN customer cust ON cust.customer_id = o.customer_id
                  JOIN staff waiter_s ON waiter_s.staff_id = o.waiter_id
                  LEFT JOIN staff cashier_s ON cashier_s.staff_id = o.cashier_id
                 WHERE o.order_id = %s
                """,
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                return None

            cur.execute(
                """
                SELECT oi.order_id, oi.line_no, oi.item_id, oi.chef_id, oi.quantity,
                       oi.price_at_order, oi.quantity * oi.price_at_order AS line_total,
                       mi.name AS item_name, mi.is_veg, mi.category_id,
                       mc.category_name, cs.name AS chef_name
                  FROM order_item oi
                  JOIN menu_item mi ON mi.item_id = oi.item_id
                  JOIN menu_category mc ON mc.category_id = mi.category_id
                  JOIN staff cs ON cs.staff_id = oi.chef_id
                 WHERE oi.order_id = %s
                 ORDER BY oi.line_no
                """,
                (order_id,),
            )
            items = cur.fetchall()

            cur.execute(
                """
                SELECT b.bill_id, b.order_id, b.subtotal, b.tax, b.discount_amount,
                       b.grand_total, b.payment_status, b.generated_at,
                       COALESCE((
                           SELECT SUM(p.amount)
                             FROM payment p
                            WHERE p.bill_id = b.bill_id AND p.payment_status = 'SUCCESS'
                       ), 0) AS paid_amount
                  FROM bill b
                 WHERE b.order_id = %s
                """,
                (order_id,),
            )
            bill = cur.fetchone()
            payments = []
            if bill:
                bill["paid_amount"] = Decimal(bill["paid_amount"])
                bill["balance"] = Decimal(bill["grand_total"]) - bill["paid_amount"]
                cur.execute(
                    """
                    SELECT payment_id, bill_id, amount, payment_mode, payment_date, payment_status
                      FROM payment
                     WHERE bill_id = %s
                     ORDER BY payment_date, payment_id
                    """,
                    (bill["bill_id"],),
                )
                payments = cur.fetchall()
                bill["payments"] = payments

        for item in items:
            item["is_veg"] = as_bool(item["is_veg"])
        order["is_live"] = order["status"] in ACTIVE_STATUSES
        order["item_count"] = len(items)
        order["items_subtotal"] = sum((item["line_total"] for item in items), Decimal("0"))

        timeline = [{
            "type": "placed",
            "title": "Order placed",
            "at": iso(order["placed_at"]),
            "detail": f"Waiter: {order['waiter_name']}",
        }]
        if order["prepared_at"]:
            timeline.append({
                "type": "prepared",
                "title": "Kitchen prepared the order",
                "at": iso(order["prepared_at"]),
                "detail": None,
            })
        if bill:
            timeline.append({
                "type": "billed",
                "title": "Bill generated",
                "at": iso(bill["generated_at"]),
                "detail": f"Bill #{bill['bill_id']}",
            })
            for payment in payments:
                timeline.append({
                    "type": "payment",
                    "title": f"Payment received · {payment['payment_mode']}",
                    "at": iso(payment["payment_date"]),
                    "detail": f"₹{float(payment['amount']):,.2f}",
                })
        if order["closed_at"]:
            timeline.append({
                "type": "cancelled" if order["status"] == "CANCELLED" else "closed",
                "title": "Order cancelled" if order["status"] == "CANCELLED" else "Order closed",
                "at": iso(order["closed_at"]),
                "detail": None,
            })

        return {
            "order": order,
            "items": items,
            "bill": bill,
            "timeline": timeline,
        }

    if conn is not None:
        return _load(conn)
    with mysql_read() as c:
        return _load(c)
