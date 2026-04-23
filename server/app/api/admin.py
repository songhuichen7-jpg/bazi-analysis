"""Admin-protected metrics endpoint for K-factor / analytics monitoring."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.core.config as _config
from app.core.db import get_db
from app.models.event import Event

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def _require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    if not _config.settings.admin_token or x_admin_token != _config.settings.admin_token:
        raise HTTPException(status_code=401, detail="invalid admin token")


@router.get("/metrics", dependencies=[Depends(_require_admin)])
async def get_metrics(
    from_: Optional[datetime] = Query(default=None),
    to: Optional[datetime] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Event.event, func.count()).group_by(Event.event)
    if from_:
        stmt = stmt.where(Event.created_at >= from_)
    if to:
        stmt = stmt.where(Event.created_at < to)
    rows = (await db.execute(stmt)).all()
    counts = {event: int(n) for event, n in rows}

    views = counts.get("card_view", 0)
    shares = counts.get("card_share", 0)
    submits = counts.get("form_submit", 0)

    return {
        "counts": counts,
        "share_rate": (shares / views) if views else 0.0,
        "form_submit_rate": (submits / views) if views else 0.0,
    }
