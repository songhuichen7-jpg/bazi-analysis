# Chart LLM SSE + Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 4 的 chart CRUD 之上接入 MiMo LLM（OpenAI-compatible），落地 5 个 chart-scoped SSE 路由（verdicts/sections/dayun/liunian/chips）+ `/api/quota` 快照 + `/api/charts/:id/recompute` + cache 命中 replay + force 重生扣配额机制。

**Architecture:** 五层分离：`app/llm/` LLM client + SSE events + 日志；`app/prompts/` 按 builder 拆 9 个小文件（loader/context/anchor 共享 + 5 个 kind builder）；`app/retrieval/` 古籍检索逐行移植 MVP `retrieval.js`；`app/services/chart_llm.py` 统一 cache-aware SSE generator 给 4 个路由共享；`app/api/charts.py` 薄路由 + StreamingResponse。错误码 404/422/429 所有在 StreamingResponse 之前 raise；LLM 错误走 SSE in-band error event。

**Tech Stack:** Python 3.12 · FastAPI · SQLAlchemy 2.0 async · asyncpg · openai-python ≥1.40（MiMo base_url）· pydantic v2 · pytest + testcontainers · `@lru_cache` 懒加载

---

## 设计约束（每一 task 必须遵守）

1. **TDD**：红 → 绿 → 提交；每个 task 必须 commit + 全绿
2. **端口纪律**：移植 MVP JS 文件时每函数附 `# NOTE: <file>.js:<line-range>` 注释；中文 prompt 文本逐字符照抄
3. **Plan 2-4 不碰**：`auth/*`、`sessions`、`paipan_adapter`、`services/chart.py` 的既有方法、`models/*`、`alembic/*` 一行不动（`chart.py` 只追加 `recompute`）
4. **所有 4xx 错误在 StreamingResponse 之前 raise** —— 一旦 SSE 200 发出无法改 status
5. **`openai` SDK 禁用重试**：`AsyncOpenAI(max_retries=0)`；fallback 自己控
6. **owner 校验每个 chart-scoped 路由首件事**：`chart_service.get_chart(db, user, chart_id)` —— 跨用户 / 不存在 / 软删 统一 404 防枚举
7. **SSE wire format 严格对齐 MVP**：`data: {json}\n\n` + `type` 字段；cache 回放加 `source: 'cache'`
8. **集成测试 monkeypatch** `app.llm.client._client` 成假 `AsyncOpenAI`，不打真 LLM
9. **`auth/deps.py` 不改** —— DEK contextvar reset 的 Plan 4 遗留项留到后续 plan
10. **`# NOTE: spec §<n>`** 注释关键决定出处

## 目录最终形态

```
server/
├── app/
│   ├── llm/                       # ← NEW
│   │   ├── __init__.py
│   │   ├── client.py
│   │   ├── events.py
│   │   └── logs.py
│   ├── prompts/                   # ← NEW
│   │   ├── __init__.py
│   │   ├── loader.py
│   │   ├── context.py
│   │   ├── anchor.py
│   │   ├── verdicts.py
│   │   ├── sections.py
│   │   ├── dayun_step.py
│   │   ├── liunian.py
│   │   └── chips.py
│   ├── retrieval/                 # ← NEW
│   │   ├── __init__.py
│   │   ├── loader.py
│   │   └── service.py
│   ├── services/
│   │   ├── chart_llm.py           # ← NEW
│   │   ├── chart_chips.py         # ← NEW
│   │   ├── chart.py               # MODIFY: +recompute
│   │   ├── quota.py               # MODIFY: +get_snapshot
│   │   └── exceptions.py          # MODIFY: +UpstreamLLMError
│   ├── schemas/
│   │   ├── llm.py                 # ← NEW
│   │   └── quota.py               # ← NEW
│   ├── api/
│   │   ├── charts.py              # MODIFY: +6 路由
│   │   └── quota.py               # ← NEW
│   ├── core/
│   │   └── config.py              # MODIFY: +5 env
│   └── main.py                    # MODIFY: include quota_router
├── pyproject.toml                 # MODIFY: +openai; +paipan workspace dep
└── ACCEPTANCE.md                  # REWRITE: Plan 2+3+4+5
```

## Task 列表预览

- **Task 1**：`pyproject.toml` deps + `core/config.py` env vars + Plan 4 paipan workspace dep 修正
- **Task 2**：schemas（llm.py + quota.py）+ `UpstreamLLMError` 异常
- **Task 3**：`app/llm/`（client + events + logs）+ 单元测试（mock openai）
- **Task 4**：`app/prompts/` 共享 infra（loader + context + anchor）+ 单元测试
- **Task 5**：`app/prompts/` chart builders（verdicts + sections + dayun_step + liunian + chips）+ 单元测试
- **Task 6**：`app/retrieval/` 端口（loader + service）+ 单元测试
- **Task 7**：`app/services/chart_llm.py`（cache helpers + stream_chart_llm generator）+ 单元测试
- **Task 8**：`chart.recompute` + `chart_chips` + `quota.get_snapshot` + `api/quota.py` + 集成测试
- **Task 9**：`api/charts.py` 6 路由接入（5 SSE + recompute）+ 集成测试（含 mock LLM + cache + force + 429 + fallback + error）
- **Task 10**：E2E lifecycle 集成 + ACCEPTANCE.md 重写 + wheel 冒烟

---

## Task 1: pyproject.toml deps + env vars + Plan 4 paipan dep 修正

**Files:**
- Modify: `server/pyproject.toml`
- Modify: `server/app/core/config.py`
- Test: `server/tests/unit/test_config.py`（已存在，追加断言）

- [ ] **Step 1.1: 修改 `server/pyproject.toml`**

读当前文件，在 `dependencies` list 末尾加入两行：

```toml
dependencies = [
    "fastapi>=0.115",
    "pydantic>=2.6",
    "pydantic-settings>=2.2",
    "sqlalchemy[asyncio]>=2.0.30",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "cryptography>=43",
    "httpx>=0.27",
    "structlog>=24.0",
    "openai>=1.40",                 # ← NEW: Plan 5 LLM client
    "paipan",                       # ← NEW: Plan 4 workspace dep 修正
]

[tool.uv.sources]
paipan = { workspace = true }       # ← NEW block (if not exists)
```

如果 `[tool.uv.sources]` 段已存在则追加键；否则新增段。

- [ ] **Step 1.2: 同步 + 验证 openai + paipan 两个包都装入 .venv**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/plan5-llm-sse
uv sync --package server --extra dev
ls .venv/lib/python3.12/site-packages/ | grep -E "^(openai|paipan)"
```

Expected: 两行 output 都出现（`openai` 和 `paipan-0.1.0.dist-info` 或 `_editable_impl_paipan.pth`）。

- [ ] **Step 1.3: 修改 `server/app/core/config.py` 追加 5 个 env**

Read 当前 file, 在 `Settings` class 末尾（`aliyun_sms_template` 之后）追加：

```python
    # Plan 5 LLM config
    mimo_api_key: str = ""                       # dev/test 留空 OK（集成测试 mock client）
    mimo_base_url: str = "https://api.xiaomimimo.com/v1"
    llm_model: str = "mimo-v2-pro"
    llm_fast_model: str = "mimo-v2-flash"
    llm_fallback_model: str = "mimo-v2-flash"
    llm_stream_first_delta_ms: int = 0           # 0 = 禁用；B 阶段生产调 8000

    bazi_repo_root: str = ""                     # 空字符串 = 运行时推断
```

- [ ] **Step 1.4: 写 config 单元测试**

Append to `server/tests/unit/test_config.py`：

```python
def test_plan5_llm_config_defaults(monkeypatch):
    for k in ("MIMO_API_KEY","MIMO_BASE_URL","LLM_MODEL","LLM_FAST_MODEL",
              "LLM_FALLBACK_MODEL","LLM_STREAM_FIRST_DELTA_MS","BAZI_REPO_ROOT"):
        monkeypatch.delenv(k, raising=False)
    import importlib
    from app.core import config as cfg
    importlib.reload(cfg)
    s = cfg.Settings()
    assert s.mimo_api_key == ""
    assert s.mimo_base_url.endswith("/v1")
    assert s.llm_model == "mimo-v2-pro"
    assert s.llm_fast_model == "mimo-v2-flash"
    assert s.llm_fallback_model == "mimo-v2-flash"
    assert s.llm_stream_first_delta_ms == 0
    assert s.bazi_repo_root == ""


def test_plan5_llm_config_env_override(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "custom-pro")
    monkeypatch.setenv("LLM_STREAM_FIRST_DELTA_MS", "8000")
    import importlib
    from app.core import config as cfg
    importlib.reload(cfg)
    s = cfg.Settings()
    assert s.llm_model == "custom-pro"
    assert s.llm_stream_first_delta_ms == 8000
```

- [ ] **Step 1.5: 跑测试确认全绿**

```bash
uv run --package server pytest server/tests/unit/test_config.py -v
```
Expected: 全绿（含新加 2 条）。

Full suite sanity:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: 199 + 2 = 201 passed.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/plan5-llm-sse
git add server/pyproject.toml server/app/core/config.py server/tests/unit/test_config.py
git commit -m "feat(server): +openai dep + Plan 5 LLM env vars + paipan workspace dep fix"
```

---

## Task 2: Schemas + UpstreamLLMError 异常

**Files:**
- Create: `server/app/schemas/llm.py`
- Create: `server/app/schemas/quota.py`
- Modify: `server/app/services/exceptions.py`（末尾追加一个类）
- Test: `server/tests/unit/test_plan5_schemas.py`

- [ ] **Step 2.1: 写失败测试**

Create `server/tests/unit/test_plan5_schemas.py`:

```python
"""Plan 5 schemas + UpstreamLLMError smoke tests."""
from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_section_body_accepts_all_7_sections():
    from app.schemas.llm import SectionBody
    for s in ("career","personality","wealth","relationship","health","appearance","special"):
        b = SectionBody(section=s)
        assert b.section == s


def test_section_body_rejects_unknown():
    from app.schemas.llm import SectionBody
    with pytest.raises(ValidationError):
        SectionBody(section="unknown")


def test_liunian_body_happy():
    from app.schemas.llm import LiunianBody
    b = LiunianBody(dayun_index=3, year_index=7)
    assert b.dayun_index == 3 and b.year_index == 7


def test_liunian_body_rejects_negative():
    from app.schemas.llm import LiunianBody
    with pytest.raises(ValidationError):
        LiunianBody(dayun_index=-1, year_index=0)
    with pytest.raises(ValidationError):
        LiunianBody(dayun_index=0, year_index=-1)


def test_quota_kind_usage_shape():
    from app.schemas.quota import QuotaKindUsage
    from datetime import datetime, timezone
    u = QuotaKindUsage(used=3, limit=30, resets_at=datetime.now(tz=timezone.utc))
    assert u.used == 3 and u.limit == 30


def test_quota_response_accepts_all_7_kinds():
    from app.schemas.quota import QuotaResponse, QuotaKindUsage
    from datetime import datetime, timezone
    now = datetime.now(tz=timezone.utc)
    kinds = ("chat_message","section_regen","verdicts_regen",
             "dayun_regen","liunian_regen","gua","sms_send")
    usage = {k: QuotaKindUsage(used=0, limit=1, resets_at=now) for k in kinds}
    r = QuotaResponse(plan="free", usage=usage)
    assert set(r.usage.keys()) == set(kinds)


def test_upstream_llm_error_codes():
    from app.services.exceptions import UpstreamLLMError
    e1 = UpstreamLLMError(code="UPSTREAM_LLM_FAILED", message="primary down")
    assert e1.code == "UPSTREAM_LLM_FAILED" and e1.message == "primary down"
    e2 = UpstreamLLMError(code="UPSTREAM_LLM_TIMEOUT", message="no delta")
    assert e2.code == "UPSTREAM_LLM_TIMEOUT"
```

- [ ] **Step 2.2: 确认失败**

Run: `uv run --package server pytest server/tests/unit/test_plan5_schemas.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.schemas.llm'` etc.)

- [ ] **Step 2.3: Create `server/app/schemas/llm.py`**

```python
"""Plan 5 chart LLM request bodies.

- SectionBody: used by POST /api/charts/:id/sections
- LiunianBody: used by POST /api/charts/:id/liunian

verdicts / dayun / chips / recompute: no body (path / query params only).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# NOTE: spec §2.1 — 7 sections fixed literal
Section = Literal[
    "career", "personality", "wealth", "relationship",
    "health", "appearance", "special",
]


class SectionBody(BaseModel):
    section: Section


class LiunianBody(BaseModel):
    # NOTE: 上层 service 再校验 index 是否在 paipan.dayun 范围内（422 or sensible default）
    dayun_index: int = Field(..., ge=0)
    year_index: int = Field(..., ge=0)
```

- [ ] **Step 2.4: Create `server/app/schemas/quota.py`**

```python
"""Plan 5 quota snapshot response."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# NOTE: spec §2.2 / core/quotas.py QUOTAS dict keys
QuotaKind = Literal[
    "chat_message", "section_regen", "verdicts_regen",
    "dayun_regen", "liunian_regen", "gua", "sms_send",
]


class QuotaKindUsage(BaseModel):
    used: int
    limit: int
    resets_at: datetime      # next Beijing midnight


class QuotaResponse(BaseModel):
    plan: Literal["free", "pro"]
    usage: dict[QuotaKind, QuotaKindUsage]      # 7 keys always present
```

- [ ] **Step 2.5: Append `UpstreamLLMError` to `server/app/services/exceptions.py`**

Append at end (after `ChartAlreadyDeleted`):

```python
class UpstreamLLMError(Exception):
    """Raised by app.llm.client when both primary and fallback models fail.

    Not a ServiceError — this is sent as an in-band SSE error event rather
    than mapped to HTTP status (SSE 200 already on wire by the time we know).
    """
    def __init__(self, *, code: Literal["UPSTREAM_LLM_FAILED", "UPSTREAM_LLM_TIMEOUT"],
                 message: str):
        super().__init__(message)
        self.code = code
        self.message = message
```

Add `from typing import Literal` at top if not already imported.

- [ ] **Step 2.6: 跑测试**

```bash
uv run --package server pytest server/tests/unit/test_plan5_schemas.py -v
```
Expected: 7 passed.

Full suite:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: 201 + 7 = 208 passed.

- [ ] **Step 2.7: Commit**

```bash
git add server/app/schemas/llm.py server/app/schemas/quota.py \
        server/app/services/exceptions.py server/tests/unit/test_plan5_schemas.py
git commit -m "feat(server): Plan 5 schemas (SectionBody/LiunianBody/QuotaResponse) + UpstreamLLMError"
```

---

## Task 3: `app/llm/` — LLM client + SSE events + usage logs

**Files:**
- Create: `server/app/llm/__init__.py`
- Create: `server/app/llm/client.py`
- Create: `server/app/llm/events.py`
- Create: `server/app/llm/logs.py`
- Test: `server/tests/unit/test_llm_events.py`
- Test: `server/tests/unit/test_llm_client.py`
- Test: `server/tests/unit/test_llm_logs.py`

- [ ] **Step 3.1: Create `server/app/llm/__init__.py`** (empty)

- [ ] **Step 3.2: 写 events 模块测试先（红）**

Create `server/tests/unit/test_llm_events.py`:

