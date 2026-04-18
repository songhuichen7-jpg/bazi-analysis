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
    lines.append("--- 古籍原文锚点（优先用这些原文引用，其次再靠模型记忆）---")
    for hit in retrieved:
        src = hit.get("source", "?")
        scope = hit.get("scope", "full")
        text = (hit.get("text") or "").strip()
        if not text:
            continue
        if terse and len(text) > 200:
            text = text[:200] + "…"
        lines.append(f"【{src} · {scope}】")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).rstrip()
