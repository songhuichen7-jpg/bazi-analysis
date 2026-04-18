"""Stage 1+2 orchestrator. NOTE: spec §5.

Pattern mirrors app.services.chart_llm.stream_chart_llm: commit-before-done.
"""
from __future__ import annotations

import time
from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.client import chat_stream_with_fallback
from app.llm.events import sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.user import User
from app.prompts import expert as prompts_expert
from app.retrieval.service import retrieve_for_chart
from app.services import message as msg_svc
from app.services.chat_router import classify
from app.services.exceptions import QuotaExceededError, UpstreamLLMError
from app.services.quota import QuotaTicket


async def stream_message(
    *, db: AsyncSession, user: User, conversation_id: UUID,
    chart, message: str, bypass_divination: bool,
    ticket: QuotaTicket,
) -> AsyncIterator[bytes]:
    """Generator yielding SSE-encoded bytes. NOTE: spec §5."""
    history = await msg_svc.recent_chat_history(db, conversation_id=conversation_id, limit=8)
    await msg_svc.insert(db, conversation_id=conversation_id, role="user", content=message)

    routed = await classify(
        db=db, user=user, chart_id=chart.id,
        message=message, history=history,
    )
    yield sse_pack({"type": "intent", "intent": routed["intent"],
                     "reason": routed["reason"], "source": routed["source"]})

    intent = routed["intent"]

    if intent == "divination" and not bypass_divination:
        await msg_svc.insert(db, conversation_id=conversation_id, role="cta",
                              content=None, meta={"question": message})
        yield sse_pack({"type": "redirect", "to": "gua", "question": message})
        try:
            await ticket.commit()
        except QuotaExceededError as e:
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
            return
        yield sse_pack({"type": "done", "full": ""})
        return

    effective_intent = "other" if intent == "divination" else intent

    if bypass_divination:
        await msg_svc.delete_last_cta(db, conversation_id=conversation_id)

    retrieved: list[dict] = []
    if effective_intent != "chitchat":
        try:
            retrieved = await retrieve_for_chart(chart.paipan, effective_intent)
        except Exception:  # noqa: BLE001 — retrieval is best-effort
            retrieved = []
    if retrieved:
        sources = " + ".join(h.get("source", "?") for h in retrieved)
        yield sse_pack({"type": "retrieval", "source": sources})

    messages_llm = prompts_expert.build_messages(
        paipan=chart.paipan, history=history,
        user_message=message, intent=effective_intent,
        retrieved=retrieved,
    )

    accumulator = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err: UpstreamLLMError | None = None

    try:
        async for ev in chat_stream_with_fallback(
            messages=messages_llm, tier="primary",
            temperature=0.7, max_tokens=5000,
            first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
        ):
            t = ev["type"]
            if t == "model":
                model_used = ev["modelUsed"]
                yield sse_pack(ev)
            elif t == "delta":
                accumulator += ev["text"]
                yield sse_pack(ev)
            elif t == "done":
                prompt_tok = ev.get("prompt_tokens", 0) or 0
                completion_tok = ev.get("completion_tokens", 0) or 0
                total_tok = ev.get("tokens_used", 0) or 0
    except UpstreamLLMError as e:
        err = e
        yield sse_pack({"type": "error", "code": e.code, "message": e.message})

    duration_ms = int((time.monotonic() - t_start) * 1000)

    if err is not None:
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="chat:expert", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"{err.code}: {err.message}",
        )
        return

    try:
        await ticket.commit()
    except QuotaExceededError as e:
        yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="chat:expert", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"QUOTA_EXCEEDED: {e}",
        )
        return

    await msg_svc.insert(
        db, conversation_id=conversation_id, role="assistant",
        content=accumulator,
        meta={
            "intent": effective_intent,
            "model_used": model_used,
            "retrieval_source": (
                " + ".join(h.get("source", "?") for h in retrieved) if retrieved else None
            ),
        },
    )
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart.id,
        endpoint="chat:expert", model=model_used,
        prompt_tokens=prompt_tok, completion_tokens=completion_tok,
        duration_ms=duration_ms,
    )
    yield sse_pack({"type": "done", "full": accumulator})