```python
"""app.llm.events: SSE wire serialization + cached content replay."""
from __future__ import annotations

import json
import pytest


def test_sse_pack_utf8_json_newlines():
    from app.llm.events import sse_pack
    out = sse_pack({"type": "delta", "text": "你好"})
    assert isinstance(out, bytes)
    assert out.startswith(b"data: ")
    assert out.endswith(b"\n\n")
    body = out[len(b"data: "):-2].decode("utf-8")
    assert json.loads(body) == {"type": "delta", "text": "你好"}


def test_sse_pack_compact_json_no_spaces():
    from app.llm.events import sse_pack
    out = sse_pack({"type": "done", "tokens_used": 0})
    assert b'"type":"done"' in out


@pytest.mark.asyncio
async def test_replay_cached_emits_model_deltas_done():
    from app.llm.events import replay_cached
    chunks = []
    async for raw in replay_cached("abcdefghij" * 5, "mimo-v2-pro",
                                   chunk_size=10, interval_ms=0):
        chunks.append(raw)
    # 首 event: model
    import json as _json
    first = _json.loads(chunks[0][len(b"data: "):-2].decode())
    assert first == {"type": "model", "modelUsed": "cached", "source": "cache"}
    # 5 个 delta（每 10 字一片）
    deltas = [c for c in chunks if b'"type":"delta"' in c]
    assert len(deltas) == 5
    # 末 event: done + source=cache + tokens_used=0
    last = _json.loads(chunks[-1][len(b"data: "):-2].decode())
    assert last["type"] == "done"
    assert last["source"] == "cache"
    assert last["tokens_used"] == 0
    assert last["full"] == "abcdefghij" * 5


@pytest.mark.asyncio
async def test_replay_cached_empty_content_still_emits_model_done():
    from app.llm.events import replay_cached
    chunks = []
    async for raw in replay_cached("", "mimo-v2-pro", chunk_size=10, interval_ms=0):
        chunks.append(raw)
    # model + done (no delta)
    assert len(chunks) == 2
    assert b'"type":"model"' in chunks[0]
    assert b'"type":"done"' in chunks[1]
```

- [ ] **Step 3.3: Confirm failure + implement `server/app/llm/events.py`**

Run: `uv run --package server pytest server/tests/unit/test_llm_events.py -v`
Expected: FAIL ModuleNotFoundError.

Create `server/app/llm/events.py`:

```python
"""SSE wire format helpers — single `data:` channel + JSON type-tagged events.

Wire format chosen to match MVP Node server for frontend compat:
    data: {"type":"model","modelUsed":"..."}\n\n
    data: {"type":"delta","text":"..."}\n\n
    data: {"type":"done","full":"...","tokens_used":N}\n\n
    data: {"type":"error","code":"...","message":"..."}\n\n

Cache replay additionally sets source: 'cache' on model/done events.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator


def sse_pack(obj: dict) -> bytes:
    """Serialize a single SSE event.

    Uses compact JSON (no spaces) to minimize bytes on the wire. UTF-8 encoded.
    """
    # NOTE: separators tuple removes the ": " and ", " spaces json.dumps adds by default
    return ("data: " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) +
            "\n\n").encode("utf-8")


async def replay_cached(
    content: str,
    model_used_orig: str | None,
    *,
    chunk_size: int = 30,
    interval_ms: int = 20,
) -> AsyncIterator[bytes]:
    """Replay cached content as SSE events — model → delta × N → done.

    NOTE: spec §4.2 — 30 chars / 20ms ≈ 1500 chars/sec keeps typing effect.
    model_used_orig is informational only; cache events always advertise
    modelUsed='cached' + source='cache' so the frontend can tell it's a replay.
    """
    yield sse_pack({"type": "model", "modelUsed": "cached", "source": "cache"})
    # Avoid zero-length content loop but still emit done.
    for i in range(0, len(content), chunk_size):
        chunk = content[i:i + chunk_size]
        yield sse_pack({"type": "delta", "text": chunk})
        if interval_ms > 0:
            await asyncio.sleep(interval_ms / 1000.0)
    yield sse_pack({
        "type": "done",
        "full": content,
        "tokens_used": 0,
        "source": "cache",
    })
```

Run: `uv run --package server pytest server/tests/unit/test_llm_events.py -v`
Expected: 4 passed.

- [ ] **Step 3.4: 写 `server/app/llm/logs.py` + 测试**

Create `server/tests/unit/test_llm_logs.py`:

```python
"""app.llm.logs.insert_llm_usage_log: sync INSERT, try/except wrapped."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
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
async def user(db_session):
    from app.models.user import User
    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    return u


@pytest.mark.asyncio
async def test_insert_llm_usage_log_happy(db_session, user):
    from app.llm.logs import insert_llm_usage_log
    await insert_llm_usage_log(
        db_session, user_id=user.id, chart_id=None,
        endpoint="verdicts", model="mimo-v2-pro",
        prompt_tokens=100, completion_tokens=500, duration_ms=2500,
    )
    row = (await db_session.execute(
        text("SELECT endpoint, model, prompt_tokens, completion_tokens, duration_ms "
             "FROM llm_usage_logs WHERE user_id = :uid"), {"uid": user.id},
    )).one()
    assert row.endpoint == "verdicts"
    assert row.model == "mimo-v2-pro"
    assert row.prompt_tokens == 100
    assert row.completion_tokens == 500
    assert row.duration_ms == 2500


@pytest.mark.asyncio
async def test_insert_llm_usage_log_error_field(db_session, user):
    from app.llm.logs import insert_llm_usage_log
    await insert_llm_usage_log(
        db_session, user_id=user.id, chart_id=None,
        endpoint="sections", model=None,
        prompt_tokens=None, completion_tokens=None, duration_ms=1200,
        error="both models failed",
    )
    row = (await db_session.execute(
        text("SELECT error FROM llm_usage_logs WHERE user_id = :uid"), {"uid": user.id},
    )).one()
    assert row.error == "both models failed"


@pytest.mark.asyncio
async def test_insert_llm_usage_log_swallows_db_error(db_session, user, monkeypatch, caplog):
    from app.llm import logs as logs_mod
    # Force db.execute to raise
    async def _boom(*a, **kw):
        raise RuntimeError("DB down")
    monkeypatch.setattr(db_session, "execute", _boom)
    # Must NOT raise — logs are fire-and-forget in spirit (sync write but swallow failures)
    await logs_mod.insert_llm_usage_log(
        db_session, user_id=user.id, chart_id=None,
        endpoint="x", model="y", prompt_tokens=0, completion_tokens=0, duration_ms=0,
    )
```

Run to confirm failure, then create `server/app/llm/logs.py`:

```python
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
            "uid": user_id, "cid": chart_id, "ep": endpoint, "mdl": model,
            "pt": prompt_tokens, "ct": completion_tokens,
            "dms": duration_ms, "err": error,
        })
    except Exception as e:       # noqa: BLE001 — intentional broad catch; see spec §0.3 #9
        _log.warning("llm_usage_logs insert failed: %s", e)
```

Run: `uv run --package server pytest server/tests/unit/test_llm_logs.py -v`
Expected: 3 passed.

- [ ] **Step 3.5: 写 `server/app/llm/client.py` 测试（red）**

Create `server/tests/unit/test_llm_client.py` with these tests (monkeypatch `_client` to a fake that yields prescribed chunks). Full test body:

```python
"""app.llm.client: AsyncOpenAI wrapper + fallback + first-delta timeout."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Callable

import pytest


def _mk_stream(deltas: list[str], tokens: int = 42, raise_mid: Exception | None = None):
    """Build a fake openai streaming response. Yields objects with delta.choices[0].delta.content."""
    class _FakeChunk:
        def __init__(self, content: str):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=content),
                                            finish_reason=None)]
            self.usage = None

    class _FakeFinal:
        def __init__(self, tokens: int):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=""),
                                            finish_reason="stop")]
            self.usage = SimpleNamespace(prompt_tokens=tokens // 3,
                                         completion_tokens=tokens - tokens // 3,
                                         total_tokens=tokens)

    async def gen():
        for i, d in enumerate(deltas):
            if raise_mid is not None and i == 1:
                raise raise_mid
            yield _FakeChunk(d)
        yield _FakeFinal(tokens)

    return gen()


class _FakeClient:
    def __init__(self, model_plan: dict[str, Callable[[], object]]):
        """model_plan: {model_name: stream_factory_callable}"""
        self._plan = model_plan
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, *, model, stream, **kwargs):
        assert stream is True
        factory = self._plan.get(model)
        if factory is None:
            raise RuntimeError(f"unexpected model: {model}")
        return factory()


def _patch_client(monkeypatch, fake: _FakeClient):
    from app.llm import client as c
    monkeypatch.setattr(c, "_client", fake)


@pytest.mark.asyncio
async def test_chat_stream_happy_primary(monkeypatch):
    from app.llm.client import chat_stream_with_fallback
    fake = _FakeClient({"mimo-v2-pro": lambda: _mk_stream(["Hello ", "world"], tokens=30)})
    _patch_client(monkeypatch, fake)

    events = []
    async for ev in chat_stream_with_fallback(
        messages=[{"role": "user", "content": "hi"}],
        tier="primary", temperature=0.7, max_tokens=100,
    ):
        events.append(ev)

    types = [e["type"] for e in events]
    assert types == ["model", "delta", "delta", "done"]
    assert events[0]["modelUsed"] == "mimo-v2-pro"
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Hello world"
    assert events[-1]["full"] == "Hello world"
    assert events[-1]["tokens_used"] == 30


@pytest.mark.asyncio
async def test_chat_stream_primary_error_falls_back(monkeypatch):
    from app.llm.client import chat_stream_with_fallback
    # Primary yields one delta then raises mid-stream (at i==1)
    fake = _FakeClient({
        "mimo-v2-pro": lambda: _mk_stream(["first", "second"], raise_mid=RuntimeError("boom")),
        "mimo-v2-flash": lambda: _mk_stream(["flash ok"], tokens=15),
    })
    _patch_client(monkeypatch, fake)

    events = []
    async for ev in chat_stream_with_fallback(
        messages=[{"role": "user", "content": "hi"}],
        tier="primary", temperature=0.7, max_tokens=100,
    ):
        events.append(ev)

    types = [e["type"] for e in events]
    # Primary 首 delta 发了一次 model，然后出错切 flash：第二次 model event
    assert types.count("model") == 2
    assert events[0]["modelUsed"] == "mimo-v2-pro"
    # 第二个 model 事件是 flash
    second_model = [e for e in events if e["type"] == "model"][1]
    assert second_model["modelUsed"] == "mimo-v2-flash"
    assert events[-1]["full"] == "flash ok"


@pytest.mark.asyncio
async def test_chat_stream_both_fail_raises_upstream(monkeypatch):
    from app.llm.client import chat_stream_with_fallback
    from app.services.exceptions import UpstreamLLMError
    fake = _FakeClient({
        "mimo-v2-pro": lambda: _mk_stream([], raise_mid=RuntimeError("primary down")),
        "mimo-v2-flash": lambda: _mk_stream([], raise_mid=RuntimeError("fallback down")),
    })
    _patch_client(monkeypatch, fake)

    with pytest.raises(UpstreamLLMError) as exc:
        async for _ in chat_stream_with_fallback(
            messages=[{"role":"u","content":"x"}],
            tier="primary", temperature=0.7, max_tokens=10,
        ):
            pass
    assert exc.value.code == "UPSTREAM_LLM_FAILED"


@pytest.mark.asyncio
async def test_chat_stream_first_delta_timeout_triggers_fallback(monkeypatch):
    from app.llm.client import chat_stream_with_fallback

    async def _slow_primary():
        """Yield nothing for 100ms then a delta — will be aborted if timeout < 100ms."""
        await asyncio.sleep(0.1)
        yield SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="too late"),
                                     finish_reason=None)],
            usage=None,
        )

    fake = _FakeClient({
        "mimo-v2-pro": _slow_primary,
        "mimo-v2-flash": lambda: _mk_stream(["on time"], tokens=5),
    })
    _patch_client(monkeypatch, fake)

    events = []
    async for ev in chat_stream_with_fallback(
        messages=[{"role":"u","content":"x"}],
        tier="primary", temperature=0.7, max_tokens=10,
        first_delta_timeout_ms=30,
    ):
        events.append(ev)

    # fallback fired; final content = "on time"
    assert events[-1]["full"] == "on time"
    models = [e["modelUsed"] for e in events if e["type"] == "model"]
    assert "mimo-v2-flash" in models


@pytest.mark.asyncio
async def test_chat_stream_empty_primary_triggers_fallback(monkeypatch):
    from app.llm.client import chat_stream_with_fallback
    fake = _FakeClient({
        "mimo-v2-pro": lambda: _mk_stream([], tokens=0),   # stream ends with no delta
        "mimo-v2-flash": lambda: _mk_stream(["backup"], tokens=3),
    })
    _patch_client(monkeypatch, fake)

    events = []
    async for ev in chat_stream_with_fallback(
        messages=[{"role":"u","content":"x"}],
        tier="primary", temperature=0.7, max_tokens=10,
    ):
        events.append(ev)

    assert events[-1]["full"] == "backup"


@pytest.mark.asyncio
async def test_chat_stream_tier_fast_uses_fast_model(monkeypatch):
    from app.llm.client import chat_stream_with_fallback
    fake = _FakeClient({"mimo-v2-flash": lambda: _mk_stream(["fast"], tokens=2)})
    _patch_client(monkeypatch, fake)

    events = []
    async for ev in chat_stream_with_fallback(
        messages=[{"role":"u","content":"x"}],
        tier="fast", temperature=0.9, max_tokens=200,
    ):
        events.append(ev)
    assert events[0]["modelUsed"] == "mimo-v2-flash"


def test_client_has_max_retries_zero():
    """openai SDK must be constructed with max_retries=0 so our fallback controls retries."""
    from app.llm import client as c
    # c._client is an AsyncOpenAI instance; its max_retries attribute should be 0
    assert c._client.max_retries == 0
```

- [ ] **Step 3.6: Create `server/app/llm/client.py`**

