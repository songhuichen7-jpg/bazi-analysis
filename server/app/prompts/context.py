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

    # Plan 7.5a: transmutation block
    transmuted = detail.get('transmuted')
    if transmuted:
        trig = transmuted['trigger']
        lines.append(
            f"  ⟳ 月令变化  {transmuted['from']} → {transmuted['to']}  {trig['source']}"
        )
        cand = transmuted['candidate']
        cand_name = cand.get('name', '?')
        cand_note = cand.get('note', '')
        cand_src  = cand.get('source', '')
        line = f"      格局新候选：{cand_name}"
        if cand_note:
            line += f"（{cand_note}）"
        if cand_src:
            line += f"  {cand_src}"
        lines.append(line)
        if transmuted.get('warning'):
            lines.append(f"      ⚠ {transmuted['warning']}")

    for w in detail.get('warnings') or []:
        lines.append(f"  ⚠ {w}")

    return lines


_XINGYUN_GLYPH = {
    '大喜': '⭐⭐',
    '喜':   '⭐',
    '平':   '·',
    '忌':   '⚠',
    '大忌': '⚠⚠',
}


def _render_xingyun_block(paipan: dict) -> list[str]:
    """Plan 7.4 §6.2 — render 行运 评分块.

    Renders 8 大运 (with ★ marker on current) + the 10 流年 within the
    current 大运 (other 大运's 流年 collapsed). Returns [] when xingyun
    is absent or all-平 (中和 命局 fallback).
    """
    xy = paipan.get('xingyun') or {}
    dayun_list = xy.get('dayun') or []
    if not dayun_list:
        return []

    # If every 大运 is '平' AND yongshenSnapshot 含 '中和', collapse entirely
    if (all(d.get('label') == '平' for d in dayun_list)
            and '中和' in (xy.get('yongshenSnapshot') or '')):
        return []

    snapshot = xy.get('yongshenSnapshot', '?')
    lines = [f'行运（对照命局用神 {snapshot}）：']
    cur_idx = xy.get('currentDayunIndex')

    for entry in dayun_list:
        marker = '★ ' if entry['index'] == cur_idx else '  '
        end_age = entry['startAge'] + (entry['endYear'] - entry['startYear'])
        glyph = _XINGYUN_GLYPH.get(entry['label'], '?')
        lines.append(
            f"  {marker}{entry['startAge']}-{end_age}岁  "
            f"{entry['ganzhi']}  {glyph}{entry['label']}  {entry['note']}"
        )

    if cur_idx is not None:
        ln_list = xy.get('liunian', {}).get(str(cur_idx), [])
        if ln_list:
            cur_dy = next(
                (d for d in dayun_list if d['index'] == cur_idx),
                None,
            )
            if cur_dy:
                lines.append(f'  ↳ 当前大运 {cur_dy["ganzhi"]} 内流年明细：')
                for ly in ln_list:
                    glyph = _XINGYUN_GLYPH.get(ly['label'], '?')
                    lines.append(
                        f"      {ly['year']}({ly['ganzhi']},{ly['age']}岁)  "
                        f"{glyph}{ly['label']}  {ly['note']}"
                    )

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
    # Plan 7.4: 行运 evaluation block
    lines.extend(_render_xingyun_block(p))
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
