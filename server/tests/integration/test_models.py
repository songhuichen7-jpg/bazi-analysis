"""Per-model smoke: INSERT one row, SELECT it back.

Encrypted fields use LargeBinary placeholders in this task (Task 11 swaps
them to EncryptedText/JSONB).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    async with engine.connect() as conn:
        trans = await conn.begin()
        session_maker = async_sessionmaker(bind=conn, expire_on_commit=False)
        async with session_maker() as session:
            yield session
        await trans.rollback()
    await engine.dispose()


async def test_insert_user(db_session: AsyncSession):
    from app.models import User
    u = User(phone="+8613800000001", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    assert u.id is not None
    assert u.status == "active"
    assert u.role == "user"
    assert u.plan == "free"


async def test_insert_chart_with_fk_user(db_session: AsyncSession):
    from app.models import User, Chart
    u = User(phone="+8613800000002", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()

    c = Chart(
        user_id=u.id,
        birth_input=b"{}",
        paipan=b"{}",
        engine_version="0.1.0",
    )
    db_session.add(c)
    await db_session.flush()
    assert c.id is not None


async def test_cascade_delete_messages(db_session: AsyncSession):
    from sqlalchemy import delete, select
    from app.models import User, Chart, Conversation, Message

    u = User(phone="+8613800000003", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    c = Chart(user_id=u.id, birth_input=b"{}", paipan=b"{}", engine_version="0.1.0")
    db_session.add(c)
    await db_session.flush()
    conv = Conversation(chart_id=c.id)
    db_session.add(conv)
    await db_session.flush()
    m = Message(conversation_id=conv.id, role="user", content=b"hi")
    db_session.add(m)
    await db_session.flush()
    message_id = m.id

    await db_session.execute(delete(Conversation).where(Conversation.id == conv.id))
    await db_session.flush()

    found = await db_session.execute(select(Message).where(Message.id == message_id))
    assert found.scalar_one_or_none() is None


async def test_unique_chart_cache_slot(db_session: AsyncSession):
    from sqlalchemy.exc import IntegrityError
    from app.models import User, Chart, ChartCache

    u = User(phone="+8613800000004", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    c = Chart(user_id=u.id, birth_input=b"{}", paipan=b"{}", engine_version="0.1.0")
    db_session.add(c)
    await db_session.flush()

    cc1 = ChartCache(chart_id=c.id, kind="section", key="career")
    db_session.add(cc1)
    await db_session.flush()

    cc2 = ChartCache(chart_id=c.id, kind="section", key="career")
    db_session.add(cc2)
    with pytest.raises(IntegrityError):
        await db_session.flush()
