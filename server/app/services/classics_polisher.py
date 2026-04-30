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
- 严格保持 id↔quote 一一对应：每条 item 的 id 必须严格指向对应候选，quote 必须从该 id 的候选原文中截取，绝不要把别的候选的原文写进当前 id；多条候选内容相似时也不要互相搬运
- plain 是原意/意译，可以用更顺的现代汉语表达
- match 要对照命盘说清楚为什么这一条贴合，可以使用你的命理知识
- 不要把意译冒充逐字原文；书名、章节、来源一律沿用候选 id
- 严禁把地支或藏干说成“透干”；只有命盘天干出现的字才可称“透”
- 用户消息里的【结构事实表】是后端用规则计算出来的，十神身份、藏透状态、干合关系全部以事实表为准；不要因为对古籍的印象就把伤官写成食神、把藏支说成透干。如果古籍引文与事实表冲突，要在 match 里把这层冲突挑明
- 古文里的富贵、科甲、贫夭等词，只解释为古籍条件/倾向，不要替命盘直接下终局
- 遇到贫、夭、寿、灾、病等极端凶断，不要单独截成 quote；若原文同段有制化、调剂、用神办法，必须一起截入
- plain/match 要把极端凶词降调为“古书提醒此处失衡/压力重，需要某种制化”，不要扩写成具体寿夭或健康结论
- 候选列表已经过检索系统精筛过，**默认要把所有候选都输出对应的 item**；只有当两条候选意思明显同义重复时才二选一，否则不要因为"觉得没必要"或"留白"就删条目
- 訣文/口诀体（如三命通会"甲日X月為偏官..."）信号密度高，不要因为短就丢
- 同一 chapter_file + section（古籍同一章节）只保留 1 条；不同章节、不同古籍即使内容相近也都各保留

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
    """Strip everything except Han chars and 繁→简 fold so the quote
    membership check works regardless of variant character forms.

    Without 繁→简, an LLM that "corrects" 嵗 → 岁, 實 → 实, 見 → 见 in its
    polished quote would fail the substring check against the raw 繁体
    corpus and the polished item would be silently dropped to a raw
    fallback (which has no plain / match), losing the explanatory text.
    """
    import zhconv
    text = zhconv.convert(str(value or ""), "zh-hans").replace("煞", "杀")
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


from app.retrieval2.chart_facts import PILLAR_LABELS as _PILLAR_LABELS
from app.retrieval2.chart_facts import ten_god_facts as _ten_god_facts


def _chart_summary(chart: dict[str, Any]) -> str:
    p = chart.get("PAIPAN") or chart
    sizhu = p.get("sizhu") or {}
    stems = []
    branches = []
    for label, key in _PILLAR_LABELS:
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
    parts = [part for part in parts if part.split("：", 1)[-1]]
    facts = _ten_god_facts(chart)
    if facts:
        parts.append("【结构事实表 — 必须严格遵循，不得改写】\n  " + "\n  ".join(facts))
    return "\n".join(parts)


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


def _find_owning_raw(quote: str, raw_hits: Sequence[dict[str, Any]]) -> int:
    """Search every raw_hit for the one whose text actually owns this quote.
    Returns the index of the matching raw, or -1 if no raw owns it.

    The polisher LLM will occasionally shuffle id↔quote attributions when
    digesting many candidates at once (we observed it citing a 滴天髓 段
    under id=2 which is supposed to be 子平真诠). The previous code
    treated this as a hallucinated quote and fell back to bare slicing,
    losing the LLM's plain / match. With re-attribution we keep the
    polish, just route it to the candidate that actually owns the text.
    """
    for idx, raw in enumerate(raw_hits):
        if _quote_belongs_to_raw(quote, str(raw.get("text") or "")):
            return idx
    return -1


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

        quote = _clean_text(item.get("quote"), max_len=320)
        raw = raw_hits[idx]
        if quote and not _quote_belongs_to_raw(quote, str(raw.get("text") or "")):
            # LLM mis-attributed the quote — search for the raw_hit that
            # actually owns it and re-route the polish there. Falls back
            # to the local quote slicer only if no raw owns the quote.
            true_idx = _find_owning_raw(quote, raw_hits)
            if true_idx < 0 or true_idx in seen:
                fallback = _fallback_items(chart, [raw])[0]
                out.append(fallback)
                seen.add(idx)
                continue
            idx = true_idx
            raw = raw_hits[idx]
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
        # MiMo's API has occasional latency spikes that fire our timeout
        # before any output is generated. One quick retry usually clears
        # it — much better UX than serving 6 raw classical paragraphs.
        logger.info("classics polish primary returned empty — retrying once")
        items = await _polish_once_via_llm(chart, raw_hits, timeout_seconds)
    if not items:
        items = _fallback_items(chart, raw_hits)
        return _ensure_book_coverage(items, raw_hits, chart, max_items=max_items)

    # Detect missing per-claim, not per-book — LLM commonly drops one of two
    # entries from the same chapter (e.g. 三命通会·卷五 has 論偏官 + 官藏煞顯;
    # if it polishes only 論偏官, the file-level seen check thinks 卷五 is
    # covered and 官藏煞顯 falls to the bare local fallback). Use original_text
    # as the per-claim key since it round-trips through the polisher faithfully.
    seen_originals = {
        it.get("original_text") or it.get("text")
        for it in items
        if it.get("original_text") or it.get("text")
    }
    missing = [r for r in raw_hits if r.get("text") not in seen_originals]

    if missing and len(items) < max_items:
        recovered = await _polish_once_via_llm(
            chart, missing, timeout_seconds, recovery=True,
        )
        if recovered:
            items.extend(recovered)
            seen_originals.update(
                it.get("original_text") or it.get("text")
                for it in recovered
                if it.get("original_text") or it.get("text")
            )
        # If recovery still left some claims unpolished (LLM dropped them
        # again or call timed out), make ONE more targeted retry just for
        # the still-missing ones — most users feel the wait less than they
        # feel raw classical text leaking into the panel.
        still_missing = [r for r in missing if r.get("text") not in seen_originals]
        if still_missing and len(items) < max_items:
            logger.info(
                "classics polish recovery missed %d claim(s) — second retry",
                len(still_missing),
            )
            recovered2 = await _polish_once_via_llm(
                chart, still_missing, timeout_seconds, recovery=True,
            )
            if recovered2:
                items.extend(recovered2)

    return _ensure_book_coverage(items, raw_hits, chart, max_items=max_items)


__all__ = ["polish_classics_for_chart"]
