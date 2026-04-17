"""POST /api/charts integration tests."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


@pytest.mark.asyncio
async def test_create_happy(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 14,
                "minute": 30, "city": "北京", "gender": "male",
            },
            "label": "测试盘",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["chart"]["label"] == "测试盘"
    assert "sizhu" in body["chart"]["paipan"]
    assert body["cache_slots"] == []
    assert body["cache_stale"] is False
    import paipan
    assert body["chart"]["engine_version"] == paipan.VERSION


@pytest.mark.asyncio
async def test_create_unauthenticated_401(client):
    r = await client.post("/api/charts", json={
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    })
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_hour_minus_one_ok(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": -1, "gender": "female"},
        },
    )
    assert r.status_code == 201
    assert r.json()["chart"]["paipan"]["hourUnknown"] is True


@pytest.mark.asyncio
async def test_create_hour_out_of_range_422(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 99, "gender": "male"},
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_unknown_city_yields_warning(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 12,
                "city": "ZZZZ未知", "gender": "male",
            },
        },
    )
    assert r.status_code == 201
    assert any("未识别城市" in w for w in r.json()["warnings"])


@pytest.mark.asyncio
async def test_create_city_canonicalized(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 12,
                "city": "北京市", "gender": "male",
            },
        },
    )
    assert r.status_code == 201
    from paipan.cities import get_city_coords
    expected = get_city_coords("北京市").canonical
    assert r.json()["chart"]["birth_input"]["city"] == expected


@pytest.mark.asyncio
async def test_create_label_null_ok(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
        },
    )
    assert r.status_code == 201
    assert r.json()["chart"]["label"] is None


@pytest.mark.asyncio
async def test_create_16th_returns_409(client):
    cookie, _ = await _register(client)
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    }
    for _ in range(15):
        r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
        assert r.status_code == 201
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    assert r.status_code == 409
    err = r.json()["detail"]
    assert err["code"] == "CHART_LIMIT_EXCEEDED"
    assert err["details"]["limit"] == 15


@pytest.mark.asyncio
async def test_create_cross_user_isolation(client):
    cookie_a, _ = await _register(client)
    cookie_b, _ = await _register(client)
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
        "label": "A盘",
    }
    r1 = await client.post("/api/charts", cookies={"session": cookie_a}, json=body)
    assert r1.status_code == 201
    chart_id = r1.json()["chart"]["id"]

    r2 = await client.get(f"/api/charts/{chart_id}", cookies={"session": cookie_b})
    assert r2.status_code == 404
    assert r2.json()["detail"]["code"] == "CHART_NOT_FOUND"
