"""services/conversation_chat: orchestrator (Stage 1+2 + persistence + quota)."""
from __future__ import annotations

import json
import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db_types import user_dek_context
from app.services import conversation as conv_svc
from app.services import conversation_chat as cc
from app.services import message as msg_svc
from app.services.exceptions import UpstreamLLMError
from app.services.quota import QuotaTicket


pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            maker = async_sessionmaker(bind=conn, expire_on_commit=False)
            async with maker() as session:
                yield session
            await trans.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def user_and_dek(db_session):
    from app.models.user import User
    dek = os.urandom(32)
    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    return u, dek


async def _make_chart(db_session, user, label=None):
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=12, gender="male"),
        label=label,
    )
    return (await chart_service.create_chart(db_session, user, req))[0]


async def _consume(gen) -> list[dict]:
    out = []
    async for raw in gen:
        line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        for chunk in line.split("\n\n"):
            chunk = chunk.strip()
            if chunk.startswith("data: "):
                out.append(json.loads(chunk[len("data: "):]))
    return out


def _fake_classify(intent="other", reason="ok", source="keyword"):
    async def _f(**_):
        return {"intent": intent, "reason": reason, "source": source}
    return _f


def _fake_stream_factory(deltas, tokens=42, model="mimo-v2-pro"):
    async def _f(**kwargs):
        yield {"type": "model", "modelUsed": model}
        for d in deltas:
            yield {"type": "delta", "text": d}
        yield {"type": "done", "tokens_used": tokens,
               "prompt_tokens": tokens // 3,
               "completion_tokens": tokens - tokens // 3}
    return _f


def _fake_stream_factory_error(err):
    async def _f(**kwargs):
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        raise err
        yield  # noqa
    return _f


async def test_normal_flow_writes_user_then_assistant(monkeypatch, db_session, user_and_dek):
    user, dek = user_and_dek
    with user_dek_context(dek):
        chart = await _make_chart(db_session, user)
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.flush()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="career", source="keyword"))
        monkeypatch.setattr("app.services.conversation_chat.chat_stream_with_fallback",
                             _fake_stream_factory(["你好", "世界"]))
        async def _no_retr(*a, **kw):
            return []
        monkeypatch.setattr("app.services.conversation_chat.retrieve_for_chart", _no_retr)

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="我想换工作", bypass_divination=False,
            ticket=ticket,
        ))
        await db_session.flush()

        types = [e["type"] for e in events]
        assert types[0] == "intent"
        assert "model" in types and "delta" in types
        assert types[-1] == "done"

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["assistant", "user"]
        assert page["items"][0].content == "你好世界"


async def test_divination_writes_cta_and_redirects(monkeypatch, db_session, user_and_dek):
    user, dek = user_and_dek
    with user_dek_context(dek):
        chart = await _make_chart(db_session, user)
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.flush()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="divination", source="keyword"))

        async def _boom_expert(**_):
            raise AssertionError("expert should not run on divination redirect")
            yield  # noqa
        monkeypatch.setattr("app.services.conversation_chat.chat_stream_with_fallback",
                             _boom_expert)

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="我能不能买这个房", bypass_divination=False,
            ticket=ticket,
        ))
        await db_session.flush()

        types = [e["type"] for e in events]
        assert "redirect" in types
        assert types[-1] == "done"

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["cta", "user"]
        assert page["items"][0].meta == {"question": "我能不能买这个房"}


async def test_bypass_divination_consumes_existing_cta(monkeypatch, db_session, user_and_dek):
    user, dek = user_and_dek
    with user_dek_context(dek):
        chart = await _make_chart(db_session, user)
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.flush()
        await msg_svc.insert(db_session, conversation_id=c.id, role="cta",
                              content=None, meta={"question": "old"})
        await db_session.flush()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="divination", source="keyword"))
        monkeypatch.setattr("app.services.conversation_chat.chat_stream_with_fallback",
                             _fake_stream_factory(["分", "析"]))
        async def _no_retr(*a, **kw):
            return []
        monkeypatch.setattr("app.services.conversation_chat.retrieve_for_chart", _no_retr)

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="还是直接分析吧", bypass_divination=True,
            ticket=ticket,
        ))
        await db_session.flush()

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert "cta" not in roles
        assert "assistant" in roles


async def test_llm_error_keeps_user_msg_no_assistant(monkeypatch, db_session, user_and_dek):
    user, dek = user_and_dek
    with user_dek_context(dek):
        chart = await _make_chart(db_session, user)
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.flush()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="career"))
        monkeypatch.setattr(
            "app.services.conversation_chat.chat_stream_with_fallback",
            _fake_stream_factory_error(UpstreamLLMError(code="UPSTREAM_LLM_TIMEOUT", message="t/o")),
        )
        async def _no_retr(*a, **kw):
            return []
        monkeypatch.setattr("app.services.conversation_chat.retrieve_for_chart", _no_retr)

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="问问事业", bypass_divination=False,
            ticket=ticket,
        ))
        await db_session.flush()

        types = [e["type"] for e in events]
        assert types[-1] == "error"

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["user"]
