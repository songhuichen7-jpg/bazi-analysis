"""Compact retrieval guidance distilled from docs/bazi-analysis.

The full skill docs are written for a human analyst. This module keeps the
same book-selection rules small enough to send with each LLM retrieval plan.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from app.prompts.loader import _repo_root
from app.retrieval.classics_index import entry_for_file


CLASSICS_GUIDANCE_SOURCE = "docs/bazi-analysis/classical-references.md"


@dataclass(frozen=True)
class SkillIndexEntry:
    demand: str
    declared_file: str
    resolved_file: str
    local_id: str
    source: str


def _skill_docs_text() -> str:
    try:
        return (_repo_root() / CLASSICS_GUIDANCE_SOURCE).read_text(encoding="utf-8")
    except OSError:
        return ""


def _direct_index_block(text: str) -> str:
    match = re.search(r"### 常用章节直查\n(?P<body>.*?)(?:\n\*\*注意\*\*|\n---|\n### )", text, flags=re.S)
    return match.group("body") if match else ""


def _path_key(path: str) -> str:
    name = path.rsplit("/", 1)[-1].replace(".md", "")
    name = re.sub(r"^(?:tong-shen-lun|liu-qin-lun)_\d+_", "", name)
    return re.sub(r"^\d+[_-]", "", name)


def _resolve_classic_path(declared_file: str) -> str | None:
    rel = declared_file.strip()
    if entry_for_file(rel):
        return rel

    entries = tuple(entry for entry in _all_entries() if _path_key(entry.file) == _path_key(rel))
    if entries:
        same_book = [entry for entry in entries if entry.file.split("/", 1)[0] == rel.split("/", 1)[0]]
        return (same_book or list(entries))[0].file
    return None


@lru_cache(maxsize=1)
def _all_entries():
    from app.retrieval.classics_index import classics_index_entries

    return classics_index_entries()


def _extract_declared_files(cell: str) -> list[str]:
    paths = re.findall(r"classics/([^`|]+?\.md)", cell)
    short = re.findall(r"`([^`/]+\.md)`", cell)
    if short and "sanming-tonghui" in cell:
        paths.extend(f"sanming-tonghui/{name}" for name in short)
    return list(dict.fromkeys(paths))


@lru_cache(maxsize=1)
def skill_direct_index_entries() -> tuple[SkillIndexEntry, ...]:
    """Resolve the skill's 常用章节直查 table to local index IDs."""
    rows: list[SkillIndexEntry] = []
    for line in _direct_index_block(_skill_docs_text()).splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2 or cells[0] in {"分析需求", "---"}:
            continue
        demand = re.sub(r"[*`]", "", cells[0]).strip()
        if not demand:
            continue
        for declared in _extract_declared_files(cells[1]):
            resolved = _resolve_classic_path(declared)
            if not resolved:
                continue
            local = entry_for_file(resolved)
            if not local:
                continue
            item = SkillIndexEntry(
                demand=demand,
                declared_file=declared,
                resolved_file=resolved,
                local_id=local.id,
                source=local.source,
            )
            if item not in rows:
                rows.append(item)
    return tuple(rows)


def build_skill_direct_index_table() -> str:
    lines = ["【skill 常用章节直查索引（来自 docs/bazi-analysis/classical-references.md，已校准到本地文件 ID）】"]
    for entry in skill_direct_index_entries():
        note = ""
        if entry.declared_file != entry.resolved_file:
            note = f" | skill旧路径:{entry.declared_file}"
        lines.append(f"- {entry.demand} -> [{entry.local_id}] {entry.source} | 文件:{entry.resolved_file}{note}")
    return "\n".join(lines)


def build_classics_retrieval_guidance() -> str:
    return "\n".join([
        "【古籍查阅法（压缩自 docs/bazi-analysis/classical-references.md）】",
        "先判断命盘问题域，再翻目录；不要只按关键词命中，也不要固定每盘都查同一组章节。",
        "查阅顺序：1 排盘/十神核验 → 2 子平真诠定格局与成败 → 3 穷通宝鉴按日主×月令查调候 → 4 滴天髓看整体气势/衰旺/从格 → 5 按用户问题补专门章节 → 6 多书交叉验证。",
        "权威分工：格局成败=子平真诠；调候用神(日干×月令)=穷通宝鉴对应日干章节逐月读；整体气势/衰旺/从格=滴天髓；官杀处理=子平真诠·论偏官 + 滴天髓·官杀；身弱身强=滴天髓·衰旺；调候寒暖燥湿=滴天髓·寒暖/燥湿 + 穷通宝鉴；大运流年=子平真诠；特殊格局/神煞/相貌/日时断=三命通会/渊海子平作辅助。",
        "官杀盘的特别读法：若月令或主格为七杀/偏官，先查子平真诠·论偏官；若身弱、杀重、财坏印、杀印相生、制化失衡，再补滴天髓·官杀/衰旺/通关。",
        "穷通宝鉴的读法：命中日主与月令后，不只看用神名；季节总判与当月细判都可能是核心判词。",
    ])
