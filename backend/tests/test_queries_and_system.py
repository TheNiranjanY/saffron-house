def _get(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


ACTIVE_STATUSES = {"PLACED", "PREPARING", "PREPARED", "BILLED"}


def test_service_index(client):
    payload = _get(client, "/")
    assert "Saffron House" in payload["service"]
    assert payload["stores"]["operational"].startswith("MySQL")


def test_health_and_outbox_idempotency(client):
    health = _get(client, "/api/health")
    assert health["status"] == "ok"
    assert health["stores"]["mysql"]["ok"] is True
    assert health["stores"]["timescale"]["ok"] is True
    assert health["sync"]["pending"] == 0
    assert health["sync"]["failed"] == 0

    first = client.post("/api/system/sync")
    assert first.status_code == 200
    assert first.get_json()["sync"]["pending"] == 0

    events_before = _get(client, "/api/health")["counts"]["events"]
    second = client.post("/api/system/sync")
    assert second.status_code == 200
    assert second.get_json()["sync"]["pending"] == 0
    events_after = _get(client, "/api/health")["counts"]["events"]
    assert events_after == events_before


def test_tables_and_active_orders_stay_consistent(client):
    tables = _get(client, "/api/tables")
    summary = tables["summary"]
    assert summary["free"] + summary["occupied"] == summary["total"]

    for table in tables["tables"]:
        if table["current_order_id"] is None:
            assert table["status"] == "FREE", table
        else:
            assert table["status"] == "OCCUPIED", table
            assert table["order_status"] in ACTIVE_STATUSES, table

    active = _get(client, "/api/orders?scope=active&limit=100")
    assert all(order["status"] in ACTIVE_STATUSES for order in active["orders"])
    assert summary["active_orders"] == sum(
        1 for order in active["orders"] if order["table_id"] is not None
    )

    health = _get(client, "/api/health")
    assert health["counts"]["open_orders"] == active["total"]
    assert health["counts"]["occupied_tables"] == summary["occupied"]


def test_order_list_validation_and_pagination(client):
    payload = _get(client, "/api/orders?scope=today&limit=5")
    assert payload["limit"] == 5
    assert len(payload["orders"]) <= 5
    assert payload["total"] >= len(payload["orders"])

    clamped = _get(client, "/api/orders?scope=all&limit=999")
    assert clamped["limit"] == 100

    negative = _get(client, "/api/orders?scope=all&offset=-10")
    assert negative["offset"] == 0

    closed = _get(client, "/api/orders?scope=all&status=CLOSED")
    assert all(order["status"] == "CLOSED" for order in closed["orders"])

    takeaway = _get(client, "/api/orders?scope=all&order_type=TAKEAWAY")
    assert all(order["order_type"] == "TAKEAWAY" for order in takeaway["orders"])

    first_order_id = _get(client, "/api/orders?scope=all&limit=1")["orders"][0]["order_id"]
    search = _get(client, f"/api/orders?scope=all&q={first_order_id}")
    assert any(order["order_id"] == first_order_id for order in search["orders"])

    assert client.get("/api/orders?scope=everything").status_code == 400
    assert client.get("/api/orders?scope=all&status=DONE").status_code == 400
    assert client.get("/api/orders?scope=all&order_type=PICNIC").status_code == 400
    assert client.get("/api/orders?scope=all&limit=abc").status_code == 400
    assert client.get("/api/orders?scope=all&offset=abc").status_code == 400
    assert client.get("/api/orders?scope=all&date=yesterday").status_code == 400


def test_bill_list_validation_and_outstanding(client):
    bills = _get(client, "/api/bills?limit=5")
    assert bills["limit"] == 5
    assert len(bills["bills"]) <= 5
    assert bills["summary"]["bills"] >= len(bills["bills"])

    clamped = _get(client, "/api/bills?limit=999")
    assert clamped["limit"] == 200

    outstanding = _get(client, "/api/bills/outstanding")
    assert all(bill["payment_status"] != "PAID" for bill in outstanding["bills"])
    assert outstanding["summary"]["outstanding"] >= 0

    assert client.get("/api/bills?status=REFUNDED").status_code == 400
    assert client.get("/api/bills?limit=abc").status_code == 400
    assert client.get("/api/bills?offset=abc").status_code == 400
    assert client.get("/api/bills?order_id=abc").status_code == 400
    assert (
        client.get("/api/bills?from_date=2026-10-28&to_date=2026-10-01").status_code == 400
    )
    assert client.get("/api/bills/99999999").status_code == 404


def test_staff_filters(client):
    waiters = _get(client, "/api/staff?role=WAITER")["staff"]
    assert waiters
    assert all(member["role"] == "WAITER" for member in waiters)
    assert all(member["table_section"] for member in waiters)

    chefs = _get(client, "/api/staff?role=CHEF")["staff"]
    assert chefs
    assert all(member["cuisine_type"] for member in chefs)

    cashiers = _get(client, "/api/staff?role=CASHIER")["staff"]
    assert cashiers
    assert all(member["counter_no"] is not None for member in cashiers)

    inactive = _get(client, "/api/staff?active=0")["staff"]
    assert all(member["is_active"] is False for member in inactive)

    assert client.get("/api/staff?role=COOK").status_code == 400
    assert client.get("/api/staff?active=2").status_code == 400
