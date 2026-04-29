"""LLM display pass for chart classics.

Retrieval2 finds source anchors. This module turns those anchors into the
short, readable "古籍旁证" cards shown in the UI, while keeping the original
retrieved text available for provenance.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Sequence

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 75.0

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.S | re.I)


_SYSTEM = """你是八字古籍旁证的编辑器。检索系统已经给出候选古籍原文锚点；
你的任务不是重新检索，而是把最贴命盘的锚点整理成可读卡片。

规则：
- 可以加标点、截取关键句、删掉同段里无关的邻句，让 quote 更像可读段落
- quote 必须来自候选原文，不要补候选里没有的古籍原句
- plain 是原意/意译，可以用更顺的现代汉语表达
- match 要对照命盘说清楚为什么这一条贴合，可以使用你的命理知识
- 不要把意译冒充逐字原文；书名、章节、来源一律沿用候选 id
- 严禁把地支或藏干说成“透干”；只有命盘天干出现的字才可称“透”
- 古文里的富贵、科甲、贫夭等词，只解释为古籍条件/倾向，不要替命盘直接下终局
- 遇到贫、夭、寿、灾、病等极端凶断，不要单独截成 quote；若原文同段有制化、调剂、用神办法，必须一起截入
- plain/match 要把极端凶词降调为“古书提醒此处失衡/压力重，需要某种制化”，不要扩写成具体寿夭或健康结论
- 同义重复只留最有信息密度的一条；宁缺毋滥
- 输入候选可能涵盖多本古籍（穷通宝鉴 / 子平真诠 / 滴天髓 / 三命通会等），每本古籍至少保留 1 条最贴命盘的锚点；訣文/口诀体（如三命通会"甲日X月為偏官..."）信号密度高，不要因为短就丢
- 同一 chapter_file + section（古籍同一章节）只保留 1 条；不同章节、不同古籍优先成组

只输出 JSON：
{"items":[{"id":"0","quote":"...","plain":"...","match":"..."}]}

