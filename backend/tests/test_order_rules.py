from decimal import Decimal


def _get(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _post(client, url, payload):
    return client.post(url, json=payload)


def _message(response):
    payload = response.get_json()
    return (payload or {}).get("error", {}).get("message", "")


def _dimensions(client):
    staff = _get(client, "/api/staff")["staff"]
    waiters = [member for member in staff if member["role"] == "WAITER"]
    chefs = [member for member in staff if member["role"] == "CHEF"]
    cashiers = [member for member in staff if member["role"] == "CASHIER"]
    items = [item for item in _get(client, "/api/menu")["items"] if item["is_available"]]
    return waiters, chefs, cashiers, items


def _free_table(client):
    return next(
        table for table in _get(client, "/api/tables")["tables"] if table["status"] == "FREE"
    )


def _table(client, table_id):
    return next(
        table for table in _get(client, "/api/tables")["tables"] if table["table_id"] == table_id
    )


def _lines(items, chefs, quantity=1):
    return [
        {
            "item_id": items[0]["item_id"],
            "chef_id": chefs[0]["staff_id"],
            "quantity": quantity,
        },
        {
            "item_id": items[1]["item_id"],
            "chef_id": chefs[1]["staff_id"],
            "quantity": 1,
        },
    ]


def _create_dine_in(client, table_id, waiter_id, items):
    response = _post(
        client,
        "/api/orders",
        {
            "order_type": "DINE_IN",
            "table_id": table_id,
            "waiter_id": waiter_id,
            "items": items,
        },
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()["order"]["order"]


def test_order_payload_validation(client):
    waiters, chefs, cashiers, items = _dimensions(client)
    table = _free_table(client)
    base = {
        "order_type": "DINE_IN",
        "table_id": table["table_id"],
        "waiter_id": waiters[0]["staff_id"],
        "items": _lines(items, chefs),
    }

    assert _post(client, "/api/orders", {**base, "items": []}).status_code == 400

    too_few = {**base, "items": [{**_lines(items, chefs)[0], "quantity": 0}]}
    response = _post(client, "/api/orders", too_few)
    assert response.status_code == 400
    assert "quantity" in _message(response)

    too_many = {**base, "items": [{**_lines(items, chefs)[0], "quantity": 51}]}
    assert _post(client, "/api/orders", too_many).status_code == 400

    forty_one = {
        **base,
        "items": [{**_lines(items, chefs)[0], "quantity": 1}] * 41,
    }
    assert _post(client, "/api/orders", forty_one).status_code == 400

    unknown_item = {
        **base,
        "items": [{**_lines(items, chefs)[0], "item_id": 99999999}],
    }
    assert _post(client, "/api/orders", unknown_item).status_code == 400

    unknown_chef = {
        **base,
        "items": [{**_lines(items, chefs)[0], "chef_id": 99999999}],
    }
    assert _post(client, "/api/orders", unknown_chef).status_code == 400

    assert _post(client, "/api/orders", {**base, "table_id": None}).status_code == 400
    assert (
        _post(
            client,
            "/api/orders",
            {**base, "order_type": "TAKEAWAY"},
        ).status_code
        == 400
    )
    assert _post(client, "/api/orders", {**base, "order_type": "DRIVE_THRU"}).status_code == 400
    assert _post(client, "/api/orders", {**base, "waiter_id": 99999999}).status_code == 404
    assert _post(client, "/api/orders", {**base, "table_id": 999999}).status_code == 404
    assert _post(client, "/api/orders", {**base, "customer_id": 99999999}).status_code == 404

    occupied = next(
        table for table in _get(client, "/api/tables")["tables"] if table["current_order_id"]
    )
    response = _post(client, "/api/orders", {**base, "table_id": occupied["table_id"]})
    assert response.status_code == 409
    assert "already has active order" in _message(response)


def test_order_transitions_and_cancellation(client):
    waiters, chefs, cashiers, items = _dimensions(client)
    table = _free_table(client)
    order = _create_dine_in(client, table["table_id"], waiters[0]["staff_id"], _lines(items, chefs, 2))
    order_id = order["order_id"]
    assert order["status"] == "PLACED"
    assert _table(client, table["table_id"])["status"] == "OCCUPIED"

    response = _post(
        client,
        f"/api/orders/{order_id}/items",
        {"items": [_lines(items, chefs, 2)[0]]},
    )
    assert response.status_code == 201
    assert len(response.get_json()["order"]["items"]) == 3

    assert (
        _post(client, f"/api/orders/{order_id}/status", {"status": "CLOSED"}).status_code == 400
    )

    response = _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARING"})
    assert response.status_code == 200
    assert response.get_json()["order"]["order"]["status"] == "PREPARING"

    response = _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARING"})
    assert response.status_code == 409
    assert "Cannot move order" in _message(response)

    response = _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARED"})
    assert response.status_code == 200

    response = _post(
        client,
        f"/api/orders/{order_id}/items",
        {"items": [_lines(items, chefs, 1)[0]]},
    )
    assert response.status_code == 409
    assert "already been billed" in _message(response) or "cannot" in _message(response).lower()

    response = _post(client, f"/api/orders/{order_id}/status", {"status": "CANCELLED"})
    assert response.status_code == 200
    detail = response.get_json()["order"]
    assert detail["order"]["status"] == "CANCELLED"
    assert any(event["type"] == "cancelled" for event in detail["timeline"])
    assert _table(client, table["table_id"])["status"] == "FREE"

    assert (
        _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARING"}).status_code == 409
    )
    assert (
        _post(
            client,
            f"/api/orders/{order_id}/items",
            {"items": [_lines(items, chefs)[0]]},
        ).status_code
        == 409
    )

    assert _post(client, "/api/orders/99999999/status", {"status": "PREPARING"}).status_code == 404
    assert (
        _post(
            client,
            "/api/orders/99999999/items",
            {"items": [_lines(items, chefs)[0]]},
        ).status_code
        == 404
    )
    assert client.get("/api/orders/99999999").status_code == 404


def test_takeaway_order_has_no_table(client):
    waiters, chefs, cashiers, items = _dimensions(client)
    response = _post(
        client,
        "/api/orders",
        {
            "order_type": "TAKEAWAY",
            "waiter_id": waiters[0]["staff_id"],
            "items": _lines(items, chefs),
        },
    )
    assert response.status_code == 201, response.get_json()
    order = response.get_json()["order"]["order"]
    assert order["order_type"] == "TAKEAWAY"
    assert order["table_id"] is None

    response = _post(client, f"/api/orders/{order['order_id']}/status", {"status": "CANCELLED"})
    assert response.status_code == 200
    assert response.get_json()["order"]["order"]["status"] == "CANCELLED"


def test_bill_rules_and_split_payments(client):
    waiters, chefs, cashiers, items = _dimensions(client)

    early_table = _free_table(client)
    early = _create_dine_in(
        client, early_table["table_id"], waiters[0]["staff_id"], _lines(items, chefs)
    )
    response = _post(
        client,
        f"/api/orders/{early['order_id']}/bill",
        {"discount_pct": 0, "tax_rate": 0.05},
    )
    assert response.status_code == 409
    assert "prepared" in _message(response).lower()
    assert (
        _post(
            client,
            f"/api/orders/{early['order_id']}/status",
            {"status": "CANCELLED"},
        ).status_code
        == 200
    )

    table = _free_table(client)
    order = _create_dine_in(
        client, table["table_id"], waiters[0]["staff_id"], _lines(items, chefs, 2)
    )
    order_id = order["order_id"]
    detail = _get(client, f"/api/orders/{order_id}")
    subtotal = sum(
        Decimal(str(line["price_at_order"])) * line["quantity"] for line in detail["items"]
    )

    assert (
        _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARING"}).status_code
        == 200
    )
    assert (
        _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARED"}).status_code == 200
    )

    assert (
        _post(
            client,
            f"/api/orders/{order_id}/bill",
            {"discount_pct": 101, "tax_rate": 0.05},
        ).status_code
        == 400
    )
    assert (
        _post(
            client,
            f"/api/orders/{order_id}/bill",
            {"discount_pct": 0, "tax_rate": 2},
        ).status_code
        == 400
    )
    assert (
        _post(
            client,
            f"/api/orders/{order_id}/bill",
            {"discount_pct": -1, "tax_rate": 0.05},
        ).status_code
        == 400
    )

    response = _post(
        client,
        f"/api/orders/{order_id}/bill",
        {"discount_pct": 10, "tax_rate": 0.05},
    )
    assert response.status_code == 201, response.get_json()
    bill = response.get_json()["bill"]["bill"]
    bill_id = bill["bill_id"]

    expected_tax = (subtotal * Decimal("0.05")).quantize(Decimal("0.01"))
    expected_discount = (subtotal * Decimal("0.10")).quantize(Decimal("0.01"))
    expected_total = subtotal + expected_tax - expected_discount
    assert Decimal(str(bill["subtotal"])) == subtotal
    assert Decimal(str(bill["tax"])) == expected_tax
    assert Decimal(str(bill["discount_amount"])) == expected_discount
    assert Decimal(str(bill["grand_total"])) == expected_total
    assert Decimal(str(bill["balance"])) == expected_total
    assert bill["payment_status"] == "UNPAID"
    assert bill["order_status"] == "BILLED"
    assert _table(client, table["table_id"])["status"] == "OCCUPIED"

    assert (
        _post(
            client,
            f"/api/orders/{order_id}/items",
            {"items": [_lines(items, chefs, 1)[0]]},
        ).status_code
        == 409
    )
    assert (
        _post(client, f"/api/orders/{order_id}/status", {"status": "CANCELLED"}).status_code == 409
    )
    assert (
        _post(
            client,
            f"/api/orders/{order_id}/bill",
            {"discount_pct": 0, "tax_rate": 0.05},
        ).status_code
        == 409
    )

    overpay = float(expected_total + Decimal("1.00"))
    response = _post(
        client,
        f"/api/bills/{bill_id}/payments",
        {"amount": overpay, "payment_mode": "CASH"},
    )
    assert response.status_code == 400
    assert "exceeds" in _message(response).lower()

    assert (
        _post(
            client,
            f"/api/bills/{bill_id}/payments",
            {"amount": 0, "payment_mode": "CASH"},
        ).status_code
        == 400
    )
    assert (
        _post(
            client,
            f"/api/bills/{bill_id}/payments",
            {"amount": 10, "payment_mode": "BITCOIN"},
        ).status_code
        == 400
    )
    assert (
        _post(
            client,
            f"/api/bills/{bill_id}/payments",
            {"amount": 10, "payment_mode": "CASH", "cashier_id": 99999999},
        ).status_code
        == 404
    )

    first = (expected_total / 2).quantize(Decimal("0.01"))
    response = _post(
        client,
        f"/api/bills/{bill_id}/payments",
        {"amount": float(first), "payment_mode": "UPI", "cashier_id": cashiers[0]["staff_id"]},
    )
    assert response.status_code == 201, response.get_json()
    partial = response.get_json()["bill"]["bill"]
    assert partial["payment_status"] == "PARTIAL"
    assert partial["order_status"] == "BILLED"
    assert Decimal(str(partial["balance"])) == expected_total - first

    response = _post(
        client,
        f"/api/bills/{bill_id}/payments",
        {
            "amount": partial["balance"],
            "payment_mode": "CARD",
            "cashier_id": cashiers[0]["staff_id"],
        },
    )
    assert response.status_code == 201, response.get_json()
    settled = response.get_json()["bill"]["bill"]
    assert settled["payment_status"] == "PAID"
    assert settled["order_status"] == "CLOSED"
    assert Decimal(str(settled["balance"])) == Decimal("0.00")
    assert _table(client, table["table_id"])["status"] == "FREE"

    response = _post(
        client,
        f"/api/bills/{bill_id}/payments",
        {"amount": 1, "payment_mode": "CASH"},
    )
    assert response.status_code == 409

    detail = _get(client, f"/api/orders/{order_id}")
    assert detail["bill"]["payment_status"] == "PAID"
    assert len(detail["bill"]["payments"]) == 2
    assert any(event["type"] == "closed" for event in detail["timeline"])
