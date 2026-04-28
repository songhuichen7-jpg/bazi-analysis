"""LLM-assisted classical excerpt selection for the left-side evidence panel.

Retrieval intentionally stays broad. The model only chooses copied spans from
local classics; any span that is not present in the source text is rejected.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.core.config import settings
from app.llm.client import chat_once_with_fallback
from app.retrieval.service import (
    _chart_search_terms,
    _day_gan,
    _month_label,
    focus_classic_text,
)

DEFAULT_DISPLAY_LIMIT = 6
CANDIDATE_FOCUS_MAX = 1400
CANDIDATE_HEAD_MAX = 900
DISPLAY_EXCERPT_MAX = 480
DISPLAY_FILTER_TIMEOUT_SECONDS = 45
GANZHI_ONLY_RE = re.compile(r"^(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])+$")


def _strip_json_fence(text: str) -> str:
    raw = str(text or "").strip()
    match = re.search(r"```(?:json)?\s*(.*?)```", raw, flags=re.S | re.I)
    if match:
        return match.group(1).strip()
    return raw


def parse_classics_filter_selection(text: str, *, max_index: int, limit: int = DEFAULT_DISPLAY_LIMIT) -> list[int]:
    """Parse LLM output into unique 1-based candidate indices."""
    try:
        data = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError:
        return []

    raw_items: Any
    if isinstance(data, dict):
        raw_items = data.get("selected") or data.get("indices") or []
    else:
        raw_items = data
    if not isinstance(raw_items, list):
        return []

    out: list[int] = []
    for item in raw_items:
        value = item.get("index") if isinstance(item, dict) else item
        try:
            index = int(value)
        except (TypeError, ValueError):
            continue
        if index < 1 or index > max_index or index in out:
            continue
        out.append(index)
        if len(out) >= limit:
            break
    return out


def _selection_items(text: str) -> list[Any]:
    try:
        data = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError:
        return []
    raw_items = data.get("selected") or data.get("indices") or [] if isinstance(data, dict) else data
    return raw_items if isinstance(raw_items, list) else []


def _copied_excerpt(source_text: str, raw_excerpt: str) -> str:
    source = str(source_text or "")
    excerpt = str(raw_excerpt or "").strip()
    if not source or not excerpt:
        return ""
    if excerpt in source:
        return excerpt

    copied_parts: list[str] = []
    for part in re.split(r"\n\s*\n", excerpt):
        clean = part.strip()
        if clean and clean in source:
            copied_parts.append(clean)
    return "\n\n".join(copied_parts).strip()


def _is_pure_ganzhi_list(paragraph: str) -> bool:
    lines = [line.strip() for line in str(paragraph or "").splitlines() if line.strip()]
    if not lines:
        return True
    compact = re.sub(r"[\s　、，,；;。:：/]+", "", "".join(lines))
    return bool(compact and GANZHI_ONLY_RE.fullmatch(compact))


def _clean_display_excerpt(excerpt: str) -> str:
    """Keep model-selected prose while removing empty/pure chart-list fragments."""
    paragraphs = re.split(r"\n\s*\n", str(excerpt or "").strip())
    kept: list[str] = []
    for paragraph in paragraphs:
        clean = paragraph.strip()
        if not clean:
            continue
        if _is_pure_ganzhi_list(clean):
            continue
        kept.append(clean)
    return "\n\n".join(kept).strip()


def _trim_display_excerpt(text: str, max_chars: int = DISPLAY_EXCERPT_MAX) -> str:
    if len(text) <= max_chars:
        return text
    cut = max(
        text.rfind("。", 0, max_chars - 6),
        text.rfind("；", 0, max_chars - 6),
        text.rfind("\n\n", 0, max_chars - 6),
    )
    if cut < max_chars * 0.5:
        cut = max_chars - 6
    return text[:cut + 1].rstrip() + "\n…(节选)"


def parse_classics_display_selection(
    text: str,
    candidates: list[dict],
    *,
    paipan: dict | None = None,
    limit: int = DEFAULT_DISPLAY_LIMIT,
) -> list[dict]:
    """Parse LLM output into display hits with excerpts copied from candidates."""
    out: list[dict] = []
    seen: set[int] = set()
    for item in _selection_items(text):
        value = item.get("index") if isinstance(item, dict) else item
        try:
            index = int(value)
        except (TypeError, ValueError):
            continue
        if index < 1 or index > len(candidates) or index in seen:
            continue
        if not isinstance(item, dict):
            continue
        excerpt = _copied_excerpt(
            str(candidates[index - 1].get("text") or ""),
            str(item.get("excerpt") or item.get("text") or ""),
        )
        if item.get("discard") is True or item.get("keep") is False:
            continue
        excerpt = _clean_display_excerpt(excerpt)
        if not excerpt:
            continue
        seen.add(index)
        out.append(_display_hit(
            paipan or {},
            candidates[index - 1],
            _trim_display_excerpt(excerpt),
            match=str(item.get("reason") or item.get("match") or "").strip() or None,
        ))
        if len(out) >= limit:
            break
    return out


def _focus_terms_line(paipan: dict) -> str:
    terms = [term for term in _chart_search_terms(paipan) if len(term) >= 2]
    return "、".join(terms[:18])


def _compact_classics_context(paipan: dict) -> str:
    p = paipan or {}
    sizhu = p.get("sizhu") or {}
    shishen = p.get("shishen") or {}
    lines = [
        "【命盘上下文】",
        f"四柱  年:{sizhu.get('year','')}  月:{sizhu.get('month','')}  日:{sizhu.get('day','')}  时:{sizhu.get('hour','')}",
        f"日主  {p.get('rizhu','')}",
        f"格局  {p.get('geju','')}",
        f"强弱  {p.get('dayStrength','')}",
        f"用神  {p.get('yongshen','')}",
        f"十神  年:{shishen.get('year','')}  月:{shishen.get('month','')}  时:{shishen.get('hour','')}",
    ]
    detail = p.get("yongshenDetail") or {}
    for item in detail.get("candidates") or []:
        if not isinstance(item, dict):
            continue
        parts = [str(item.get("method") or ""), str(item.get("name") or "")]
        note = str(item.get("note") or "")
        source = str(item.get("source") or "")
        line = "  · " + " ▸ ".join(part for part in parts if part)
        if note:
            line += f"（{note}）"
        if source:
            line += f"  {source}"
        lines.append(line)
    return "\n".join(line for line in lines if line.strip())


def _candidate_block(paipan: dict, candidates: list[dict]) -> str:
    focus_terms = _chart_search_terms(paipan)
    lines: list[str] = []
    for index, hit in enumerate(candidates, start=1):
        raw_text = str(hit.get("text") or "").strip()
        focused = focus_classic_text(
            raw_text,
            focus_terms,
            CANDIDATE_FOCUS_MAX,
            include_anchor=False,
        )
        head = raw_text
        if len(head) > CANDIDATE_HEAD_MAX:
            head = head[:CANDIDATE_HEAD_MAX] + "\n…"
        text_parts = ["可选短摘：", focused or head]
        if head and head not in (focused or ""):
            text_parts.extend(["章节定位：", head])
        text = "\n\n".join(text_parts)
        lines.append(
            "\n".join([
                f"[{index}] {hit.get('source', '')}",
                f"范围：{hit.get('scope', '')}",
                "原文：",
                text,
            ])
        )
    return "\n\n---\n\n".join(lines)


def build_classics_filter_messages(paipan: dict, candidates: list[dict], *, limit: int) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "\n".join([
                "你是八字古籍旁证筛选器，只负责从候选原文中挑选最适合展示的段落。",
                "必须遵守：",
                "1. 只从候选编号中选择，并从候选原文里复制 excerpt；不要创造新古籍、不要改写原文。",
                "2. 可以自由判断哪些段落最值得展示：可选高度命中本盘的原文，也可选通用法则、相似命例、反面参照，关键是它真的能帮助读这张盘。",
                "3. 不要复制章节开头总论，除非它就是唯一相关；优先复制同一候选里命中具体结构条件的短段。",
                "4. 不要把结果硬分为固定标签；reason 只说明你为什么选它、它与本盘如何互照即可。",
                "5. 可以保留异盘命例、不同月令或不同日主的段落，只要你判断它有旁证价值，并在 reason 里说清楚取它的理由。",
                "6. 排除纯干支排盘、明显空泛、或只是堆材料却无法帮助读盘的候选段。",
                f"7. 按价值选择，不必凑数，最多 {limit} 段；每段 excerpt 约 80 到 450 字，宁短勿长。",
                '8. 只输出 JSON：{"selected":[{"index":1,"reason":"为什么值得展示","excerpt":"从原文复制的一小段"}]}',
            ]),
        },
        {
            "role": "user",
            "content": "\n\n".join([
                _compact_classics_context(paipan),
                "【本盘检索重点】",
                _focus_terms_line(paipan),
                "【候选古籍原文】",
                _candidate_block(paipan, candidates),
            ]),
        },
    ]


def _fallback(paipan: dict, candidates: list[dict], limit: int) -> list[dict]:
    out: list[dict] = []
    for hit in candidates:
        focused = _focus_hit(paipan, hit)
        if str(focused.get("text") or "").strip():
            out.append(focused)
        if len(out) >= limit:
            break
    return out


def _fit_note(paipan: dict, hit: dict) -> str:
    source = str(hit.get("source") or "")
    day = _day_gan(paipan)
    month = _month_label(paipan)
    geju = str(paipan.get("geju") or "")
    yongshen = str((paipan.get("yongshenDetail") or {}).get("primary") or paipan.get("yongshen") or "")

    if "穷通宝鉴" in source and day and month:
        return f"本盘是{day}日主、{month}生，这一段先看调候用神。"
    if "偏官" in source or "七杀" in source:
        return f"本盘主轴为{geju or '官杀'}，这里看七杀怎样制化。"
    if "理气" in source and day:
        return f"这里旁证{day}木遇庚金时，丁火如何成为转机。"
    if "印绶" in source:
        return "本盘有印星可用，这里看七杀能否转成杀印相生。"
    if "衰旺" in source:
        return "这里用来校正日主强弱，避免只按月令死断。"
    if "官杀" in source:
        return "这里用来对照官杀轻重，以及制化是否得宜。"
    if yongshen:
        return f"这一段用于旁证本盘所取的{yongshen}。"
    return "这一段只作旁证，仍须回到本盘结构取舍。"


def _display_hit(
    paipan: dict,
    hit: dict,
    text: str,
    *,
    match: str | None = None,
) -> dict:
    return {
        **hit,
        "text": text,
        "chars": len(text),
        "match": match or _fit_note(paipan, hit),
    }


def _focus_hit(paipan: dict, hit: dict) -> dict:
    text = str(hit.get("text") or "")
    focused = focus_classic_text(
        text,
        _chart_search_terms(paipan),
        max_chars=DISPLAY_EXCERPT_MAX,
        include_anchor=False,
    )
    cleaned = _clean_display_excerpt(focused or _trim_display_excerpt(text))
    if not cleaned and focused:
        cleaned = _clean_display_excerpt(_trim_display_excerpt(text))
    return _display_hit(paipan, hit, cleaned)


async def filter_classics_for_display(
    paipan: dict,
    candidates: list[dict],
    *,
    display_limit: int = DEFAULT_DISPLAY_LIMIT,
    fallback_limit: int = DEFAULT_DISPLAY_LIMIT,
) -> list[dict]:
    """Return local excerpts selected for display, using LLM indices when available."""
    if not candidates:
        return []
    if not settings.llm_api_key:
        return _fallback(paipan, candidates, fallback_limit)

    try:
        messages = build_classics_filter_messages(paipan, candidates, limit=display_limit)
        text, _model = await asyncio.wait_for(
            chat_once_with_fallback(
                messages=messages,
                tier="fast",
                temperature=0,
                max_tokens=1800,
                disable_thinking=True,
            ),
            timeout=DISPLAY_FILTER_TIMEOUT_SECONDS,
        )
        display_hits = parse_classics_display_selection(text, candidates, paipan=paipan, limit=display_limit)
        if display_hits:
            return display_hits

        if any(isinstance(item, dict) and (item.get("excerpt") or item.get("text")) for item in _selection_items(text)):
            return _fallback(paipan, candidates, fallback_limit)

        indices = parse_classics_filter_selection(text, max_index=len(candidates), limit=display_limit)
    except Exception:  # noqa: BLE001 - filtering is best-effort
        return _fallback(paipan, candidates, fallback_limit)

    if not indices:
        return _fallback(paipan, candidates, fallback_limit)
    display_hits = [_focus_hit(paipan, candidates[index - 1]) for index in indices]
    return display_hits