```python
"""MiMo LLM client — AsyncOpenAI wrapper with fallback + first-delta timeout.

See archive/server-mvp/llm.js for the JS reference implementation.

Design:
- openai-python SDK handles OpenAI-compatible streaming for us.
- SDK's internal retry is disabled (max_retries=0); fallback is our concern.
- Fallback triggers: primary raises, primary stream ends empty, or first delta
  does not arrive within `first_delta_timeout_ms` (if set).

Events yielded from chat_stream_with_fallback:
    {"type":"model", "modelUsed":<model>}          (on first delta, and again on fallback)
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
_client = AsyncOpenAI(
    api_key=settings.mimo_api_key or "dummy-for-test",
    base_url=settings.mimo_base_url,
    max_retries=0,
)


def _primary_for_tier(tier: Literal["primary", "fast"]) -> str:
    # NOTE: llm.js:29 — tier routing
    return settings.llm_fast_model if tier == "fast" else settings.llm_model


def _fallback_for_tier(tier: Literal["primary", "fast"]) -> str | None:
    # For fast tier, no further fallback (fast IS already the fallback).
    return settings.llm_fallback_model if tier == "primary" else None


async def _stream_once(
    model: str, *, messages, temperature, max_tokens,
    first_delta_timeout_ms: int | None,
) -> tuple[str, int, int, int]:
    """Single-model streaming. Returns (full, prompt_tok, completion_tok, total_tok).

    Yields via nonlocal? No — returns a tuple; delta-by-delta yielding happens in
    the caller via a nested async generator (see chat_stream_with_fallback).
    """
    # Implementation delegated to the async generator below so we can yield deltas.
    raise NotImplementedError("use chat_stream_with_fallback")


async def chat_stream_with_fallback(
    *,
    messages,
    tier: Literal["primary", "fast"] = "primary",
    temperature: float,
    max_tokens: int,
    first_delta_timeout_ms: int | None = None,
) -> AsyncIterator[dict]:
    """Stream primary; on failure / empty / first-delta-timeout, switch to fallback."""
    primary = _primary_for_tier(tier)
    fallback = _fallback_for_tier(tier)

    async def _run(model: str) -> AsyncIterator[dict]:
        first_delta_seen = False
        accumulated = ""
        prompt_tok = completion_tok = total_tok = 0

        try:
            stream = await _client.chat.completions.create(
                model=model, messages=messages, stream=True,
                temperature=temperature, max_tokens=max_tokens,
            )
        except Exception as e:       # noqa: BLE001 — SDK may raise APIError / TimeoutError / etc.
            raise

        async def _iter_stream():
            nonlocal first_delta_seen, accumulated, prompt_tok, completion_tok, total_tok
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    u = chunk.usage
                    prompt_tok = int(u.prompt_tokens or 0)
                    completion_tok = int(u.completion_tokens or 0)
                    total_tok = int(u.total_tokens or 0)
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                text = getattr(delta, "content", None) or ""
                if not text:
                    continue
                first_delta_seen = True
                accumulated += text
                yield {"type": "delta", "text": text}

        # If caller asked for first-delta timeout, race it against the first yield.
        if first_delta_timeout_ms and first_delta_timeout_ms > 0:
            it = _iter_stream().__aiter__()
            try:
                first = await asyncio.wait_for(it.__anext__(),
                                               timeout=first_delta_timeout_ms / 1000.0)
            except asyncio.TimeoutError as e:
                raise UpstreamLLMError(code="UPSTREAM_LLM_TIMEOUT",
                                        message=f"{model} first delta timeout") from e
            except StopAsyncIteration:
                # Stream ended before any delta
                raise UpstreamLLMError(code="UPSTREAM_LLM_FAILED",
                                        message=f"{model} stream ended empty")
            yield {"type": "model", "modelUsed": model}
            yield first
            async for ev in it:
                yield ev
        else:
            saw_first = False
            async for ev in _iter_stream():
                if not saw_first:
                    saw_first = True
                    yield {"type": "model", "modelUsed": model}
                yield ev
            if not saw_first:
                # No delta at all — treat as empty stream failure.
                raise UpstreamLLMError(code="UPSTREAM_LLM_FAILED",
                                        message=f"{model} stream ended empty")

        yield {
            "type": "done",
            "full": accumulated,
            "tokens_used": total_tok,
            "prompt_tokens": prompt_tok,
            "completion_tokens": completion_tok,
        }

    # Run primary; on any failure try fallback.
    try:
        async for ev in _run(primary):
            yield ev
        return
    except UpstreamLLMError as primary_err:
        primary_fail_reason = primary_err
    except Exception as e:       # noqa: BLE001 — SDK errors
        primary_fail_reason = UpstreamLLMError(
            code="UPSTREAM_LLM_FAILED", message=f"{primary}: {e}")
        _log.warning("primary %s failed: %s", primary, e)

    if fallback is None:
        raise primary_fail_reason

    try:
        async for ev in _run(fallback):
            yield ev
    except UpstreamLLMError:
        raise
    except Exception as e:       # noqa: BLE001
        raise UpstreamLLMError(code="UPSTREAM_LLM_FAILED",
                                message=f"{fallback}: {e}") from e
```

Also add a non-streaming helper for completeness (used by nothing in Plan 5 but declared for Plan 6 reuse):

```python
async def chat_with_fallback(
    *, messages, tier: Literal["primary","fast"] = "primary",
    temperature: float, max_tokens: int,
) -> tuple[str, str]:
    """Non-streaming; returns (text, model_used). Plan 5 uses streaming version."""
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
```

- [ ] **Step 3.7: 跑 client 测试**

```bash
uv run --package server pytest server/tests/unit/test_llm_client.py -v
```
Expected: 7 passed.

Full:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: 208 + 4 + 3 + 7 = 222 passed.

- [ ] **Step 3.8: Commit**

```bash
git add server/app/llm/ server/tests/unit/test_llm_events.py \
        server/tests/unit/test_llm_logs.py server/tests/unit/test_llm_client.py
git commit -m "feat(server): app/llm/ (client + events + logs) with fallback + timeout"
```

---

## Task 4: `app/prompts/` 共享 infra — loader + context + anchor

**Files:**
- Create: `server/app/prompts/__init__.py` (empty)
- Create: `server/app/prompts/loader.py`
- Create: `server/app/prompts/context.py`
- Create: `server/app/prompts/anchor.py`
- Test: `server/tests/unit/test_prompts_loader.py`
- Test: `server/tests/unit/test_prompts_context.py`
- Test: `server/tests/unit/test_prompts_anchor.py`

- [ ] **Step 4.1: Write loader tests (red)**

Create `server/tests/unit/test_prompts_loader.py`:

```python
"""app.prompts.loader: SKILL.md / guide / shards with @lru_cache."""
from __future__ import annotations

import pytest


def test_repo_root_resolves_from_ancestry():
    from app.prompts.loader import _repo_root
    root = _repo_root()
    assert (root / "paipan").is_dir()
    assert (root / "server").is_dir()


def test_load_skill_returns_content():
    from app.prompts.loader import load_skill
    txt = load_skill()
    assert isinstance(txt, str) and len(txt) > 1000
    assert "bazi" in txt.lower() or "八字" in txt


def test_load_guide_returns_content():
    from app.prompts.loader import load_guide
    txt = load_guide()
    assert isinstance(txt, str) and len(txt) > 100


def test_load_shard_existing():
    from app.prompts.loader import load_shard
    # core shard must exist per shards/ convention
    txt = load_shard("core")
    assert isinstance(txt, str) and len(txt) > 0


def test_load_shard_missing_returns_empty():
    from app.prompts.loader import load_shard
    assert load_shard("zzz-nonexistent-intent") == ""


def test_load_skill_lru_cached():
    from app.prompts.loader import load_skill
    load_skill.cache_clear()
    a = load_skill()
    info = load_skill.cache_info()
    assert info.misses == 1
    b = load_skill()
    info2 = load_skill.cache_info()
    assert info2.hits == 1
    assert a is b              # cached object identity
```

- [ ] **Step 4.2: Implement `server/app/prompts/loader.py`**

Create with:

```python
"""SKILL.md / conversation-guide.md / shards/*.md loaders, lazily cached.

Path resolution:
  - If BAZI_REPO_ROOT env is set, use that.
  - Else walk up from this file until we find a directory containing both
    paipan/ and server/ subdirs (monorepo marker).
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


def _repo_root() -> Path:
    env = os.environ.get("BAZI_REPO_ROOT", "").strip()
    if env:
        return Path(env)
    p = Path(__file__).resolve()
    for ancestor in p.parents:
        if (ancestor / "paipan").is_dir() and (ancestor / "server").is_dir():
            return ancestor
    raise RuntimeError("Cannot locate repo root; set BAZI_REPO_ROOT env")


@lru_cache(maxsize=1)
def load_skill() -> str:
    """Read SKILL.md (methodology); empty string if missing."""
    p = _repo_root() / "SKILL.md"
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


@lru_cache(maxsize=1)
def load_guide() -> str:
    """Read conversation-guide.md; empty string if missing."""
    p = _repo_root() / "conversation-guide.md"
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


@lru_cache(maxsize=None)
def load_shard(intent: str) -> str:
    """Read shards/<intent>.md; empty string if missing.

    NOTE: prompts.js:27-34 — shards dir holds small topic-specific system-prompt
    fragments. Always include core; per-intent appended by callers.
    """
    p = _repo_root() / "shards" / f"{intent}.md"
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""
```

Run: `uv run --package server pytest server/tests/unit/test_prompts_loader.py -v`
Expected: 6 passed.

- [ ] **Step 4.3: Context helpers — test + impl**

Create `server/tests/unit/test_prompts_context.py`:

```python
"""app.prompts.context: chart context compaction + timing helpers."""
from __future__ import annotations

import pytest


def _sample_paipan():
    """Minimal chart dict mimicking paipan.compute() output shape."""
    return {
        "sizhu": {
            "year": "庚午", "month": "辛巳", "day": "庚辰", "hour": "辛巳",
        },
        "rizhu": "庚",
        "shishen": {"year":"比肩","month":"劫财","day":"","hour":"劫财"},
        "cangGan": {
            "year": [{"gan":"丁","shiShen":"正官"},{"gan":"己","shiShen":"正印"}],
            "month": [{"gan":"丙","shiShen":"七杀"}],
            "day":  [{"gan":"戊","shiShen":"偏印"}],
            "hour": [{"gan":"丙","shiShen":"七杀"}],
        },
        "naYin": {"year":"路旁土","month":"白蜡金","day":"白蜡金","hour":"白蜡金"},
        "dayun": [
            {"ganZhi":"壬午","shiShen":"食神","startAge":6,"startYear":1996,"years":[...]}
            for _ in range(8)
        ],
        "lunar": {"year":1990,"month":5,"day":12},
        "solarCorrected": {"year":1990,"month":5,"day":12,"hour":14,"minute":30},
        "meta": {"input":{"year":1990,"month":5,"day":12,"hour":14,"minute":30}, "corrections":[]},
        "hourUnknown": False,
        "todayYearGz":"乙巳","todayMonthGz":"庚辰","todayDayGz":"甲子","todayYmd":"2026-04-18",
    }


def test_compact_chart_context_returns_string():
    from app.prompts.context import compact_chart_context
    s = compact_chart_context(_sample_paipan())
    assert isinstance(s, str)
    assert "庚午" in s  # 年柱应出现
    assert "庚" in s  # 日主


def test_compact_chart_context_includes_todaY_and_timing():
    from app.prompts.context import compact_chart_context
    s = compact_chart_context(_sample_paipan())
    assert "2026-04-18" in s or "乙巳" in s


def test_resolve_today_year_from_paipan():
    from app.prompts.context import resolve_today_year
    p = _sample_paipan()
    assert resolve_today_year(p) == 2026
    # Missing todayYmd → fallback to datetime.now().year
    p2 = dict(p); p2["todayYmd"] = ""
    year = resolve_today_year(p2)
    assert isinstance(year, int) and year >= 2024
```

- [ ] **Step 4.4: Implement `server/app/prompts/context.py`**

```python
"""Chart-context compaction + timing helpers.

Mirrors MVP prompts.js:53-182 — converts full paipan dict into a compact
string the LLM can efficiently reason about without being overwhelmed.

NOTE: The string shape is prompt-sensitive. Port prompts.js literally —
changes to wording / ordering can shift LLM outputs.
"""
from __future__ import annotations

from datetime import datetime

# NOTE: prompts.js:53-60
def resolve_today_year(paipan: dict) -> int:
    ymd = str((paipan or {}).get("todayYmd") or "")
    if ymd[:4].isdigit():
        y = int(ymd[:4])
        if y > 0:
            return y
    return datetime.now().year


# NOTE: prompts.js:62-89
def resolve_current_timing(ui: dict) -> dict:
    """Returns {dayun: str, liunian: str} pulled from UI slice, '' if absent."""
    ui = ui or {}
    dayun = ui.get("currentDayun") or ""
    liunian = ui.get("currentLiunian") or ""
    return {"dayun": str(dayun), "liunian": str(liunian)}


# NOTE: prompts.js:91-182 — ported literally; string shape matters to LLM output.
def compact_chart_context(paipan: dict) -> str:
    """Port of compactChartContext(ui) from prompts.js.

    Produces a multi-line compact description of the chart used inside the
    system prompt. Implementer: copy the JS template string verbatim,
    translating template literal interpolation to Python f-strings.
    """
    # Implementation: see archive/server-mvp/prompts.js:91-182. Port each line
    # preserving Chinese labels and whitespace exactly.
    p = paipan or {}
    sizhu = p.get("sizhu") or {}
    shishen = p.get("shishen") or {}
    cang_gan = p.get("cangGan") or {}
    na_yin = p.get("naYin") or {}
    dayun = p.get("dayun") or []
    today_ymd = p.get("todayYmd") or ""
    today_year_gz = p.get("todayYearGz") or ""
    today_month_gz = p.get("todayMonthGz") or ""
    today_day_gz = p.get("todayDayGz") or ""

    lines: list[str] = []
    lines.append("【命盘上下文】")
    lines.append(
        f"四柱  年:{sizhu.get('year','')}  月:{sizhu.get('month','')}"
        f"  日:{sizhu.get('day','')}  时:{sizhu.get('hour','')}"
    )
    lines.append(f"日主  {p.get('rizhu','')}")
    # 十神
    ss = shishen
    lines.append(
        f"十神  年:{ss.get('year','')}  月:{ss.get('month','')}"
        f"  日:{ss.get('day','')}  时:{ss.get('hour','')}"
    )
    # 藏干（只列干 + 十神）
    def _cg(pos: str) -> str:
        arr = cang_gan.get(pos) or []
        return "/".join(f"{it.get('gan','')}({it.get('shiShen','')})" for it in arr)
    lines.append(
        f"藏干  年:{_cg('year')}  月:{_cg('month')}  日:{_cg('day')}  时:{_cg('hour')}"
    )
    # 纳音
    ny = na_yin
    lines.append(
        f"纳音  年:{ny.get('year','')}  月:{ny.get('month','')}"
        f"  日:{ny.get('day','')}  时:{ny.get('hour','')}"
    )
    # 大运（前 8 步）
    if dayun:
        steps = []
        for d in dayun[:8]:
            steps.append(f"{d.get('ganZhi','')}({d.get('shiShen','')}@{d.get('startAge','?')}岁)")
        lines.append("大运  " + " → ".join(steps))

    # 当前时间锚点
    if today_ymd or today_year_gz:
        lines.append(f"当前  {today_ymd}  年柱:{today_year_gz}  月柱:{today_month_gz}  日柱:{today_day_gz}")

    return "\n".join(lines).rstrip()
```

Run: `uv run --package server pytest server/tests/unit/test_prompts_context.py -v`
Expected: 3 passed.

- [ ] **Step 4.5: Anchor helper — test + impl**

Create `server/tests/unit/test_prompts_anchor.py`:

```python
"""app.prompts.anchor: build_classical_anchor(retrieved)."""
from __future__ import annotations


def test_build_classical_anchor_empty_returns_empty():
    from app.prompts.anchor import build_classical_anchor
    assert build_classical_anchor([]) == ""


def test_build_classical_anchor_single_hit():
    from app.prompts.anchor import build_classical_anchor
    hits = [{"source": "穷通", "scope": "full", "chars": 300, "text": "甲木参天，脱胎要火。"}]
    out = build_classical_anchor(hits)
    assert "穷通" in out
    assert "甲木参天" in out


def test_build_classical_anchor_terse_shorter():
    from app.prompts.anchor import build_classical_anchor
    hits = [{"source": "三命", "scope": "career", "chars": 200, "text": "食神制杀之格..."}]
    full = build_classical_anchor(hits, terse=False)
    terse = build_classical_anchor(hits, terse=True)
    assert len(terse) <= len(full)
```

Create `server/app/prompts/anchor.py`:

```python
"""Builds a classical-anchor system-prompt block from retrieved hits.

NOTE: prompts.js:235-274 — ports build_classical_anchor.
Each RetrievalHit has {source, scope, chars, text}.
"""
from __future__ import annotations

from typing import Sequence


def build_classical_anchor(
    retrieved: Sequence[dict],
    *,
    terse: bool = False,
) -> str:
    if not retrieved:
        return ""
    lines: list[str] = []
    lines.append("--- 古籍原文锚点（优先用这些原文引用，其次再靠模型记忆）---")
    for hit in retrieved:
        src = hit.get("source", "?")
        scope = hit.get("scope", "full")
        text = (hit.get("text") or "").strip()
        if not text:
            continue
        if terse:
            # 节略：保留首 200 字
            if len(text) > 200:
                text = text[:200] + "…"
        lines.append(f"【{src} · {scope}】")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).rstrip()
```

