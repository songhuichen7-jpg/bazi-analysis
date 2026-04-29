"""Builds a classical-anchor system-prompt block from retrieved hits.

NOTE: ports archive/server-mvp/prompts.js:235-274 (buildClassicalAnchor).
Each retrieved hit is a dict {source, scope, chars, text}.
"""
from __future__ import annotations

from typing import Sequence


def build_classical_anchor(
    retrieved: Sequence[dict],
    *,
    terse: bool = False,
) -> str:
    if not retrieved:
        return ""
    lines: list[str] = []
    lines.append(
        "--- 古籍原文锚点（按相关度排序；第 1 条最对题）---\n"
        "回复时必须做到：\n"
        "  1. 至少直接引用其中 1-2 段的关键句，用「」括起来，并用书名 + 章节标注出处，"
        "如：滴天髓「杀重而身轻，非贫即夭…制杀为吉，全凭调剂之工」。\n"
        "  2. 引用后立刻接一句把这条与本盘的具体干支/十神/格局对照（不是泛泛复述古籍）。\n"
        "  3. 优先引用第 1 条；若它和用户问题无关再选其它。涉及"
        "「日柱+时柱」「时上偏财/正官」「日支坐X」这种盘面专属断辞时，"
        "整段照引（去标点的口诀别只挑一两个字）。\n"
        "  4. 只引用下面提供的原文，不够时化用思路、不凭记忆补古文。\n"
    )
    for i, hit in enumerate(retrieved):
        src = hit.get("source", "?")
        scope = hit.get("scope", "full")
        text = (hit.get("text") or "").strip()
        if not text:
            continue
        if terse and len(text) > 200:
            text = text[:200] + "…"
        marker = "★ 首选锚点" if i == 0 else f"#{i + 1}"
        lines.append(f"【{marker} · {src} · {scope}】")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).rstrip()
