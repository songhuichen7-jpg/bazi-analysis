"""Integration tests for POST /api/auth/guest."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_guest_login_creates_dev_session_and_user(client):
    r = await client.post("/api/auth/guest")
    assert r.status_code == 200
    assert r.cookies.get("session") is not None

    body = r.json()
    assert body["user"]["nickname"] == "游客"
    assert body["user"]["phone_last4"]

    me = await client.get("/api/auth/me", cookies={"session": r.cookies.get("session")})
    assert me.status_code == 200
    assert me.json()["user"]["id"] == body["user"]["id"]


@pytest.mark.asyncio
async def test_guest_login_hidden_outside_dev(client, monkeypatch):
    import app.api.auth as auth_api

    monkeypatch.setattr(auth_api.settings, "env", "prod")

    r = await client.post("/api/auth/guest")
    assert r.status_code == 404
