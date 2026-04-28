"""OpenAI-compatible LLM client — AsyncOpenAI wrapper with fallback + first-delta timeout.

Port of archive/server-mvp/llm.js. Uses openai-python SDK for transport;
fallback + timeout semantics are our concern (SDK retry is disabled).

Events yielded from chat_stream_with_fallback:
    {"type":"model", "modelUsed":<model>}          (on first delta; again on fallback)
    {"type":"delta", "text":<chunk>}               × N
    {"type":"done",  "full":<str>, "tokens_used":<int>,
                     "prompt_tokens":<int>, "completion_tokens":<int>}

Both primary + fallback failure → raises UpstreamLLMError.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Literal

from openai import AsyncOpenAI

from app.core.config import settings
from app.services.exceptions import UpstreamLLMError

_log = logging.getLogger(__name__)

# NOTE: max_retries=0 — fallback semantics require we control retry ourselves.
# api_key falls back to a dummy value so module import doesn't crash in test envs
# where the LLM API key isn't set (integration tests monkeypatch _client directly).
_client = AsyncOpenAI(
    api_key=settings.llm_api_key or "dummy-for-test",
    base_url=settings.llm_base_url,
    max_retries=0,
)


def _primary_for_tier(tier: Literal["primary", "fast"]) -> str:
    # NOTE: llm.js:29 — tier routing
    return settings.llm_fast_model if tier == "fast" else settings.llm_model


def _fallback_for_tier(tier: Literal["primary", "fast"]) -> str | None:
    # For fast tier, no further fallback (fast IS already the fallback).
    return settings.llm_fallback_model if tier == "primary" else None


async def _run_one_model(
    model: str,
    *,
    messages,
    temperature,
    max_tokens,
    first_delta_timeout_ms: int | None,
) -> AsyncIterator[dict]:
    """Stream a single model. Yields model → delta* → done events.

    Raises UpstreamLLMError if stream ends with zero deltas or first-delta timeout.
    Lets other exceptions (openai APIError / connection / etc.) propagate for
    the outer fallback handler.
    """
    stream = await _client.chat.completions.create(
        model=model, messages=messages, stream=True,
        temperature=temperature, max_tokens=max_tokens,
    )

    first_delta_seen = False
    accumulated = ""
    prompt_tok = completion_tok = total_tok = 0

    async def _iter_stream():
        nonlocal first_delta_seen, accumulated, prompt_tok, completion_tok, total_tok
        async for chunk in stream:
            u = getattr(chunk, "usage", None)
            if u is not None:
                prompt_tok = int(getattr(u, "prompt_tokens", 0) or 0)
                completion_tok = int(getattr(u, "completion_tokens", 0) or 0)
                total_tok = int(getattr(u, "total_tokens", 0) or 0)
            if not getattr(chunk, "choices", None):
                continue
            delta = chunk.choices[0].delta
            text = getattr(delta, "content", None) or ""
            if not text:
                continue
            first_delta_seen = True
            accumulated += text
            yield {"type": "delta", "text": text}

    it = _iter_stream().__aiter__()

    # First delta: optionally race against timeout.
    try:
        if first_delta_timeout_ms and first_delta_timeout_ms > 0:
            first = await asyncio.wait_for(
                it.__anext__(), timeout=first_delta_timeout_ms / 1000.0,
            )
        else:
            first = await it.__anext__()
    except StopAsyncIteration as e:
        raise UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED",
            message=f"{model} stream ended empty",
        ) from e
    except asyncio.TimeoutError as e:
        raise UpstreamLLMError(
            code="UPSTREAM_LLM_TIMEOUT",
            message=f"{model} first delta timeout",
        ) from e

    yield {"type": "model", "modelUsed": model}
    yield first
    async for ev in it:
        yield ev

    yield {
        "type": "done",
        "full": accumulated,
        "tokens_used": total_tok,
        "prompt_tokens": prompt_tok,
        "completion_tokens": completion_tok,
    }


async def chat_stream_with_fallback(
    *,
    messages,
    tier: Literal["primary", "fast"] = "primary",
    temperature: float,
    max_tokens: int,
    first_delta_timeout_ms: int | None = None,
) -> AsyncIterator[dict]:
    """Stream primary; on failure / empty / first-delta-timeout, switch to fallback.

    Re-raises UpstreamLLMError if both primary and fallback fail (or no fallback).
    """
    primary = _primary_for_tier(tier)
    fallback = _fallback_for_tier(tier)

    primary_fail: UpstreamLLMError | None = None
    try:
        async for ev in _run_one_model(
            primary, messages=messages, temperature=temperature,
            max_tokens=max_tokens, first_delta_timeout_ms=first_delta_timeout_ms,
        ):
            yield ev
        return
    except UpstreamLLMError as e:
        primary_fail = e
    except Exception as e:  # noqa: BLE001 — SDK errors (APIError, timeout, etc.)
        primary_fail = UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED", message=f"{primary}: {e}",
        )
        _log.warning("primary %s failed: %s", primary, e)

    if fallback is None:
        raise primary_fail

    try:
        async for ev in _run_one_model(
            fallback, messages=messages, temperature=temperature,
            max_tokens=max_tokens, first_delta_timeout_ms=None,  # no retry timeout on fallback
        ):
            yield ev
    except UpstreamLLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED", message=f"{fallback}: {e}",
        ) from e


async def chat_with_fallback(
    *,
    messages,
    tier: Literal["primary", "fast"] = "primary",
    temperature: float,
    max_tokens: int,
) -> tuple[str, str]:
    """Non-streaming helper — returns (text, model_used). Plan 5 uses streaming
    version directly; this is provided for Plan 6 reuse."""
    full = ""
    model_used = ""
    async for ev in chat_stream_with_fallback(
        messages=messages, tier=tier,
        temperature=temperature, max_tokens=max_tokens,
    ):
        if ev["type"] == "model":
            model_used = ev["modelUsed"]
        elif ev["type"] == "delta":
            full += ev["text"]
    return full, model_used


def _completion_content(response) -> str:
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    return str(getattr(message, "content", None) or "")


async def _run_one_model_once(
    model: str,
    *,
    messages,
    temperature,
    max_tokens,
    disable_thinking: bool,
) -> str:
    kwargs = {
        "model": model,
        "messages": messages,
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if disable_thinking:
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    response = await _client.chat.completions.create(**kwargs)
    text = _completion_content(response).strip()
    if not text:
        raise UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED",
            message=f"{model} returned empty content",
        )
    return text


async def chat_once_with_fallback(
    *,
    messages,
    tier: Literal["primary", "fast"] = "primary",
    temperature: float,
    max_tokens: int,
    disable_thinking: bool = True,
) -> tuple[str, str]:
    """Non-streaming helper for short structured tasks.

    DeepSeek V4 defaults to thinking mode, where reasoning tokens count toward
    max_tokens and can leave JSON tasks with empty final content. Callers that
    need deeper deliberation can pass disable_thinking=False and raise token
    budget.
    """
    primary = _primary_for_tier(tier)
    fallback = _fallback_for_tier(tier)

    primary_fail: UpstreamLLMError | None = None
    try:
        return (
            await _run_one_model_once(
                primary,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                disable_thinking=disable_thinking,
            ),
            primary,
        )
    except UpstreamLLMError as e:
        primary_fail = e
    except Exception as e:  # noqa: BLE001
        primary_fail = UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED",
            message=f"{primary}: {e}",
        )
        _log.warning("primary %s failed: %s", primary, e)

    if fallback is None:
        raise primary_fail

    try:
        return (
            await _run_one_model_once(
                fallback,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                disable_thinking=disable_thinking,
            ),
            fallback,
        )
    except UpstreamLLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED",
            message=f"{fallback}: {e}",
        ) from e
