"""Chart-context compaction + timing helpers.

NOTE: ports archive/server-mvp/prompts.js:53-182. Output string shape is
prompt-sensitive — preserve Chinese labels and ordering.
"""
from __future__ import annotations

from datetime import datetime


def _render_yongshen_block(paipan: dict) -> list[str]:
    """Plan 7.3 §6.3 — render 用神 detail as compact text lines for LLM prompt.

    Returns a list of lines to append to the chart-context block. Returns []
    when yongshenDetail is absent or empty.
    """
    detail = paipan.get('yongshenDetail') or {}
    if not detail.get('primary'):
        return []

    lines: list[str] = []
    primary = detail['primary']
    reason = detail.get('primaryReason', '')
    head = f"用神：{primary}"
    if reason:
        head += f"（{reason}）"
    lines.append(head)

    for c in detail.get('candidates') or []:
        method = c.get('method', '?')
        name = c.get('name') or '—'
        note = c.get('note', '')
        source = c.get('source', '')
        if name == '—' and not note:
            lines.append(f"  · {method} ▸ —")
            continue
        line = f"  · {method} ▸ {name}"
        if note:
            line += f"（{note}）"
        if source:
            line += f"  {source}"
        lines.append(line)

    for w in detail.get('warnings') or []:
        lines.append(f"  ⚠ {w}")

    return lines


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
    # dayun may be a dict {"list": [...]} or a plain list
    _dayun_raw = p.get("dayun") or {}
    if isinstance(_dayun_raw, dict):
        dayun = _dayun_raw.get("list") or []
    else:
        dayun = list(_dayun_raw)
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
    lines.extend(_render_yongshen_block(p))
    ss = shishen
    lines.append(
        f"十神  年:{ss.get('year','')}  月:{ss.get('month','')}"
        f"  日:{ss.get('day','')}  时:{ss.get('hour','')}"
    )

    def _cg(pos: str) -> str:
        arr = cang_gan.get(pos) or []
        parts = []
        for it in arr:
            if isinstance(it, dict):
                parts.append(f"{it.get('gan','')}({it.get('shiShen','')})")
            else:
                parts.append(str(it))
        return "/".join(parts)

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
            # paipan uses 'ganzhi' (lowercase z); JS expected 'ganZhi'
            gz = d.get("ganZhi") or d.get("ganzhi") or ""
            ss = d.get("shiShen") or d.get("shishen") or ""
            age = d.get("startAge", "?")
            steps.append(f"{gz}({ss}@{age}岁)")
        lines.append("大运  " + " → ".join(steps))

    if today_ymd or today_year_gz:
        lines.append(
            f"当前  {today_ymd}  年柱:{today_year_gz}  月柱:{today_month_gz}  日柱:{today_day_gz}"
        )

    return "\n".join(lines).rstrip()