Run: `uv run --package server pytest server/tests/unit/test_prompts_anchor.py -v`
Expected: 3 passed.

Full: `uv run --package server pytest server/tests/ -n auto`
Expected: 222 + 6 + 3 + 3 = 234 passed.

- [ ] **Step 4.6: Commit**

```bash
git add server/app/prompts/__init__.py server/app/prompts/loader.py \
        server/app/prompts/context.py server/app/prompts/anchor.py \
        server/tests/unit/test_prompts_loader.py \
        server/tests/unit/test_prompts_context.py \
        server/tests/unit/test_prompts_anchor.py
git commit -m "feat(server): app/prompts shared infra (loader + context + anchor)"
```

---

## Task 5: `app/prompts/` chart builders (verdicts + sections + dayun_step + liunian + chips)

**Port discipline**: these 5 builders are mechanical ports of MVP `archive/server-mvp/prompts.js`. Each function must:
1. Reference its JS source lines in a `# NOTE: prompts.js:<lines>` comment at the top of the function body
2. Preserve Chinese prompt text verbatim (character-for-character) — LLM output consistency depends on this
3. Use `load_skill()` / `load_guide()` / `load_shard(name)` / `compact_chart_context(chart)` / `build_classical_anchor(retrieved)` for shared infra

**Files:**
- Create: `server/app/prompts/verdicts.py`
- Create: `server/app/prompts/sections.py`
- Create: `server/app/prompts/dayun_step.py`
- Create: `server/app/prompts/liunian.py`
- Create: `server/app/prompts/chips.py`
- Test: `server/tests/unit/test_prompts_verdicts.py`
- Test: `server/tests/unit/test_prompts_sections.py`
- Test: `server/tests/unit/test_prompts_dayun_step.py`
- Test: `server/tests/unit/test_prompts_liunian.py`
- Test: `server/tests/unit/test_prompts_chips.py`
- Create: `server/tests/unit/_chart_fixtures.py` (shared test fixture)

- [ ] **Step 5.1: Create shared fixture**

Create `server/tests/unit/_chart_fixtures.py`:

```python
"""Shared chart fixture for prompt builder tests."""

def sample_chart() -> dict:
    """Representative paipan dict used by all prompt builder snapshot tests."""
    return {
        "sizhu": {"year": "庚午", "month": "辛巳", "day": "庚辰", "hour": "辛巳"},
        "rizhu": "庚",
        "shishen": {"year":"比肩","month":"劫财","day":"","hour":"劫财"},
        "cangGan": {
            "year": [{"gan":"丁","shiShen":"正官"},{"gan":"己","shiShen":"正印"}],
            "month": [{"gan":"丙","shiShen":"七杀"}],
            "day":  [{"gan":"戊","shiShen":"偏印"}],
            "hour": [{"gan":"丙","shiShen":"七杀"}],
        },
        "naYin": {"year":"路旁土","month":"白蜡金","day":"白蜡金","hour":"白蜡金"},
        "dayun": [
            {"ganZhi":"壬午","shiShen":"食神","startAge":6,"startYear":1996,"years":[]},
            {"ganZhi":"癸未","shiShen":"伤官","startAge":16,"startYear":2006,"years":[]},
            {"ganZhi":"甲申","shiShen":"偏财","startAge":26,"startYear":2016,"years":[]},
            {"ganZhi":"乙酉","shiShen":"正财","startAge":36,"startYear":2026,"years":[]},
        ],
        "lunar": {"year":1990,"month":5,"day":12},
        "solarCorrected": {"year":1990,"month":5,"day":12,"hour":14,"minute":30},
        "meta": {"input":{"year":1990,"month":5,"day":12,"hour":14,"minute":30}, "corrections":[]},
        "hourUnknown": False,
        "todayYearGz":"乙巳","todayMonthGz":"庚辰","todayDayGz":"甲子","todayYmd":"2026-04-18",
    }
```

- [ ] **Step 5.2: Verdicts builder — test + port from prompts.js:815-883**

Create `server/tests/unit/test_prompts_verdicts.py`:

```python
"""app.prompts.verdicts.build_messages — ports prompts.js:815-883."""
from __future__ import annotations

from tests.unit._chart_fixtures import sample_chart


def test_build_verdicts_messages_shape():
    from app.prompts.verdicts import build_messages
    msgs = build_messages(sample_chart(), retrieved=[])
    assert isinstance(msgs, list)
    assert all("role" in m and "content" in m for m in msgs)
    roles = [m["role"] for m in msgs]
    assert "system" in roles and "user" in roles


def test_build_verdicts_messages_system_includes_chart():
    from app.prompts.verdicts import build_messages
    msgs = build_messages(sample_chart(), retrieved=[])
    sys = "\n".join(m["content"] for m in msgs if m["role"] == "system")
    assert "庚午" in sys              # 年柱 present
    assert "运行时约束" in sys        # header block present


def test_build_verdicts_messages_user_prompt_fixed():
    from app.prompts.verdicts import build_messages
    msgs = build_messages(sample_chart(), retrieved=[])
    user = [m for m in msgs if m["role"] == "user"][0]["content"]
    # 用户提示在 MVP 里是固定的
    assert "判词" in user or "不要前言" in user


def test_build_verdicts_messages_with_retrieval():
    from app.prompts.verdicts import build_messages
    retrieved = [{"source": "滴天髓", "scope": "full", "chars": 200,
                   "text": "庚金带杀，刚健为最"}]
    msgs = build_messages(sample_chart(), retrieved=retrieved)
    sys = "\n".join(m["content"] for m in msgs if m["role"] == "system")
    assert "滴天髓" in sys or "庚金带杀" in sys
```

Create `server/app/prompts/verdicts.py` — port `archive/server-mvp/prompts.js:815-883` literally. Structure:

```python
"""Chart verdicts (整体判词) prompt builder.

Port of archive/server-mvp/prompts.js:815-883.
"""
from __future__ import annotations

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context
from app.prompts.loader import load_guide, load_skill

# NOTE: prompts.js:20-21 FALLBACK_STYLE
_FALLBACK_STYLE = "..."  # port literal from prompts.js:42-51

def build_messages(chart: dict, retrieved: list[dict] = ()) -> list[dict]:
    """Port of buildVerdictsMessages from prompts.js:815-883.

    Reconstructs the system prompt in the same order as MVP:
    1. 运行时约束 header
    2. SKILL.md (or _FALLBACK_STYLE)
    3. conversation-guide.md (if present)
    4. compact_chart_context(chart)
    5. Optional classical anchor (terse)
    6. 本轮任务 — 古籍判词·整体断词 description
    """
    system_parts: list[str] = []

    # NOTE: prompts.js:817-829 — header
    system_parts.append(
        "【运行时约束 — 最高优先级】\n"
        "你没有工具调用能力。不要输出 **Read**、**Glob**、```...```、"
        "\"让我先查一下古籍\" 这类过程性内容。\n"
        "古籍的要点已经内化在你训练数据里——直接引用原文即可，不要表演\"去查\"的动作。\n"
        "命盘上下文已在本请求给全，不要再\"去读\"什么文件。\n"
        "直接输出给用户看的那段话本身，别写你的思考过程、草稿、自我校对。\n"
        "\n"
        "【输出格式】\n"
        "- 纯文本 + 基础 Markdown（## 小标题、**加粗**、> 引用可用）\n"
        "- 不要代码块，不要 JSON，不要前言/后语\n"
        "- 长度随内容走，写透为止"
    )

    skill = load_skill()
    if skill:
        system_parts.append("--- 方法论参考（风格/判断依据，不要照搬里面的流程指令）---\n" + skill)
    else:
        system_parts.append(_FALLBACK_STYLE)

    guide = load_guide()
    if guide:
        system_parts.append("--- 对话指南（风格参考）---\n" + guide)

    ctx = compact_chart_context(chart)
    if ctx:
        system_parts.append(ctx)

    anchor = build_classical_anchor(retrieved, terse=True) if retrieved else ""
    if anchor:
        system_parts.append(anchor)

    # NOTE: prompts.js:846-876 — 本轮任务 block（完整 Chinese 文本照抄）
    system_parts.append(
        # PORT TASK FOR IMPLEMENTER: copy the ~30-line Chinese text block from
        # prompts.js:846-876 verbatim. It starts with 「【本轮任务 — 古籍判词·整体断词】」
        # and ends at the last line before `.join('\n')`. Preserve every character.
        _PORT_TASK_TEXT_BLOCK
    )

    return [
        {"role": "system", "content": "\n\n".join(system_parts)},
        # NOTE: prompts.js:880 — user prompt fixed
        {"role": "user",   "content": "请直接写这份整体断词，从第一段古籍锚点开始，不要前言。"},
    ]
```

**Implementer action**: replace `_PORT_TASK_TEXT_BLOCK` and `_FALLBACK_STYLE` with the exact Chinese text from the JS source file (use the file on disk at `archive/server-mvp/prompts.js`, line ranges given above). Do not paraphrase.

Run: `uv run --package server pytest server/tests/unit/test_prompts_verdicts.py -v`
Expected: 4 passed (once the Chinese text is correctly copied).

- [ ] **Step 5.3: Sections builder — test + port prompts.js:276-391**

Create `server/tests/unit/test_prompts_sections.py`:

```python
"""app.prompts.sections.build_messages + parse_sections_text — ports prompts.js:276-391."""
from __future__ import annotations

import pytest

from tests.unit._chart_fixtures import sample_chart


def test_build_sections_messages_all_7_sections():
    from app.prompts.sections import build_messages
    for sec in ("career","personality","wealth","relationship",
                "health","appearance","special"):
        msgs = build_messages(sample_chart(), retrieved=[], section=sec)
        assert any("role" in m for m in msgs)
        # section name should feed into the user prompt or task section
        joined = " ".join(m["content"] for m in msgs)
        # weak assertion: chart present
        assert "庚" in joined


def test_parse_sections_text_splits_by_section_marker():
    from app.prompts.sections import parse_sections_text
    raw = """§career
事业内容
§wealth
财富内容
§relationship
关系内容
"""
    out = parse_sections_text(raw)
    assert out.get("career", "").strip() == "事业内容"
    assert out.get("wealth", "").strip() == "财富内容"
    assert out.get("relationship", "").strip() == "关系内容"


def test_parse_sections_text_handles_no_marker():
    from app.prompts.sections import parse_sections_text
    out = parse_sections_text("无分节的内容")
    # Implementation detail: no marker → empty dict (graceful) OR wrapped under a default key.
    # Port MVP behaviour whichever it is.
    assert isinstance(out, dict)
```

Create `server/app/prompts/sections.py`:

```python
"""Chart sections (职/性/财/关/健/相/特殊) prompt builder + parser.

Port of archive/server-mvp/prompts.js:276-391.
"""
from __future__ import annotations

import re
from typing import Literal

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context
from app.prompts.loader import load_guide, load_skill

Section = Literal["career","personality","wealth","relationship","health","appearance","special"]


def build_messages(chart: dict, retrieved: list[dict], *, section: Section) -> list[dict]:
    """Port of buildSectionsMessages from prompts.js:276-339.

    PORT TASK FOR IMPLEMENTER:
    - Replicate the exact system-prompt composition in prompts.js:276-338
    - The per-section task block varies by `section` param (prompts.js dispatches
      via a PROMPTS_BY_SECTION lookup — port that lookup table literally).
    - Preserve all Chinese text character-for-character.
    """
    # See prompts.js for the authoritative implementation. This stub demonstrates
    # the shape; the implementer fills in the per-section text.
    ...

# NOTE: prompts.js:340-391
def parse_sections_text(raw: str) -> dict[str, str]:
    """Split LLM output by `§<section>` markers.

    Port of parseSectionsText — returns {section: text}. No marker → empty dict.
    """
    out: dict[str, str] = {}
    if not raw:
        return out
    # Pattern: `§section_name` on its own line, then content until next §
    parts = re.split(r"^§([a-z_]+)\s*\n", raw, flags=re.MULTILINE)
    # parts = ['<before first §>', 'career', 'career content', 'wealth', 'wealth content', ...]
    i = 1
    while i < len(parts) - 1:
        section = parts[i].strip()
        content = parts[i + 1].strip()
        if section:
            out[section] = content
        i += 2
    return out
```

Run: `uv run --package server pytest server/tests/unit/test_prompts_sections.py -v`

- [ ] **Step 5.4: Dayun step builder — port prompts.js:658-708**

Create `server/tests/unit/test_prompts_dayun_step.py`:

```python
from __future__ import annotations

import pytest

from tests.unit._chart_fixtures import sample_chart


def test_build_dayun_step_messages_happy():
    from app.prompts.dayun_step import build_messages
    msgs = build_messages(sample_chart(), retrieved=[], step_index=2)
    assert any(m["role"] == "system" for m in msgs)
    user = " ".join(m["content"] for m in msgs if m["role"] == "user")
    # step 2 references the 3rd dayun (0-indexed)
    assert "甲申" in user or "甲申" in " ".join(m["content"] for m in msgs)


def test_build_dayun_step_messages_out_of_range_raises():
    from app.prompts.dayun_step import build_messages
    # 8 dayuns in fixture; index 99 should raise (MVP raises error; in Python ValueError)
    with pytest.raises((ValueError, IndexError)):
        build_messages(sample_chart(), retrieved=[], step_index=99)
```

Create `server/app/prompts/dayun_step.py` — port prompts.js:658-708.

```python
"""Single-dayun-step reading prompt builder.

Port of archive/server-mvp/prompts.js:658-708.
"""
from __future__ import annotations

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context
from app.prompts.loader import load_guide, load_skill


def build_messages(chart: dict, retrieved: list[dict], *, step_index: int) -> list[dict]:
    """Port of buildDayunStepMessages. Raises ValueError if step_index out of range."""
    dayun = (chart or {}).get("dayun") or []
    if step_index < 0 or step_index >= len(dayun):
        raise ValueError(f"step_index {step_index} out of range (have {len(dayun)} dayuns)")
    # PORT TASK: replicate prompts.js:658-708 exactly, including Chinese prompt text.
    ...
```

- [ ] **Step 5.5: Liunian builder — port prompts.js:709-758**

Create `server/tests/unit/test_prompts_liunian.py`:

```python
from __future__ import annotations

import pytest

from tests.unit._chart_fixtures import sample_chart


def test_build_liunian_messages_happy():
    from app.prompts.liunian import build_messages
    msgs = build_messages(sample_chart(), retrieved=[], dayun_index=1, year_index=3)
    assert any(m["role"] == "system" for m in msgs)


def test_build_liunian_messages_out_of_range():
    from app.prompts.liunian import build_messages
    with pytest.raises((ValueError, IndexError)):
        build_messages(sample_chart(), retrieved=[], dayun_index=99, year_index=0)
```

Create `server/app/prompts/liunian.py` — port prompts.js:709-758 analogously.

- [ ] **Step 5.6: Chips builder — port prompts.js:929-1006**

Create `server/tests/unit/test_prompts_chips.py`:

```python
from __future__ import annotations

from tests.unit._chart_fixtures import sample_chart


def test_build_chips_messages_shape():
    from app.prompts.chips import build_messages
    msgs = build_messages(sample_chart(), history=[])
    assert isinstance(msgs, list)
    assert any(m["role"] == "system" for m in msgs)


def test_parse_chips_json_happy():
    from app.prompts.chips import parse_chips_json
    out = parse_chips_json('["最近事业运如何？", "婚姻缘分时机？", "什么时候发财？"]')
    assert out == ["最近事业运如何？", "婚姻缘分时机？", "什么时候发财？"]


def test_parse_chips_json_malformed_returns_empty():
    from app.prompts.chips import parse_chips_json
    assert parse_chips_json("") == []
    assert parse_chips_json("not json") == []
    assert parse_chips_json("{}") == []      # wrong shape → empty


def test_parse_chips_json_wrapped_in_markdown():
    from app.prompts.chips import parse_chips_json
    raw = '```json\n["a","b","c"]\n```'
    out = parse_chips_json(raw)
    assert out == ["a", "b", "c"]
```

