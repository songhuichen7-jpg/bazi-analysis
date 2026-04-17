"""Integration tests for GET /api/auth/me + rolling session expiry."""
from __future__ import annotations

import asyncio
import hashlib
import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .conftest import register_user


@pytest.mark.asyncio
async def test_me_returns_current_user(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, user = await register_user(client, phone)
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["id"] == user["id"]
    assert body["quota_snapshot"] == {}


@pytest.mark.asyncio
async def test_me_requires_cookie(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_refreshes_expires_at(client):
    """Rolling: each /me call slides expires_at forward."""
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)

    token_hash = hashlib.sha256(cookie.encode()).hexdigest()
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        exp_before = (await s.execute(text("""
            SELECT expires_at FROM sessions WHERE token_hash=:h
        """), {"h": token_hash})).scalar_one()

    await asyncio.sleep(1)
    await client.get("/api/auth/me", cookies={"session": cookie})

    async with maker() as s:
        exp_after = (await s.execute(text("""
            SELECT expires_at FROM sessions WHERE token_hash=:h
        """), {"h": token_hash})).scalar_one()
    await engine.dispose()

    assert exp_after > exp_before
