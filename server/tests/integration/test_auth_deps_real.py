"""Integration tests for app.auth.deps real implementations.

Exercises current_user / optional_user / require_admin / check_quota end-to-end
through the actual FastAPI app + testcontainers Postgres.
"""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture
async def client(database_url, monkeypatch):
    """Fresh client per test — forces lifespan / KEK / app.state.kek wiring.

    Also wires the app's module-level engine singleton to the testcontainers
    Postgres URL so get_db() dependencies resolve against the real DB.
    """
    import importlib
    import sys

    # Make sure any code path that re-reads settings sees the real DB URL.
    monkeypatch.setenv("DATABASE_URL", str(database_url))
    # "dev" env makes /api/auth/sms/send echo the OTP in the response (__devCode)
    # so the test can complete the register flow without scraping the DB.
    monkeypatch.setenv("ENV", "dev")

    cfg_mod = sys.modules.get("app.core.config")
    if cfg_mod is not None:
        importlib.reload(cfg_mod)

    # Reset the engine singleton — its next access will rebuild against the
    # reloaded settings.database_url (pointing at the testcontainer).
    from app.core import db as db_mod
    await db_mod.dispose_engine()

    main_mod = sys.modules.get("app.main")
    if main_mod is not None:
        importlib.reload(main_mod)
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        async with app.router.lifespan_context(app):
            yield c

    await db_mod.dispose_engine()


async def _register_and_get_cookie(client: AsyncClient, phone: str) -> tuple[str, dict]:
    """Helper: register user with dev SMS; returns (cookie_value, user_dict)."""
    # Seed an invite code via direct DB (we don't have admin routes yet).
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy import text
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        # Bootstrap user (creator of the invite code) with random phone.
        bootstrap_phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
        await s.execute(text("""
            INSERT INTO users (phone, phone_last4, dek_ciphertext, dek_key_version)
            VALUES (:phone, :last4, :ct, 1)
        """), {"phone": bootstrap_phone, "last4": bootstrap_phone[-4:],
                "ct": b"\x00" * 44})
        bootstrap_id = (await s.execute(text("""
            SELECT id FROM users WHERE phone=:p
        """), {"p": bootstrap_phone})).scalar_one()
        invite = f"INV-{uuid.uuid4().hex[:8].upper()}"
        await s.execute(text("""
            INSERT INTO invite_codes (code, created_by, max_uses) VALUES (:c, :u, 10)
        """), {"c": invite, "u": bootstrap_id})
        await s.commit()
    await engine.dispose()

    # 1. SMS send → dev code in response
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    assert r.status_code == 200, r.text
    code = r.json()["__devCode"]

    # 2. register
    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": invite,
        "nickname": "test", "agreed_to_terms": True,
    })
    assert r.status_code == 200, r.text
    cookie = r.cookies.get("session")
    assert cookie, "session cookie not set"
    user = r.json()["user"]
    return cookie, user


@pytest.mark.asyncio
async def test_current_user_blocks_no_cookie(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_current_user_blocks_bogus_cookie(client):
    r = await client.get("/api/auth/me", cookies={"session": "not-a-real-token"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "SESSION_INVALID"


@pytest.mark.asyncio
async def test_current_user_valid_cookie(client):
    cookie, user = await _register_and_get_cookie(client, "+8613811110001")
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 200
    assert r.json()["user"]["id"] == user["id"]
    assert r.json()["user"]["phone_last4"] == "0001"
    # phone full value must NOT appear
    assert "phone" not in r.json()["user"]


@pytest.mark.asyncio
async def test_phone_full_value_never_in_response(client):
    cookie, _ = await _register_and_get_cookie(client, "+8613811110002")
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert "+8613811110002" not in r.text
    assert "13811110002" not in r.text
