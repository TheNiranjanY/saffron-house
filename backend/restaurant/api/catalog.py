from flask import Blueprint, jsonify, request

from restaurant.db import cursor, mysql_rows, mysql_tx
from restaurant.errors import ApiError

from .utils import as_decimal, json_body, optional_int, require

catalog_bp = Blueprint("catalog", __name__, url_prefix="/api/menu")


def _bool(value, field):
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.lower() in ("true", "false", "0", "1"):
        return value.lower() in ("true", "1")
    raise ApiError(f"{field} must be a boolean.")


def _get_item(item_id):
    rows = mysql_rows(
        """
        SELECT m.item_id, m.category_id, c.category_name, m.name, m.description,
               m.price, m.is_available, m.is_veg
          FROM menu_item m
          JOIN menu_category c ON c.category_id = m.category_id
         WHERE m.item_id = %s
        """,
        (item_id,),
    )
    if not rows:
        raise ApiError("Menu item not found.", 404)
    item = rows[0]
    item["is_available"] = bool(item["is_available"])
    item["is_veg"] = bool(item["is_veg"])
    return item


@catalog_bp.get("")
def list_menu():
    category_id = optional_int(request.args.get("category_id"), "category_id", 1)
    search = (request.args.get("q") or "").strip()
    available = request.args.get("available")

    where = ["1 = 1"]
    params = []
    if category_id:
        where.append("m.category_id = %s")
        params.append(category_id)
    if search:
        where.append("(m.name LIKE %s OR m.description LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    if available is not None and available != "":
        where.append("m.is_available = %s")
        params.append(_bool(available, "available"))

    items = mysql_rows(
        f"""
        SELECT m.item_id, m.category_id, c.category_name, m.name, m.description,
               m.price, m.is_available, m.is_veg
          FROM menu_item m
          JOIN menu_category c ON c.category_id = m.category_id
         WHERE {' AND '.join(where)}
         ORDER BY c.category_name, m.name
        """,
        tuple(params),
    )
    for item in items:
        item["is_available"] = bool(item["is_available"])
        item["is_veg"] = bool(item["is_veg"])

    categories = mysql_rows(
        """
        SELECT c.category_id, c.category_name,
               COUNT(m.item_id) AS item_count,
               COALESCE(SUM(m.is_available), 0) AS available_count
          FROM menu_category c
          LEFT JOIN menu_item m ON m.category_id = c.category_id
         GROUP BY c.category_id, c.category_name
         ORDER BY c.category_name
        """
    )
    for category in categories:
        category["item_count"] = int(category["item_count"])
        category["available_count"] = int(category["available_count"])

    return jsonify(
        {
            "items": items,
            "categories": categories,
            "summary": {
                "items": len(items),
                "available": sum(1 for item in items if item["is_available"]),
                "categories": len(categories),
            },
        }
    )


@catalog_bp.post("/categories")
def create_category():
    data = json_body()
    name = require(data, "category_name", "Category name")
    if len(name) > 80:
        raise ApiError("Category name must be 80 characters or fewer.")
    with mysql_tx() as conn, cursor(conn) as cur:
        cur.execute(
            "INSERT INTO menu_category (category_name) VALUES (%s)", (name,)
        )
        category_id = cur.lastrowid
    return jsonify({"category": {"category_id": category_id, "category_name": name}}), 201


@catalog_bp.post("")
def create_item():
    data = json_body()
    category_id = optional_int(data.get("category_id"), "category_id", 1)
    if category_id is None:
        raise ApiError("category_id is required.")
    name = require(data, "name", "Item name")
    price = as_decimal(data.get("price"), "price", minimum=0, maximum=100000)
    description = (data.get("description") or "").strip() or None
    is_veg = _bool(data.get("is_veg", True), "is_veg")
    is_available = _bool(data.get("is_available", True), "is_available")

    with mysql_tx() as conn, cursor(conn) as cur:
        cur.execute(
            "SELECT category_id FROM menu_category WHERE category_id = %s",
            (category_id,),
        )
        if not cur.fetchone():
            raise ApiError("Menu category not found.", 404)
        cur.execute(
            """
            INSERT INTO menu_item
                (category_id, name, description, price, is_available, is_veg)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (category_id, name, description, price, is_available, is_veg),
        )
        item_id = cur.lastrowid

    return jsonify({"item": _get_item(item_id)}), 201


@catalog_bp.patch("/items/<int:item_id>")
def update_item(item_id):
    data = json_body()
    allowed = {"name", "description", "price", "is_available", "is_veg", "category_id"}
    fields = []
    params = []

    if "name" in data:
        name = require(data, "name", "Item name")
        fields.append("name = %s")
        params.append(name)
    if "description" in data:
        description = (data.get("description") or "").strip() or None
        fields.append("description = %s")
        params.append(description)
    if "price" in data:
        price = as_decimal(data.get("price"), "price", minimum=0, maximum=100000)
        fields.append("price = %s")
        params.append(price)
    if "is_available" in data:
        fields.append("is_available = %s")
        params.append(_bool(data.get("is_available"), "is_available"))
    if "is_veg" in data:
        fields.append("is_veg = %s")
        params.append(_bool(data.get("is_veg"), "is_veg"))
    if "category_id" in data:
        category_id = optional_int(data.get("category_id"), "category_id", 1)
        if category_id is None:
            raise ApiError("category_id cannot be empty.")
        fields.append("category_id = %s")
        params.append(category_id)
    if not fields:
        raise ApiError(f"Provide at least one field to update: {', '.join(sorted(allowed))}.")

    params.append(item_id)
    with mysql_tx() as conn, cursor(conn) as cur:
        cur.execute(
            f"UPDATE menu_item SET {', '.join(fields)} WHERE item_id = %s", tuple(params)
        )
        if cur.rowcount == 0:
            raise ApiError("Menu item not found.", 404)

    return jsonify({"item": _get_item(item_id)})


@catalog_bp.get("/specials")
def specials():
    items = mysql_rows(
        """
        SELECT m.item_id, m.name, c.category_name, m.price,
               COALESCE(SUM(oi.quantity), 0) AS units_sold
          FROM menu_item m
          JOIN menu_category c ON c.category_id = m.category_id
          LEFT JOIN order_item oi ON oi.item_id = m.item_id
         WHERE m.is_available = TRUE
         GROUP BY m.item_id, m.name, c.category_name, m.price
         ORDER BY units_sold DESC
         LIMIT 8
        """
    )
    for item in items:
        item["units_sold"] = int(item["units_sold"])
    return jsonify({"items": items})
