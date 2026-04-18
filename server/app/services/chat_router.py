"""Stage 1 router: keyword fast-path → LLM fallback. NOTE: spec §5.2."""
from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.client import chat_with_fallback
from app.llm.logs import insert_llm_usage_log
from app.models.user import User
from app.prompts.router import build_messages, classify_by_keywords, parse_router_json
from app.services.exceptions import UpstreamLLMError


async def classify(
    *, db: AsyncSession, user: User, chart_id: UUID,
    message: str, history: list[dict],
) -> dict:
    """Returns {intent, reason, source}. Logs llm_usage_logs row on LLM path."""
    routed = classify_by_keywords(message)
    if routed:
        return routed

    t_start = time.monotonic()
    model_used: str | None = None
    err: UpstreamLLMError | None = None
    parsed = {"intent": "other", "reason": "router_error"}

    try:
        text, model_used = await chat_with_fallback(
            messages=build_messages(history=history, user_message=message),
            tier="fast", temperature=0, max_tokens=800,
        )
        parsed = parse_router_json(text)
    except UpstreamLLMError as e:
        err = e

    duration_ms = int((time.monotonic() - t_start) * 1000)
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart_id,
        endpoint="chat:router", model=model_used,
        prompt_tokens=None,
        completion_tokens=None,
        duration_ms=duration_ms,
        error=(f"{err.code}: {err.message}" if err else None),
    )

    return {**parsed, "source": "llm"}
