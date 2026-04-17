"""Quota limits per plan + timezone helpers for daily-reset quotas.

NOTE: Plan 3 ONLY consumes 'sms_send' quota. Other kinds are placeholders
for Plan 4+ to consume. Values may be tuned per product feedback.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_BEIJING = ZoneInfo("Asia/Shanghai")


QUOTAS: dict[str, dict[str, int]] = {
    "free": {
        "sms_send":       20,
        "chat_message":   30,
        "section_regen":   5,
        "verdicts_regen":  3,
        "dayun_regen":    10,
        "liunian_regen":  10,
        "gua":            20,
    },
    "pro": {  # placeholder — Plan 5 revises when pricing is set
        "sms_send":       20,
        "chat_message":   30,
        "section_regen":   5,
        "verdicts_regen":  3,
        "dayun_regen":    10,
        "liunian_regen":  10,
        "gua":            20,
    },
}


def today_beijing() -> str:
    """YYYY-MM-DD string in Asia/Shanghai (quota reset boundary)."""
    return datetime.now(tz=_BEIJING).strftime("%Y-%m-%d")


def next_midnight_beijing() -> datetime:
    """Next 00:00:00 in Asia/Shanghai (when quota resets)."""
    now = datetime.now(tz=_BEIJING)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    return tomorrow


def seconds_until_midnight() -> int:
    """Seconds from now until the next Beijing midnight."""
    now = datetime.now(tz=_BEIJING)
    return int((next_midnight_beijing() - now).total_seconds())


# NOTE: spec §2.2 — 每用户活动盘上限；软删不算。
MAX_CHARTS_PER_USER = 15
