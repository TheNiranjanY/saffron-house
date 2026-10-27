from decimal import Decimal


def _get(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _post(client, url, payload):
    return client.post(url, json=payload)


def test_health_reports_both_stores(client):
    payload = _get(client, "/api/health")
    assert payload["stores"]["mysql"]["ok"] is True
    assert payload["stores"]["timescale"]["ok"] is True
    assert payload["status"] == "ok"


def test_menu_and_dining_dimensions(client):
    menu = _get(client, "/api/menu")
    assert menu["items"]
    assert menu["categories"]

    tables = _get(client, "/api/tables")
    assert tables["summary"]["total"] >= 1

    staff = _get(client, "/api/staff?role=WAITER")
    assert all(member["role"] == "WAITER" for member in staff["staff"])


def test_sql_lab_blocks_writes(client):
    response = _post(
        client,
        "/api/analytics/sql",
        {"db": "mysql", "sql": "DELETE FROM orders"},
    )
    assert response.status_code == 400

    response = _post(
        client,
        "/api/analytics/sql",
        {"db": "timescale", "sql": "SELECT 1; SELECT 2"},
    )
    assert response.status_code == 400


def test_dashboard_reconciles_both_stores(client):
    dashboard = _get(client, "/api/analytics/dashboard?days=7")
    assert dashboard["reconciliation"]["matched"] is True
    assert dashboard["reconciliation"]["revenue_difference"] == 0
    assert dashboard["sync"]["pending"] == 0


def test_full_order_billing_lifecycle(client):
    tables = _get(client, "/api/tables")["tables"]
    free_tables = [table for table in tables if table["status"] == "FREE"]
    if not free_tables:
        import pytest

        pytest.skip("No free table in the demo dataset")
    table_id = free_tables[0]["table_id"]

    waiter = _get(client, "/api/staff?role=WAITER")["staff"][0]
    chefs = _get(client, "/api/staff?role=CHEF")["staff"]
    cashier = _get(client, "/api/staff?role=CASHIER")["staff"][0]
    items = [item for item in _get(client, "/api/menu")["items"] if item["is_available"]]

    response = _post(
        client,
        "/api/orders",
        {
            "order_type": "DINE_IN",
            "table_id": table_id,
            "waiter_id": waiter["staff_id"],
            "items": [
                {
                    "item_id": items[0]["item_id"],
                    "chef_id": chefs[0]["staff_id"],
                    "quantity": 2,
                }
            ],
        },
    )
    assert response.status_code == 201, response.get_json()
    created = response.get_json()
    assert created["order"]["order"]["status"] == "PLACED"
    assert created["sync"]["pending"] == 0
    order_id = created["order"]["order"]["order_id"]

    occupied_table = next(
        table for table in _get(client, "/api/tables")["tables"] if table["table_id"] == table_id
    )
    assert occupied_table["status"] == "OCCUPIED"

    response = _post(
        client,
        f"/api/orders/{order_id}/items",
        {
            "items": [
                {
                    "item_id": items[1]["item_id"],
                    "chef_id": chefs[1]["staff_id"],
                    "quantity": 1,
                }
            ]
        },
    )
    assert response.status_code == 201
    assert len(response.get_json()["order"]["items"]) == 2

    assert _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARING"}).status_code == 200
    prepared = _post(client, f"/api/orders/{order_id}/status", {"status": "PREPARED"})
    assert prepared.status_code == 200
    assert prepared.get_json()["order"]["order"]["status"] == "PREPARED"

    response = _post(
        client,
        f"/api/orders/{order_id}/bill",
        {"discount_pct": 0, "tax_rate": 0.05},
    )
    assert response.status_code == 201, response.get_json()
    bill = response.get_json()["bill"]["bill"]
    assert bill["payment_status"] == "UNPAID"
    assert Decimal(str(bill["balance"])) == Decimal(str(bill["grand_total"]))

    half = float(Decimal(str(bill["grand_total"])) / 2)
    partial = _post(
        client,
        f"/api/bills/{bill['bill_id']}/payments",
        {"amount": half, "payment_mode": "UPI", "cashier_id": cashier["staff_id"]},
    )
    assert partial.status_code == 201
    assert partial.get_json()["bill"]["bill"]["payment_status"] == "PARTIAL"
    assert partial.get_json()["bill"]["bill"]["order_status"] == "BILLED"

    balance = partial.get_json()["bill"]["bill"]["balance"]
    settled = _post(
        client,
        f"/api/bills/{bill['bill_id']}/payments",
        {"amount": float(balance), "payment_mode": "CASH", "cashier_id": cashier["staff_id"]},
    )
    assert settled.status_code == 201
    final = settled.get_json()
    assert final["bill"]["bill"]["payment_status"] == "PAID"
    assert final["bill"]["bill"]["order_status"] == "CLOSED"
    assert final["sync"]["pending"] == 0

    freed = next(
        table for table in _get(client, "/api/tables")["tables"] if table["table_id"] == table_id
    )
    assert freed["status"] == "FREE"

    detail = _get(client, f"/api/orders/{order_id}")
    assert detail["bill"]["payment_status"] == "PAID"
    assert len(detail["bill"]["payments"]) == 2
    assert any(item["type"] == "closed" for item in detail["timeline"])

    dashboard = _get(client, "/api/analytics/dashboard?days=7")
    assert dashboard["reconciliation"]["matched"] is True
