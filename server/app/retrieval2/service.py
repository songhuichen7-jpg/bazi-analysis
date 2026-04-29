"""Public entry — drop-in replacement for ``app.retrieval.service``.

Same async signature as v1 (``retrieve_for_chart(chart, kind, user_message)
-> list[V1Hit]``) so call sites are unchanged.

Pipeline at runtime:

    intents = bazi_chart_to_intents(chart, kind, user_msg)
    candidates = BM25(text-of-intents) ∪ KG(constraints-of-intents)  → top 30
    hits = await DeepSeek_select(chart, intents, user_msg, candidates)  → 6
    return [v1_shape(h) for h in hits]

Failure modes are graceful:
* No index on disk → return [] (caller falls back to v1)
* Selector LLM error → fall back to top-k by fused score
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

from . import bm25 as bm25_mod
from . import kg as kg_mod
from . import selector as selector_mod
from . import storage
from .intents import bazi_chart_to_intents
from .normalize import book_label
from .policy import RetrievalPolicy, build_policy
from .types import ClaimTags, ClaimUnit, RetrievalHit

logger = logging.getLogger(__name__)

DEFAULT_FUSED_TOP_N = 30
DEFAULT_FINAL_K = 6


class V1Hit(TypedDict):
    """Mirrors ``app.retrieval.service.RetrievalHit`` (TypedDict)."""

    source: str
    file: str
    scope: str
    chars: int
    text: str


def _default_index_root() -> Path:
    env = os.environ.get("RETRIEVAL2_INDEX_ROOT")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "var" / "retrieval2"


@lru_cache(maxsize=4)
def _bundle(root_str: str):
    root = Path(root_str)
    p = storage.paths(root)
    claims = {c.id: c for c in storage.load_claims(p.claims)}
    tags = {t.claim_id: t for t in storage.load_tags(p.tags)}
    bm25_idx = bm25_mod.load_bm25(p.bm25) if p.bm25.exists() else None
    kg_idx = kg_mod.build_kg(tags.values())
    logger.info(
        "retrieval2 loaded: %d claims, %d tags, bm25=%s, kg fields=%d",
        len(claims), len(tags), bool(bm25_idx), len(kg_idx.field_index),
    )
    return claims, tags, bm25_idx, kg_idx


def reset_cache() -> None:
    """For tests / index rebuild."""
    _bundle.cache_clear()


def _v1_shape(hit: RetrievalHit) -> V1Hit:
    parts = [book_label(hit.claim.book), hit.claim.chapter_title]
    return V1Hit(
        source=" · ".join(p for p in parts if p),
        file=hit.claim.chapter_file,
        scope=hit.claim.section or "full",
        text=hit.claim.text,
        chars=len(hit.claim.text),
    )


def _gather_candidates(
    intents,
    bm25_idx,
    kg_idx,
    claims: dict[str, ClaimUnit],
    tags: dict[str, ClaimTags],
    *,
    n: int,
    policy: RetrievalPolicy,
) -> dict[str, dict[str, float]]:
    """Run BM25 + KG on each intent; aggregate per-claim per-channel score."""
    scores: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for intent in intents:
        if intent.text and bm25_idx is not None:
            for cid, s in bm25_idx.query(intent.text, k=n):
                scores[cid]["bm25"] += s * intent.weight
        if intent.constraints:
            for cid, s in kg_idx.match(intent.constraints).items():
                scores[cid]["kg"] += s * intent.weight
    for cid, claim in claims.items():
        tag = tags.get(cid, ClaimTags(claim_id=cid))
        if policy.rejects(claim, tag):
            scores[cid]["reject"] = 1.0
            continue
        boost = policy.boost(claim, tag)
        if boost > 0:
            scores[cid]["policy"] += boost
    return scores


def _fuse(
    scores: dict[str, dict[str, float]],
    *,
    n: int,
) -> list[tuple[str, float, dict[str, float]]]:
    """Tiny linear blend across channels — only used to pre-filter to N
    candidates before the selector. Selector does the real ranking, so this
    just needs to keep the right candidates in the pool."""
    max_bm25 = max((ch.get("bm25", 0.0) for ch in scores.values()), default=0.0)
    usable = [ch for ch in scores.values() if not ch.get("reject")]
    max_kg = max((ch.get("kg", 0.0) for ch in usable), default=0.0)
    max_policy = max((ch.get("policy", 0.0) for ch in usable), default=0.0)
    out: list[tuple[str, float, dict[str, float]]] = []
    for cid, ch in scores.items():
        if ch.get("reject"):
            continue
        # Normalize each channel by its own max within this query so the
        # blend doesn't get dominated by one channel's scale.
        bm25 = ch.get("bm25", 0.0) / max_bm25 if max_bm25 > 0 else 0.0
        kg = ch.get("kg", 0.0) / max_kg if max_kg > 0 else 0.0
        policy = ch.get("policy", 0.0) / max_policy if max_policy > 0 else 0.0
        fused = 0.35 * bm25 + 1.0 * kg + 1.35 * policy
        out.append((cid, fused, dict(ch)))
    out.sort(key=lambda x: x[1], reverse=True)
    return out[:n]


def _promote_preferred_files(
    fused: list[tuple[str, float, dict[str, float]]],
    claims: dict[str, ClaimUnit],
    policy: RetrievalPolicy,
    *,
    n: int,
) -> list[tuple[str, float, dict[str, float]]]:
    if not policy.preferred_files:
        return fused[:n]

    anchors: list[tuple[str, float, dict[str, float]]] = []
    for file_name in policy.preferred_files:
        match = next(
            (item for item in fused if claims.get(item[0]) and claims[item[0]].chapter_file == file_name),
            None,
        )
        if match is not None:
            anchors.append(match)

    out: list[tuple[str, float, dict[str, float]]] = []
    seen: set[str] = set()
    for item in [*anchors, *fused]:
        cid = item[0]
        if cid in seen:
            continue
        out.append(item)
        seen.add(cid)
        if len(out) >= n:
            break
    return out


def _diversify_fused(
    fused: list[tuple[str, float, dict[str, float]]],
    claims: dict[str, ClaimUnit],
    *,
    n: int,
    per_file: int = 2,
) -> list[tuple[str, float, dict[str, float]]]:
    if per_file <= 0:
        return fused[:n]

    counts: dict[str, int] = defaultdict(int)
    out: list[tuple[str, float, dict[str, float]]] = []
    seen: set[str] = set()

    for item in fused:
        cid = item[0]
        claim = claims.get(cid)
        if claim is None or counts[claim.chapter_file] >= per_file:
            continue
        out.append(item)
        seen.add(cid)
        counts[claim.chapter_file] += 1
        if len(out) >= n:
            return out

    for item in fused:
        cid = item[0]
        if cid in seen:
            continue
        out.append(item)
        if len(out) >= n:
            break
    return out


def _ensure_preferred_hits(
    hits: list[RetrievalHit],
    candidates: list[selector_mod.Candidate],
    policy: RetrievalPolicy,
    *,
    k: int,
) -> list[RetrievalHit]:
    if not policy.preferred_files or not candidates:
        return hits[:k]

    by_file: dict[str, selector_mod.Candidate] = {}
    for c in candidates:
        by_file.setdefault(c.claim.chapter_file, c)

    out: list[RetrievalHit] = []
    seen: set[str] = set()
    by_hit_id = {h.claim.id: h for h in hits}

    for file_name in policy.preferred_files:
        c = by_file.get(file_name)
        if c is None:
            continue
        hit = by_hit_id.get(c.claim.id) or RetrievalHit(
            claim=c.claim,
            tags=c.tags,
            score=c.fused_score,
            reason="preferred-source",
        )
        out.append(hit)
        seen.add(hit.claim.id)
        if len(out) >= k:
            return out

    for hit in hits:
        if hit.claim.id in seen:
            continue
        out.append(hit)
        seen.add(hit.claim.id)
        if len(out) >= k:
            break
    return out


async def retrieve_for_chart(
    chart: dict[str, Any],
    kind: str,
    user_message: str | None = None,
    *,
    index_root: Path | None = None,
    final_k: int = DEFAULT_FINAL_K,
    fused_top_n: int = DEFAULT_FUSED_TOP_N,
    use_selector: bool = True,
) -> list[V1Hit]:
    """v1-compatible signature. Returns v1-shaped dicts.

    Internal pipeline:
      1. chart → intents
      2. BM25 + KG → top fused_top_n candidates
      3. DeepSeek selector → up to final_k (graceful fallback to fused score)
      4. v1 dict shape
    """
    intent_kind = kind[len("section:"):] if kind.startswith("section:") else kind
    intents = bazi_chart_to_intents(chart, intent_kind, user_message)
    if not intents:
        return []
    policy = build_policy(chart, intent_kind, user_message)
    claims, tags, bm25_idx, kg_idx = _bundle(
        str((index_root or _default_index_root()).resolve())
    )
    if not claims:
        logger.warning("retrieval2 index empty — returning []")
        return []

    raw_scores = _gather_candidates(
        intents, bm25_idx, kg_idx, claims, tags,
        n=fused_top_n, policy=policy,
    )
    fused = _fuse(raw_scores, n=max(fused_top_n, len(raw_scores)))
    if not fused and (
        policy.allowed_file_fragments
        or policy.rejected_file_fragments
        or policy.required_domains
        or policy.required_terms
    ):
        fallback_policy = RetrievalPolicy(kind=intent_kind)
        raw_scores = _gather_candidates(
            intents, bm25_idx, kg_idx, claims, tags,
            n=fused_top_n, policy=fallback_policy,
        )
        fused = _fuse(raw_scores, n=max(fused_top_n, len(raw_scores)))
    fused = _promote_preferred_files(fused, claims, policy, n=fused_top_n)
    fused = _diversify_fused(fused, claims, n=fused_top_n)
    candidates = [
        selector_mod.Candidate(
            claim=claims[cid],
            tags=tags.get(cid, ClaimTags(claim_id=cid)),
            fused_score=score,
        )
        for cid, score, _ in fused
        if cid in claims
    ]

    if use_selector:
        hits = await selector_mod.select(
            chart, intents, user_message, candidates, k=final_k,
            policy_hint=policy.selector_hint,
        )
        hits = _ensure_preferred_hits(hits, candidates, policy, k=final_k)
    else:
        hits = [
            RetrievalHit(claim=c.claim, tags=c.tags, score=c.fused_score)
            for c in candidates[:final_k]
        ]

    return [_v1_shape(h) for h in hits]


__all__ = ["V1Hit", "retrieve_for_chart", "reset_cache"]
