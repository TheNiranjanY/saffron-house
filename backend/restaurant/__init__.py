import logging
import os

import mysql.connector
import psycopg
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .config import Config
from .errors import ApiError
from .serialization import SaffronJSONProvider

log = logging.getLogger(__name__)


def create_app():
    app = Flask(__name__)
    app.json = SaffronJSONProvider(app)
    app.config["PROPAGATE_EXCEPTIONS"] = False

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    from .api import register_blueprints

    register_blueprints(app)

    @app.after_request
    def cors(response):
        origin = request.headers.get("Origin")
        configured = os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,"
            "http://localhost:4173,http://127.0.0.1:4173",
        )
        allowed = {item.strip() for item in configured.split(",") if item.strip()}
        if origin and (origin in allowed or origin.startswith("http://localhost:")):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PATCH, PUT, DELETE, OPTIONS"
            )
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
        return response

    @app.get("/")
    def index():
        return jsonify(
            {
                "service": "Saffron House POS API",
                "version": "1.0.0",
                "stores": {"operational": "MySQL 8.4", "analytics": "TimescaleDB 2.31"},
                "docs": "/api/health",
            }
        )

    @app.errorhandler(ApiError)
    def handle_api_error(exc: ApiError):
        payload = {"error": {"message": exc.message}}
        if exc.details is not None:
            payload["error"]["details"] = exc.details
        return jsonify(payload), exc.status_code

    @app.errorhandler(mysql.connector.Error)
    def handle_mysql_error(exc):
        errno = getattr(exc, "errno", None)
        raw = getattr(exc, "msg", str(exc))
        if errno == 1644:  # SIGNAL SQLSTATE '45000' from stored routines/triggers
            message = str(raw).split(": ", 1)[-1]
            return jsonify({"error": {"message": message}}), 400
        if errno == 1062:
            return jsonify({"error": {"message": "That record already exists."}}), 409
        if errno in (1451, 1452):
            return jsonify({"error": {"message": "Related record does not exist or is still in use."}}), 409
        if errno in (3819, 1406, 1264, 1366):
            return jsonify({"error": {"message": "A value failed the database constraints."}}), 400
        if errno == 1205:
            return jsonify({"error": {"message": "The record is locked by another operation. Try again."}}), 409
        log.exception("Unhandled MySQL error", exc_info=exc)
        return jsonify({"error": {"message": "Operational database error."}}), 500

    @app.errorhandler(psycopg.Error)
    def handle_ts_error(exc):
        log.exception("TimescaleDB error", exc_info=exc)
        return jsonify({"error": {"message": "Analytics database is unavailable."}}), 503

    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        return jsonify({"error": {"message": exc.description or exc.name}}), exc.code

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        log.exception("Unhandled API exception")
        return jsonify({"error": {"message": "Unexpected server error."}}), 500

    return app
