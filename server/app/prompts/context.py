"""Chart-context compaction + timing helpers.

NOTE: ports archive/server-mvp/prompts.js:53-182. Output string shape is
prompt-sensitive — preserve Chinese labels and ordering.
"""
from __future__ import annotations

from datetime import datetime


def resolve_today_year(paipan: dict) -> int:
    """NOTE: prompts.js:53-60 — falls back to datetime.now().year if absent."""
    ymd = str((paipan or {}).get("todayYmd") or "")
    if ymd[:4].isdigit():
        y = int(ymd[:4])
        if y > 0:
            return y
    return datetime.now().year


def resolve_current_timing(ui: dict) -> dict:
    """NOTE: prompts.js:62-89 — picks current 大运 / 流年 from UI slice."""
    ui = ui or {}
    dayun = ui.get("currentDayun") or ""
    liunian = ui.get("currentLiunian") or ""
    return {"dayun": str(dayun), "liunian": str(liunian)}


def compact_chart_context(paipan: dict) -> str:
    """Port of compactChartContext(ui) from prompts.js:91-182.

    Builds a multi-line compact description the LLM uses as chart context.
    """
    p = paipan or {}
    sizhu = p.get("sizhu") or {}
    shishen = p.get("shishen") or {}
    cang_gan = p.get("cangGan") or {}
    na_yin = p.get("naYin") or {}
    dayun = p.get("dayun") or []
    today_ymd = p.get("todayYmd") or ""
    today_year_gz = p.get("todayYearGz") or ""
    today_month_gz = p.get("todayMonthGz") or ""
    today_day_gz = p.get("todayDayGz") or ""

    lines: list[str] = []
    lines.append("【命盘上下文】")
    lines.append(
        f"四柱  年:{sizhu.get('year','')}  月:{sizhu.get('month','')}"
        f"  日:{sizhu.get('day','')}  时:{sizhu.get('hour','')}"
    )
    lines.append(f"日主  {p.get('rizhu','')}")
    ss = shishen
    lines.append(
        f"十神  年:{ss.get('year','')}  月:{ss.get('month','')}"
        f"  日:{ss.get('day','')}  时:{ss.get('hour','')}"
    )

    def _cg(pos: str) -> str:
        arr = cang_gan.get(pos) or []
        return "/".join(f"{it.get('gan','')}({it.get('shiShen','')})" for it in arr)

    lines.append(
        f"藏干  年:{_cg('year')}  月:{_cg('month')}  日:{_cg('day')}  时:{_cg('hour')}"
    )
    ny = na_yin
    lines.append(
        f"纳音  年:{ny.get('year','')}  月:{ny.get('month','')}"
        f"  日:{ny.get('day','')}  时:{ny.get('hour','')}"
    )
    if dayun:
        steps = []
        for d in dayun[:8]:
            steps.append(f"{d.get('ganZhi','')}({d.get('shiShen','')}@{d.get('startAge','?')}岁)")
        lines.append("大运  " + " → ".join(steps))

    if today_ymd or today_year_gz:
        lines.append(
            f"当前  {today_ymd}  年柱:{today_year_gz}  月柱:{today_month_gz}  日柱:{today_day_gz}"
        )

    return "\n".join(lines).rstrip()