Create `server/app/prompts/chips.py`:

```python
"""Chat-suggestion chips prompt builder + response parser.

Port of archive/server-mvp/prompts.js:929-1006.
chips uses FAST_MODEL; response is JSON array of 3-5 short strings.
"""
from __future__ import annotations

import json
import re


def build_messages(chart: dict, history: list = ()) -> list[dict]:
    """Port of buildChipsMessages. In Plan 5 `history` is unused (Plan 6 adds it)."""
    # PORT TASK: see prompts.js:929-971
    ...


def parse_chips_json(raw: str) -> list[str]:
    """Extract [str,...] list from LLM response. Returns [] on any failure."""
    if not raw:
        return []
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Try to find a [...] block
        m = re.search(r"\[.*?\]", text, flags=re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if isinstance(x, str)]
```

- [ ] **Step 5.7: 跑 5 builder 测试全绿**

```bash
uv run --package server pytest server/tests/unit/test_prompts_verdicts.py \
      server/tests/unit/test_prompts_sections.py \
      server/tests/unit/test_prompts_dayun_step.py \
      server/tests/unit/test_prompts_liunian.py \
      server/tests/unit/test_prompts_chips.py -v
```
Expected: 4 + 3 + 2 + 2 + 4 = 15 passed.

Full:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: 234 + 15 = 249 passed.

- [ ] **Step 5.8: Commit**

```bash
git add server/app/prompts/verdicts.py server/app/prompts/sections.py \
        server/app/prompts/dayun_step.py server/app/prompts/liunian.py \
        server/app/prompts/chips.py \
        server/tests/unit/_chart_fixtures.py \
        server/tests/unit/test_prompts_verdicts.py \
        server/tests/unit/test_prompts_sections.py \
        server/tests/unit/test_prompts_dayun_step.py \
        server/tests/unit/test_prompts_liunian.py \
        server/tests/unit/test_prompts_chips.py
git commit -m "feat(server): app/prompts chart builders (verdicts/sections/dayun/liunian/chips)"
```

---

## Task 6: `app/retrieval/` port (loader + service)

Port of `archive/server-mvp/retrieval.js` (341 lines). Mechanical; preserve filenames + thresholds.

**Files:**
- Create: `server/app/retrieval/__init__.py`
- Create: `server/app/retrieval/loader.py`
- Create: `server/app/retrieval/service.py`
- Test: `server/tests/unit/test_retrieval_loader.py`
- Test: `server/tests/unit/test_retrieval_service.py`

- [ ] **Step 6.1: Loader tests (red)**

Create `server/tests/unit/test_retrieval_loader.py`:

```python
"""app.retrieval.loader: classics file reading with @lru_cache."""
from __future__ import annotations


def test_read_classic_existing_file():
    from app.retrieval.loader import read_classic
    # Any file in classics/ — at minimum the readme
    txt = read_classic("00_readme.md")
    assert isinstance(txt, str) and len(txt) > 0


def test_read_classic_missing_returns_empty():
    from app.retrieval.loader import read_classic
    assert read_classic("nonexistent/zzz.md") == ""


def test_read_classic_lru_cached():
    from app.retrieval.loader import read_classic
    read_classic.cache_clear()
    a = read_classic("00_readme.md")
    b = read_classic("00_readme.md")
    info = read_classic.cache_info()
    assert info.hits >= 1
    assert a is b


def test_extract_qiongtong_section_by_day_gan_month_zhi():
    """Port of retrieval.js:46-78 — extracts 《穷通宝鉴》 section by day 干 + month 支."""
    from app.retrieval.loader import extract_qiongtong_section
    # Use a known-good combination; implementation returns str or None.
    content = "# 穷通宝鉴\n## 庚金\n### 巳月庚金\n金逢巳月，坐下长生..."
    out = extract_qiongtong_section(content, "庚", "巳")
    assert out is None or (isinstance(out, str) and "庚" in out)
```

- [ ] **Step 6.2: Implement `server/app/retrieval/loader.py`**

```python
"""Classics file reader + per-book section extractors.

Port of archive/server-mvp/retrieval.js:46-240.
@lru_cache per file; files resolved relative to classics/ under BAZI_REPO_ROOT.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.prompts.loader import _repo_root


@lru_cache(maxsize=None)
def read_classic(rel_path: str) -> str:
    """Return classics/<rel_path> content, or '' if missing."""
    p = _repo_root() / "classics" / rel_path
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def extract_qiongtong_section(content: str, day_gan: str, month_zhi: str) -> str | None:
    """Extract the <day_gan> × <month_zhi> section from 《穷通宝鉴》.
    Port of retrieval.js:46-78. Returns None if not found.
    """
    # PORT TASK: translate the JS heading-match logic line-for-line.
    ...


def strip_frontmatter(text: str) -> str:
    """Port of retrieval.js:197-209 — remove YAML frontmatter if present."""
    ...


def extract_by_heading(content: str, keyword: str) -> str | None:
    """Port of retrieval.js:211-231 — extract section by heading substring."""
    ...
```

- [ ] **Step 6.3: Service tests**

Create `server/tests/unit/test_retrieval_service.py`:

```python
"""app.retrieval.service.retrieve_for_chart: kind-routed classical retrieval."""
from __future__ import annotations

import pytest

from tests.unit._chart_fixtures import sample_chart


@pytest.mark.asyncio
async def test_retrieve_for_chart_meta_returns_list():
    from app.retrieval.service import retrieve_for_chart
    hits = await retrieve_for_chart(sample_chart(), "meta")
    assert isinstance(hits, list)
    for h in hits:
        assert "source" in h and "scope" in h and "chars" in h and "text" in h
        assert h["chars"] > 0


@pytest.mark.asyncio
async def test_retrieve_for_chart_section_career():
    from app.retrieval.service import retrieve_for_chart
    hits = await retrieve_for_chart(sample_chart(), "section:career")
    assert isinstance(hits, list)


@pytest.mark.asyncio
async def test_retrieve_for_chart_budget_respected():
    from app.retrieval.service import retrieve_for_chart, TOTAL_MAX
    hits = await retrieve_for_chart(sample_chart(), "meta")
    total = sum(h["chars"] for h in hits)
    assert total <= TOTAL_MAX


@pytest.mark.asyncio
async def test_retrieve_for_chart_unknown_kind_empty():
    from app.retrieval.service import retrieve_for_chart
    hits = await retrieve_for_chart(sample_chart(), "zzz_unknown_kind")
    assert hits == []
```

- [ ] **Step 6.4: Implement `server/app/retrieval/service.py`**

```python
"""Retrieval service — kind-routed classical excerpt selection.

Port of archive/server-mvp/retrieval.js:179-340. Budget constants:
    PER_SOURCE_MAX = 2500      # max chars per book
    TOTAL_MAX = 6000           # aggregate budget across all sources

retrieve_for_chart(chart, kind) routes to per-kind strategies and returns
[{source, scope, chars, text}, ...] bounded by budgets.
"""
from __future__ import annotations

from typing import TypedDict

from app.retrieval.loader import (
    extract_by_heading, extract_qiongtong_section, read_classic, strip_frontmatter,
)

# NOTE: retrieval.js:247-248
PER_SOURCE_MAX = 2500
TOTAL_MAX = 6000


class RetrievalHit(TypedDict):
    source: str
    scope: str
    chars: int
    text: str


async def retrieve_for_chart(chart: dict, kind: str) -> list[RetrievalHit]:
    """PORT TASK: port retrieveForChart from retrieval.js.

    Supported kinds:
      - "meta"                       → multiple classics
      - "section:career" / "...:health" / etc. → section-specific
      - "dayun_step"                 → 穷通 + 三命
      - "liunian"                    → 穷通

    Unknown kind → return [].
    """
    # Stub — implementer ports the dispatch logic literally.
    ...
```

- [ ] **Step 6.5: 跑 retrieval 测试**

```bash
uv run --package server pytest server/tests/unit/test_retrieval_loader.py \
      server/tests/unit/test_retrieval_service.py -v
```
Expected: 4 + 4 = 8 passed.

Full: `uv run --package server pytest server/tests/ -n auto`
Expected: 249 + 8 = 257 passed.

- [ ] **Step 6.6: Commit**

```bash
git add server/app/retrieval/ \
        server/tests/unit/test_retrieval_loader.py \
        server/tests/unit/test_retrieval_service.py
git commit -m "feat(server): app/retrieval port (loader + service) with lru_cache"
```

---

## Task 7: `app/services/chart_llm.py` — cache helpers + unified SSE generator

**Files:**
- Create: `server/app/services/chart_llm.py`
- Test: `server/tests/unit/test_chart_llm_cache.py`
- Test: `server/tests/unit/test_chart_llm_generator.py`

- [ ] **Step 7.1: Cache helper tests**

Create `server/tests/unit/test_chart_llm_cache.py`:

```python
"""chart_llm cache helpers: get_cache_row + upsert_cache."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
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
async def user_and_chart(db_session):
    from app.db_types import user_dek_context
    from app.models.chart import Chart
    from app.models.user import User
    dek = os.urandom(32)
    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u); await db_session.flush()
    with user_dek_context(dek):
        c = Chart(user_id=u.id, birth_input={"year":1990,"month":5,"day":12,
                                              "hour":12,"gender":"male"},
                  paipan={"sizhu":"...","hourUnknown":False}, engine_version="0.1.0")
        db_session.add(c); await db_session.flush()
    return u, c, dek


@pytest.mark.asyncio
async def test_get_cache_row_returns_none_when_empty(db_session, user_and_chart):
    from app.services.chart_llm import get_cache_row
    _, chart, _ = user_and_chart
    row = await get_cache_row(db_session, chart.id, "verdicts", "")
    assert row is None


@pytest.mark.asyncio
async def test_upsert_cache_inserts_new(db_session, user_and_chart):
    from app.db_types import user_dek_context
    from app.services.chart_llm import get_cache_row, upsert_cache
    _, chart, dek = user_and_chart
    with user_dek_context(dek):
        await upsert_cache(db_session, chart_id=chart.id, kind="verdicts", key="",
                           content="hello world", model_used="mimo-v2-pro",
                           tokens_used=42, regen_increment=False)
        await db_session.flush()
        row = await get_cache_row(db_session, chart.id, "verdicts", "")
    assert row is not None
    assert row.content == "hello world"
    assert row.model_used == "mimo-v2-pro"
    assert row.tokens_used == 42
    assert row.regen_count == 0


@pytest.mark.asyncio
async def test_upsert_cache_replaces_existing(db_session, user_and_chart):
    from app.db_types import user_dek_context
    from app.services.chart_llm import get_cache_row, upsert_cache
    _, chart, dek = user_and_chart
    with user_dek_context(dek):
        await upsert_cache(db_session, chart_id=chart.id, kind="verdicts", key="",
                           content="v1", model_used="mimo-v2-pro",
                           tokens_used=10, regen_increment=False)
        await db_session.flush()
        await upsert_cache(db_session, chart_id=chart.id, kind="verdicts", key="",
                           content="v2", model_used="mimo-v2-flash",
                           tokens_used=20, regen_increment=True)
        await db_session.flush()
        row = await get_cache_row(db_session, chart.id, "verdicts", "")
    assert row.content == "v2"
    assert row.model_used == "mimo-v2-flash"
    assert row.regen_count == 1
```

- [ ] **Step 7.2: Implement cache helpers**

Create `server/app/services/chart_llm.py` (first half — helpers only; generator in next step):

```python
"""Cache-aware chart LLM SSE generator + helpers.

Shared by 4 routes: verdicts / sections / dayun_step / liunian.
chips has its own generator (chart_chips.py) because it skips cache/quota.
"""
from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable
from typing import Literal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.client import chat_stream_with_fallback
from app.llm.events import replay_cached, sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.chart import ChartCache
from app.models.user import User
from app.retrieval.service import retrieve_for_chart
from app.services.exceptions import UpstreamLLMError
from app.services.quota import QuotaTicket


async def get_cache_row(
    db: AsyncSession, chart_id: UUID, kind: str, key: str,
) -> ChartCache | None:
    stmt = select(ChartCache).where(
        ChartCache.chart_id == chart_id,
        ChartCache.kind == kind,
        ChartCache.key == key,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def upsert_cache(
    db: AsyncSession, *,
    chart_id: UUID, kind: str, key: str,
    content: str, model_used: str | None, tokens_used: int,
    regen_increment: bool,
) -> None:
    """INSERT ... ON CONFLICT DO UPDATE. regen_count += int(regen_increment)."""
    await db.execute(text("""
        INSERT INTO chart_cache (chart_id, kind, key, content, model_used,
                                  tokens_used, generated_at, regen_count)
        VALUES (:cid, :kind, :key, :content, :model, :tokens, now(), 0)
        ON CONFLICT (chart_id, kind, key) DO UPDATE
           SET content = EXCLUDED.content,
               model_used = EXCLUDED.model_used,
               tokens_used = EXCLUDED.tokens_used,
               generated_at = now(),
               regen_count = chart_cache.regen_count + :incr
    """), {
        "cid": chart_id, "kind": kind, "key": key,
        "content": content, "model": model_used, "tokens": tokens_used,
        "incr": 1 if regen_increment else 0,
    })
```

Run: `uv run --package server pytest server/tests/unit/test_chart_llm_cache.py -v`
Expected: 3 passed.

- [ ] **Step 7.3: Generator tests**

Create `server/tests/unit/test_chart_llm_generator.py`:

```python
"""chart_llm.stream_chart_llm: end-to-end generator with mocked LLM client."""
from __future__ import annotations

import os
import uuid
from functools import partial
from types import SimpleNamespace

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
        c = Chart(user_id=u.id,
                  birth_input={"year":1990,"month":5,"day":12,"hour":12,"gender":"male"},
                  paipan={"sizhu":{"year":"庚午"}, "hourUnknown": False},
                  engine_version="0.1.0")
        db_session.add(c); await db_session.flush()
    return u, c, dek


def _fake_stream_fn(chunks: list[str], tokens: int = 30):
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
        # 验 cache 已写
        row = await chart_llm.get_cache_row(db_session, chart.id, "verdicts", "")
    assert row is not None
    assert row.content == "hello world"
    assert row.regen_count == 0


@pytest.mark.asyncio
async def test_stream_chart_llm_cache_hit_replays_without_llm(db_session, seeded, monkeypatch):
    from app.db_types import user_dek_context
    from app.services import chart_llm

    # Prime cache directly
    user, chart, dek = seeded
    with user_dek_context(dek):
        await chart_llm.upsert_cache(db_session,
            chart_id=chart.id, kind="verdicts", key="",
            content="cached content", model_used="mimo-v2-pro",
            tokens_used=50, regen_increment=False)
        await db_session.flush()
        cache_row = await chart_llm.get_cache_row(db_session, chart.id, "verdicts", "")

    # Guard: LLM client must NOT be called
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
    # events should contain model+delta*+done with source=cache
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
    assert row is None                                  # cache not written
    assert any(b'"type":"error"' in e for e in events)
```

- [ ] **Step 7.4: Append generator to `server/app/services/chart_llm.py`**

Append after the helpers:

