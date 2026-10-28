def _get(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _sql(client, db, sql):
    return client.post("/api/analytics/sql", json={"db": db, "sql": sql})


def test_sql_catalog_and_read_only_queries(client):
    catalog = _get(client, "/api/analytics/sql")
    queries = catalog["queries"]
    assert queries
    assert {entry["db"] for entry in queries} <= {"mysql", "timescale"}
    assert {database["id"] for database in catalog["databases"]} == {"mysql", "timescale"}
    for entry in queries:
        assert entry["id"] and entry["title"] and entry["sql"].strip()
        assert entry["sql"].lstrip().upper().startswith(("SELECT", "WITH"))

    response = _sql(client, "mysql", "SELECT 1 AS one")
    assert response.status_code == 200, response.get_json()
    result = response.get_json()["result"]
    assert result["columns"] == ["one"]
    assert result["rows"][0]["one"] == 1
    assert result["read_only"] is True
    assert result["truncated"] is False

    response = _sql(client, "timescale", "SELECT 1 AS one")
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["result"]["rows"][0]["one"] == 1

    assert _sql(client, "mysql", "SELECT 1;").status_code == 200
    assert _sql(client, "mysql", "-- leading comment\nSELECT 1 AS one").status_code == 200
    assert _sql(client, "mysql", "WITH one AS (SELECT 1 AS n) SELECT n FROM one").status_code == 200

    preset = next(entry for entry in queries if entry["db"] == "timescale")
    response = client.post("/api/analytics/sql", json={"query_id": preset["id"]})
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["result"]["read_only"] is True

    response = _sql(
        client,
        "mysql",
        "WITH RECURSIVE seq AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < 600) "
        "SELECT n FROM seq",
    )
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["result"]["truncated"] is True
    assert response.get_json()["result"]["row_count"] == 500


def test_sql_lab_rejects_writes_and_bad_input(client):
    for statement in (
        "DELETE FROM orders",
        "UPDATE orders SET status = 'CLOSED'",
        "INSERT INTO orders (order_id) VALUES (1)",
        "DROP TABLE orders",
        "TRUNCATE TABLE payment",
        "SELECT 1; SELECT 2",
        "SELECT pg_sleep(2)",
        "SHOW TABLES",
        "/* unclosed comment",
        "-- comment without a statement",
    ):
        response = _sql(client, "mysql" if "pg_sleep" not in statement else "timescale", statement)
        assert response.status_code == 400, statement

    assert _sql(client, "mysql", "").status_code == 400
    assert _sql(client, "mysql", "SELECT 1",).status_code == 200
    assert _sql(client, "oracle", "SELECT 1").status_code == 400
    assert (
        client.post("/api/analytics/sql", json={"query_id": "does-not-exist"}).status_code == 404
    )
    assert (
        client.post("/api/analytics/sql", json={"db": "mysql"}).status_code == 400
    )
    assert _sql(client, "mysql", "SELECT '" + "x" * 12001 + "'").status_code == 400


def test_dashboard_reconciliation_and_kpis(client):
    payload = _get(client, "/api/analytics/dashboard?days=7")
    assert payload["range"]["days"] == 7
    assert payload["range"]["label"] == "Last 7 days"
    assert {"revenue", "bills", "avg_bill", "collected", "payments", "orders"} <= set(
        payload["kpis"]
    )
    assert payload["kpis"]["total_tables"] >= 1
    reconciliation = payload["reconciliation"]
    assert reconciliation["matched"] is True, reconciliation
    assert reconciliation["revenue_difference"] == 0
    assert reconciliation["bills_difference"] == 0
    assert reconciliation["payments_difference"] == 0
    assert reconciliation["pending_events"] == 0
    assert payload["sync"]["pending"] == 0
    assert payload["hourly"]
    assert payload["top_items"]
    assert payload["payment_mix"]


def test_analytics_screen_payloads(client):
    revenue = _get(client, "/api/analytics/revenue-series?days=7")
    assert revenue["days"] == 7
    assert len(revenue["series"]) == 7
    assert {"mysql", "timescale", "difference", "matched"} == set(revenue["totals"])
    total = revenue["totals"]["mysql"]
    assert total >= 0
    assert abs(revenue["totals"]["difference"]) <= max(1.0, total * 0.01)

    peak = _get(client, "/api/analytics/peak-hours?days=7")
    assert peak["cells"]
    for cell in peak["cells"]:
        assert 1 <= cell["dow"] <= 7
        assert 0 <= cell["hour"] <= 23
        assert cell["bills"] >= 0
    assert peak["max_revenue"] >= 0

    top = _get(client, "/api/analytics/top-items?days=7&limit=5")
    assert len(top["items"]) <= 5
    assert top["totals"]["units"] >= 0
    assert top["categories"]
    shares = [float(item["share_pct"]) for item in top["items"]]
    assert all(0 <= share <= 100 for share in shares)

    kitchen = _get(client, "/api/analytics/kitchen?days=7")
    assert kitchen["summary"]["prepared_orders"] >= 0
    assert isinstance(kitchen["series"], list)
    assert len(kitchen["slowest"]) <= 8
    assert len(kitchen["chefs"]) <= 8

    payments = _get(client, "/api/analytics/payments?days=7")
    assert payments["summary"]["payments"] >= 0
    assert {"billed_revenue", "collection_efficiency_pct"} <= set(payments["summary"])
    assert {entry["payment_mode"] for entry in payments["mix"]} <= {
        "CASH",
        "CARD",
        "UPI",
        "ONLINE",
    }

    flow = _get(client, "/api/analytics/order-flow?days=7")
    assert {"placed", "prepared", "billed", "closed", "cancelled"} <= set(flow["funnel"])
    assert flow["funnel"]["placed"] >= 0
    assert {entry["order_type"] for entry in flow["order_types"]} <= {
        "DINE_IN",
        "TAKEAWAY",
        "DELIVERY",
    }

    storage = _get(client, "/api/analytics/storage")
    assert storage["timescale"]["hypertable"]["bytes"] > 0
    assert storage["timescale"]["chunks"]["total"] > 0
    aggregate_names = {
        entry["view_name"] for entry in storage["timescale"]["continuous_aggregates"]
    }
    assert {
        "sales_hourly",
        "order_activity_hourly",
        "payments_hourly",
        "kitchen_performance_hourly",
    } <= aggregate_names
    assert storage["mysql"]["tables"]
    assert storage["mysql"]["total_bytes"] > 0


def test_analytics_rejects_bad_windows(client):
    for path in (
        "dashboard",
        "revenue-series",
        "peak-hours",
        "kitchen",
        "payments",
        "order-flow",
    ):
        assert client.get(f"/api/analytics/{path}?days=0").status_code == 400, path
        assert client.get(f"/api/analytics/{path}?days=366").status_code == 400, path
        assert client.get(f"/api/analytics/{path}?days=abc").status_code == 400, path

    assert client.get("/api/analytics/top-items?limit=0").status_code == 400
    assert client.get("/api/analytics/top-items?limit=51").status_code == 400
