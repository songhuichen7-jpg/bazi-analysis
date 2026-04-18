"""GET /api/quota."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user


@pytest.mark.asyncio
async def test_quota_unauthenticated_401(client):
    r = await client.get("/api/quota")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_quota_happy(client):
    cookie, user = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    r = await client.get("/api/quota", cookies={"session": cookie})
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "free"
    assert set(body["usage"].keys()) == {"chat_message","section_regen","verdicts_regen",
                                          "dayun_regen","liunian_regen","gua","sms_send"}
    for k, v in body["usage"].items():
        assert v["limit"] > 0
        assert "resets_at" in v
        # sms_send is charged once during registration; other kinds start at 0
        if k != "sms_send":
            assert v["used"] == 0


@pytest.mark.asyncio
async def test_quota_reflects_sms_usage(client):
    phone = f"+86139{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)
    r = await client.get("/api/quota", cookies={"session": cookie})
    body = r.json()
    assert body["usage"]["sms_send"]["used"] >= 1
