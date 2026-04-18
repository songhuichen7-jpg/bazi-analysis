"""Sections prompt builder — 五段初始解读 (sections narrative).

NOTE: prompts.js:276-391
"""
from __future__ import annotations

import re

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context

# Valid section keys for the per-section route model.
Section = str

_ALL_SECTIONS = ('career', 'personality', 'wealth', 'relationship', 'health', 'appearance', 'special')

_STYLE_BLOCK = '''你是一位懂八字命理的朋友，语气是聊天而非交报告。

【风格】
- 判断要 tie to 命盘里具体的干支/十神/分数，不要空话
- 术语配白话（例："七杀格" 配 "最强势的力量是一把对着你的刀"）
- 用原话/具象化表达，避免"你是个内心丰富的人"这种废话
- 能化用古籍意旨可化用，但不说"我查了..."

【严格约束】
- 你没有工具调用能力。不要写 **Read**、**Glob**、```...```、"让我先查一下古籍" 这类过程性内容。
- 直接输出最终 JSON，前后不要任何字符（不要 ```json 围栏，不要解释）。'''

_TASK_BLOCK = '''【本轮任务】基于上面的命盘，写五段"初始解读"，顺序固定：
1. 底层结构  2. 性格两面  3. 关系模式  4. 发力方向  5. 此刻的提醒

【硬要求】
- 每段 body 控制在 60-120 字，1-3 句
- 判断必须 tie to 命盘里具体的干支/十神/分数
- 用原话/具象化表达，避免"你是个内心丰富的人"这种废话
- 能化用古籍意旨可化用，但不说"我查了..."

【输出格式 — 极其严格】
第一个字符必须是 "§"。绝对不要写"分析请求"、"让我先"、"润色检查"、"草稿"、"角色：..." 这种思考过程。
绝对不要写前言（"以下是解读："）或后语（"希望对你有帮助"）。
只按下面这种格式输出五段，中间用空行分隔：

§1 底层结构
正文...

§2 性格两面
正文...

§3 关系模式
正文...

§4 发力方向
正文...

§5 此刻的提醒
正文...'''


def build_messages(
    chart: dict,
    retrieved: list[dict] | None = None,
    *,
    section: Section = '',
) -> list[dict]:
    # NOTE: prompts.js:276-334
    # JS buildSectionsMessages generates all 5 fixed sections in one shot;
    # the Python port adds the section kwarg for Plan 5's per-section route model
    # but keeps the same prompt body as JS (chart context always present).
    retrieved = retrieved or []
    system_parts: list[str] = []

    system_parts.append(_STYLE_BLOCK)

    ctx = compact_chart_context(chart)
    if ctx:
        system_parts.append(ctx)

    anchor = build_classical_anchor(retrieved, terse=False)
    if anchor:
        system_parts.append(anchor)

    system_parts.append(_TASK_BLOCK)

    return [
        {'role': 'system', 'content': '\n\n'.join(system_parts)},
        {'role': 'user', 'content': '请直接输出这份初始解读，从 "§1" 开始。'},
    ]


def parse_sections_text(raw: str) -> dict[str, str] | list[dict]:
    '''Parse §-delimited sections text.

    NOTE: prompts.js:340-361

    Two modes:
    - Named markers (§career, §wealth, …) → return {section_name: content} dict
    - Numbered markers (§1 底层结构, …)   → return [{title, body}, …] list (JS original)

    Graceful: returns {} / [] on no markers.
    '''
    if not raw:
        return {}

    # Check for named section markers first (Plan 5 per-section variant)
    named_match = re.search(r'§([a-zA-Z_]+)', raw)
    if named_match:
        out: dict[str, str] = {}
        parts = re.split(r'§([a-zA-Z_]+)\n?', raw)
        # parts alternates: [preamble, name, content, name, content, ...]
        i = 1
        while i < len(parts) - 1:
            name = parts[i].strip()
            content = parts[i + 1].strip() if i + 1 < len(parts) else ''
            if name and content:
                out[name] = content
            i += 2
        return out

    # Numbered markers — JS original behavior, return list
    first_mark = re.search(r'§\s*\d', raw)
    if first_mark is None:
        return {}
    body = raw[first_mark.start():]
    parts = re.split(r'§\s*(\d+)\s*', body)
    parts = [p for p in parts if p]
    out_list: list[dict] = []
    i = 0
    while i < len(parts) - 1:
        chunk = parts[i + 1].strip()
        if not chunk:
            i += 2
            continue
        lines = chunk.split('\n')
        title = lines[0].strip()
        body_text = '\n'.join(lines[1:]).strip()
        if title and body_text:
            out_list.append({'title': title, 'body': body_text})
        i += 2
    return out_list  # type: ignore[return-value]
