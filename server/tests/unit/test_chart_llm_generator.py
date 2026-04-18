"""chart_llm.stream_chart_llm: end-to-end generator with mocked LLM client."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            maker = async_sessionmaker(bind=conn, expire_on_commit=False)
            async with maker() as s:
                yield s
            await trans.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def seeded(db_session):
    from app.db_types import user_dek_context
    from app.models.chart import Chart
    from app.models.user import User
    dek = os.urandom(32)
    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u); await db_session.flush()
    with user_dek_context(dek):
        c = Chart(
            user_id=u.id,
            birth_input={"year":1990,"month":5,"day":12,"hour":12,"gender":"male"},
            paipan={"sizhu":{"year":"庚午"}, "hourUnknown":False},
            engine_version="0.1.0",
        )
        db_session.add(c); await db_session.flush()
    return u, c, dek


def _fake_stream_fn(chunks: list[str], tokens: int = 30):
    """Replacement for chat_stream_with_fallback — yields prescribed events."""
    async def _stream(**kwargs):
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        for c in chunks:
            yield {"type": "delta", "text": c}
        yield {"type": "done", "full": "".join(chunks), "tokens_used": tokens,
               "prompt_tokens": 10, "completion_tokens": tokens - 10}
    return _stream


def _fake_build_messages(chart, retrieved, **kw):
    return [{"role":"system","content":"test"}, {"role":"user","content":"do it"}]


async def _fake_retrieve(chart, kind):
    return []


@pytest.mark.asyncio
async def test_stream_chart_llm_cache_miss_generates_and_writes(db_session, seeded, monkeypatch):
    from app.db_types import user_dek_context
    from app.services import chart_llm
    monkeypatch.setattr(chart_llm, "chat_stream_with_fallback",
                        _fake_stream_fn(["hello ", "world"], tokens=42))
    monkeypatch.setattr(chart_llm, "retrieve_for_chart", _fake_retrieve)

    user, chart, dek = seeded
    with user_dek_context(dek):
        events = []
        async for raw in chart_llm.stream_chart_llm(
            db_session, user, chart,
            kind="verdicts", key="", force=False, cache_row=None, ticket=None,
            build_messages=_fake_build_messages,
            retrieval_kind="meta",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            events.append(raw)
        await db_session.flush()
        row = await chart_llm.get_cache_row(db_session, chart.id, "verdicts", "")
    assert row is not None
    assert row.content == "hello world"
    assert row.regen_count == 0


@pytest.mark.asyncio
async def test_stream_chart_llm_cache_hit_replays_without_llm(db_session, seeded, monkeypatch):
    from app.db_types import user_dek_context
    from app.services import chart_llm

    user, chart, dek = seeded
    with user_dek_context(dek):
        await chart_llm.upsert_cache(db_session,
            chart_id=chart.id, kind="verdicts", key="",
            content="cached content", model_used="mimo-v2-pro",
            tokens_used=50, regen_increment=False)
        await db_session.flush()
        cache_row = await chart_llm.get_cache_row(db_session, chart.id, "verdicts", "")

    def _boom(**kw): raise AssertionError("LLM should not be called on cache hit")
    monkeypatch.setattr(chart_llm, "chat_stream_with_fallback", _boom)

    with user_dek_context(dek):
        events = []
        async for raw in chart_llm.stream_chart_llm(
            db_session, user, chart,
            kind="verdicts", key="", force=False,
            cache_row=cache_row, ticket=None,
            build_messages=_fake_build_messages,
            retrieval_kind="meta",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            events.append(raw)
    assert any(b'"source":"cache"' in e for e in events)


@pytest.mark.asyncio
async def test_stream_chart_llm_upstream_error_no_cache_write(db_session, seeded, monkeypatch):
    from app.db_types import user_dek_context
    from app.services import chart_llm
    from app.services.exceptions import UpstreamLLMError

    async def _erroring(**kw):
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        raise UpstreamLLMError(code="UPSTREAM_LLM_FAILED", message="boom")

    monkeypatch.setattr(chart_llm, "chat_stream_with_fallback", _erroring)
    monkeypatch.setattr(chart_llm, "retrieve_for_chart", _fake_retrieve)

    user, chart, dek = seeded
    with user_dek_context(dek):
        events = []
        async for raw in chart_llm.stream_chart_llm(
            db_session, user, chart,
            kind="verdicts", key="", force=False, cache_row=None, ticket=None,
            build_messages=_fake_build_messages, retrieval_kind="meta",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            events.append(raw)
        await db_session.flush()
        row = await chart_llm.get_cache_row(db_session, chart.id, "verdicts", "")
    assert row is None
    assert any(b'"type":"error"' in e for e in events)