```python
async def stream_chart_llm(
    db: AsyncSession, user: User, chart, *,
    kind: Literal["verdicts", "section", "dayun_step", "liunian"],
    key: str,
    force: bool,
    cache_row: ChartCache | None,
    ticket: QuotaTicket | None,
    build_messages: Callable[[dict, list], list[dict]],
    retrieval_kind: str,
    temperature: float = 0.7,
    max_tokens: int = 3000,
    tier: Literal["primary", "fast"] = "primary",
) -> AsyncIterator[bytes]:
    """Unified SSE generator. See spec §2.6."""
    # 1. Cache hit branch
    if cache_row and not force:
        async for raw in replay_cached(cache_row.content, cache_row.model_used):
            yield raw
        return

    # 2. Generate branch — retrieval first
    retrieved = []
    try:
        retrieved = await retrieve_for_chart(chart.paipan, retrieval_kind)
    except Exception:     # noqa: BLE001 — retrieval is best-effort
        retrieved = []
    if retrieved:
        yield sse_pack({"type": "retrieval",
                         "source": " + ".join(h["source"] for h in retrieved)})

    messages = build_messages(chart.paipan, retrieved)
    accumulated = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err: UpstreamLLMError | None = None

    try:
        async for ev in chat_stream_with_fallback(
            messages=messages, tier=tier,
            temperature=temperature, max_tokens=max_tokens,
        ):
            if ev["type"] == "model":
                model_used = ev["modelUsed"]
                yield sse_pack(ev)
            elif ev["type"] == "delta":
                accumulated += ev["text"]
                yield sse_pack(ev)
            elif ev["type"] == "done":
                prompt_tok = ev.get("prompt_tokens", 0)
                completion_tok = ev.get("completion_tokens", 0)
                total_tok = ev.get("tokens_used", 0)
                yield sse_pack({"type": "done",
                                 "full": accumulated,
                                 "tokens_used": total_tok})
    except UpstreamLLMError as e:
        err = e
        yield sse_pack({"type": "error", "code": e.code, "message": e.message})

    duration_ms = int((time.monotonic() - t_start) * 1000)

    if err is not None:
        # Log error attempt; don't write cache; don't commit ticket.
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint=kind, model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"{err.code}: {err.message}",
        )
        return

    # Success — UPSERT + log + ticket.commit
    await upsert_cache(
        db,
        chart_id=chart.id, kind=kind, key=key,
        content=accumulated, model_used=model_used, tokens_used=total_tok,
        regen_increment=(cache_row is not None and force),
    )
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart.id,
        endpoint=kind, model=model_used,
        prompt_tokens=prompt_tok, completion_tokens=completion_tok,
        duration_ms=duration_ms,
    )
    if ticket is not None:
        try:
            await ticket.commit()
        except Exception as e:   # noqa: BLE001 — race: other request pushed over limit
            # Best-effort: already wrote cache + log; emit in-band error.
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED",
                             "message": str(e)})
```

Run: `uv run --package server pytest server/tests/unit/test_chart_llm_generator.py -v`
Expected: 3 passed.

Full: `uv run --package server pytest server/tests/ -n auto`
Expected: 257 + 3 + 3 = 263 passed.

- [ ] **Step 7.5: Commit**

```bash
git add server/app/services/chart_llm.py \
        server/tests/unit/test_chart_llm_cache.py \
        server/tests/unit/test_chart_llm_generator.py
git commit -m "feat(server): chart_llm service (cache helpers + unified SSE generator)"
```

---

## Task 8: chart_chips + chart.recompute + quota.get_snapshot + /api/quota route

All four sub-pieces are small; group into one coherent task.

**Files:**
- Create: `server/app/services/chart_chips.py`
- Modify: `server/app/services/chart.py` (append `recompute`)
- Modify: `server/app/services/quota.py` (append `get_snapshot`)
- Create: `server/app/api/quota.py`
- Modify: `server/app/main.py` (include quota_router)
- Test: `server/tests/unit/test_quota_snapshot.py`
- Test: `server/tests/unit/test_chart_recompute_service.py`
- Test: `server/tests/integration/test_quota_route.py`
- Test: `server/tests/integration/test_charts_recompute.py`

- [ ] **Step 8.1: quota.get_snapshot test + impl**

Create `server/tests/unit/test_quota_snapshot.py`:

```python
"""quota.get_snapshot: merges QUOTAS[plan] with today's usage."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
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
async def user(db_session):
    from app.models.user import User
    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u); await db_session.flush()
    return u


@pytest.mark.asyncio
async def test_snapshot_empty_returns_all_kinds_used_0(db_session, user):
    from app.services.quota import get_snapshot
    snap = await get_snapshot(db_session, user)
    assert snap.plan == "free"
    assert set(snap.usage.keys()) == {"chat_message","section_regen","verdicts_regen",
                                       "dayun_regen","liunian_regen","gua","sms_send"}
    for u in snap.usage.values():
        assert u.used == 0


@pytest.mark.asyncio
async def test_snapshot_reflects_partial_usage(db_session, user):
    from app.core.quotas import today_beijing
    from app.services.quota import get_snapshot
    # Seed one row
    await db_session.execute(text("""
        INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
        VALUES (:uid, :p, 'chat_message', 3, now())
    """), {"uid": user.id, "p": today_beijing()})
    await db_session.flush()
    snap = await get_snapshot(db_session, user)
    assert snap.usage["chat_message"].used == 3
    assert snap.usage["gua"].used == 0


@pytest.mark.asyncio
async def test_snapshot_resets_at_is_next_midnight_beijing(db_session, user):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.services.quota import get_snapshot
    snap = await get_snapshot(db_session, user)
    ra = snap.usage["chat_message"].resets_at
    # Must be in Asia/Shanghai, at midnight
    beijing = ra.astimezone(ZoneInfo("Asia/Shanghai"))
    assert beijing.hour == 0 and beijing.minute == 0 and beijing.second == 0
```

Append to `server/app/services/quota.py`:

```python
from app.core.quotas import QUOTAS, next_midnight_beijing, today_beijing
from app.models.user import User
from app.schemas.quota import QuotaKindUsage, QuotaResponse

async def get_snapshot(db: AsyncSession, user: User) -> QuotaResponse:
    """Current Beijing-day quota snapshot for user, across all 7 kinds."""
    limits = QUOTAS.get(user.plan, QUOTAS["free"])
    period = today_beijing()
    rows = (await db.execute(text("""
        SELECT kind, count FROM quota_usage
         WHERE user_id = :uid AND period = :p
    """), {"uid": user.id, "p": period})).all()
    used_by_kind = {r.kind: r.count for r in rows}
    reset = next_midnight_beijing()

    usage = {}
    for kind, limit in limits.items():
        usage[kind] = QuotaKindUsage(
            used=used_by_kind.get(kind, 0), limit=limit, resets_at=reset,
        )
    return QuotaResponse(plan=user.plan, usage=usage)
```

Run: `uv run --package server pytest server/tests/unit/test_quota_snapshot.py -v`
Expected: 3 passed.

- [ ] **Step 8.2: chart.recompute service test + impl**

Create `server/tests/unit/test_chart_recompute_service.py`:

```python
"""chart.recompute: re-runs paipan + clears chart_cache."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
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
    import os as _os
    from app.db_types import user_dek_context
    from app.models.chart import Chart, ChartCache
    from app.models.user import User
    dek = _os.urandom(32)
    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u); await db_session.flush()
    with user_dek_context(dek):
        c = Chart(user_id=u.id,
                  birth_input={"year":1990,"month":5,"day":12,"hour":14,
                               "gender":"male","minute":0,"useTrueSolarTime":True,
                               "ziConvention":"early"},
                  paipan={"sizhu":{"year":"old"}, "hourUnknown": False},
                  engine_version="0.0.0")
        db_session.add(c); await db_session.flush()
        # Seed a cache row so we can verify it gets cleared
        cc = ChartCache(chart_id=c.id, kind="verdicts", key="",
                        content="stale", model_used="mimo-v2-pro",
                        tokens_used=10, regen_count=0)
        db_session.add(cc); await db_session.flush()
    return u, c, dek


@pytest.mark.asyncio
async def test_recompute_updates_paipan_and_engine_version(db_session, seeded):
    from app.db_types import user_dek_context
    from app.services.chart import recompute
    import paipan
    user, chart, dek = seeded
    with user_dek_context(dek):
        updated, warnings = await recompute(db_session, user, chart.id)
    assert updated.engine_version == paipan.VERSION
    assert updated.paipan.get("sizhu") != {"year":"old"}   # recomputed


@pytest.mark.asyncio
async def test_recompute_clears_chart_cache(db_session, seeded):
    from app.db_types import user_dek_context
    from app.services.chart import recompute
    user, chart, dek = seeded
    with user_dek_context(dek):
        await recompute(db_session, user, chart.id)
    await db_session.flush()
    rows = (await db_session.execute(
        text("SELECT count(*) FROM chart_cache WHERE chart_id = :cid"),
        {"cid": chart.id},
    )).scalar()
    assert rows == 0


@pytest.mark.asyncio
async def test_recompute_soft_deleted_raises_not_found(db_session, seeded):
    from app.db_types import user_dek_context
    from app.services.chart import recompute
    from app.services.exceptions import ChartNotFound
    user, chart, dek = seeded
    await db_session.execute(
        text("UPDATE charts SET deleted_at=now() WHERE id=:cid"),
        {"cid": chart.id},
    )
    await db_session.flush()
    with user_dek_context(dek):
        with pytest.raises(ChartNotFound):
            await recompute(db_session, user, chart.id)
```

Append `recompute` to `server/app/services/chart.py`:

```python
async def recompute(db: AsyncSession, user: User, chart_id: UUID) -> tuple[Chart, list[str]]:
    """Re-run paipan for chart and clear all chart_cache entries.

    Does NOT trigger LLM. Does NOT charge quota. Chart must be active
    (soft-deleted → ChartNotFound via get_chart default).
    """
    chart = await get_chart(db, user, chart_id)   # include_soft_deleted=False
    from app.schemas.chart import BirthInput
    birth = BirthInput(**chart.birth_input)
    paipan_dict, warnings, engine_version = paipan_adapter.run_paipan(birth)

    chart.paipan = paipan_dict
    chart.engine_version = engine_version
    chart.updated_at = datetime.now(tz=timezone.utc)
    await db.flush()

    await db.execute(text("DELETE FROM chart_cache WHERE chart_id = :cid"),
                     {"cid": chart.id})
    return chart, warnings
```

Run: `uv run --package server pytest server/tests/unit/test_chart_recompute_service.py -v`
Expected: 3 passed.

- [ ] **Step 8.3: chart_chips service**

Create `server/app/services/chart_chips.py`:

```python
"""chips SSE generator — FAST_MODEL, no cache, no quota, no retrieval."""
from __future__ import annotations

import time
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.client import chat_stream_with_fallback
from app.llm.events import sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.chart import Chart
from app.models.user import User
from app.prompts.chips import build_messages
from app.services.exceptions import UpstreamLLMError


async def stream_chips(db: AsyncSession, user: User, chart: Chart) -> AsyncIterator[bytes]:
    messages = build_messages(chart.paipan, history=[])
    accumulated = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err_code = err_msg = None

    try:
        async for ev in chat_stream_with_fallback(
            messages=messages, tier="fast",
            temperature=0.9, max_tokens=200,
        ):
            if ev["type"] == "model":
                model_used = ev["modelUsed"]; yield sse_pack(ev)
            elif ev["type"] == "delta":
                accumulated += ev["text"]; yield sse_pack(ev)
            elif ev["type"] == "done":
                prompt_tok = ev.get("prompt_tokens", 0)
                completion_tok = ev.get("completion_tokens", 0)
                total_tok = ev.get("tokens_used", 0)
                yield sse_pack({"type":"done","full":accumulated,"tokens_used":total_tok})
    except UpstreamLLMError as e:
        err_code, err_msg = e.code, e.message
        yield sse_pack({"type":"error","code":e.code,"message":e.message})

    duration_ms = int((time.monotonic() - t_start) * 1000)
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart.id,
        endpoint="chips", model=model_used,
        prompt_tokens=prompt_tok or None,
        completion_tokens=completion_tok or None,
        duration_ms=duration_ms,
        error=(f"{err_code}: {err_msg}" if err_code else None),
    )
```

(No standalone unit test — integration tests in Task 9 cover it.)

- [ ] **Step 8.4: `/api/quota` route + integration test**

Create `server/app/api/quota.py`:

```python
"""GET /api/quota — current Beijing-day quota snapshot for the authenticated user."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.quota import QuotaResponse
from app.services import quota as quota_service

router = APIRouter(tags=["quota"], dependencies=[Depends(current_user)])


@router.get("/api/quota", response_model=QuotaResponse)
async def get_quota(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> QuotaResponse:
    return await quota_service.get_snapshot(db, user)
```

Modify `server/app/main.py` — include `quota_router`:

```python
from app.api.quota import router as quota_router
...
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(charts_router)
app.include_router(quota_router)      # ← NEW
app.include_router(public_router)
```

Create `server/tests/integration/test_quota_route.py`:

```python
"""GET /api/quota."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user


@pytest.mark.asyncio
async def test_quota_unauthenticated_401(client):
    r = await client.get("/api/quota")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_quota_happy(client):
    cookie, user = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    r = await client.get("/api/quota", cookies={"session": cookie})
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "free"
    assert set(body["usage"].keys()) == {"chat_message","section_regen","verdicts_regen",
                                          "dayun_regen","liunian_regen","gua","sms_send"}
    for v in body["usage"].values():
        assert v["used"] == 0
        assert v["limit"] > 0
        assert "resets_at" in v


@pytest.mark.asyncio
async def test_quota_reflects_sms_usage(client, database_url):
    phone = f"+86139{uuid.uuid4().int % 10**8:08d}"
    # Registration burns 1 sms_send
    cookie, _ = await register_user(client, phone)
    r = await client.get("/api/quota", cookies={"session": cookie})
    body = r.json()
    assert body["usage"]["sms_send"]["used"] >= 1
```

Create `server/tests/integration/test_charts_recompute.py`:

```python
"""POST /api/charts/:id/recompute integration tests."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


async def _make(client, cookie, label="L"):
    body = {"birth_input":{"year":1990,"month":5,"day":12,"hour":12,"gender":"male"},
            "label": label}
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    assert r.status_code == 201
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_recompute_happy(client, database_url):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    # Tamper engine_version to pretend old
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(text("UPDATE charts SET engine_version='0.0.0' WHERE id=:cid"),
                        {"cid": cid})
        await s.commit()
    await engine.dispose()

    r = await client.post(f"/api/charts/{cid}/recompute", cookies={"session": cookie})
    assert r.status_code == 200
    body = r.json()
    assert body["cache_stale"] is False
    assert body["cache_slots"] == []
    import paipan
    assert body["chart"]["engine_version"] == paipan.VERSION


@pytest.mark.asyncio
async def test_recompute_clears_cache(client, database_url):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    # Seed a fake chart_cache row directly
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(text("""
            INSERT INTO chart_cache (chart_id, kind, key, content, model_used,
                                      tokens_used, generated_at, regen_count)
            VALUES (:cid, 'verdicts', '', 'stale', 'mimo-v2-pro', 10, now(), 0)
        """), {"cid": cid})
        await s.commit()
    await engine.dispose()

    r = await client.post(f"/api/charts/{cid}/recompute", cookies={"session": cookie})
    assert r.status_code == 200

    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        n = (await s.execute(text("SELECT count(*) FROM chart_cache WHERE chart_id=:cid"),
                              {"cid": cid})).scalar()
    await engine.dispose()
    assert n == 0


@pytest.mark.asyncio
async def test_recompute_cross_user_404(client):
    cookie_a, _ = await _register(client)
    cookie_b, _ = await _register(client)
    cid = await _make(client, cookie_a)
    r = await client.post(f"/api/charts/{cid}/recompute", cookies={"session": cookie_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_recompute_soft_deleted_404(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    r = await client.post(f"/api/charts/{cid}/recompute", cookies={"session": cookie})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_recompute_nonexistent_404(client):
    cookie, _ = await _register(client)
    r = await client.post(f"/api/charts/{uuid.uuid4()}/recompute", cookies={"session": cookie})
    assert r.status_code == 404
```

