"""Synonym + variant-character normalization.

Single source of truth: ``data/synonyms.json``. Editing the JSON +
re-running the indexer is the supported way to extend.

Three operations exposed:

    normalize(text)   -> str          # variant-char folding
    expand(term)      -> set[str]     # all surface forms equivalent to term
    canonical(term)   -> str          # pick the canonical form
    book_label(key)   -> str
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Iterable

_DATA = Path(__file__).resolve().parent / "data" / "synonyms.json"


def _mtime_key(path: Path) -> tuple[str, int]:
    try:
        return (str(path), int(os.path.getmtime(path)))
    except FileNotFoundError:
        return (str(path), 0)


@lru_cache(maxsize=2)
def _data(_key: tuple[str, int]) -> dict:
    with _DATA.open(encoding="utf-8") as fh:
        return json.load(fh)


def _config() -> dict:
    return _data(_mtime_key(_DATA))


@lru_cache(maxsize=2)
def _variants(_key: tuple[str, int]) -> dict[str, str]:
    raw = _config().get("variant_chars", {})
    out: dict[str, str] = {}
    for canonical, alts in raw.items():
        if canonical.startswith("_"):
            continue
        for a in alts:
            out[a] = canonical
    return out


def normalize(text: str) -> str:
    """Variant-char fold. Idempotent. Used by both indexer and query."""
    if not text:
        return text
    table = _variants(_mtime_key(_DATA))
    return "".join(table.get(c, c) for c in text)


@lru_cache(maxsize=2)
def _classes(_key: tuple[str, int]) -> tuple[frozenset[str], ...]:
    """Build undirected synonym classes (with transitive closure)."""
    cfg = _config()
    raw_classes: list[set[str]] = []
    for section in ("shishen", "strength", "method", "phrases"):
        for canonical, alts in (cfg.get(section) or {}).items():
            if canonical.startswith("_"):
                continue
            cls = {normalize(t) for t in [canonical, *alts] if t}
            raw_classes.append(cls)
    # Transitive merge
    merged: list[set[str]] = []
    for cls in raw_classes:
        joined = cls
        keep: list[set[str]] = []
        for existing in merged:
            if joined & existing:
                joined = joined | existing
            else:
                keep.append(existing)
        keep.append(joined)
        merged = keep
    return tuple(frozenset(c) for c in merged)


@lru_cache(maxsize=2)
def _term_index(_key: tuple[str, int]) -> dict[str, frozenset[str]]:
    out: dict[str, frozenset[str]] = {}
    for cls in _classes(_mtime_key(_DATA)):
        for term in cls:
            out[term] = cls
    return out


def expand(term: str) -> set[str]:
    """All surface forms equivalent to ``term`` (including itself)."""
    if not term:
        return set()
    folded = normalize(term)
    cls = _term_index(_mtime_key(_DATA)).get(folded)
    return set(cls) | {folded, term} if cls else {folded, term}


def canonical(term: str) -> str:
    """Pick the canonical form (first declared in JSON)."""
    folded = normalize(term)
    cls = _term_index(_mtime_key(_DATA)).get(folded)
    if not cls:
        return folded
    cfg = _config()
    for section in ("shishen", "strength", "method", "phrases"):
        for canonical_form in (cfg.get(section) or {}).keys():
            if canonical_form in cls:
                return canonical_form
    return min(cls, key=lambda s: (len(s), s))


def expand_many(terms: Iterable[str]) -> set[str]:
    out: set[str] = set()
    for t in terms:
        out |= expand(t)
    return out


def book_label(key: str) -> str:
    return _config().get("book_labels", {}).get(key, key)


def synonyms_version() -> str:
    return str(_config().get("_version", "0"))


__all__ = [
    "normalize",
    "expand",
    "expand_many",
    "canonical",
    "book_label",
    "synonyms_version",
]
