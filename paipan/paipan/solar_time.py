"""
真太阳时换算。Port of paipan-engine/src/solarTime.js.

标准时（北京时 UTC+8，120°E）→ 真太阳时

修正分两部分：
  1. 经度时差：每经度 4 分钟。用户所在经度 L（东经正值），
     相对 120°E 的时差 = (L - 120) * 4 分钟
  2. 均时差（Equation of Time, EoT）：地球轨道离心率+黄赤交角
     造成的太阳相对于平太阳的快慢。使用 Meeus 简化公式，
     精度约 ±1 分钟，足够命理使用。
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone


def equation_of_time(utc_dt: datetime) -> float:
    """
    均时差（分钟），基于 Meeus《天文算法》简化式。
    Port of solarTime.js:19-34 equationOfTime.

    Args:
        utc_dt: UTC datetime (tzinfo must be UTC or naive-interpreted-as-UTC)

    Returns:
        均时差分钟数（正：真太阳快于平太阳）
    """
    # Match Node: const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    # Date.UTC(Y, 0, 0) = 前一年 12 月 31 日 00:00 UTC
    # NOTE: solarTime.js:21-23
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=timezone.utc)
    else:
        utc_dt = utc_dt.astimezone(timezone.utc)

    year = utc_dt.year
    start = datetime(year - 1, 12, 31, 0, 0, 0, tzinfo=timezone.utc)
    diff_ms = (utc_dt - start).total_seconds() * 1000.0
    # NOTE: solarTime.js:23 — 86400000 ms/day
    N = math.floor(diff_ms / 86400000)

    # NOTE: solarTime.js:26 — B = 2π(N-81)/365
    B = (2 * math.pi * (N - 81)) / 365

    # NOTE: solarTime.js:29-32 — EoT = 9.87 sin(2B) - 7.53 cos(B) - 1.5 sin(B)
    eot = (
        9.87 * math.sin(2 * B)
        - 7.53 * math.cos(B)
        - 1.5 * math.sin(B)
    )
    return eot


def to_true_solar_time(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    longitude: float,
) -> dict:
    """
    把北京时间转换成真太阳时。
    Port of solarTime.js:46-80 toTrueSolarTime.

    Args:
        year, month (1-12), day, hour (0-23), minute (0-59): 北京时间
        longitude: 东经为正，西经为负

    Returns:
        {year, month, day, hour, minute, shiftMinutes, eotMinutes, longitudeMinutes}
    """
    # 北京时的 UTC 时间戳
    # NOTE: solarTime.js:48 — new Date(Date.UTC(year, month-1, day, hour-8, minute, 0))
    # Beijing is UTC+8, so UTC = Beijing - 8h
    utc_dt = datetime(year, month, day, hour, minute, 0, tzinfo=timezone.utc) - timedelta(hours=8)

    # 经度时差（分钟）
    # NOTE: solarTime.js:51 — (longitude - 120) * 4
    longitude_minutes = (longitude - 120) * 4

    # 均时差（分钟）
    # NOTE: solarTime.js:54
    eot_minutes = equation_of_time(utc_dt)

    # 总修正
    # NOTE: solarTime.js:57
    shift_minutes = longitude_minutes + eot_minutes

    # 应用到北京时间上
    # NOTE: solarTime.js:60-68 — Node 用 local-TZ Date 做加减；在 UTC/无 DST 环境下
    # 等价于纯字段加减。Oracle dump 在 TZ=UTC (via +08:00 literal) 下生成，
    # 我们用 naive datetime 字段加减来匹配。
    base = datetime(year, month, day, hour, minute, 0)
    corrected = base + timedelta(minutes=shift_minutes)

    # NOTE: solarTime.js:76-78 — Math.round(x * 10) / 10，四舍五入到 0.1
    # JS Math.round 对 .5 向 +∞ 取整（与 Python round 的 banker's rounding 不同），
    # 用 math.floor(x + 0.5) 精确模拟 JS 行为。
    return {
        "year": corrected.year,
        "month": corrected.month,
        "day": corrected.day,
        "hour": corrected.hour,
        "minute": corrected.minute,
        "shiftMinutes": math.floor(shift_minutes * 10 + 0.5) / 10,
        "eotMinutes": math.floor(eot_minutes * 10 + 0.5) / 10,
        "longitudeMinutes": math.floor(longitude_minutes * 10 + 0.5) / 10,
    }
