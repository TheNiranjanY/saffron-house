from datetime import datetime, timedelta, timezone

from restaurant.timeutil import date_bounds, from_mysql, iso, now_local, to_mysql


def test_locale_is_asia_kolkata():
    assert now_local().tzinfo is not None
    assert now_local().utcoffset() == timedelta(hours=5, minutes=30)


def test_mysql_round_trip_uses_local_wall_time():
    aware = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert to_mysql(aware) == datetime(2026, 1, 1, 17, 30)

    naive = datetime(2026, 1, 1, 12, 0)
    assert to_mysql(naive) == naive
    assert to_mysql(None) is None

    restored = from_mysql(naive)
    assert restored.utcoffset() == timedelta(hours=5, minutes=30)
    assert restored.replace(tzinfo=None) == naive
    assert from_mysql(None) is None


def test_iso_marks_local_time():
    assert iso(datetime(2026, 1, 1, 12, 0)) == "2026-01-01T12:00:00+05:30"
    assert iso(None) is None


def test_date_bounds_covers_whole_requested_window():
    start, end = date_bounds(1)
    assert (start.hour, start.minute, start.second, start.microsecond) == (0, 0, 0, 0)
    assert start.date() <= now_local().date()
    assert end >= start

    week_start, _ = date_bounds(7)
    assert (start.date() - week_start.date()).days == 6
    assert (week_start.hour, week_start.minute) == (0, 0)
