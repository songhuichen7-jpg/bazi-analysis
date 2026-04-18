"""Message insert + keyset pagination + helpers used by chat/gua orchestrators."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Message
from app.schemas.message import MessageDetail


async def insert(
    db: AsyncSession, *,
    conversation_id: UUID, role: str,
    content: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> Message:
    """INSERT a message row. Caller commits.

    created_at is set from the Python wall-clock (not PostgreSQL's now()) so
    that messages inserted in rapid succession within the same DB transaction
    still have strictly increasing timestamps for reliable ORDER BY.
    """
    m = Message(
        conversation_id=conversation_id,
        role=role, content=content, meta=meta,
        created_at=datetime.now(tz=timezone.utc),
    )
    db.add(m)
    await db.flush()
    await db.refresh(m, ["created_at", "id"])
    return m


def _to_detail(m: Message) -> MessageDetail:
    return MessageDetail(
        id=m.id, role=m.role, content=m.content, meta=m.meta,
        created_at=m.created_at,
    )


async def paginate(
    db: AsyncSession, *,
    conversation_id: UUID,
    before: Optional[UUID],
    limit: int,
) -> dict:
    """Newest-first keyset pagination. NOTE: spec §4.3.

    Returns {"items": [Message...], "next_cursor": UUID|None}.

    next_cursor is the id of the last item in the current page; pass it as
    ``before`` to fetch the next (older) page. None means no more pages.
    """
    if limit < 1 or limit > 100:
        raise ValueError(f"limit must be in [1, 100], got {limit}")

    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before is not None:
        # Resolve cursor row to (created_at, id) tuple
        cursor_row = (await db.execute(
            select(Message.created_at, Message.id).where(Message.id == before)
        )).one_or_none()
        if cursor_row is None:
            # Cursor refers to a non-existent message — treat as fresh page
            pass
        else:
            c_at, c_id = cursor_row
            stmt = stmt.where(
                (Message.created_at < c_at) |
                ((Message.created_at == c_at) & (Message.id < c_id))
            )

    stmt = stmt.order_by(desc(Message.created_at), desc(Message.id)).limit(limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].id if has_more and items else None
    return {"items": [_to_detail(m) for m in items], "next_cursor": next_cursor}


async def recent_chat_history(
    db: AsyncSession, *, conversation_id: UUID, limit: int = 8,
) -> list[dict]:
    """Last N user/assistant messages in chronological order, dict-shaped for prompts.

    Used by chat (limit=8), router (limit=4), chips (limit=6).
    """
    stmt = (
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role.in_(["user", "assistant"]),
        )
        .order_by(desc(Message.created_at), desc(Message.id))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    rows.reverse()  # chronological
    return [{"role": m.role, "content": m.content or ""} for m in rows]


async def delete_last_cta(
    db: AsyncSession, *, conversation_id: UUID,
) -> Optional[UUID]:
    """Atomic DELETE of the most recent role='cta' row. Returns deleted id or None.

    Used by chat (bypass_divination=True) and gua (consume on cast). Caller commits.
    NOTE: spec §5.4 / §6.1 step 10.
    """
    stmt = (
        select(Message.id)
        .where(Message.conversation_id == conversation_id, Message.role == "cta")
        .order_by(desc(Message.created_at), desc(Message.id))
        .limit(1)
    )
    last_id = (await db.execute(stmt)).scalar_one_or_none()
    if last_id is None:
        return None
    await db.execute(
        Message.__table__.delete().where(Message.id == last_id)
    )
    return last_id
