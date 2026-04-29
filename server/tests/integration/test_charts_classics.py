"""GET /api/charts/:id/classics integration tests."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user
from app.retrieval2.types import RetrievalHit


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


async def _make(client, cookie, label=None):
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    }
    if label is not None:
        body["label"] = label
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    assert r.status_code == 201, r.text
    return r.json()["chart"]["id"]


@pytest.fixture(autouse=True)
def _stub_selector(monkeypatch):
    async def stub_select(chart, intents, user_msg, candidates, *, k=6,
                          max_candidates=30, timeout_seconds=20.0, policy_hint=""):
        return [
            RetrievalHit(claim=c.claim, tags=c.tags, score=c.fused_score, reason="stub")
            for c in list(candidates)[:k]
        ]

    monkeypatch.setattr("app.retrieval2.selector.select", stub_select)

    async def stub_polish(chart, items):
        out = []
        for item in items:
            quote = item["text"][:24].rstrip("，。") + "。"
            out.append({
                **item,
                "text": quote,
                "quote": quote,
                "plain": "整理后的古籍原意",
                "match": "本盘对应到这里",
                "original_text": item["text"],
                "chars": len(quote),
            })
        return out

    monkeypatch.setattr(
        "app.services.classics_polisher.polish_classics_for_chart",
        stub_polish,
    )


@pytest.mark.asyncio
async def test_classics_returns_polished_excerpts_with_original_anchor(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie, "古籍盘")

    r = await client.get(f"/api/charts/{cid}/classics", cookies={"session": cookie})
    assert r.status_code == 200

    body = r.json()
    assert "items" in body
    assert len(body["items"]) >= 1
    first = body["items"][0]
    assert {"source", "scope", "chars", "text", "quote", "plain", "match", "original_text"} <= set(first.keys())
    assert first["source"]
    assert "###" not in first["source"]
    assert first["scope"] != "month"
    assert not first["scope"].startswith("claim:")
    assert "###" not in first["text"]
    assert "✓" not in first["text"]
    assert "你的盘" not in first["text"]
    assert first["quote"] == first["text"]
    assert first["plain"] == "整理后的古籍原意"
    assert first["match"] == "本盘对应到这里"
    assert first["original_text"]


@pytest.mark.asyncio
async def test_classics_unauthenticated_401(client):
    r = await client.get(f"/api/charts/{uuid.uuid4()}/classics")
    assert r.status_code == 401
