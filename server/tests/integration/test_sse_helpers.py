"""Helpers for consuming SSE + stubbing openai client in integration tests."""
from __future__ import annotations

import json
from types import SimpleNamespace


def patch_llm_client(monkeypatch, prescribed: dict[str, list[str]],
                     *, raise_on_model: set[str] | None = None):
    """Replace app.llm.client._client.chat.completions.create with a stub.

    prescribed: {model_name: [delta1, delta2, ...]}.  Missing model → raises.
    raise_on_model: these model names raise to force fallback.
    """
    raise_on_model = raise_on_model or set()

    class _Chunk:
        def __init__(self, c):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=c),
                                             finish_reason=None)]
            self.usage = None

    class _Final:
        def __init__(self, tokens=30):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=""),
                                             finish_reason="stop")]
            self.usage = SimpleNamespace(
                prompt_tokens=tokens // 3,
                completion_tokens=tokens - tokens // 3,
                total_tokens=tokens,
            )

    async def _create(*, model, stream, **kw):
        assert stream is True
        if model in raise_on_model:
            raise RuntimeError(f"forced failure on {model}")
        if model not in prescribed:
            raise RuntimeError(f"no prescribed output for model {model}")
        chunks = prescribed[model]
        async def _gen():
            for d in chunks:
                yield _Chunk(d)
            yield _Final()
        return _gen()

    from app.llm import client as c
    monkeypatch.setattr(c._client.chat.completions, "create", _create)


async def consume_sse(client, url, *, cookies=None, json_body=None):
    """httpx AsyncClient streaming GET/POST; parse `data: {json}\\n\\n` events."""
    events = []
    method = "POST" if json_body is not None else "GET"
    async with client.stream(method, url, cookies=cookies or {}, json=json_body) as r:
        assert r.status_code == 200, await r.aread()
        buf = ""
        async for chunk in r.aiter_text():
            buf += chunk
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                if frame.startswith("data: "):
                    events.append(json.loads(frame[len("data: "):]))
    return events
