"""app.retrieval.service.retrieve_for_chart: kind-routed classical retrieval."""
from __future__ import annotations

import pytest

from tests.unit._chart_fixtures import sample_chart


@pytest.mark.asyncio
async def test_retrieve_for_chart_meta_returns_list():
    from app.retrieval.service import retrieve_for_chart
    hits = await retrieve_for_chart(sample_chart(), "meta")
    assert isinstance(hits, list)
    for h in hits:
        assert "source" in h and "scope" in h and "chars" in h and "text" in h
        assert h["chars"] > 0


@pytest.mark.asyncio
async def test_retrieve_for_chart_section_career():
    from app.retrieval.service import retrieve_for_chart
    hits = await retrieve_for_chart(sample_chart(), "section:career")
    assert isinstance(hits, list)


@pytest.mark.asyncio
async def test_retrieve_for_chart_budget_respected():
    from app.retrieval.service import retrieve_for_chart, TOTAL_MAX
    hits = await retrieve_for_chart(sample_chart(), "meta")
    total = sum(h["chars"] for h in hits)
    assert total <= TOTAL_MAX


@pytest.mark.asyncio
async def test_retrieve_for_chart_unknown_kind_empty():
    from app.retrieval.service import retrieve_for_chart
    hits = await retrieve_for_chart(sample_chart(), "zzz_unknown_kind")
    assert hits == []


@pytest.mark.asyncio
async def test_retrieve_for_chart_meta_formats_qiongtong_hit_for_display():
    from app.retrieval.service import retrieve_for_chart

    hits = await retrieve_for_chart(sample_chart(), "meta")

    assert hits
    first = hits[0]
    assert first["source"] == "穷通宝鉴 · 三夏庚金"
    assert first["scope"] == "四月庚金"
    assert "###" not in first["text"]
    assert first["text"].startswith("四月庚金，")
