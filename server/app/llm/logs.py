"""Fire-and-forget-ish llm_usage_logs writer.

Writes are synchronous (called at end of SSE generator, after yield done),
but wrapped in try/except so DB issues never break the user-facing response.
"""
from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_log = logging.getLogger(__name__)


async def insert_llm_usage_log(
    db: AsyncSession,
    *,
    user_id: UUID,
    chart_id: UUID | None,
    endpoint: str,
    model: str | None,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    duration_ms: int,
    error: str | None = None,
) -> None:
    """INSERT into llm_usage_logs; swallow DB errors with logger.warning."""
    try:
        await db.execute(text("""
            INSERT INTO llm_usage_logs
                (user_id, chart_id, endpoint, model,
                 prompt_tokens, completion_tokens, duration_ms,
                 intent, error, created_at)
            VALUES (:uid, :cid, :ep, :mdl, :pt, :ct, :dms, NULL, :err, now())
        """), {
            "uid": user_id, "cid": chart_id, "ep": endpoint,
            "mdl": model or "",  # DB column is NOT NULL; empty string = unknown model
            "pt": prompt_tokens or 0, "ct": completion_tokens or 0,
            "dms": duration_ms, "err": error,
        })
    except Exception as e:  # noqa: BLE001 — intentional broad catch; see spec §0.3 #9
        _log.warning("llm_usage_logs insert failed: %s", e)
