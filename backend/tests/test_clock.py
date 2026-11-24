from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.clock import coerce_timezone, local_today


def test_coerce_timezone_keeps_valid_names():
    assert coerce_timezone("Asia/Kolkata") == "Asia/Kolkata"
    assert coerce_timezone("") == "Asia/Kolkata"
    assert coerce_timezone(None) == "Asia/Kolkata"


def test_local_today_uses_institute_zone():
    noon_utc = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
    assert local_today("Asia/Kolkata", now=noon_utc) == "2026-11-24"
    # 18:30 UTC is already 00:00 next day in Asia/Kolkata (UTC+5:30).
    before_midnight = datetime(2026, 11, 24, 18, 29, tzinfo=timezone.utc)
    assert local_today("Asia/Kolkata", now=before_midnight) == "2026-11-24"
    next_day = datetime(2026, 11, 24, 18, 30, tzinfo=timezone.utc)
    assert local_today("Asia/Kolkata", now=next_day) == "2026-11-25"


def test_local_today_falls_back_when_zoneinfo_missing(monkeypatch):
    def missing(_name):
        raise ZoneInfoNotFoundError("missing")

    monkeypatch.setattr("app.clock.ZoneInfo", missing)
    assert coerce_timezone("Asia/Kolkata") == "UTC"
    assert local_today("Asia/Kolkata", now=datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)) == "2026-11-24"
