"""app.prompts.anchor: build_classical_anchor(retrieved)."""
from __future__ import annotations


def test_build_classical_anchor_empty_returns_empty():
    from app.prompts.anchor import build_classical_anchor
    assert build_classical_anchor([]) == ""


def test_build_classical_anchor_single_hit():
    from app.prompts.anchor import build_classical_anchor
    hits = [{"source":"穷通","scope":"full","chars":300,"text":"甲木参天，脱胎要火。"}]
    out = build_classical_anchor(hits)
    assert "穷通" in out
    assert "甲木参天" in out


def test_build_classical_anchor_terse_shorter():
    from app.prompts.anchor import build_classical_anchor
    long_text = "食神制杀之格……" + ("详细释义" * 100)
    hits = [{"source":"三命","scope":"career","chars":len(long_text),"text":long_text}]
    full = build_classical_anchor(hits, terse=False)
    terse = build_classical_anchor(hits, terse=True)
    assert len(terse) <= len(full)
