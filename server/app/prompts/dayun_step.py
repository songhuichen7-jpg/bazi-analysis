"""Dayun-step prompt builder — 大运某步走向解读.

NOTE: prompts.js:658-708
"""
from __future__ import annotations

from app.prompts.anchor import build_classical_anchor
from app.prompts.style import BAZI_OUTPUT_STYLE_PRESET, CLASSICAL_QUOTE_POLICY

# NOTE: prompts.js:596-601 (INTENT_GUIDE.dayun_step)
_INTENT_GUIDE_DAYUN_STEP = (
    '【本轮：某一步大运的走向解读】\n'
    '分析这一步大运（干支 + 起运年龄）对日主的作用：干支各自是什么十神，和日主/用神的生克、与原局四柱的合冲。\n'
    '回答要落到具体十年里：前 2-3 年受上一步余气影响，中段（4-7 年）最纯，末 2 年过渡下一步。\n'
    '指出这十年哪条线被激活：事业/关系/财/健康，只选最突出的一两条。\n'
    '语气：像朋友在白板前给你画时间线。8-12 行，不用段落标题，不要前言后语。'
)

_RUNTIME_HEADER = '\n\n'.join([
    '【运行时约束 — 最高优先级】\n'
    '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、```...```'
    '、"让我先查一下古籍" 这类过程性描述。\n'
    '命盘上下文和可用古籍锚点已在本请求给出；直接输出给用户看的回答。',
    BAZI_OUTPUT_STYLE_PRESET,
    CLASSICAL_QUOTE_POLICY,
])

_FORMAT_BLOCK = (
    '【输出格式】\n'
    '- 纯文本或极简 Markdown，不要标题，不要"以下是..."前言\n'
    '- 第一个字是 "这"、"从"、或直接说干支，不要铺垫\n'
    '- 8-12 行，每行 1-2 句\n'
    '- 判断挂在具体干支/十神/用神/大运十神上'
)


def build_messages(
    chart: dict,
    retrieved: list[dict] | None = None,
    *,
    step_index: int,
) -> list[dict]:
    # NOTE: prompts.js:658-708
    retrieved = retrieved or []
    _dayun_raw = (chart or {}).get('dayun') or {}
    if isinstance(_dayun_raw, dict):
        dayun = _dayun_raw.get('list') or []
    else:
        dayun = list(_dayun_raw)
    if step_index >= len(dayun):
        raise ValueError(f'invalid step_index {step_index}: dayun has {len(dayun)} steps')
    step = dayun[step_index]
    prev_step = dayun[step_index - 1] if step_index > 0 else None
    next_step = dayun[step_index + 1] if step_index + 1 < len(dayun) else None

    # Determine if this step is currently active
    today_ymd = (chart or {}).get('todayYmd') or ''
    current_year = int(today_ymd[:4]) if today_ymd[:4].isdigit() else 0
    current_dayun_index = -1
    for i, d in enumerate(dayun):
        start = d.get('startYear') or 0
        end = d.get('endYear') or 9999
        if current_year and start <= current_year <= end:
            current_dayun_index = i
            break

    sys = '\n'.join([
        _RUNTIME_HEADER,
        '',
        _INTENT_GUIDE_DAYUN_STEP,
        '',
        _FORMAT_BLOCK,
    ])

    def _fmt(s: dict | None) -> str:
        if not s:
            return '无'
        age = s.get('startAge', '?')
        gz = s.get('ganZhi') or s.get('ganzhi') or '?'
        ss_val = s.get('shiShen') or s.get('shishen') or '?'
        start_year = s.get('startYear')
        end_year = s.get('endYear')
        yr = f' {start_year}\u2013{end_year}' if start_year else ''
        return f'{age}岁起 {gz}（{ss_val}）{yr}'

    rizhu = (chart or {}).get('rizhu') or '?'
    core_lines = [f'【命主核心】日主 {rizhu}']
    sizhu = (chart or {}).get('sizhu') or {}
    if sizhu:
        yr = sizhu.get('year', '')
        mo = sizhu.get('month', '')
        dy = sizhu.get('day', '')
        hr = sizhu.get('hour', '未知')
        core_lines.append(f'原局四柱：年 {yr} / 月 {mo} / 日 {dy} / 时 {hr}')

    core_lines.append('')
    core_lines.append(f'【上一步】{_fmt(prev_step)}')
    is_current = '  ← 当前正走' if step_index == current_dayun_index else ''
    core_lines.append(f'【本步】   {_fmt(step)}{is_current}')
    core_lines.append(f'【下一步】{_fmt(next_step)}')

    gz_val = step.get('ganZhi') or step.get('ganzhi') or '?'
    ss_val = step.get('shiShen') or step.get('shishen') or '?'
    age = step.get('startAge', '?')
    user_msg = f'请讲讲 {age}岁起 {gz_val}（{ss_val}）这步大运对我意味着什么。'

    anchor = build_classical_anchor(retrieved, terse=True)
    system_content = sys + '\n\n' + '\n'.join(core_lines)
    if anchor:
        system_content += '\n\n' + anchor

    return [
        {'role': 'system', 'content': system_content},
        {'role': 'user', 'content': user_msg},
    ]
