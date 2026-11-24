"""Institute-local dates. Follow-up deadlines use this calendar, not UTC."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Kolkata"


def coerce_timezone(value: str | None) -> str:
    """Pick a usable IANA name. Windows embeddable Python needs the tzdata package."""
    candidates = [(value or "").strip(), DEFAULT_TIMEZONE, "UTC"]
    for name in candidates:
        if not name:
            continue
        try:
            ZoneInfo(name)
            return name
        except ZoneInfoNotFoundError:
            continue
    return "UTC"


def require_timezone(value: str) -> str:
    name = (value or "").strip()
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(name) from exc
    return name


def local_today(timezone_name: str | None, now: datetime | None = None) -> str:
    name = coerce_timezone(timezone_name)
    try:
        zone = ZoneInfo(name)
    except ZoneInfoNotFoundError:
        zone = timezone.utc
    moment = now.astimezone(zone) if now else datetime.now(zone)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc).astimezone(zone)
    return moment.date().isoformat()
