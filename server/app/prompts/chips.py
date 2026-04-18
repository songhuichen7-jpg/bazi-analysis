"""Chips prompt builder — 命主想问的 4 个问题.

NOTE: prompts.js:929-1006
"""
from __future__ import annotations

import json
import re

from app.prompts.context import compact_chart_context

_SYSTEM_BASE_LINES = [
    '你在为一位命主准备"他想问命理师的 4 个问题"。',
    '输出的每一条都是【命主本人】要问出口的话——主语是"我"，不是"你"。',
    '',
    '思考步骤（内部进行，不要输出）：',
    '1. 这张盘最有特点的结构是什么（格局、十神极端值、大运关键期）？',
    '2. 对话里已经覆盖了哪些维度（性格/事业/感情/财运/流年/人生课题）？',
    '3. 还有哪些重要维度完全没聊到，或者刚才的话题自然延伸到哪里？',
    '4. 对于这张具体的盘，命主此刻最想追问的 4 个问题是什么？',
    '',
    '输出要求：',
]

# Lines that reference specific history behavior (switched at runtime)
_HISTORY_LINE = '- 不重复已聊话题；刚聊完的话题可以自然延伸到下一层，也可以跳到完全没聊过的维度'
_NO_HISTORY_LINE = '- 覆盖不同维度：建议包含整体/性格/事业/感情或流年中的几个'

_SYSTEM_TAIL_LINES = [
    '- 口语化，像命主自己会说的话',
    '- 每条不超过 20 字',
    '- 输出格式：纯 JSON 数组，["问题1","问题2","问题3","问题4"]',
    '- 只输出 JSON，不要任何其他文字',
]


def build_messages(chart: dict, history: list[dict] | None = None) -> list[dict]:
    # NOTE: prompts.js:929-970
    history = list(history or [])
    summary = compact_chart_context(chart)
    has_history = bool(history)

    hist_str = ''
    if has_history:
        hist_str = '\n'.join(
            ('用户：' if m.get('role') == 'user' else '助手：')
            + str(m.get('content') or '')[:300]
            for m in history[-6:]
        )

    # NOTE: prompts.js:939-960 — verbatim system prompt lines
    first_person_line = (
        '- 第一人称：用"我"指代命主自己；涉及命盘特征要像命主在陈述自己'
        '（例："我七杀这么重，将来的对象扛得住我的压力吗"、"我丁卯大运这十年到底在干嘛"）'
    )
    no_third_party_line = '- 不要用"你"、"您"、"这张盘"这种第三方口吻'
    specific_line = '- 贴合这张盘，提到具体的结构特征（如七杀分数、格局名、大运干支），不要通用问题'

    lines = list(_SYSTEM_BASE_LINES)
    lines.append(first_person_line)
    lines.append(no_third_party_line)
    lines.append(specific_line)
    lines.append(_HISTORY_LINE if has_history else _NO_HISTORY_LINE)
    lines.extend(_SYSTEM_TAIL_LINES)

    system_prompt = '\n'.join(lines)

    if has_history:
        user_content = '【命盘】\n' + summary + '\n\n【对话记录】\n' + hist_str
    else:
        user_content = '【命盘】\n' + summary

    return [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_content},
    ]


def parse_chips_json(raw: str) -> list[str]:
    # NOTE: prompts.js:972-983
    try:
        s = str(raw or '').strip()
        # Strip markdown code fences
        s = re.sub(r'^```(?:json)?\s*', '', s)
        s = re.sub(r'\s*```$', '', s)
        s = s.strip()
        match = re.search(r'\[[\s\S]*\]', s)
        if not match:
            return []
        arr = json.loads(match.group(0))
        if not isinstance(arr, list):
            return []
        return [x for x in arr if isinstance(x, str) and x.strip()][:4]
    except Exception:
        return []
