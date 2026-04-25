"""GET /api/charts/:id/classics integration tests."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user


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


@pytest.mark.asyncio
async def test_classics_returns_retrieved_original_excerpts(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie, "古籍盘")

    r = await client.get(f"/api/charts/{cid}/classics", cookies={"session": cookie})
    assert r.status_code == 200

    body = r.json()
    assert "items" in body
    assert len(body["items"]) >= 1
    first = body["items"][0]
    assert set(first.keys()) == {"source", "scope", "chars", "text"}
    assert first["source"].startswith("穷通宝鉴")
    assert "###" not in first["source"]
    assert first["scope"] != "month"
    assert "###" not in first["text"]
    assert "✓" not in first["text"]
    assert "你的盘" not in first["text"]


@pytest.mark.asyncio
async def test_classics_unauthenticated_401(client):
    r = await client.get(f"/api/charts/{uuid.uuid4()}/classics")
    assert r.status_code == 401
