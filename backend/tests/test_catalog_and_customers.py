import uuid


def _get(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _post(client, url, payload):
    return client.post(url, json=payload)


def _patch(client, url, payload):
    return client.patch(url, json=payload)


def _suffix():
    return uuid.uuid4().hex[:8]


def test_menu_category_lifecycle(client):
    name = f"QA Category {_suffix()}"
    response = _post(client, "/api/menu/categories", {"category_name": name})
    assert response.status_code == 201, response.get_json()
    category_id = response.get_json()["category"]["category_id"]

    duplicate = _post(client, "/api/menu/categories", {"category_name": name})
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.get_json()["error"]["message"]

    assert _post(client, "/api/menu/categories", {"category_name": "   "}).status_code == 400
    assert (
        _post(client, "/api/menu/categories", {"category_name": "x" * 81}).status_code == 400
    )

    categories = _get(client, "/api/menu")["categories"]
    created = next(item for item in categories if item["category_id"] == category_id)
    assert created["category_name"] == name
    assert created["item_count"] == 0


def test_menu_item_create_update_and_filters(client):
    category = _post(
        client, "/api/menu/categories", {"category_name": f"QA Dishes {_suffix()}"}
    )
    assert category.status_code == 201, category.get_json()
    category_id = category.get_json()["category"]["category_id"]

    name = f"QA Test Dish {_suffix()}"
    response = _post(
        client,
        "/api/menu",
        {
            "category_id": category_id,
            "name": name,
            "price": 199.5,
            "description": "Created by the automated suite",
            "is_veg": False,
            "is_available": True,
        },
    )
    assert response.status_code == 201, response.get_json()
    item = response.get_json()["item"]
    item_id = item["item_id"]
    assert item["name"] == name
    assert item["category_id"] == category_id
    assert item["is_veg"] is False
    assert item["is_available"] is True

    assert (
        _post(client, "/api/menu", {"category_id": category_id, "name": "", "price": 10}).status_code
        == 400
    )
    assert (
        _post(client, "/api/menu", {"category_id": 99999999, "name": "Ghost", "price": 10}).status_code
        == 404
    )
    assert (
        _post(client, "/api/menu", {"category_id": category_id, "name": "Bad price", "price": -1}).status_code
        == 400
    )
    assert (
        _post(
            client,
            "/api/menu",
            {"category_id": category_id, "name": "Too pricey", "price": 100001},
        ).status_code
        == 400
    )
    assert (
        _post(
            client,
            "/api/menu",
            {"category_id": category_id, "name": "Bad flag", "price": 10, "is_veg": "maybe"},
        ).status_code
        == 400
    )
    assert (
        _post(client, "/api/menu", {"name": "No category", "price": 10}).status_code == 400
    )

    by_category = _get(client, f"/api/menu?category_id={category_id}")
    assert [entry["item_id"] for entry in by_category["items"]] == [item_id]

    by_search = _get(client, f"/api/menu?q={name}")
    assert [entry["item_id"] for entry in by_search["items"]] == [item_id]

    response = _patch(client, f"/api/menu/items/{item_id}", {"is_available": False})
    assert response.status_code == 200
    assert response.get_json()["item"]["is_available"] is False

    unavailable = _get(client, "/api/menu?available=0")
    assert item_id in [entry["item_id"] for entry in unavailable["items"]]
    available = _get(client, "/api/menu?available=1")
    assert item_id not in [entry["item_id"] for entry in available["items"]]

    response = _patch(
        client,
        f"/api/menu/items/{item_id}",
        {"name": f"{name} v2", "price": 249, "description": "Updated"},
    )
    assert response.status_code == 200
    updated = response.get_json()["item"]
    assert updated["name"] == f"{name} v2"
    assert float(updated["price"]) == 249.0

    assert _patch(client, f"/api/menu/items/{item_id}", {}).status_code == 400
    assert _patch(client, "/api/menu/items/99999999", {"price": 10}).status_code == 404
    assert _patch(client, f"/api/menu/items/{item_id}", {"is_available": "maybe"}).status_code == 400

    assert client.get("/api/menu?available=maybe").status_code == 400
    assert client.get("/api/menu?category_id=abc").status_code == 400

    specials = _get(client, "/api/menu/specials")["items"]
    assert specials
    assert len(specials) <= 8
    assert all(entry["units_sold"] >= 0 for entry in specials)

    response = _patch(client, f"/api/menu/items/{item_id}", {"is_available": True})
    assert response.status_code == 200


def test_unavailable_item_cannot_be_ordered(client):
    waiters = _get(client, "/api/staff?role=WAITER")["staff"]
    chefs = _get(client, "/api/staff?role=CHEF")["staff"]
    table = next(
        entry for entry in _get(client, "/api/tables")["tables"] if entry["status"] == "FREE"
    )

    category = _post(
        client, "/api/menu/categories", {"category_name": f"QA Sold Out {_suffix()}"}
    )
    category_id = category.get_json()["category"]["category_id"]
    item = _post(
        client,
        "/api/menu",
        {"category_id": category_id, "name": f"QA Sold Out Dish {_suffix()}", "price": 120},
    ).get_json()["item"]

    try:
        assert (
            _patch(client, f"/api/menu/items/{item['item_id']}", {"is_available": False}).status_code
            == 200
        )
        response = _post(
            client,
            "/api/orders",
            {
                "order_type": "DINE_IN",
                "table_id": table["table_id"],
                "waiter_id": waiters[0]["staff_id"],
                "items": [
                    {
                        "item_id": item["item_id"],
                        "chef_id": chefs[0]["staff_id"],
                        "quantity": 1,
                    }
                ],
            },
        )
        assert response.status_code == 400
        assert "unavailable" in response.get_json()["error"]["message"].lower()
        assert (
            next(
                entry
                for entry in _get(client, "/api/tables")["tables"]
                if entry["table_id"] == table["table_id"]
            )["status"]
            == "FREE"
        )
    finally:
        _patch(client, f"/api/menu/items/{item['item_id']}", {"is_available": True})


def test_customer_directory_and_validation(client):
    email = f"qa-{_suffix()}@example.com"
    phone = "+91 90000 12345"
    response = _post(
        client,
        "/api/customers",
        {"name": "QA Walkthrough Guest", "email": email, "phone": phone},
    )
    assert response.status_code == 201, response.get_json()
    customer = response.get_json()["customer"]
    assert customer["email"] == email
    assert customer["orders"] == 0

    duplicate = _post(
        client, "/api/customers", {"name": "QA Duplicate", "email": email}
    )
    assert duplicate.status_code == 409

    assert _post(client, "/api/customers", {"name": "   "}).status_code == 400
    assert (
        _post(client, "/api/customers", {"name": "Bad email", "email": "not-an-email"}).status_code
        == 400
    )
    assert (
        _post(client, "/api/customers", {"name": "Bad phone", "phone": "123"}).status_code == 400
    )

    found = _get(client, f"/api/customers?q={email}")["customers"]
    assert [entry["customer_id"] for entry in found] == [customer["customer_id"]]
    assert found[0]["orders"] == 0

    assert client.get("/api/customers?limit=abc").status_code == 400
    assert client.get("/api/customers?limit=500").status_code == 200