最多输出 6 条。不要解释，不要 markdown fence。"""


async def chat_once_with_fallback(**kwargs):
    from app.llm.client import chat_once_with_fallback as _chat_once_with_fallback

    return await _chat_once_with_fallback(**kwargs)


def _clean_text(value: Any, *, max_len: int = 260) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text[:max_len].strip()


def _compact_for_match(value: Any) -> str:
    text = str(value or "").replace("煞", "杀")
    return re.sub(r"[\W_]+", "", text, flags=re.UNICODE)


_ELLIPSIS_RE = re.compile(r"…+|\.{3,}")


def _quote_belongs_to_raw(quote: str, raw_text: str) -> bool:
    """True iff every ellipsis-delimited segment of the quote is a substring
    of the raw text (after stripping non-Chinese characters).

    The polisher prompt allows the LLM to "delete unrelated neighbouring
    sentences from the same paragraph", which some models (notably MiMo)
    realise as multi-segment quotes joined by …… ellipses. A naive single-
    substring check would reject these legitimate excerpts and force the
    panel into raw fallback. Splitting on the ellipsis recovers them while
    still rejecting any segment the LLM hallucinated."""
    compact_raw = _compact_for_match(raw_text)
    if not compact_raw:
        return False
    segments = [seg for seg in _ELLIPSIS_RE.split(quote) if seg.strip()]
    if not segments:
        return False
    for seg in segments:
        compact_seg = _compact_for_match(seg)
        if not compact_seg or compact_seg not in compact_raw:
            return False
    return True


def _strip_fence(text: str) -> str:
    s = (text or "").strip()
    m = _FENCE_RE.search(s)
    return (m.group(1) if m else s).strip()


def _normalize_raw_hits(hits: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for hit in hits:
        text = str(hit.get("text") or "").strip()
        if not text:
            continue
        item = dict(hit)
        item["text"] = text
        item["chars"] = int(item.get("chars") or len(text))
        out.append(item)
    return out


def _pillar_parts(chart: dict[str, Any]) -> tuple[str, str]:
    p = chart.get("PAIPAN") or chart
    sizhu = p.get("sizhu") or {}
    day = str(sizhu.get("day") or p.get("rizhu") or "")
    month = str(sizhu.get("month") or "")
    return (day[:1] if day else "", month[1:2] if len(month) >= 2 else "")


def _chart_summary(chart: dict[str, Any]) -> str:
    p = chart.get("PAIPAN") or chart
    sizhu = p.get("sizhu") or {}
    stems = []
    branches = []
    for label, key in (("年", "year"), ("月", "month"), ("日", "day"), ("时", "hour")):
        pillar = str(sizhu.get(key) or "")
        if pillar:
            stems.append(f"{label}{pillar[:1]}")
        if len(pillar) >= 2:
            branches.append(f"{label}{pillar[1:2]}")
    parts = [
        f"四柱：年{sizhu.get('year', '')} 月{sizhu.get('month', '')} 日{sizhu.get('day', '')} 时{sizhu.get('hour', '')}",
        f"盘面天干：{'、'.join(stems)}（只有这些可称透干）" if stems else "",
        f"盘面地支：{'、'.join(branches)}（地支/藏干不可说成透干）" if branches else "",
        f"日主：{p.get('rizhu', '')}",
        f"格局：{p.get('geju', '')}",
        f"强弱：{p.get('dayStrength', '')}",
        f"用神：{p.get('yongshen', '')}",
    ]
    return "\n".join(part for part in parts if part.split("：", 1)[-1])


def _month_name(month_zhi: str) -> str:
    return {
        "寅": "正月", "卯": "二月", "辰": "三月",
        "巳": "四月", "午": "五月", "未": "六月",
        "申": "七月", "酉": "八月", "戌": "九月",
        "亥": "十月", "子": "十一月", "丑": "十二月",
    }.get(month_zhi, "")


def _fallback_quote(chart: dict[str, Any], text: str, scope: str) -> str:
    day_gan, month_zhi = _pillar_parts(chart)
    if day_gan and month_zhi:
        exact = re.search(
            rf"{re.escape(day_gan)}日{re.escape(month_zhi)}月.*?"
            rf"(?=\s+[甲乙丙丁戊己庚辛壬癸]日{re.escape(month_zhi)}月|$)",
            text,
        )
        if exact:
            return exact.group(0).strip(" ，。")

    if len(text) <= 180:
        return text

    terms = [
        day_gan, month_zhi, _month_name(month_zhi), scope,
        "丁火", "庚金", "七杀", "七煞", "偏官", "身弱", "杀重身轻", "制杀", "制煞",
    ]
    pieces = [p.strip() for p in re.split(r"(?<=[。！？；])\s*", text) if p.strip()]
    scored: list[tuple[int, int, str]] = []
    for idx, piece in enumerate(pieces):
        score = sum(1 for term in terms if term and term in piece)
        if score:
            scored.append((score, idx, piece))
    if scored:
        chosen = [piece for _score, _idx, piece in sorted(scored, key=lambda x: (-x[0], x[1]))[:3]]
        chosen.sort(key=lambda piece: text.find(piece))
        quote = "".join(chosen).strip()
        if quote:
            return quote[:220].strip()
    return text[:220].strip()


def _fallback_items(chart: dict[str, Any], raw_hits: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in raw_hits:
        text = str(raw.get("text") or "").strip()
        quote = _fallback_quote(chart, text, str(raw.get("scope") or ""))
        item = dict(raw)
        item["text"] = quote
        item["chars"] = len(quote)
        if quote != text:
            item["quote"] = quote
            item["original_text"] = text
        out.append(item)
    return out


def _format_hits(hits: Sequence[dict[str, Any]]) -> str:
    lines: list[str] = []
    for i, hit in enumerate(hits):
        text = str(hit.get("text") or "").replace("\n", " ").strip()
        if len(text) > 260:
            text = text[:260] + "…"
        lines.append(
            f"[{i}] {hit.get('source', '')} · {hit.get('scope', '')}\n"
            f"原文锚点：{text}"
        )
    return "\n\n".join(lines)


def _build_messages(
    chart: dict[str, Any],
    hits: Sequence[dict[str, Any]],
    *,
    recovery: bool = False,
) -> list[dict[str, str]]:
    if recovery:
        directive = (
            "上一轮精选漏掉了下面这几条原本应该展示的古籍锚点。"
            "请把它们全部输出（不要再删减、合并或丢弃），"
            "按同一规则补全 quote / plain / match。"
        )
    else:
        directive = "请输出最适合页面展示的古籍旁证 JSON。"
    return [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": (
                f"【命盘】\n{_chart_summary(chart)}\n\n"
                f"【候选古籍锚点】\n{_format_hits(hits)}\n\n"
                f"{directive}"
            ),
        },
    ]


def _parse_items(
    text: str,
    raw_hits: Sequence[dict[str, Any]],
    chart: dict[str, Any],
) -> list[dict[str, Any]]:
    try:
        data = json.loads(_strip_fence(text))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return []

    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in data["items"]:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(str(item.get("id") or "").strip())
        except ValueError:
            continue
        if idx < 0 or idx >= len(raw_hits) or idx in seen:
            continue

        raw = raw_hits[idx]
        quote = _clean_text(item.get("quote"), max_len=320)
        if quote and not _quote_belongs_to_raw(quote, str(raw.get("text") or "")):
            fallback = _fallback_items(chart, [raw])[0]
            out.append(fallback)
            seen.add(idx)
            continue
        plain = _clean_text(item.get("plain"), max_len=220)
        match = _clean_text(item.get("match"), max_len=220)
        display_text = quote or str(raw.get("text") or "").strip()
        if not display_text:
            continue

        polished = dict(raw)
        polished["text"] = display_text
        polished["chars"] = len(display_text)
        polished["original_text"] = str(raw.get("text") or "").strip()
        if quote:
            polished["quote"] = quote
        if plain:
            polished["plain"] = plain
        if match:
            polished["match"] = match
        out.append(polished)
        seen.add(idx)
    return out


DEFAULT_MAX_OUTPUT = 6


def _ensure_book_coverage(
    items: list[dict[str, Any]],
    raw_hits: Sequence[dict[str, Any]],
    chart: dict[str, Any],
    *,
    max_items: int,
) -> list[dict[str, Any]]:
    """Guarantee every chapter_file in the input is represented in the output.

    The polisher LLM occasionally drops entire books (e.g. terse 訣文 from
    三命通会) that retrieval2 had explicitly anchored. When that happens we
    add the dropped book back via the local quote slicer so the panel still
    reflects the diversity of the retrieval anchors.
    """
    seen_files = {item.get("file") for item in items if item.get("file")}
    out = list(items)
    for raw in raw_hits:
        file_name = raw.get("file")
        if not file_name or file_name in seen_files:
            continue
        out.append(_fallback_items(chart, [raw])[0])
        seen_files.add(file_name)
        if len(out) >= max_items:
            break
    return out[:max_items]


# 6 cards × (quote + plain + match) is ~2000+ tokens of Chinese; budget enough
# headroom so the JSON is never truncated mid-string (silent parse failure).
_POLISH_MAX_TOKENS = 4000


async def _polish_once_via_llm(
    chart: dict[str, Any],
    raw_hits: Sequence[dict[str, Any]],
    timeout_seconds: float,
    *,
    recovery: bool = False,
) -> list[dict[str, Any]]:
    """Single LLM polish pass. Returns parsed items or [] on any failure."""
    try:
        text, _model = await asyncio.wait_for(
            chat_once_with_fallback(
                messages=_build_messages(chart, raw_hits, recovery=recovery),
                tier="fast",
                temperature=0.2,
                max_tokens=_POLISH_MAX_TOKENS,
                disable_thinking=True,
            ),
            timeout=timeout_seconds,
        )
        return _parse_items(text, raw_hits, chart)
    except Exception as exc:  # noqa: BLE001
        logger.warning("classics polish failed: %r", exc)
        return []


async def polish_classics_for_chart(
    chart: dict[str, Any],
    hits: Sequence[dict[str, Any]],
    *,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_items: int = DEFAULT_MAX_OUTPUT,
) -> list[dict[str, Any]]:
    """Return display-ready classics cards.

    Two-pass LLM polish: the first call may drop entire books (terse 訣文 are
    often misjudged as low-density). For dropped books we run a second,
    targeted LLM call so they still get punctuation + 现代汉语 + 命盘对照
    instead of leaking raw classical text into the UI. Local quote slicer
    is the last-resort fallback only when both LLM passes fail.
    """
    raw_hits = _normalize_raw_hits(hits)
    if not raw_hits:
        return []

    items = await _polish_once_via_llm(chart, raw_hits, timeout_seconds)
    if not items:
        items = _fallback_items(chart, raw_hits)
        return _ensure_book_coverage(items, raw_hits, chart, max_items=max_items)

    seen_files = {it.get("file") for it in items if it.get("file")}
    missing = [r for r in raw_hits if r.get("file") and r.get("file") not in seen_files]

    if missing and len(items) < max_items:
        recovered = await _polish_once_via_llm(
            chart, missing, timeout_seconds, recovery=True,
        )
        if recovered:
            items.extend(recovered)

    return _ensure_book_coverage(items, raw_hits, chart, max_items=max_items)


__all__ = ["polish_classics_for_chart"]
