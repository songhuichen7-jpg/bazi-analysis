"""LLM-planned retrieval over local classics.

The model only writes search plans. Source text still comes from local files.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.core.config import settings
from app.llm.client import chat_once_with_fallback
from app.retrieval.classics_guidance import build_classics_retrieval_guidance, build_skill_direct_index_table
from app.retrieval.classics_index import build_classics_index_table, entry_by_id
from app.retrieval.service import (
    SOURCE_ROUTE_ALIASES,
    _chart_search_terms,
    _classic_search_index,
    _merge_terms,
    _route_for_shishen,
    _search_score,
)

PLAN_QUERY_LIMIT = 8
PLAN_SOURCE_LIMIT = 6
PLAN_ID_LIMIT = 10
PLAN_ROUTE_LIMIT = 7
PLAN_TIMEOUT_SECONDS = 60
GENERIC_ROUTE_TITLE_MARKERS = ("总论", "假神", "杂格", "源流", "科甲歌")
STRONG_STRUCTURE_PHRASES = ("杀重身轻", "煞重身轻", "身轻印重", "用火敌杀", "甲木休困")


def _strip_json_fence(text: str) -> str:
    raw = str(text or "").strip()
    match = re.search(r"```(?:json)?\s*(.*?)```", raw, flags=re.S | re.I)
    if match:
        return match.group(1).strip()
    return raw


def _clean_item(value: Any, max_chars: int = 40) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.strip(" \t\r\n，。；;、")
    return text[:max_chars].strip()


def _unique_texts(values: list[Any], *, limit: int, max_chars: int = 40) -> list[str]:
    out: list[str] = []
    for value in values:
        if isinstance(value, dict):
            value = value.get("query") or value.get("text") or value.get("source") or value.get("name")
        text = _clean_item(value, max_chars=max_chars)
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def parse_llm_retrieval_plan(text: str) -> dict[str, list[str]]:
    """Parse LLM output into selected index ids plus optional fallbacks."""
    try:
        data = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError:
        return {"ids": [], "queries": [], "sources": []}

    if isinstance(data, list):
        ids = data
        queries = data
        sources: list[Any] = []
    elif isinstance(data, dict):
        ids = data.get("ids") or data.get("selected_ids") or data.get("selected") or []
        queries = (
            data.get("queries")
            or data.get("searches")
            or data.get("search_terms")
            or data.get("terms")
            or []
        )
        sources = data.get("sources") or data.get("books") or data.get("chapters") or []
    else:
        return {"ids": [], "queries": [], "sources": []}

    if not isinstance(ids, list):
        ids = [ids]
    if not isinstance(queries, list):
        queries = [queries]
    if not isinstance(sources, list):
        sources = [sources]

    return {
        "ids": _unique_texts(ids, limit=PLAN_ID_LIMIT, max_chars=8),
        "queries": _unique_texts(queries, limit=PLAN_QUERY_LIMIT, max_chars=48),
        "sources": _unique_texts(sources, limit=PLAN_SOURCE_LIMIT, max_chars=32),
    }


def _compact_chart_context(chart: dict, intent: str, user_message: str | None) -> str:
    p = chart or {}
    sizhu = p.get("sizhu") or {}
    shishen = p.get("shishen") or {}
    lines = [
        "【命盘上下文】",
        f"意图  {intent}",
        f"用户问题  {user_message or '古籍旁证'}",
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


def build_llm_retrieval_plan_messages(chart: dict, intent: str, user_message: str | None = None) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "\n".join([
                "你是八字古籍检索规划器。你面前有一张本地古籍索引表，像翻目录一样选最该打开的章节 ID。",
                "只选索引表里存在的 ID；不要编造书名、章节、原文。",
                "第一优先使用 skill 常用章节直查索引；再用完整本地古籍索引补缺。",
                "选择标准：先按 docs/bazi-analysis 的查书法判断问题域，再看日主月令、格局主轴、强弱、调候、制化、通关、用神。",
                "每个 ID 都必须能解释为“这张盘为什么该翻这一章”；不要为了凑数选择无关章节。",
                "可以多选，宁可多翻几章；古籍判词很重要。",
                '只输出 JSON：{"ids":["C001","C039","C087"]}',
            ]),
        },
        {
            "role": "user",
            "content": "\n\n".join([
                _compact_chart_context(chart, intent, user_message),
                build_classics_retrieval_guidance(),
                build_skill_direct_index_table(),
                "【程序已知关键词】",
                "、".join(_chart_search_terms(chart)[:24]),
                "【完整本地古籍索引（补充目录）】",
                build_classics_index_table(),
                "请优先从 skill 常用章节直查索引中选择，再从完整本地古籍索引补充，共选 4-10 个最值得打开的 ID。",
            ]),
        },
    ]


def _query_terms(queries: list[str]) -> list[str]:
    terms: list[str] = []
    for query in queries:
        clean = _clean_item(query, max_chars=80)
        if not clean:
            continue
        terms.append(clean)
        terms.extend(part for part in re.split(r"[\s,，、;；|/]+", clean) if len(part) >= 2)
    return _merge_terms(terms)


def _source_hint_routes(sources: list[str]) -> list[dict]:
    routes: list[dict] = []
    for source in sources:
        hint = _clean_item(source, max_chars=32)
        if not hint:
            continue
        for alias, route in SOURCE_ROUTE_ALIASES.items():
            if hint in alias or alias in hint:
                routes.append({**route, "score": 116})
                break
        else:
            route = _route_for_shishen(hint, 96)
            if route:
                routes.append(route)
    return routes


def _index_id_routes(ids: list[str]) -> list[dict]:
    routes: list[dict] = []
    for offset, entry_id in enumerate(ids):
        entry = entry_by_id(entry_id)
        if entry is None:
            continue
        routes.append({
            "file": entry.file,
            "label": entry.source,
            "score": 140 - offset,
        })
    return routes


def _query_match_bonus(paragraph: str, queries: list[str]) -> int:
    best = 0
    for query in queries:
        parts = [
            part
            for part in re.split(r"[\s,，、;；|/]+", query)
            if len(part) >= 2 and part not in {"身弱", "用印"}
        ]
        hits = [part for part in parts if part in paragraph]
        if len(hits) >= 2:
            best = max(best, 18 * len(hits) + sum(min(len(part), 4) for part in hits))
        for phrase in STRONG_STRUCTURE_PHRASES:
            if phrase in query and phrase in paragraph:
                best = max(best, 42)
    return best


def _query_routes(queries: list[str], *, limit: int = PLAN_ROUTE_LIMIT) -> list[dict]:
    terms = _query_terms(queries)
    if not terms:
        return []

    best_by_file: dict[str, tuple[int, dict]] = {}
    for row in _classic_search_index():
        if str(row["file"]).startswith("yuanhai-ziping/"):
            continue
        if len(str(row["text"])) < 60:
            continue
        bonus = _query_match_bonus(row["text"], queries)
        if bonus <= 0:
            continue
        score = _search_score(row["text"], terms)
        score += bonus
        if any(marker in str(row["label"]) for marker in GENERIC_ROUTE_TITLE_MARKERS):
            score -= 35
        if score < 55:
            continue
        current = best_by_file.get(row["file"])
        if current is None or score > current[0]:
            best_by_file[row["file"]] = (score, row)

    routes: list[dict] = []
    for score, row in sorted(best_by_file.values(), key=lambda item: item[0], reverse=True):
        routes.append({
            "file": row["file"],
            "label": row["label"],
            "score": min(120, 80 + score),
            "exactText": row["text"],
        })
        if len(routes) >= limit:
            break
    return routes


def _dedupe_routes(routes: list[dict], *, limit: int = PLAN_ROUTE_LIMIT) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for route in sorted(routes, key=lambda item: item.get("score", 0), reverse=True):
        file = str(route.get("file") or "")
        if not file or file in seen:
            continue
        seen.add(file)
        out.append(route)
        if len(out) >= limit:
            break
    return out


async def llm_planned_routes(
    chart: dict,
    intent: str,
    user_message: str | None = None,
    *,
    limit: int = PLAN_ROUTE_LIMIT,
) -> list[dict]:
    """Ask the LLM for search intent, then resolve it against local classics."""
    if not settings.llm_api_key:
        return []

    try:
        text, _model = await asyncio.wait_for(
            chat_once_with_fallback(
                messages=build_llm_retrieval_plan_messages(chart, intent, user_message),
                tier="fast",
                temperature=0,
                max_tokens=1800,
                disable_thinking=False,
            ),
            timeout=PLAN_TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001 - retrieval falls back to deterministic routes
        return []

    plan = parse_llm_retrieval_plan(text)
    routes = _index_id_routes(plan["ids"])
    if not routes:
        routes = _query_routes(plan["queries"], limit=limit)
    routes.extend(_source_hint_routes(plan["sources"]))
    return _dedupe_routes(routes, limit=limit)
