"""Public tracking endpoint — anonymous event capture for K-factor analytics."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.event import Event
from app.schemas.tracking import TrackRequest

router = APIRouter(prefix="/api", tags=["tracking"])

_KNOWN_FIELDS = {
    "type_id", "channel", "from_", "share_slug",
    "anonymous_id", "session_id", "user_agent", "viewport",
}


@router.post("/track", status_code=204)
async def post_track(
    req: TrackRequest,
    db: AsyncSession = Depends(get_db),
) -> Response:
    props = req.properties
    # Everything beyond KNOWN_FIELDS goes into extra JSONB
    extra_dump = props.model_dump(by_alias=True, exclude={
        "type_id", "channel", "from_", "share_slug",
        "anonymous_id", "session_id", "user_agent", "viewport",
    })
    evt = Event(
        event=req.event,
        type_id=props.type_id,
        channel=props.channel,
        from_param=props.from_,
        share_slug=props.share_slug,
        anonymous_id=props.anonymous_id,
        session_id=props.session_id,
        user_id=None,
        user_agent=props.user_agent,
        viewport=props.viewport,
        extra=extra_dump or None,
    )
    db.add(evt)
    # get_db auto-commits
    return Response(status_code=204)
