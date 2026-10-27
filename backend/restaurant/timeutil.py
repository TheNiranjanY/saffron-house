from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .config import Config

LOCAL_TZ = ZoneInfo(Config.TZ)


def now_local() -> datetime:
    return datetime.now(LOCAL_TZ)


def to_mysql(dt: datetime | None) -> datetime | None:
    """MySQL DATETIME columns hold restaurant-local wall time."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=LOCAL_TZ).replace(tzinfo=None)
    return dt.astimezone(LOCAL_TZ).replace(tzinfo=None)


def from_mysql(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=LOCAL_TZ)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=LOCAL_TZ)
    return value.astimezone(LOCAL_TZ).isoformat()


def date_bounds(days: int):
    """Local-time window covering today plus the previous N-1 days."""
    now = now_local()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = start - timedelta(days=max(days - 1, 0))
    return start, now
