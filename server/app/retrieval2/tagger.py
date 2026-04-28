"""LLM tagger — runs once offline.

Reads ClaimUnit, returns ClaimTags. Uses the project's existing DeepSeek
chat client (no extra dependency). Prompt + parser are versioned together
via :data:`TAGGER_PROMPT_VERSION` (in ``types.py``).

Tagger output is **strictly gated against the controlled vocabulary in
:data:`VOCAB`** — any term the model invents is silently dropped at parse
time. So adding a new vocabulary term requires:

  1. add it to :data:`VOCAB`
  2. bump :data:`TAGGER_PROMPT_VERSION` in ``types.py``
  3. re-run the indexer

The tagger is async + concurrency-safe (no shared mutable state).
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from .types import ClaimTags, ClaimUnit, TAGGER_PROMPT_VERSION

# Controlled vocabulary the tagger is allowed to emit.
VOCAB: dict[str, list[str]] = {
    "shishen": [
        "比肩", "劫财", "正印", "偏印",
        "正官", "七杀", "正财", "偏财",
        "食神", "伤官", "建禄", "阳刃",
    ],
    "yongshen_method": ["扶抑", "调候", "通关", "病药", "格局", "专旺"],
    "day_strength": ["身强", "身旺", "身弱", "身轻", "中和", "极弱", "极强", "从格"],
    "domain": [
        "格局成败", "用神取舍", "用神变化", "六亲", "性情", "调候",
        "财官", "疾病", "行运", "神煞", "外貌", "女命", "时上",
    ],
    "season": ["春", "夏", "秋", "冬", "四季"],
    "day_gan": list("甲乙丙丁戊己庚辛壬癸"),
    "month_zhi": list("子丑寅卯辰巳午未申酉戌亥"),
    "geju": [
        "七杀格", "正官格", "正印格", "偏印格", "印绶格",
        "正财格", "偏财格", "财格", "食神格", "伤官格",
        "建禄格", "月劫格", "阳刃格",
        "化气格", "从财格", "从杀格", "从儿格", "从势格",
        "曲直格", "炎上格", "稼穑格", "从革格", "润下格",
        "飞天禄马", "倒冲", "井栏叉", "六阴朝阳", "六乙鼠贵",
        "朝阳格", "金神", "魁罡", "日刃", "日德", "日贵",
    ],
    "kind": ["principle", "case", "heuristic", "meta", "unclear"],
}


def _vocab_block() -> str:
    return "\n".join(f"  {k}: [{', '.join(v)}]" for k, v in VOCAB.items())


SYSTEM_PROMPT = f"""你是八字古籍的结构化标注器。读一条 claim，按下表输出标签。
只用受控词表内的值；如果一段 claim 不属于任何受控值，对应字段留空数组。

受控词表：
{_vocab_block()}

字段说明：
- shishen: claim 主要讨论的十神（多选）。
- yongshen_method: 涉及的用神方法。
- day_strength: 适用的日主强弱情境（"杀重身轻"应拆为 day_strength=身轻 + shishen=七杀）。
- domain: 落在哪个生活/命理域。
- season / day_gan / month_zhi: 仅在 claim 明确专属时填，通则留空。
- geju: 提到的具体格局名。
- authority: 0..1。1=主流共识断语；0.5=普通论述；<0.3=偏门口诀。
- refined_kind: principle=抽象命题；case=具体命例；heuristic=经验法则；meta=篇首释例。
- confidence: 你这次标注的置信度 0..1。

只输出 JSON。不要解释，不要 fence。"""

_USER_TEMPLATE = """书：{book}
章节：{chapter_title}
小节：{section}
claim_id：{claim_id}
claim 文本：
{text}"""


def build_messages(claim: ClaimUnit) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _USER_TEMPLATE.format(
            book=claim.book, chapter_title=claim.chapter_title,
            section=claim.section or "—", claim_id=claim.id, text=claim.text,
        )},
    ]


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.S | re.I)


def _strip_fence(text: str) -> str:
    s = (text or "").strip()
    m = _FENCE_RE.search(s)
    return (m.group(1) if m else s).strip()


def _filter_vocab(values: Any, allowed: list[str]) -> tuple[str, ...]:
    if values is None:
        return ()
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return ()
    allowed_set = set(allowed)
    out: list[str] = []
    for v in values:
        s = str(v or "").strip()
        if s in allowed_set and s not in out:
            out.append(s)
    return tuple(out)


def parse_response(text: str, claim_id: str) -> dict[str, Any]:
    try:
        data = json.loads(_strip_fence(text))
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, Any] = {"claim_id": claim_id}
    for key in ("shishen", "yongshen_method", "day_strength", "domain",
                "season", "day_gan", "month_zhi", "geju"):
        out[key] = _filter_vocab(data.get(key), VOCAB[key])
    refined = str(data.get("refined_kind") or "").strip()
    out["refined_kind"] = refined if refined in set(VOCAB["kind"]) else "principle"
    try:
        out["authority"] = float(data.get("authority", 0.5))
    except (TypeError, ValueError):
        out["authority"] = 0.5
    try:
        out["tagger_confidence"] = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        out["tagger_confidence"] = 0.0
    return out


async def tag_one(claim: ClaimUnit, *, timeout_seconds: float = 30.0) -> ClaimTags:
    """Tag a single claim. Late-imports the chat client so this module is
    importable in environments without the LLM stack."""
    from app.llm.client import chat_once_with_fallback  # local import

    try:
        text, model = await asyncio.wait_for(
            chat_once_with_fallback(
                messages=build_messages(claim),
                tier="fast", temperature=0.0, max_tokens=400,
                disable_thinking=True,
            ),
            timeout=timeout_seconds,
        )
    except Exception:  # noqa: BLE001 - tagger is best-effort
        return ClaimTags(
            claim_id=claim.id,
            tagger_version=TAGGER_PROMPT_VERSION,
            tagger_model="(error)",
            tagger_confidence=0.0,
        )
    parsed = parse_response(text, claim.id)
    return ClaimTags(
        claim_id=claim.id,
        shishen=parsed.get("shishen", ()),
        yongshen_method=parsed.get("yongshen_method", ()),
        day_strength=parsed.get("day_strength", ()),
        domain=parsed.get("domain", ()),
        season=parsed.get("season", ()),
        day_gan=parsed.get("day_gan", ()),
        month_zhi=parsed.get("month_zhi", ()),
        geju=parsed.get("geju", ()),
        refined_kind=parsed.get("refined_kind", claim.kind),
        authority=parsed.get("authority", 0.5),
        tagger_version=TAGGER_PROMPT_VERSION,
        tagger_model=model or "deepseek",
        tagger_confidence=parsed.get("tagger_confidence", 0.0),
    )


async def tag_all(claims: list[ClaimUnit], *, max_concurrency: int = 32) -> list[ClaimTags]:
    """Tag a list of claims concurrently. Returns in the same order as input."""
    sem = asyncio.Semaphore(max_concurrency)

    async def _one(c: ClaimUnit, idx: int) -> tuple[int, ClaimTags]:
        async with sem:
            return idx, await tag_one(c)

    results = await asyncio.gather(*(_one(c, i) for i, c in enumerate(claims)))
    results.sort(key=lambda x: x[0])
    return [t for _, t in results]


__all__ = [
    "VOCAB",
    "SYSTEM_PROMPT",
    "build_messages",
    "parse_response",
    "tag_one",
    "tag_all",
]