- [ ] **Step 8.5: Add recompute route to `app/api/charts.py`**

Append (before any existing SSE routes that come in Task 9):

```python
@router.post("/{chart_id}/recompute", response_model=ChartResponse)
async def recompute_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart, warnings = await chart_service.recompute(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db, warnings=warnings)
```

- [ ] **Step 8.6: 跑 Task 8 全部测试**

```bash
uv run --package server pytest server/tests/unit/test_quota_snapshot.py \
      server/tests/unit/test_chart_recompute_service.py \
      server/tests/integration/test_quota_route.py \
      server/tests/integration/test_charts_recompute.py -v
```
Expected: 3 + 3 + 3 + 5 = 14 passed.

Full: `uv run --package server pytest server/tests/ -n auto`
Expected: 263 + 14 = 277 passed.

- [ ] **Step 8.7: Commit**

```bash
git add server/app/services/chart_chips.py server/app/services/chart.py \
        server/app/services/quota.py server/app/api/quota.py \
        server/app/api/charts.py server/app/main.py \
        server/tests/unit/test_quota_snapshot.py \
        server/tests/unit/test_chart_recompute_service.py \
        server/tests/integration/test_quota_route.py \
        server/tests/integration/test_charts_recompute.py
git commit -m "feat(server): chart_chips + chart.recompute + quota snapshot + /api/quota route"
```

---

## Task 9: 5 SSE routes in `app/api/charts.py` + integration tests

**Files:**
- Modify: `server/app/api/charts.py` — 5 SSE route handlers (verdicts / sections / dayun / liunian / chips)
- Test: `server/tests/integration/test_sse_helpers.py` (conftest fixture for SSE parsing + fake openai client)
- Test: `server/tests/integration/test_charts_verdicts_sse.py`
- Test: `server/tests/integration/test_charts_sections_sse.py`
- Test: `server/tests/integration/test_charts_dayun_sse.py`
- Test: `server/tests/integration/test_charts_liunian_sse.py`
- Test: `server/tests/integration/test_charts_chips_sse.py`

- [ ] **Step 9.1: Shared SSE helper fixture**

Create `server/tests/integration/test_sse_helpers.py`:

```python
"""Helpers for consuming SSE + stubbing openai client in integration tests."""
from __future__ import annotations

import asyncio
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
        def __init__(self, c): self.choices = [SimpleNamespace(delta=SimpleNamespace(content=c),
                                                               finish_reason=None)]; self.usage=None
    class _Final:
        def __init__(self, tokens=30):
            self.choices=[SimpleNamespace(delta=SimpleNamespace(content=""),finish_reason="stop")]
            self.usage=SimpleNamespace(prompt_tokens=tokens//3,
                                       completion_tokens=tokens-tokens//3,
                                       total_tokens=tokens)

    async def _create(*, model, stream, **kw):
        assert stream is True
        if model in raise_on_model:
            raise RuntimeError(f"forced failure on {model}")
        if model not in prescribed:
            raise RuntimeError(f"no prescribed output for model {model}")
        chunks = prescribed[model]
        async def _gen():
            for d in chunks: yield _Chunk(d)
            yield _Final()
        return _gen()

    from app.llm import client as c
    monkeypatch.setattr(c._client.chat.completions, "create", _create)


async def consume_sse(client, url, *, cookies=None, json_body=None):
    """httpx AsyncClient streaming GET/POST; parse `data: {json}\n\n` events."""
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
```

- [ ] **Step 9.2: Add 5 SSE routes to `app/api/charts.py`**

Append to `server/app/api/charts.py` (after the `recompute_endpoint` from Task 8):

```python
from fastapi import Query
from fastapi.responses import StreamingResponse
from functools import partial

from app.schemas.llm import LiunianBody, SectionBody
from app.services import chart_llm as chart_llm_service
from app.services import chart_chips as chart_chips_service
from app.auth.deps import check_quota
from app.prompts import (
    chips as prompts_chips,
    dayun_step as prompts_dayun_step,
    liunian as prompts_liunian,
    sections as prompts_sections,
    verdicts as prompts_verdicts,
)

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/{chart_id}/verdicts")
async def verdicts_endpoint(
    chart_id: UUID,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    chart = await chart_service.get_chart(db, user, chart_id)
    cache = await chart_llm_service.get_cache_row(db, chart.id, "verdicts", "")
    ticket = await check_quota("verdicts_regen")(user=user, db=db) if (cache and force) else None

    async def _gen():
        async for raw in chart_llm_service.stream_chart_llm(
            db, user, chart,
            kind="verdicts", key="", force=force,
            cache_row=cache, ticket=ticket,
            build_messages=prompts_verdicts.build_messages,
            retrieval_kind="meta",
            temperature=0.7, max_tokens=5000, tier="primary",
        ):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/{chart_id}/sections")
async def sections_endpoint(
    chart_id: UUID, body: SectionBody,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    chart = await chart_service.get_chart(db, user, chart_id)
    cache = await chart_llm_service.get_cache_row(db, chart.id, "section", body.section)
    ticket = await check_quota("section_regen")(user=user, db=db) if (cache and force) else None

    async def _gen():
        async for raw in chart_llm_service.stream_chart_llm(
            db, user, chart,
            kind="section", key=body.section, force=force,
            cache_row=cache, ticket=ticket,
            build_messages=partial(prompts_sections.build_messages, section=body.section),
            retrieval_kind=f"section:{body.section}",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/{chart_id}/dayun/{index}")
async def dayun_endpoint(
    chart_id: UUID, index: int,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    if index < 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail={"code":"VALIDATION","message":"index<0"})
    chart = await chart_service.get_chart(db, user, chart_id)
    # Service-level range check (raises ValueError in build_messages → map to 422)
    dayun_count = len(chart.paipan.get("dayun") or [])
    if index >= dayun_count:
        from fastapi import HTTPException
        raise HTTPException(status_code=422,
                            detail={"code":"VALIDATION",
                                    "message":f"dayun index {index} out of range ({dayun_count})"})
    key = str(index)
    cache = await chart_llm_service.get_cache_row(db, chart.id, "dayun_step", key)
    ticket = await check_quota("dayun_regen")(user=user, db=db) if (cache and force) else None

    async def _gen():
        async for raw in chart_llm_service.stream_chart_llm(
            db, user, chart,
            kind="dayun_step", key=key, force=force,
            cache_row=cache, ticket=ticket,
            build_messages=partial(prompts_dayun_step.build_messages, step_index=index),
            retrieval_kind="dayun_step",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/{chart_id}/liunian")
async def liunian_endpoint(
    chart_id: UUID, body: LiunianBody,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    chart = await chart_service.get_chart(db, user, chart_id)
    dayun = chart.paipan.get("dayun") or []
    if body.dayun_index >= len(dayun):
        from fastapi import HTTPException
        raise HTTPException(status_code=422,
                            detail={"code":"VALIDATION","message":"dayun_index out of range"})
    key = f"{body.dayun_index}:{body.year_index}"
    cache = await chart_llm_service.get_cache_row(db, chart.id, "liunian", key)
    ticket = await check_quota("liunian_regen")(user=user, db=db) if (cache and force) else None

    async def _gen():
        async for raw in chart_llm_service.stream_chart_llm(
            db, user, chart,
            kind="liunian", key=key, force=force,
            cache_row=cache, ticket=ticket,
            build_messages=partial(prompts_liunian.build_messages,
                                    dayun_index=body.dayun_index,
                                    year_index=body.year_index),
            retrieval_kind="liunian",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/{chart_id}/chips")
async def chips_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    chart = await chart_service.get_chart(db, user, chart_id)

    async def _gen():
        async for raw in chart_chips_service.stream_chips(db, user, chart):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
```

- [ ] **Step 9.3: Verdicts SSE integration tests**

Create `server/tests/integration/test_charts_verdicts_sse.py`:

```python
"""SSE: POST /api/charts/:id/verdicts."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user
from tests.integration.test_sse_helpers import consume_sse, patch_llm_client


async def _make(client, cookie):
    body = {"birth_input":{"year":1990,"month":5,"day":12,"hour":12,"gender":"male"}}
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_verdicts_cache_miss_generates_and_writes(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro": ["整体判词：", "庚金带杀..."]})

    events = await consume_sse(client, f"/api/charts/{cid}/verdicts",
                                cookies={"session": cookie}, json_body={})
    types = [e["type"] for e in events]
    assert "model" in types and "delta" in types and "done" in types
    full = events[-1]["full"]
    assert "庚金" in full


@pytest.mark.asyncio
async def test_verdicts_cache_hit_replays(client, database_url, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    # Seed cache directly
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(text("""
            INSERT INTO chart_cache (chart_id, kind, key, content, model_used,
                                      tokens_used, generated_at, regen_count)
            VALUES (:cid, 'verdicts', '', 'cached text', 'mimo-v2-pro', 100, now(), 0)
        """), {"cid": cid})
        await s.commit()
    await engine.dispose()

    # LLM must NOT be called
    def _boom(**kw): raise AssertionError("no LLM on cache hit")
    from app.llm import client as c
    monkeypatch.setattr(c._client.chat.completions, "create", _boom)

    events = await consume_sse(client, f"/api/charts/{cid}/verdicts",
                                cookies={"session": cookie}, json_body={})
    sources = [e.get("source") for e in events]
    assert "cache" in sources
    assert events[-1]["full"] == "cached text"


@pytest.mark.asyncio
async def test_verdicts_force_no_cache_generates_without_quota(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro": ["first-gen"]})

    events = await consume_sse(client, f"/api/charts/{cid}/verdicts?force=true",
                                cookies={"session": cookie}, json_body={})
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_verdicts_force_cache_charges_regen_quota(client, database_url, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    # Seed cache
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(text("""
            INSERT INTO chart_cache (chart_id, kind, key, content, model_used,
                                      tokens_used, generated_at, regen_count)
            VALUES (:cid, 'verdicts', '', 'old', 'mimo-v2-pro', 50, now(), 0)
        """), {"cid": cid})
        await s.commit()
    await engine.dispose()
    patch_llm_client(monkeypatch, {"mimo-v2-pro": ["new content"]})

    events = await consume_sse(client, f"/api/charts/{cid}/verdicts?force=true",
                                cookies={"session": cookie}, json_body={})
    assert events[-1]["type"] == "done"
    assert events[-1]["full"] == "new content"

    # Quota used
    r = await client.get("/api/quota", cookies={"session": cookie})
    assert r.json()["usage"]["verdicts_regen"]["used"] == 1


@pytest.mark.asyncio
async def test_verdicts_force_regen_quota_exceeded_429(client, database_url, monkeypatch):
    cookie, user = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    # Seed cache + max-out verdicts_regen
    engine = create_async_engine(str(database_url))
    from app.core.quotas import QUOTAS, today_beijing
    limit = QUOTAS["free"]["verdicts_regen"]
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(text("""
            INSERT INTO chart_cache (chart_id, kind, key, content, model_used,
                                      tokens_used, generated_at, regen_count)
            VALUES (:cid, 'verdicts', '', 'old', 'mimo-v2-pro', 50, now(), 0)
        """), {"cid": cid})
        await s.execute(text("""
            INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
            VALUES (:uid, :p, 'verdicts_regen', :lim, now())
        """), {"uid": user["id"], "p": today_beijing(), "lim": limit})
        await s.commit()
    await engine.dispose()

    r = await client.post(f"/api/charts/{cid}/verdicts?force=true",
                           cookies={"session": cookie})
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "QUOTA_EXCEEDED"


@pytest.mark.asyncio
async def test_verdicts_llm_error_sse_error_no_cache(client, database_url, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":[], "mimo-v2-flash":[]},
                      raise_on_model={"mimo-v2-pro","mimo-v2-flash"})

    events = await consume_sse(client, f"/api/charts/{cid}/verdicts",
                                cookies={"session": cookie}, json_body={})
    assert any(e["type"] == "error" for e in events)

    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        n = (await s.execute(text("SELECT count(*) FROM chart_cache WHERE chart_id=:cid"),
                              {"cid": cid})).scalar()
    await engine.dispose()
    assert n == 0


@pytest.mark.asyncio
async def test_verdicts_fallback_takes_over_on_primary_error(client, monkeypatch):
    """Primary errors at create() → fallback fires and completes the stream.
    Emits exactly one model event (fallback). When primary streams some deltas
    then fails mid-stream, two model events would appear — covered in Task 3
    unit test test_chat_stream_primary_error_falls_back."""
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch,
                      {"mimo-v2-pro":[], "mimo-v2-flash":["fallback content"]},
                      raise_on_model={"mimo-v2-pro"})

    events = await consume_sse(client, f"/api/charts/{cid}/verdicts",
                                cookies={"session": cookie}, json_body={})
    models = [e["modelUsed"] for e in events if e["type"] == "model"]
    assert "mimo-v2-flash" in models
    assert events[-1]["full"] == "fallback content"


@pytest.mark.asyncio
async def test_verdicts_cross_user_404(client, monkeypatch):
    cookie_a, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cookie_b, _ = await register_user(client, f"+86139{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie_a)
    r = await client.post(f"/api/charts/{cid}/verdicts", cookies={"session": cookie_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_verdicts_unauthenticated_401(client):
    r = await client.post(f"/api/charts/{uuid.uuid4()}/verdicts")
    assert r.status_code == 401
```

- [ ] **Step 9.4: Sections SSE integration tests**

Create `server/tests/integration/test_charts_sections_sse.py` — 5 tests:
- happy per-section generates independent cache entry
- body validation: invalid section → 422
- same chart, different sections → 2 separate cache rows
- force + cache + regen quota exceeded → 429
- LLM error → SSE error event

(Pattern mirrors verdicts.py; condensed for brevity.)

```python
"""SSE: POST /api/charts/:id/sections."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user
from tests.integration.test_sse_helpers import consume_sse, patch_llm_client


async def _make(client, cookie):
    body = {"birth_input":{"year":1990,"month":5,"day":12,"hour":12,"gender":"male"}}
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_sections_career_happy(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":["事业段落"]})
    events = await consume_sse(client, f"/api/charts/{cid}/sections",
                                cookies={"session": cookie},
                                json_body={"section": "career"})
    assert events[-1]["full"] == "事业段落"


@pytest.mark.asyncio
async def test_sections_invalid_section_422(client):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    r = await client.post(f"/api/charts/{cid}/sections",
                           cookies={"session": cookie},
                           json={"section": "invalid"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_sections_independent_cache_per_section(client, database_url, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":["x"]})
    for sec in ("career","wealth"):
        await consume_sse(client, f"/api/charts/{cid}/sections",
                           cookies={"session": cookie},
                           json_body={"section": sec})
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        keys = [row.key for row in (await s.execute(
            text("SELECT key FROM chart_cache WHERE chart_id=:cid AND kind='section'"),
            {"cid": cid},
        )).all()]
    await engine.dispose()
    assert set(keys) == {"career", "wealth"}


@pytest.mark.asyncio
async def test_sections_force_regen_429_when_exhausted(client, database_url, monkeypatch):
    cookie, user = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    from app.core.quotas import QUOTAS, today_beijing
    limit = QUOTAS["free"]["section_regen"]
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(text("""
            INSERT INTO chart_cache (chart_id, kind, key, content, model_used,
                                      tokens_used, generated_at, regen_count)
            VALUES (:cid, 'section', 'career', 'old', 'mimo-v2-pro', 10, now(), 0)
        """), {"cid": cid})
        await s.execute(text("""
            INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
            VALUES (:uid, :p, 'section_regen', :lim, now())
        """), {"uid": user["id"], "p": today_beijing(), "lim": limit})
        await s.commit()
    await engine.dispose()
    r = await client.post(f"/api/charts/{cid}/sections?force=true",
                           cookies={"session": cookie},
                           json={"section":"career"})
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_sections_llm_error_sse_error(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":[],"mimo-v2-flash":[]},
                      raise_on_model={"mimo-v2-pro","mimo-v2-flash"})
    events = await consume_sse(client, f"/api/charts/{cid}/sections",
                                cookies={"session": cookie},
                                json_body={"section":"career"})
    assert any(e["type"] == "error" for e in events)
```

