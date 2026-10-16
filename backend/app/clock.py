"""Institute-local dates. Follow-up deadlines use this calendar, not UTC."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Kolkata"


def coerce_timezone(value: str | None) -> str:
    name = (value or "").strip() or DEFAULT_TIMEZONE
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return DEFAULT_TIMEZONE
    return name


def require_timezone(value: str) -> str:
    name = (value or "").strip()
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(name) from exc
    return name


def local_today(timezone_name: str | None, now: datetime | None = None) -> str:
    zone = ZoneInfo(coerce_timezone(timezone_name))
    moment = now.astimezone(zone) if now else datetime.now(zone)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc).astimezone(zone)
    return moment.date().isoformat()
