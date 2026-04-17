"""
China DST correction. Port of paipan-engine/src/chinaDst.js.
Only 1986-05-04 ~ 1991-09-15 summers had DST in China.

During DST the wall clock was advanced +1h, so to recover real (standard)
time we subtract 1 hour from the clock reading.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_HOST_TZ = ZoneInfo("Asia/Shanghai")


# NOTE: chinaDst.js:16-24 — CHINA_DST_PERIODS 照抄 Node 源码数据。
# 格式：{year: (start_month, start_day, end_month, end_day)}
# 起止边界钟点统一在 02:00，由 _is_in_dst 施加。
_DST_TABLE: dict[int, tuple[int, int, int, int]] = {
    1986: (5, 4, 9, 14),   # NOTE: chinaDst.js:18
    1987: (4, 12, 9, 13),  # NOTE: chinaDst.js:19
    1988: (4, 10, 9, 11),  # NOTE: chinaDst.js:20
    1989: (4, 16, 9, 17),  # NOTE: chinaDst.js:21
    1990: (4, 15, 9, 16),  # NOTE: chinaDst.js:22
    1991: (4, 14, 9, 15),  # NOTE: chinaDst.js:23
}


def _is_in_dst(year: int, month: int, day: int, hour: int) -> bool:
    """Port of chinaDst.js:34 isChinaDst.

    Node 用 `ts >= startTs && ts < endTs`，起止日都在 02:00。
    这里 minute 参数 Node 也没用（只比较到 hour），为忠实起见保持同样行为。
    """
    entry = _DST_TABLE.get(year)
    if entry is None:
        return False
    sm, sd, em, ed = entry
    # NOTE: chinaDst.js:38 — Node 构造时 minute=0, second=0，按 hour 粒度比较
    t = datetime(year, month, day, hour, 0, 0)
    # NOTE: chinaDst.js:40 — 起始：起始日 02:00
    start = datetime(year, sm, sd, 2, 0, 0)
    # NOTE: chinaDst.js:42 — 结束：结束日 02:00（含该日 00:00-02:00）
    end = datetime(year, em, ed, 2, 0, 0)
    # NOTE: chinaDst.js:44 — ts >= startTs && ts < endTs
    return start <= t < end


def correct_china_dst(
    year: int, month: int, day: int, hour: int, minute: int
) -> dict:
    """Port of chinaDst.js:51 correctChinaDst.

    Returns:
        {year, month, day, hour, minute, wasDst}
    """
    # NOTE: chinaDst.js:52 — isChinaDst 只吃 hour，不吃 minute
    in_dst = _is_in_dst(year, month, day, hour)
    if not in_dst:
        # NOTE: chinaDst.js:54 — 字段顺序及 camelCase wasDst 照抄
        return {
            "year": year,
            "month": month,
            "day": day,
            "hour": hour,
            "minute": minute,
            "wasDst": False,
        }
    # NOTE: chinaDst.js:56 — new Date(y, m-1, d, hour-1, minute, 0)
    # JS Date constructor under host Asia/Shanghai does "wall-clock construction
    # with forward-normalize on DST gap" — uses IANA tzdata. If hour-1 lands in
    # a non-existent wall-clock (spring-forward), JS normalizes forward.
    # Critically, IANA's 1988 CDT start is 1988-04-17, not Node table's 04-10,
    # so JS's behavior varies per year. Replicate via zoneinfo UTC round-trip.
    wc = (
        datetime(year, month, day, hour - 1, minute, 0, tzinfo=_HOST_TZ)
        .astimezone(timezone.utc)
        .astimezone(_HOST_TZ)
    )
    return {
        "year": wc.year,
        "month": wc.month,
        "day": wc.day,
        "hour": wc.hour,
        "minute": wc.minute,
        "wasDst": True,
    }
