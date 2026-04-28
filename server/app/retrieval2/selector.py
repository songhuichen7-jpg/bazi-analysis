"""DeepSeek-as-selector — picks the best K claims out of ~30 candidates.

This is the **key new component** that replaces the cross-encoder reranker.
For our deployment (2GB RAM domestic-API server), this is the right tradeoff:

* No model weights, no torch. Zero deployment footprint.
* Uses the existing DeepSeek client; no new API integration.
* ~500ms-1s latency per call — acceptable since baseline chat is 10-20s.
* Sees full chart context + user question, not just (query, doc) pairs.
  This actually beats cross-encoder rerankers on highly contextual tasks.

Failure modes are explicit and graceful:
* LLM call timeout / error → fall back to top-N by candidate score.
* Bad JSON → fall back to top-N by candidate score.
* IDs the LLM made up → silently dropped.
* Too few picked → top-up from candidates by score until reaching K.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Sequence

from .types import ClaimUnit, QueryIntent, RetrievalHit, ClaimTags

logger = logging.getLogger(__name__)

DEFAULT_K = 6
DEFAULT_MAX_CANDIDATES = 30
DEFAULT_TIMEOUT_SECONDS = 20.0


@dataclass(slots=True)
class Candidate:
    claim: ClaimUnit
    tags: ClaimTags
    fused_score: float


_SYSTEM = """你是八字检索结果的精排器。给你一个命盘+用户问题+一批候选古籍 claim，
你要挑出最直接对题、最有信息密度的几条。

打分原则：
- 直接答用户问题的（一句道破型）排首位
- 普遍命题 > 具体案例（除非用户明确想看案例）
- 同一观点重复出现，只挑信号最强、表述最精的一条
- 偏门口诀 / 神煞类杂论权重低
- 与命盘强弱、格局、月令、用神不对应的，直接淘汰

只输出 JSON：
{"picks":[{"id":"<claim_id>","reason":"<10-20字>"}]}

picks 数组按相关性从高到低排列。给我精选 N 条；宁缺毋滥。
不要解释，不要 ```fence。"""


def _format_chart(chart: dict) -> str:
    p = chart.get("PAIPAN") or chart
    sizhu = p.get("sizhu") or {}
    parts = [
        f"四柱: 年{sizhu.get('year','')} 月{sizhu.get('month','')} 日{sizhu.get('day','')} 时{sizhu.get('hour','')}",
        f"日主: {p.get('rizhu','')}",
        f"格局: {p.get('geju','')}",
        f"强弱: {p.get('dayStrength','')}",
        f"用神: {p.get('yongshen','')}",
    ]
    return "  ".join(s for s in parts if s.split(": ", 1)[-1])


def _format_intents(intents: Sequence[QueryIntent]) -> str:
    lines: list[str] = []
    for it in intents:
        if it.kind == "user_msg":
            continue
        if it.text:
            lines.append(f"  · {it.kind}: {it.text}")
    return "\n".join(lines)


def _format_candidates(candidates: Sequence[Candidate]) -> str:
    lines: list[str] = []
    for c in candidates:
        text = c.claim.text.replace("\n", " ").strip()
        if len(text) > 220:
            text = text[:220] + "…"
        src = c.claim.chapter_title
        lines.append(f"[{c.claim.id}] {src}\n  {text}")
    return "\n".join(lines)


def _user_message(
    chart: dict,
    intents: Sequence[QueryIntent],
    user_msg: str | None,
    candidates: Sequence[Candidate],
    k: int,
) -> str:
    user_q = user_msg or "（用户未直接提问；按命盘整体特征做检索）"
    return (
        f"【命盘】\n  {_format_chart(chart)}\n\n"
        f"【用户问题】\n  {user_q}\n\n"
        f"【系统识别的检索意图】\n{_format_intents(intents) or '  · meta'}\n\n"
        f"【候选 claim（共 {len(candidates)} 条）】\n{_format_candidates(candidates)}\n\n"
        f"请从中精选最对题的 {k} 条，输出 JSON。"
    )


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.S | re.I)


def _strip_fence(text: str) -> str:
    s = (text or "").strip()
    m = _FENCE_RE.search(s)
    return (m.group(1) if m else s).strip()


def parse_picks(text: str, valid_ids: set[str]) -> list[tuple[str, str]]:
    """Parse selector output. Returns ``[(claim_id, reason), ...]`` in order.
    Drops ids not in ``valid_ids``."""
    try:
        data = json.loads(_strip_fence(text))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, dict):
        return []
    picks = data.get("picks") or []
    if not isinstance(picks, list):
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in picks:
        if isinstance(item, dict):
            cid = str(item.get("id") or "").strip()
            reason = str(item.get("reason") or "").strip()[:80]
        elif isinstance(item, str):
            cid, reason = item.strip(), ""
        else:
            continue
        if cid and cid in valid_ids and cid not in seen:
            out.append((cid, reason))
            seen.add(cid)
    return out


def _topup(picks: list[tuple[str, str]], candidates: Sequence[Candidate],
           k: int) -> list[tuple[str, str, float]]:
    """Append fallback candidates by fused_score until we have k items."""
    seen = {cid for cid, _ in picks}
    score_map = {c.claim.id: c.fused_score for c in candidates}
    out: list[tuple[str, str, float]] = [
        (cid, reason, score_map.get(cid, 0.0)) for cid, reason in picks
    ]
    for c in sorted(candidates, key=lambda x: x.fused_score, reverse=True):
        if len(out) >= k:
            break
        if c.claim.id in seen:
            continue
        out.append((c.claim.id, "", c.fused_score))
        seen.add(c.claim.id)
    return out


async def _call_deepseek(messages: list[dict], *, timeout: float) -> str:
    from app.llm.client import chat_once_with_fallback

    text, _ = await asyncio.wait_for(
        chat_once_with_fallback(
            messages=messages,
            tier="fast", temperature=0.0, max_tokens=600,
            disable_thinking=True,
        ),
        timeout=timeout,
    )
    return text


async def select(
    chart: dict,
    intents: Sequence[QueryIntent],
    user_msg: str | None,
    candidates: Sequence[Candidate],
    *,
    k: int = DEFAULT_K,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> list[RetrievalHit]:
    """Pick best k claims from candidates using DeepSeek.

    Returns up to k :class:`RetrievalHit`. On any LLM-call failure, falls
    back to top-k by ``fused_score`` (no exception thrown).
    """
    if not candidates:
        return []
    # Trim candidates to manage prompt size and cost.
    pool = list(candidates)[:max_candidates]
    valid_ids = {c.claim.id for c in pool}

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _user_message(chart, intents, user_msg, pool, k)},
    ]
    try:
        text = await _call_deepseek(messages, timeout=timeout_seconds)
        picks = parse_picks(text, valid_ids)
    except Exception as exc:  # noqa: BLE001
        logger.warning("selector LLM call failed: %s — falling back to fused_score", exc)
        picks = []

    final = _topup(picks, pool, k)
    by_id = {c.claim.id: c for c in pool}
    out: list[RetrievalHit] = []
    for cid, reason, score in final[:k]:
        c = by_id.get(cid)
        if c is None:
            continue
        out.append(RetrievalHit(
            claim=c.claim, tags=c.tags,
            score=score if score else 0.5,
            reason=reason,
        ))
    return out


__all__ = ["Candidate", "select", "parse_picks", "DEFAULT_K"]
