from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_admin_metrics_requires_token(client):
    resp = await client.get("/api/admin/metrics")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_metrics_rejects_wrong_token(client, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "admin_token", "realtoken")

    resp = await client.get("/api/admin/metrics", headers={"X-Admin-Token": "wrongtoken"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_metrics_returns_counts_and_rates(client, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "admin_token", "testtoken")

    # Seed events
    for evt in ["card_view", "card_view", "card_view", "card_share", "form_submit"]:
        await client.post("/api/track", json={
            "event": evt, "properties": {"type_id": "01"},
        })

    resp = await client.get(
        "/api/admin/metrics",
        headers={"X-Admin-Token": "testtoken"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Counts
    assert data["counts"]["card_view"] >= 3
    assert data["counts"]["card_share"] >= 1
    assert data["counts"]["form_submit"] >= 1
    # Rates (relative to card_view)
    assert "share_rate" in data
    assert "form_submit_rate" in data


@pytest.mark.asyncio
async def test_admin_metrics_empty_views_returns_zero_rate(client, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "admin_token", "testtoken")

    # No events sent — but other tests may have seeded events. Use a distant date window
    # to ensure we see 0 views (tests run quickly so "now - 1 year to now - 364 days" is safe).
    resp = await client.get(
        "/api/admin/metrics?from_=1990-01-01T00:00:00&to=1990-01-02T00:00:00",
        headers={"X-Admin-Token": "testtoken"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["share_rate"] == 0.0
    assert data["form_submit_rate"] == 0.0
