from datetime import date
from decimal import Decimal, InvalidOperation

from flask import request

from restaurant.errors import ApiError
from restaurant.events import project_pending_safe


def json_body(required=True):
    data = request.get_json(silent=True)
    if data is None and not required:
        return {}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.")
    return data


def as_int(value, field, minimum=None, maximum=None):
    if isinstance(value, bool):
        raise ApiError(f"{field} must be an integer.")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field} must be an integer.")
    if minimum is not None and number < minimum:
        raise ApiError(f"{field} must be at least {minimum}.")
    if maximum is not None and number > maximum:
        raise ApiError(f"{field} must be at most {maximum}.")
    return number


def optional_int(value, field, minimum=None, maximum=None):
    if value is None or value == "":
        return None
    return as_int(value, field, minimum, maximum)


def as_decimal(value, field, minimum=None, maximum=None, scale="0.01"):
    if isinstance(value, bool):
        raise ApiError(f"{field} must be a number.")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ApiError(f"{field} must be a number.")
    if not number.is_finite():
        raise ApiError(f"{field} must be a finite number.")
    if scale:
        number = number.quantize(Decimal(scale))
    if minimum is not None and number < Decimal(str(minimum)):
        raise ApiError(f"{field} must be at least {minimum}.")
    if maximum is not None and number > Decimal(str(maximum)):
        raise ApiError(f"{field} must be at most {maximum}.")
    return number


def require(data, field, label=None):
    value = data.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ApiError(f"{label or field} is required.")
    return value.strip() if isinstance(value, str) else value


def enum_value(value, field, allowed):
    if value not in allowed:
        raise ApiError(f"{field} must be one of {', '.join(allowed)}.")
    return value


def query_int(name, default=None, minimum=None, maximum=None):
    raw = request.args.get(name)
    if raw is None or raw == "":
        if default is None:
            raise ApiError(f"{name} is required.")
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ApiError(f"{name} must be an integer.")
    if minimum is not None and value < minimum:
        raise ApiError(f"{name} must be at least {minimum}.")
    if maximum is not None and value > maximum:
        raise ApiError(f"{name} must be at most {maximum}.")
    return value


def query_days(default=7, maximum=365):
    return query_int("days", default, 1, maximum)


def query_date(name="date", default=None):
    raw = request.args.get(name)
    if not raw:
        return default
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ApiError(f"{name} must use the YYYY-MM-DD format.")


def sync_analytics():
    return project_pending_safe()
