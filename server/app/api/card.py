"""Card generation endpoint. Public (no auth). Writes a card_shares row per
generation for share-link preview + analytics."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.card_share import CardShare
from app.schemas.card import CardRequest, CardResponse
from app.services.card.loader import load_all
from app.services.card.payload import build_card_payload
from app.services.card.slug import birth_hash

router = APIRouter(prefix="/api", tags=["card"])


@router.post("/card", response_model=CardResponse)
async def post_card(
    req: CardRequest,
    db: AsyncSession = Depends(get_db),
) -> CardResponse:
    # Ensure JSON data is loaded (safe under normal startup; this is a safety net).
    load_all()

    payload = build_card_payload(req.birth, req.nickname)

    share = CardShare(
        slug=payload.share_slug,
        birth_hash=birth_hash(
            req.birth.year, req.birth.month, req.birth.day,
            req.birth.hour, req.birth.minute,
        ),
        type_id=payload.type_id,
        cosmic_name=payload.cosmic_name,
        suffix=payload.suffix,
        nickname=payload.nickname,
        user_id=None,  # MVP: always anonymous
    )
    db.add(share)
    # get_db auto-commits on success — no explicit db.commit() needed here.

    return payload
