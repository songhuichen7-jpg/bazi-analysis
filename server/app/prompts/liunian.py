"""Liunian prompt builder — 流年解读.

NOTE: prompts.js:709-758
"""
from __future__ import annotations

from app.prompts.anchor import build_classical_anchor

# NOTE: prompts.js:587-595 (INTENT_GUIDE.liunian)
_INTENT_GUIDE_LIUNIAN = (
    '【本轮：某一年的流年解读】\n'
    '在当前大运背景下讲这一年对命主的具体作用：\n'
    '- 年干支与日主的十神关系（ss 字段已给）\n'
    '- 年柱与大运干支的合冲刑害（同冲/同合会加码，互冲互合会缓和）\n'
    '- 落在"紧/松"哪种节奏：杀旺压身、财星辛劳、印年贵人等\n'
    '- 结尾给一句"这一年适合做什么 / 避免什么"，要具体\n'
    '- 4-8 行，口语，不要段落标题\n'
    '- 第一个字必须是具体干支或结论，不要"好的"、"这一年"这种套话开头。'
)

_RUNTIME_HEADER = (
    '【运行时约束 — 最高优先级】\n'
    '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、'
    '"让我先查一下古籍" 这类过程性描述。\n'
    '古籍/方法论内容已内化，直接引用即可。'
)

_FORMAT_BLOCK = (
    '【输出格式】\n'
    '- 纯文本，不要标题、不要"以下是..."前言\n'
    '- 4-8 行，每行 1-2 句\n'
    '- 判断必须 tie to 年干支 + 大运干支 + 日主/用神'
)


def build_messages(
    chart: dict,
    retrieved: list[dict] | None = None,
    *,
    dayun_index: int,
    year_index: int,
) -> list[dict]:
    # NOTE: prompts.js:709-758
    retrieved = retrieved or []
    _dayun_raw = (chart or {}).get('dayun') or {}
    if isinstance(_dayun_raw, dict):
        dayun = _dayun_raw.get('list') or []
    else:
        dayun = list(_dayun_raw)
    if dayun_index >= len(dayun):
        raise ValueError(f'invalid dayun_index {dayun_index}: dayun has {len(dayun)} steps')
    step = dayun[dayun_index]
    # paipan uses 'liunian' key; JS used 'years'
    years = step.get('years') or step.get('liunian') or []
    if year_index >= len(years):
        raise ValueError(f'invalid year_index {year_index}: dayun step has {len(years)} years')
    year_info = years[year_index]

    # Determine current timing for annotation
    today_ymd = (chart or {}).get('todayYmd') or ''
    current_year = int(today_ymd[:4]) if today_ymd[:4].isdigit() else 0
    current_dayun_index = -1
    for i, d in enumerate(dayun):
        start = d.get('startYear') or 0
        end = d.get('endYear') or 9999
        if current_year and start <= current_year <= end:
            current_dayun_index = i
            break

    current_liunian_year = None
    if current_dayun_index >= 0:
        cur_step = dayun[current_dayun_index]
        for y in (cur_step.get('years') or cur_step.get('liunian') or []):
            if y.get('year') == current_year or y.get('current'):
                current_liunian_year = y.get('year')
                break

    sys = '\n'.join([
        _RUNTIME_HEADER,
        '',
        _INTENT_GUIDE_LIUNIAN,
        '',
        _FORMAT_BLOCK,
    ])

    rizhu = (chart or {}).get('rizhu') or '?'
    age = step.get('startAge', '?')
    step_gz = step.get('ganZhi') or step.get('ganzhi') or '?'
    step_ss = step.get('shiShen') or step.get('shishen') or '?'
    step_start = step.get('startYear')
    step_end = step.get('endYear')
    step_yr = f' {step_start}\u2013{step_end}' if step_start else ''
    dayun_current = ' \u2190 正走' if dayun_index == current_dayun_index else ''

    yi_year = year_info.get('year', '?')
    yi_gz = year_info.get('gz') or year_info.get('ganZhi') or year_info.get('ganzhi') or '?'
    yi_ss = year_info.get('ss') or year_info.get('shiShen') or year_info.get('shishen') or ''
    liunian_current = ' \u2190 今年' if current_liunian_year == yi_year else ''

    core_lines = [
        f'【命主核心】日主 {rizhu}',
        '',
        f'【当前大运】{age}岁起 {step_gz}（{step_ss}）{step_yr}{dayun_current}',
        f'【本年】{yi_year}年 {yi_gz}（{yi_ss}）{liunian_current}',
    ]
    core = '\n'.join(core_lines)

    user_msg = f'请讲讲 {yi_year}年（{yi_gz} {yi_ss}）在 {step_gz} 大运里对我意味着什么。'

    anchor = build_classical_anchor(retrieved, terse=True)
    system_content = sys + '\n\n' + core
    if anchor:
        system_content += '\n\n' + anchor

    return [
        {'role': 'system', 'content': system_content},
        {'role': 'user', 'content': user_msg},
    ]