- [ ] **Step 9.5: Dayun/Liunian/Chips SSE tests (compact)**

Create `server/tests/integration/test_charts_dayun_sse.py`:

```python
"""SSE: POST /api/charts/:id/dayun/{index}."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user
from tests.integration.test_sse_helpers import consume_sse, patch_llm_client


async def _make(client, cookie):
    body = {"birth_input":{"year":1990,"month":5,"day":12,"hour":12,"gender":"male"}}
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_dayun_step_2_happy(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":["大运第3步..."]})
    events = await consume_sse(client, f"/api/charts/{cid}/dayun/2",
                                cookies={"session": cookie}, json_body={})
    assert events[-1]["full"] == "大运第3步..."


@pytest.mark.asyncio
async def test_dayun_out_of_range_422(client):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    r = await client.post(f"/api/charts/{cid}/dayun/99", cookies={"session": cookie})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_dayun_cache_key_is_index(client, database_url, monkeypatch):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":["x"]})
    await consume_sse(client, f"/api/charts/{cid}/dayun/3",
                       cookies={"session": cookie}, json_body={})
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        key = (await s.execute(
            text("SELECT key FROM chart_cache WHERE chart_id=:cid AND kind='dayun_step'"),
            {"cid": cid},
        )).scalar()
    await engine.dispose()
    assert key == "3"
```

Create `server/tests/integration/test_charts_liunian_sse.py`:

```python
"""SSE: POST /api/charts/:id/liunian."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user
from tests.integration.test_sse_helpers import consume_sse, patch_llm_client


async def _make(client, cookie):
    body = {"birth_input":{"year":1990,"month":5,"day":12,"hour":12,"gender":"male"}}
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_liunian_happy(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":["流年内容"]})
    events = await consume_sse(client, f"/api/charts/{cid}/liunian",
                                cookies={"session": cookie},
                                json_body={"dayun_index": 1, "year_index": 3})
    assert events[-1]["full"] == "流年内容"


@pytest.mark.asyncio
async def test_liunian_missing_body_422(client):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    r = await client.post(f"/api/charts/{cid}/liunian", cookies={"session": cookie},
                           json={"dayun_index": 0})   # missing year_index
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_liunian_cache_key_compound(client, database_url, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-pro":["x"]})
    await consume_sse(client, f"/api/charts/{cid}/liunian",
                       cookies={"session": cookie},
                       json_body={"dayun_index":2, "year_index":5})
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        key = (await s.execute(
            text("SELECT key FROM chart_cache WHERE chart_id=:cid AND kind='liunian'"),
            {"cid": cid},
        )).scalar()
    await engine.dispose()
    assert key == "2:5"
```

Create `server/tests/integration/test_charts_chips_sse.py`:

```python
"""SSE: POST /api/charts/:id/chips — FAST_MODEL, no cache, no quota."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user
from tests.integration.test_sse_helpers import consume_sse, patch_llm_client


async def _make(client, cookie):
    body = {"birth_input":{"year":1990,"month":5,"day":12,"hour":12,"gender":"male"}}
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_chips_happy(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-flash":['["事业?","婚姻?","财运?"]']})
    events = await consume_sse(client, f"/api/charts/{cid}/chips",
                                cookies={"session": cookie}, json_body={})
    # FAST_MODEL used
    model_evts = [e for e in events if e["type"] == "model"]
    assert any(m["modelUsed"] == "mimo-v2-flash" for m in model_evts)
    # Ends with done event
    assert events[-1]["type"] == "done"
    # (chips does NOT write cache — covered in test_chips_does_not_write_cache below)


@pytest.mark.asyncio
async def test_chips_does_not_write_cache(client, database_url, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-flash":["[]"]})
    await consume_sse(client, f"/api/charts/{cid}/chips",
                       cookies={"session": cookie}, json_body={})
    engine = create_async_engine(str(database_url))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        n = (await s.execute(text("SELECT count(*) FROM chart_cache WHERE chart_id=:cid"),
                              {"cid": cid})).scalar()
    await engine.dispose()
    assert n == 0


@pytest.mark.asyncio
async def test_chips_cross_user_404(client):
    cookie_a, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cookie_b, _ = await register_user(client, f"+86139{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie_a)
    r = await client.post(f"/api/charts/{cid}/chips", cookies={"session": cookie_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_chips_llm_error_emits_error_event(client, monkeypatch):
    cookie, _ = await register_user(client, f"+86138{uuid.uuid4().int % 10**8:08d}")
    cid = await _make(client, cookie)
    patch_llm_client(monkeypatch, {"mimo-v2-flash":[]}, raise_on_model={"mimo-v2-flash"})
    events = await consume_sse(client, f"/api/charts/{cid}/chips",
                                cookies={"session": cookie}, json_body={})
    assert any(e["type"] == "error" for e in events)
```

- [ ] **Step 9.6: 跑 Task 9 全部测试**

```bash
uv run --package server pytest \
    server/tests/integration/test_charts_verdicts_sse.py \
    server/tests/integration/test_charts_sections_sse.py \
    server/tests/integration/test_charts_dayun_sse.py \
    server/tests/integration/test_charts_liunian_sse.py \
    server/tests/integration/test_charts_chips_sse.py -v
```
Expected: 9 + 5 + 3 + 3 + 4 = 24 passed.

Full:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: 277 + 24 = 301 passed.

- [ ] **Step 9.7: Commit**

```bash
git add server/app/api/charts.py server/tests/integration/test_sse_helpers.py \
        server/tests/integration/test_charts_verdicts_sse.py \
        server/tests/integration/test_charts_sections_sse.py \
        server/tests/integration/test_charts_dayun_sse.py \
        server/tests/integration/test_charts_liunian_sse.py \
        server/tests/integration/test_charts_chips_sse.py
git commit -m "feat(server): 5 chart SSE routes (verdicts/sections/dayun/liunian/chips)"
```

---

## Task 10: ACCEPTANCE + wheel 冒烟 + 硬闸验收

**Files:**
- Rewrite: `server/ACCEPTANCE.md`（Plan 2+3+4+5 合并）

- [ ] **Step 10.1: 跑完整测试套件 + 覆盖率**

```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/plan5-llm-sse
time uv run --package server pytest server/tests/ -n auto
```
Expected: 301 passed; record wall-time (<60s target).

```bash
uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/
```
Expected: **≥85%** total coverage on `app/*`. If <85%, inspect per-module table and add targeted tests for uncovered branches BEFORE moving on (likely `app/llm/client.py` fallback paths).

- [ ] **Step 10.2: wheel 冒烟**

```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/plan5-llm-sse
uv build --package server
python3 -m venv /tmp/plan5-wheel-check
source /tmp/plan5-wheel-check/bin/activate
pip install --upgrade pip >/dev/null
pip install dist/server-*-py3-none-any.whl dist/paipan-*-py3-none-any.whl || \
    pip install /Users/veko/code/usual/bazi-analysis/.claude/worktrees/plan5-llm-sse/dist/server-0.1.0-py3-none-any.whl
export ENCRYPTION_KEK="00000000000000000000000000000000000000000000000000000000000000ab"
export DATABASE_URL="postgresql+asyncpg://placeholder:placeholder@localhost:1/placeholder"
export MIMO_API_KEY="dummy"
python -c "
from app.main import app
routes = sorted([(p, sorted(r.methods)) for r in app.routes
                 for p in ([r.path] if hasattr(r, 'methods') else [])])
for p, m in routes:
    print(m, p)
print(f'total: {len(routes)}')
"
deactivate
rm -rf /tmp/plan5-wheel-check
```

Expected output includes all 23 business routes (Plan 4's 17 + 6 new: verdicts, sections, dayun, liunian, chips, recompute) + /api/quota = 24 total.

- [ ] **Step 10.3: Rewrite `server/ACCEPTANCE.md`**

Replace the entire file with the Plan 2+3+4+5 combined acceptance:

```markdown
# server Backend — Acceptance Checklist

Plan 2 (Foundation) + Plan 3 (Auth Business) + Plan 4 (Charts CRUD + paipan) +
Plan 5 (Chart LLM SSE + Quota + Recompute) 合并状态。

## Hard Gates

- [x] **全部测试并行全绿**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **301 passed in <TIME>s** → ✅
- [x] **源码覆盖率 ≥ 85%**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **<PCT>%** → ✅
- [x] **并行 CI runtime < 60s** — Wall time: **<TIME>s** → ✅
- [x] **wheel 可装可跑** — 24 业务路由 (health + 7 auth + 2 sessions + 2 public
      + 6 charts CRUD + 5 chart SSE + recompute + /api/quota) → ✅
- [x] **Alembic 双向干净** (Plan 2/3 migrations 0001 + 0002 unchanged) → ✅
- [x] **chart SSE 路由 owner 校验** (跨用户 / 软删 / 不存在 统一 404) → ✅
- [x] **cache 命中 replay 零 LLM 调用** — `test_verdicts_cache_hit_replays` 中 boom
      fixture 保证 → ✅
- [x] **force + cache 存在扣 `<kind>_regen` 配额** — `test_verdicts_force_cache_charges_regen_quota` → ✅
- [x] **force + 无 cache 首次生成不扣配额** — `test_verdicts_force_no_cache_generates_without_quota` → ✅
- [x] **regen 配额超限 → 429 前置** — `test_verdicts_force_regen_quota_exceeded_429` → ✅
- [x] **LLM 双失败 → SSE error event + cache 未写 + ticket 未 commit** — `test_verdicts_llm_error_sse_error_no_cache` → ✅
- [x] **fallback 激活发 2 次 model event** — `test_verdicts_fallback_emits_two_model_events` → ✅
- [x] **recompute 清 chart_cache + 更新 engine_version + 不扣配额** → ✅
- [x] **chips 无 cache / 无 quota / FAST_MODEL** → ✅
- [x] **GET /api/quota 未登录 401 / 登录返 7 kinds** → ✅
- [x] **server/pyproject.toml 声明 openai>=1.40 + paipan workspace dep** → ✅
- [x] **Plan 2/3/4 现有 256 测试全部不回归** (`git diff main..HEAD -- server/app/auth/ server/app/api/auth.py server/app/api/sessions.py` 零修改) → ✅

## Route Inventory

| Method | Path | Auth | Plan |
|---|---|---|---|
| GET | `/api/health` | public | Plan 2 |
| GET | `/api/config` | public | Plan 4 |
| GET | `/api/cities` | public | Plan 4 |
| POST | `/api/auth/sms/send` | public | Plan 3 |
| POST | `/api/auth/register` | public | Plan 3 |
| POST | `/api/auth/login` | public | Plan 3 |
| POST | `/api/auth/logout` | user | Plan 3 |
| GET | `/api/auth/me` | user | Plan 3 |
| DELETE | `/api/auth/account` | user | Plan 3 |
| GET | `/api/auth/sessions` | user | Plan 3 |
| DELETE | `/api/auth/sessions/{id}` | user | Plan 3 |
| GET | `/api/charts` | user | Plan 4 |
| POST | `/api/charts` | user | Plan 4 |
| GET | `/api/charts/{id}` | user | Plan 4 |
| PATCH | `/api/charts/{id}` | user | Plan 4 |
| DELETE | `/api/charts/{id}` | user | Plan 4 |
| POST | `/api/charts/{id}/restore` | user | Plan 4 |
| POST | `/api/charts/{id}/recompute` | user | **Plan 5** |
| POST | `/api/charts/{id}/verdicts` | user SSE | **Plan 5** |
| POST | `/api/charts/{id}/sections` | user SSE | **Plan 5** |
| POST | `/api/charts/{id}/dayun/{index}` | user SSE | **Plan 5** |
| POST | `/api/charts/{id}/liunian` | user SSE | **Plan 5** |
| POST | `/api/charts/{id}/chips` | user SSE | **Plan 5** |
| GET | `/api/quota` | user | **Plan 5** |

## Handoff to Plan 6

以下 Plan 5 契约稳定，Plan 6（conversation 对话层）可复用：

- `app.llm.client.{chat_stream_with_fallback, chat_with_fallback, UpstreamLLMError}`
- `app.llm.events.{sse_pack, replay_cached}`
- `app.llm.logs.insert_llm_usage_log`
- `app.retrieval.service.retrieve_for_chart`
- `app.prompts.loader / context / anchor` (shared infra)
- `app.services.quota.get_snapshot`
- `app.schemas.quota.QuotaResponse`

Plan 6 新增 `app/prompts/router.py` / `expert.py` / `chat.py` / `gua.py` 同目录追加。

## Known non-blocking items

1. `POST /api/charts/:id/import`（localStorage 迁移）未实现 —— 单独短 plan。
2. 软删 30 天硬删 cron/worker 未实现 —— Plan 7 部署期。
3. `paipan.compute` 同步跑 —— C 阶段压测后再优化。
4. `LLM_STREAM_FIRST_DELTA_MS` 默认 0 —— Plan 7 监控 P50 定值。
5. `llm_usage_logs` 同步写 ~20ms —— B 阶段若影响响应时序再改。
6. chips 错误发 error event vs MVP 静默返空 —— Plan 7 前端侧处理。
7. `auth/deps.py:62` DEK contextvar `.set()` 无 `.reset()` —— 后续独立小 plan。
8. POST `/api/charts` 无 rate limit —— Plan 7 部署期 WAF/Nginx。
9. chips 无 history 上下文 —— Plan 6 补。

## Sign-off

Plan 5 在 Plan 2+3+4 之上执行。301 测试全绿 · 覆盖率 ≥85% · CI < 60s · wheel 可装可跑。
Plan 6 可在此基础上加 conversation 对话层。
```

Fill in `<TIME>s` / `<PCT>%` with actual numbers from Step 10.1.

- [ ] **Step 10.4: Final commit**

```bash
git add server/ACCEPTANCE.md
git commit -m "docs(server): Plan 5 acceptance (301 tests green, coverage ≥85%)"
```

- [ ] **Step 10.5: Final git log verify**

```bash
git log --oneline -15
```
Expected 10 Plan 5 commits preceded by the merge commit `a2aa245` and Plan 4 history.

---

## Recap — Plan 5 完成后的最终产出

- 10 个有序 commit
- 新文件：3 个 llm/ + 8 个 prompts/ + 2 个 retrieval/ + 2 个 services 新 + 2 个 schemas + 1 个 api/quota + 1 个 SSE helpers + 14 个测试文件
- 修改：`charts.py` (+6 路由) · `chart.py` (+recompute) · `quota.py` (+get_snapshot) · `exceptions.py` (+UpstreamLLMError) · `main.py` (+quota_router) · `config.py` (+5 env) · `pyproject.toml` (+openai +paipan dep)
- 新增路由：**7 条**（5 SSE + recompute + /api/quota）
- 测试：~102 条新增（合并 301 passed）
- 覆盖率 ≥ 85% · CI < 60s · wheel 可装可跑

Plan 5 完成后，Plan 6（conversations / messages / chat SSE / gua / intent router）可无缝接入。
