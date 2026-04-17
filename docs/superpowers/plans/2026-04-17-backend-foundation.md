# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `paipan/` 之上搭出 FastAPI 后端的"信任根"——HTTP 骨架 + Postgres + 加密层——为后续 auth/charts/LLM 业务 plan 铺路。

**Architecture:** FastAPI 单进程、async 全链路；SQLAlchemy 2.0 async + Alembic 管 Postgres 16；AES-256-GCM 信封加密（KEK → per-user DEK → 字段密文），用 `contextvars` 把 DEK 挂到请求上下文；加密对 ORM 透明（`EncryptedText` / `EncryptedJSONB` TypeDecorator）；测试用 testcontainers 起真实 Postgres。

**Tech Stack:** Python 3.12 · uv workspace · FastAPI · SQLAlchemy 2.0 (async) · Alembic · asyncpg · Postgres 16 · `cryptography` (AESGCM) · pydantic v2 · pydantic-settings · structlog · pytest · pytest-asyncio · testcontainers · httpx

---

## 设计约束（每一 task 必须遵守）

1. **不做业务路由**——除 `/api/health` 外，Plan 2 里任何 `app/api/` 子目录都不应出现
2. **`auth/deps.py` 所有函数必须是 `raise NotImplementedError`**——Plan 3 才实现
3. **每个 task 必须 commit 且 `uv run pytest` 绿**
4. **TDD**：红 → 绿 → 提交
5. **`# NOTE:` 注释标注关键 magic number / 决策来源**（承自 Plan 1 的纪律）
6. **不引入新依赖**（除 spec 明确列出的）
7. **`paipan/` 包不动**

## 目录最终形态（plan 执行完的样子）

```
bazi-analysis/
├── pyproject.toml                     # 修改：workspace members 加 "server"
├── paipan/                            # Plan 1 产出，不动
├── server/                            # ← 本 plan 产出
│   ├── pyproject.toml
│   ├── README.md
│   ├── .env.example
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 0001_baseline.py
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py
│   │   │   ├── logging.py
│   │   │   ├── db.py
│   │   │   └── crypto.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── chart.py
│   │   │   ├── conversation.py
│   │   │   └── quota.py
│   │   ├── db_types/
│   │   │   ├── __init__.py
│   │   │   ├── encrypted_text.py
│   │   │   └── encrypted_json.py
│   │   └── auth/
│   │       ├── __init__.py
│   │       └── deps.py
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   ├── unit/
│   │   │   ├── __init__.py
│   │   │   ├── test_config.py
│   │   │   ├── test_crypto.py
│   │   │   ├── test_logging.py
│   │   │   ├── test_encrypted_text.py
│   │   │   ├── test_encrypted_json.py
│   │   │   └── test_auth_deps.py
│   │   └── integration/
│   │       ├── __init__.py
│   │       ├── test_health.py
│   │       ├── test_lifespan.py
│   │       ├── test_migrations.py
│   │       ├── test_models.py
│   │       ├── test_crypto_shredding.py
│   │       └── test_dek_isolation.py
│   └── ACCEPTANCE.md
└── .github/workflows/
    └── server-ci.yml
```

---

## Phase A：骨架 + 工具链（3 tasks）

### Task 1: uv workspace 扩展 + server 包骨架

**Files:**
- Modify: `pyproject.toml`（workspace 根）
- Create: `server/pyproject.toml`
- Create: `server/README.md`
- Create: `server/.env.example`
- Create: `server/app/__init__.py`
- Create: `server/app/core/__init__.py`
- Create: `server/app/models/__init__.py`
- Create: `server/app/db_types/__init__.py`
- Create: `server/app/auth/__init__.py`
- Create: `server/tests/__init__.py`
- Create: `server/tests/unit/__init__.py`
- Create: `server/tests/integration/__init__.py`

- [ ] **Step 1: 扩展 workspace 根 `pyproject.toml`**

改 `pyproject.toml`（worktree 根）：
```toml
[tool.uv.workspace]
members = ["paipan", "server"]

[tool.pytest.ini_options]
testpaths = ["paipan/tests", "server/tests"]
addopts = "-ra --strict-markers"
pythonpath = ["."]
```

- [ ] **Step 2: 写 `server/pyproject.toml`**

```toml
[project]
name = "server"
version = "0.1.0"
description = "bazi-analysis FastAPI backend (foundation layer)"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "pydantic>=2.6",
    "pydantic-settings>=2.2",
    "sqlalchemy[asyncio]>=2.0.30",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "cryptography>=42.0",
    "structlog>=24.1",
    "httpx>=0.27",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-xdist>=3.5",
    "testcontainers[postgres]>=4.4",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["app"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: 写 `server/.env.example`**

```bash
# Environment mode: dev / prod / test
ENV=dev
LOG_LEVEL=INFO

# Postgres connection (asyncpg driver)
# Local dev: docker-compose up postgres 后
DATABASE_URL=postgresql+asyncpg://bazi:bazi@localhost:5432/bazi_dev

# Application-layer encryption key (64 hex chars = 32 bytes)
# Generate: python -c "import secrets; print(secrets.token_hex(32))"
# Sentinel __CHANGE_ME_64_HEX__ blocks startup
ENCRYPTION_KEK=__CHANGE_ME_64_HEX__

# Aliyun SMS (Plan 3 onwards)
ALIYUN_SMS_ACCESS_KEY=
ALIYUN_SMS_SECRET=
ALIYUN_SMS_TEMPLATE=
```

- [ ] **Step 4: 写 `server/README.md`**

```markdown
# server

FastAPI backend for bazi-analysis. Provides the HTTP/DB/encryption
foundation used by downstream plans (auth, charts, LLM).

## Dev quickstart

    # from repo root
    cp server/.env.example server/.env
    # edit .env: set DATABASE_URL and ENCRYPTION_KEK
    uv sync --package server --extra dev

    # run migrations (once a Postgres is up)
    uv run --package server alembic -c server/alembic.ini upgrade head

    # run tests (testcontainers will start its own Postgres)
    uv run --package server pytest server/tests/

    # run the app locally
    uv run --package server uvicorn app.main:app --reload
```

- [ ] **Step 5: 创建空 `__init__.py` 占位**

创建 9 个空 `__init__.py`：
- `server/app/__init__.py`
- `server/app/core/__init__.py`
- `server/app/models/__init__.py`
- `server/app/db_types/__init__.py`
- `server/app/auth/__init__.py`
- `server/tests/__init__.py`
- `server/tests/unit/__init__.py`
- `server/tests/integration/__init__.py`

全部空文件即可。

- [ ] **Step 6: 同步依赖验证**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/lucid-yalow-97b48c
uv sync --package server --extra dev
uv run --package server python -c "import fastapi, sqlalchemy, cryptography; print('OK')"
```
Expected: 输出 `OK`；`uv.lock` 被更新。

- [ ] **Step 7: 提交**

```bash
git add pyproject.toml server/pyproject.toml server/.env.example server/README.md \
        server/app/__init__.py server/app/core/__init__.py server/app/models/__init__.py \
        server/app/db_types/__init__.py server/app/auth/__init__.py \
        server/tests/__init__.py server/tests/unit/__init__.py server/tests/integration/__init__.py \
        uv.lock
git commit -m "chore(server): uv workspace member + package skeleton"
```

---

### Task 2: config + logging + FastAPI main + /api/health

**Files:**
- Create: `server/app/core/config.py`
- Create: `server/app/core/logging.py`
- Create: `server/app/main.py`
- Create: `server/tests/unit/test_config.py`
- Create: `server/tests/unit/test_logging.py`

- [ ] **Step 1: 写失败测试 `test_config.py`（红）**

```python
"""Unit tests for app.core.config.Settings."""
from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_settings_requires_database_url(monkeypatch):
    """Missing DATABASE_URL → ValidationError at construction time."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ENCRYPTION_KEK", "00" * 32)
    # Clear cached settings module
    import sys
    sys.modules.pop("app.core.config", None)
    with pytest.raises(ValidationError):
        from app.core.config import Settings
        Settings()


def test_settings_requires_encryption_kek(monkeypatch):
    """Missing ENCRYPTION_KEK → ValidationError."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h/d")
    monkeypatch.delenv("ENCRYPTION_KEK", raising=False)
    import sys
    sys.modules.pop("app.core.config", None)
    with pytest.raises(ValidationError):
        from app.core.config import Settings
        Settings()


def test_settings_loads_valid_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h/d")
    monkeypatch.setenv("ENCRYPTION_KEK", "aa" * 32)
    monkeypatch.setenv("ENV", "test")
    import sys
    sys.modules.pop("app.core.config", None)
    from app.core.config import Settings
    s = Settings()
    assert s.env == "test"
    assert str(s.database_url).startswith("postgresql+asyncpg://")
    assert s.encryption_kek == "aa" * 32
```

- [ ] **Step 2: 写失败测试 `test_logging.py`（红）**

```python
"""Unit tests for app.core.logging PII scrub."""
from __future__ import annotations


def test_scrub_drops_nonwhitelist_keys():
    from app.core.logging import _pii_scrub_processor

    out = _pii_scrub_processor(
        None, "info",
        {"event": "hi", "user_id": "u1", "phone": "138****", "password": "x"},
    )
    assert "event" in out
    assert "user_id" in out
    assert "phone" not in out
    assert "password" not in out


def test_scrub_keeps_all_whitelisted_keys():
    from app.core.logging import _pii_scrub_processor, _LOG_WHITELIST

    event = {k: "x" for k in _LOG_WHITELIST}
    out = _pii_scrub_processor(None, "info", dict(event))
    assert set(out.keys()) == _LOG_WHITELIST
```

- [ ] **Step 3: 运行测试验证失败**

Run:
```bash
uv run --package server pytest server/tests/unit/test_config.py server/tests/unit/test_logging.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.core.config'` 等。

- [ ] **Step 4: 写 `server/app/core/config.py`**

```python
"""Application settings loaded from environment.

Settings are instantiated at module import time — tests must set env vars
BEFORE importing any app module. See server/tests/conftest.py.
"""
from __future__ import annotations

from typing import Literal

from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["dev", "prod", "test"] = "dev"
    version: str = "0.1.0"
    log_level: str = "INFO"

    # Postgres (asyncpg driver)
    database_url: PostgresDsn

    # 32 字节 KEK，以 64 hex 字符传入；load_kek() 校验并转 bytes
    encryption_kek: str

    # Plan 3+ 预留；Plan 2 不使用
    aliyun_sms_access_key: str | None = None
    aliyun_sms_secret: str | None = None
    aliyun_sms_template: str | None = None


settings = Settings()
```

- [ ] **Step 5: 写 `server/app/core/logging.py`**

```python
"""structlog setup with PII-whitelist scrubber.

Only keys in ``_LOG_WHITELIST`` make it to log output; everything else is
dropped at the processor stage. This is a defense-in-depth layer; callers
should still avoid passing PII into log calls.
"""
from __future__ import annotations

import logging

import structlog


# NOTE: see spec §4.3 — whitelist must match audit requirements.
_LOG_WHITELIST: frozenset[str] = frozenset({
    "event", "level", "timestamp", "request_id",
    "user_id", "chart_id", "conversation_id",
    "endpoint", "method", "status", "duration_ms",
    "model", "tokens_used", "error_code",
})


def _pii_scrub_processor(logger, method_name, event_dict):
    """Drop any key not in the whitelist."""
    return {k: v for k, v in event_dict.items() if k in _LOG_WHITELIST}


def setup_logging(level: str = "INFO") -> None:
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(level=numeric_level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _pii_scrub_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        cache_logger_on_first_use=True,
    )
```

- [ ] **Step 6: 写 `server/app/main.py`**

```python
"""FastAPI entry point — foundation layer.

Only route: GET /api/health. Lifespan loads KEK (fails loudly on sentinel).
Business routes come in later plans.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)

    # KEK is loaded inside lifespan so tests that don't need it (e.g. health
    # smoke) can override via monkeypatch before import. The actual load_kek
    # function lands in Task 8; for now we stash the raw hex to prove the
    # lifespan path wires up.
    try:
        from app.core.crypto import load_kek
        app.state.kek = load_kek()
    except ImportError:
        # Task 8 not yet complete; health check still needs to work.
        app.state.kek = None
    yield


app = FastAPI(
    title="bazi-analysis backend",
    version=settings.version,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env == "dev" else None,
    redoc_url=None,
)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": settings.version, "env": settings.env}
```

**Note**: Task 8 移除 `try/except ImportError`——那时 `load_kek` 已存在且必须成功。

- [ ] **Step 7: 运行单测**

Run:
```bash
uv run --package server pytest server/tests/unit/test_config.py server/tests/unit/test_logging.py -v
```
Expected: 5 passed.

- [ ] **Step 8: 提交**

```bash
git add server/app/core/config.py server/app/core/logging.py server/app/main.py \
        server/tests/unit/test_config.py server/tests/unit/test_logging.py
git commit -m "feat(server): config + logging + FastAPI skeleton with /api/health"
```

---

### Task 3: testcontainers 基座 + 冒烟测试

**Files:**
- Create: `server/tests/conftest.py`
- Create: `server/tests/integration/test_health.py`

- [ ] **Step 1: 写 `server/tests/conftest.py`**

```python
"""Test fixtures. Sets env vars at module top BEFORE importing any app module.

conftest.py is imported by pytest before any test file, so any env setup here
happens before app.core.config.settings instantiates.
"""
from __future__ import annotations

import os

# Set test env BEFORE any `from app...` import anywhere in the test tree.
os.environ.setdefault("ENV", "test")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("ENCRYPTION_KEK", "00" * 32)  # all-zero test key
# Real database_url gets monkeypatched by postgres_container fixture below.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://placeholder:placeholder@localhost:1/placeholder")

# Now safe to import.
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="session")
def postgres_container():
    """One Postgres 16 container for the whole test session."""
    # NOTE: alpine keeps startup < 5s on most hosts.
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg


@pytest.fixture(scope="session")
def database_url(postgres_container) -> str:
    """asyncpg-flavored URL for tests that need to connect."""
    raw = postgres_container.get_connection_url()
    # testcontainers returns postgresql://; we want postgresql+asyncpg://
    return raw.replace("postgresql://", "postgresql+asyncpg://", 1)


@pytest_asyncio.fixture
async def async_client() -> AsyncIterator[AsyncClient]:
    """httpx AsyncClient bound to the FastAPI app via ASGI — no uvicorn."""
    from app.main import app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # lifespan is NOT triggered by ASGITransport alone; we need to run it.
        async with app.router.lifespan_context(app):
            yield client
```

- [ ] **Step 2: 写失败测试 `test_health.py`（红）**

```python
"""Integration test: /api/health returns 200."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_health_returns_ok(async_client):
    r = await async_client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["env"] == "test"
    assert "version" in body
```

- [ ] **Step 3: 运行测试**

Run:
```bash
uv run --package server pytest server/tests/integration/test_health.py -v
```
Expected: PASS（会拉一次 `postgres:16-alpine` 镜像，首次可能 30s+；后续 < 5s）。

- [ ] **Step 4: 提交**

```bash
git add server/tests/conftest.py server/tests/integration/test_health.py
git commit -m "test(server): testcontainers conftest + health smoke"
```

---

## Phase B：DB + 迁移（4 tasks）

### Task 4: core/db.py — AsyncEngine factory + get_db

**Files:**
- Create: `server/app/core/db.py`

- [ ] **Step 1: 写 `server/app/core/db.py`**

```python
"""SQLAlchemy async engine + session factory.

Engine is created lazily via ``create_engine_from_settings()`` so tests can
build a separate engine pointed at their testcontainers Postgres URL without
fighting a module-level singleton.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings


def create_engine_from_settings(url: str | None = None, **kwargs: Any) -> AsyncEngine:
    """Create an AsyncEngine.

    Args:
        url: overrides ``settings.database_url`` (used by tests).
        **kwargs: merged into engine kwargs.

    Default pool config: 5 + 10, pre-ping on.
    """
    defaults = {
        "pool_pre_ping": True,
        "pool_size": 5,
        "max_overflow": 10,
    }
    defaults.update(kwargs)
    return create_async_engine(url or str(settings.database_url), **defaults)


# Module-level singleton for production use (Plan 3+ routes). Tests build
# their own engine and don't touch this.
_engine: AsyncEngine | None = None
_session_maker: async_sessionmaker[AsyncSession] | None = None


def _ensure_engine() -> async_sessionmaker[AsyncSession]:
    global _engine, _session_maker
    if _session_maker is None:
        _engine = create_engine_from_settings()
        _session_maker = async_sessionmaker(_engine, expire_on_commit=False)
    return _session_maker


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yields an AsyncSession that commits on success
    and rolls back on exception."""
    maker = _ensure_engine()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Called from FastAPI lifespan shutdown."""
    global _engine, _session_maker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_maker = None
```

- [ ] **Step 2: 更新 `server/app/main.py` 的 lifespan 调用 dispose**

在 `lifespan` 函数里 `yield` 之后加：
```python
    yield
    from app.core.db import dispose_engine
    await dispose_engine()
```

完整 lifespan 现在是：
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)
    try:
        from app.core.crypto import load_kek
        app.state.kek = load_kek()
    except ImportError:
        app.state.kek = None
    yield
    from app.core.db import dispose_engine
    await dispose_engine()
```

- [ ] **Step 3: 验证既有测试仍通过**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: 6 passed（5 unit + 1 integration）。

- [ ] **Step 4: 提交**

```bash
git add server/app/core/db.py server/app/main.py
git commit -m "feat(server): AsyncEngine factory + get_db dependency"
```

---

### Task 5: ORM models — 10 表，未加密占位

**Files:**
- Create: `server/app/models/__init__.py`（覆盖 Task 1 创建的空文件）
- Create: `server/app/models/user.py`
- Create: `server/app/models/chart.py`
- Create: `server/app/models/conversation.py`
- Create: `server/app/models/quota.py`

**本 task 先用普通 `LargeBinary` 做敏感字段的占位；Task 11 把它们切换到 `EncryptedText` / `EncryptedJSONB`。**

- [ ] **Step 1: 写 `server/app/models/__init__.py`（Base + 全量 import）**

```python
"""SQLAlchemy declarative Base + model re-exports for Alembic autodiscovery."""
from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# NOTE: naming convention keeps generated constraint names deterministic so
# Alembic autogenerate diffs stay stable.
_NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=_NAMING_CONVENTION)


# Import all models so Base.metadata is populated when Alembic imports us.
from app.models.user import InviteCode, SmsCode, User, UserSession  # noqa: E402
from app.models.chart import Chart, ChartCache  # noqa: E402
from app.models.conversation import Conversation, Message  # noqa: E402
from app.models.quota import LlmUsageLog, QuotaUsage  # noqa: E402

__all__ = [
    "Base",
    "User", "InviteCode", "UserSession", "SmsCode",
    "Chart", "ChartCache",
    "Conversation", "Message",
    "QuotaUsage", "LlmUsageLog",
]
```

- [ ] **Step 2: 写 `server/app/models/user.py`**

```python
"""Account-side tables: users, invite_codes, sessions, sms_codes."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, SmallInteger,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import INET, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("status IN ('active','disabled')", name="status_enum"),
        CheckConstraint("role IN ('user','admin')", name="role_enum"),
        CheckConstraint("plan IN ('free','pro')", name="plan_enum"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    phone: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    phone_hash: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, unique=True)
    phone_last4: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    nickname: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'user'"))
    plan: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'free'"))
    plan_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True,
    )
    used_invite_code_id: Mapped[Optional[UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("invite_codes.id", ondelete="RESTRICT"), nullable=True,
    )
    wechat_openid: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    wechat_unionid: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    # KEK-encrypted per-user DEK (not itself DEK-encrypted; users has no DEK context yet).
    dek_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    dek_key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    created_by: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))


class UserSession(Base):
    # NOTE: class renamed from Session to avoid shadowing sqlalchemy.orm.Session
    # in downstream imports. Table name stays "sessions".
    __tablename__ = "sessions"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=text("now()"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SmsCode(Base):
    __tablename__ = "sms_codes"
    __table_args__ = (
        CheckConstraint("purpose IN ('register','login','bind')", name="purpose_enum"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
```

- [ ] **Step 3: 写 `server/app/models/chart.py`**

```python
"""Chart + chart_cache tables."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Chart(Base):
    __tablename__ = "charts"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    # Task 11 will swap these three to EncryptedText / EncryptedJSONB.
    label: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    birth_input: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    paipan: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    engine_version: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ChartCache(Base):
    __tablename__ = "chart_cache"
    __table_args__ = (
        CheckConstraint("kind IN ('verdicts','section','dayun_step','liunian')", name="kind_enum"),
        UniqueConstraint("chart_id", "kind", "key", name="uq_chart_cache_slot"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    chart_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("charts.id", ondelete="CASCADE"), nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    key: Mapped[str] = mapped_column(String(40), nullable=False, server_default=text("''"))
    # Task 11 → EncryptedText
    content: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    model_used: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=text("now()"))
    regen_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
```

- [ ] **Step 4: 写 `server/app/models/conversation.py`**

```python
"""Conversation + message tables."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String, text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    chart_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("charts.id", ondelete="RESTRICT"), nullable=False,
    )
    # Task 11 → EncryptedText
    label: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("role IN ('user','assistant','gua','cta')", name="role_enum"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    conversation_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # Task 11 → EncryptedText / EncryptedJSONB
    content: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    meta: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
```

- [ ] **Step 5: 写 `server/app/models/quota.py`**

```python
"""quota_usage + llm_usage_logs tables."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class QuotaUsage(Base):
    __tablename__ = "quota_usage"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('chat_message','section_regen','verdicts_regen',"
            "'dayun_regen','liunian_regen','gua','sms_send')",
            name="kind_enum",
        ),
        UniqueConstraint("user_id", "period", "kind", name="uq_quota_usage_slot"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    period: Mapped[str] = mapped_column(String(10), nullable=False)  # 'YYYY-MM-DD'
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))


class LlmUsageLog(Base):
    __tablename__ = "llm_usage_logs"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    chart_id: Mapped[Optional[UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("charts.id", ondelete="SET NULL"), nullable=True,
    )
    endpoint: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    intent: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
```

- [ ] **Step 6: 导入冒烟**

Run:
```bash
uv run --package server python -c "from app.models import Base; print(sorted(Base.metadata.tables.keys()))"
```
Expected: `['chart_cache', 'charts', 'conversations', 'invite_codes', 'llm_usage_logs', 'messages', 'quota_usage', 'sessions', 'sms_codes', 'users']`（10 张表）。

- [ ] **Step 7: 提交**

```bash
git add server/app/models/
git commit -m "feat(server): ORM models for 10 tables (encrypted fields as LargeBinary placeholders)"
```

---

### Task 6: Alembic init + async env.py

**Files:**
- Create: `server/alembic.ini`
- Create: `server/alembic/env.py`
- Create: `server/alembic/script.py.mako`
- Create: `server/alembic/versions/.gitkeep`

- [ ] **Step 1: 写 `server/alembic.ini`**

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

**Note**: `sqlalchemy.url` 留空——`env.py` 从 `app.core.config.settings` 读。

- [ ] **Step 2: 写 `server/alembic/script.py.mako`**

```python
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, Sequence[str], None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 3: 写 `server/alembic/env.py`（async 模式）**

```python
"""Alembic environment — async mode, reads URL from app.core.config.settings."""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import models so Base.metadata is populated.
from app.models import Base
from app.core.config import settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject URL from settings at runtime.
config.set_main_option("sqlalchemy.url", str(settings.database_url))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 4: 创建空 versions 目录**

Run:
```bash
mkdir -p server/alembic/versions
touch server/alembic/versions/.gitkeep
```

- [ ] **Step 5: 冒烟验证 alembic 可被调用**

Run:
```bash
cd server
uv run --package server alembic -c alembic.ini current 2>&1 | head
cd ..
```
Expected: 不抛 ImportError；可能显示 "Can't locate revision" 或类似提示（因为没连 DB）——这是正常的。关键是 `alembic` CLI 能加载 `env.py` 和 `settings`。

- [ ] **Step 6: 提交**

```bash
git add server/alembic.ini server/alembic/env.py server/alembic/script.py.mako \
        server/alembic/versions/.gitkeep
git commit -m "feat(server): Alembic async env.py"
```

---

### Task 7: 0001_baseline migration + migrations/models integration tests

**Files:**
- Create: `server/alembic/versions/0001_baseline.py`
- Create: `server/tests/integration/test_migrations.py`
- Create: `server/tests/integration/test_models.py`

- [ ] **Step 1: 写失败测试 `test_migrations.py`（红）**

```python
"""Migration roundtrip: upgrade head → downgrade base → upgrade head."""
from __future__ import annotations

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


@pytest.fixture
def alembic_config(database_url):
    """Alembic config pointed at the testcontainers Postgres."""
    sync_url = str(database_url).replace("postgresql+asyncpg://", "postgresql://")
    cfg = Config("server/alembic.ini")
    cfg.set_main_option("script_location", "server/alembic")
    cfg.set_main_option("sqlalchemy.url", sync_url)
    return cfg, sync_url


EXPECTED_TABLES = {
    "users", "invite_codes", "sessions", "sms_codes",
    "charts", "chart_cache",
    "conversations", "messages",
    "quota_usage", "llm_usage_logs",
    "alembic_version",
}


def test_upgrade_creates_all_tables(alembic_config):
    cfg, sync_url = alembic_config
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    engine = create_engine(sync_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert EXPECTED_TABLES.issubset(tables)
    engine.dispose()


def test_downgrade_removes_all_except_alembic_version(alembic_config):
    cfg, sync_url = alembic_config
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    engine = create_engine(sync_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert tables == {"alembic_version"}
    engine.dispose()
    # Restore head for subsequent tests.
    command.upgrade(cfg, "head")


def test_expected_indexes_present(alembic_config):
    cfg, sync_url = alembic_config
    command.upgrade(cfg, "head")
    engine = create_engine(sync_url)
    inspector = inspect(engine)
    indexes_by_table = {
        "charts": {ix["name"] for ix in inspector.get_indexes("charts")},
        "messages": {ix["name"] for ix in inspector.get_indexes("messages")},
        "sms_codes": {ix["name"] for ix in inspector.get_indexes("sms_codes")},
        "sessions": {ix["name"] for ix in inspector.get_indexes("sessions")},
    }
    assert "ix_charts_user_created" in indexes_by_table["charts"]
    assert "ix_messages_conv_created" in indexes_by_table["messages"]
    assert "ix_sms_phone_created" in indexes_by_table["sms_codes"]
    engine.dispose()
```

- [ ] **Step 2: 写失败测试 `test_models.py`（红）**

```python
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
```

- [ ] **Step 3: 运行，确认红**

Run:
```bash
uv run --package server pytest server/tests/integration/test_migrations.py -v
```
Expected: FAIL（没有 revision，或者 EXPECTED_TABLES 不匹配）。

- [ ] **Step 4: 写 `server/alembic/versions/0001_baseline.py`**

```python
"""baseline: create all 10 tables

Revision ID: 0001_baseline
Revises:
Create Date: 2026-04-17 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- users ----------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("phone", sa.String(20), nullable=False, unique=True),
        sa.Column("phone_hash", sa.LargeBinary, nullable=True, unique=True),
        sa.Column("phone_last4", sa.String(4), nullable=True),
        sa.Column("nickname", sa.String(40), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'active'")),
        sa.Column("role", sa.String(16), nullable=False, server_default=sa.text("'user'")),
        sa.Column("plan", sa.String(16), nullable=False, server_default=sa.text("'free'")),
        sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("used_invite_code_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("wechat_openid", sa.String(64), nullable=True, unique=True),
        sa.Column("wechat_unionid", sa.String(64), nullable=True, unique=True),
        sa.Column("dek_ciphertext", sa.LargeBinary, nullable=False),
        sa.Column("dek_key_version", sa.SmallInteger, nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('active','disabled')", name="ck_users_status_enum"),
        sa.CheckConstraint("role IN ('user','admin')", name="ck_users_role_enum"),
        sa.CheckConstraint("plan IN ('free','pro')", name="ck_users_plan_enum"),
    )

    # ---- invite_codes ---------------------------------------------------
    op.create_table(
        "invite_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT",
                                name="fk_invite_codes_created_by_users"),
                  nullable=False),
        sa.Column("max_uses", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("used_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )

    # Now that invite_codes exists, backfill FKs on users.
    op.create_foreign_key(
        "fk_users_invited_by_user_id_users",
        "users", "users",
        ["invited_by_user_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_users_used_invite_code_id_invite_codes",
        "users", "invite_codes",
        ["used_invite_code_id"], ["id"], ondelete="RESTRICT",
    )

    # ---- sessions -------------------------------------------------------
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE",
                                name="fk_sessions_user_id_users"),
                  nullable=False),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column("ip", postgresql.INET, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )

    # ---- sms_codes ------------------------------------------------------
    op.create_table(
        "sms_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("ip", postgresql.INET, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("purpose IN ('register','login','bind')",
                           name="ck_sms_codes_purpose_enum"),
    )
    op.create_index("ix_sms_phone_created", "sms_codes",
                    ["phone", sa.text("created_at DESC")])

    # ---- charts ---------------------------------------------------------
    op.create_table(
        "charts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT",
                                name="fk_charts_user_id_users"),
                  nullable=False),
        sa.Column("label", sa.LargeBinary, nullable=True),
        sa.Column("birth_input", sa.LargeBinary, nullable=False),
        sa.Column("paipan", sa.LargeBinary, nullable=False),
        sa.Column("engine_version", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_charts_user_created", "charts",
        ["user_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ---- chart_cache ----------------------------------------------------
    op.create_table(
        "chart_cache",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("chart_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("charts.id", ondelete="CASCADE",
                                name="fk_chart_cache_chart_id_charts"),
                  nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("key", sa.String(40), nullable=False, server_default=sa.text("''")),
        sa.Column("content", sa.LargeBinary, nullable=True),
        sa.Column("model_used", sa.String(32), nullable=True),
        sa.Column("tokens_used", sa.Integer, nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("regen_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.CheckConstraint("kind IN ('verdicts','section','dayun_step','liunian')",
                           name="ck_chart_cache_kind_enum"),
        sa.UniqueConstraint("chart_id", "kind", "key", name="uq_chart_cache_slot"),
    )

    # ---- conversations --------------------------------------------------
    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("chart_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("charts.id", ondelete="RESTRICT",
                                name="fk_conversations_chart_id_charts"),
                  nullable=False),
        sa.Column("label", sa.LargeBinary, nullable=True),
        sa.Column("position", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ---- messages -------------------------------------------------------
    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("conversations.id", ondelete="CASCADE",
                                name="fk_messages_conversation_id_conversations"),
                  nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.LargeBinary, nullable=True),
        sa.Column("meta", sa.LargeBinary, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("role IN ('user','assistant','gua','cta')",
                           name="ck_messages_role_enum"),
    )
    op.create_index("ix_messages_conv_created", "messages",
                    ["conversation_id", sa.text("created_at ASC")])

    # ---- quota_usage ----------------------------------------------------
    op.create_table(
        "quota_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT",
                                name="fk_quota_usage_user_id_users"),
                  nullable=False),
        sa.Column("period", sa.String(10), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "kind IN ('chat_message','section_regen','verdicts_regen',"
            "'dayun_regen','liunian_regen','gua','sms_send')",
            name="ck_quota_usage_kind_enum",
        ),
        sa.UniqueConstraint("user_id", "period", "kind", name="uq_quota_usage_slot"),
    )

    # ---- llm_usage_logs -------------------------------------------------
    op.create_table(
        "llm_usage_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL",
                                name="fk_llm_usage_logs_user_id_users"),
                  nullable=True),
        sa.Column("chart_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("charts.id", ondelete="SET NULL",
                                name="fk_llm_usage_logs_chart_id_charts"),
                  nullable=True),
        sa.Column("endpoint", sa.String(32), nullable=False),
        sa.Column("model", sa.String(32), nullable=False),
        sa.Column("prompt_tokens", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("completion_tokens", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column("intent", sa.String(24), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_llm_usage_logs_user_created", "llm_usage_logs",
                    ["user_id", sa.text("created_at DESC")])


def downgrade() -> None:
    # Reverse order; CASCADE FKs on messages / chart_cache handle themselves.
    op.drop_index("ix_llm_usage_logs_user_created", table_name="llm_usage_logs")
    op.drop_table("llm_usage_logs")
    op.drop_table("quota_usage")
    op.drop_index("ix_messages_conv_created", table_name="messages")
    op.drop_table("messages")
    op.drop_table("conversations")
    op.drop_table("chart_cache")
    op.drop_index("ix_charts_user_created", table_name="charts")
    op.drop_table("charts")
    op.drop_index("ix_sms_phone_created", table_name="sms_codes")
    op.drop_table("sms_codes")
    op.drop_table("sessions")
    # FKs on users → invite_codes must drop before invite_codes table.
    op.drop_constraint("fk_users_used_invite_code_id_invite_codes",
                       "users", type_="foreignkey")
    op.drop_constraint("fk_users_invited_by_user_id_users",
                       "users", type_="foreignkey")
    op.drop_table("invite_codes")
    op.drop_table("users")
```

- [ ] **Step 5: 运行两个新测试文件**

Run:
```bash
uv run --package server pytest server/tests/integration/test_migrations.py server/tests/integration/test_models.py -v
```
Expected: 全部 pass（3 migration tests + 4 model tests = 7 passed）。

- [ ] **Step 6: 跑完整 suite 确认没 regression**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: 13 passed（5 unit + 3 integration-phase-A + 7 integration-phase-B）。

- [ ] **Step 7: 提交**

```bash
git add server/alembic/versions/0001_baseline.py \
        server/tests/integration/test_migrations.py \
        server/tests/integration/test_models.py
git commit -m "feat(server): baseline Alembic migration + schema integration tests"
```

---

## Phase C：加密层（4 tasks）

### Task 8: core/crypto.py — KEK / DEK / AES-GCM 原语

**Files:**
- Create: `server/app/core/crypto.py`
- Create: `server/tests/unit/test_crypto.py`

- [ ] **Step 1: 写失败测试 `test_crypto.py`（红）**

```python
"""Unit tests for app.core.crypto — pure-function crypto primitives."""
from __future__ import annotations

import os

import pytest
from cryptography.exceptions import InvalidTag


# ---------- load_kek ---------------------------------------------------
def test_load_kek_reads_64_hex(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEK", "aa" * 32)
    import importlib
    import app.core.config as cfg
    importlib.reload(cfg)
    from app.core.crypto import load_kek
    kek = load_kek()
    assert isinstance(kek, bytes) and len(kek) == 32


def test_load_kek_rejects_sentinel(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEK", "__CHANGE_ME_64_HEX__")
    import importlib
    import app.core.config as cfg
    importlib.reload(cfg)
    from app.core.crypto import load_kek
    with pytest.raises(RuntimeError, match="sentinel"):
        load_kek()


def test_load_kek_rejects_invalid_hex(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEK", "zzz")
    import importlib
    import app.core.config as cfg
    importlib.reload(cfg)
    from app.core.crypto import load_kek
    with pytest.raises(ValueError):
        load_kek()


# ---------- generate_dek + encrypt_dek / decrypt_dek -------------------
def test_dek_roundtrip():
    from app.core.crypto import decrypt_dek, encrypt_dek, generate_dek
    kek = os.urandom(32)
    dek = generate_dek()
    assert len(dek) == 32
    ct = encrypt_dek(dek, kek)
    assert ct != dek
    recovered = decrypt_dek(ct, kek)
    assert recovered == dek


def test_decrypt_dek_rejects_tampered():
    from app.core.crypto import decrypt_dek, encrypt_dek, generate_dek
    kek = os.urandom(32)
    dek = generate_dek()
    ct = bytearray(encrypt_dek(dek, kek))
    ct[-1] ^= 0x01
    with pytest.raises(InvalidTag):
        decrypt_dek(bytes(ct), kek)


# ---------- encrypt_field / decrypt_field ------------------------------
@pytest.mark.parametrize("payload", [
    b"",
    b"a",
    b"Hello, world",
    "你好世界".encode("utf-8"),
    "🎉🌈".encode("utf-8"),
    b"x" * (1024 * 1024),  # 1 MiB
])
def test_field_roundtrip(payload):
    from app.core.crypto import decrypt_field, encrypt_field
    dek = os.urandom(32)
    ct = encrypt_field(payload, dek)
    assert ct != payload
    assert decrypt_field(ct, dek) == payload


def test_field_nonce_is_unique():
    """Same plaintext encrypted 1000 times should yield 1000 distinct nonces."""
    from app.core.crypto import encrypt_field
    dek = os.urandom(32)
    nonces = set()
    for _ in range(1000):
        ct = encrypt_field(b"same", dek)
        nonces.add(ct[:12])  # first 12 bytes = nonce
    assert len(nonces) == 1000


def test_field_tamper_ciphertext_raises():
    from app.core.crypto import decrypt_field, encrypt_field
    dek = os.urandom(32)
    ct = bytearray(encrypt_field(b"secret", dek))
    ct[-1] ^= 0x01
    with pytest.raises(InvalidTag):
        decrypt_field(bytes(ct), dek)


def test_field_tamper_nonce_raises():
    from app.core.crypto import decrypt_field, encrypt_field
    dek = os.urandom(32)
    ct = bytearray(encrypt_field(b"secret", dek))
    ct[0] ^= 0x01  # first byte is nonce
    with pytest.raises(InvalidTag):
        decrypt_field(bytes(ct), dek)


def test_field_wrong_key_raises():
    from app.core.crypto import decrypt_field, encrypt_field
    dek_a = os.urandom(32)
    dek_b = os.urandom(32)
    ct = encrypt_field(b"secret", dek_a)
    with pytest.raises(InvalidTag):
        decrypt_field(ct, dek_b)
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
uv run --package server pytest server/tests/unit/test_crypto.py -v
```
Expected: ImportError on `app.core.crypto`。

- [ ] **Step 3: 写 `server/app/core/crypto.py`**

```python
"""Envelope encryption primitives.

Layers:
    KEK (32 bytes, process-global)
      ↓ AES-256-GCM
    DEK (32 bytes, per user)
      ↓ AES-256-GCM
    field ciphertext (nonce || tagged_ct)

Ciphertext format: ``nonce (12B) || aesgcm_ciphertext_with_tag``.
"""
from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

# NOTE: AES-GCM standard nonce size.
NONCE_SIZE = 12
KEY_SIZE = 32
_SENTINEL = "__CHANGE_ME_64_HEX__"


def load_kek() -> bytes:
    """Read settings.encryption_kek (64 hex) → 32 bytes. Fails loudly."""
    raw = settings.encryption_kek
    if raw == _SENTINEL:
        raise RuntimeError(
            "sentinel ENCRYPTION_KEK detected — generate a real key: "
            "python -c 'import secrets; print(secrets.token_hex(32))'"
        )
    kek = bytes.fromhex(raw)  # raises ValueError if not hex
    if len(kek) != KEY_SIZE:
        raise ValueError(f"KEK must be {KEY_SIZE} bytes, got {len(kek)}")
    return kek


def generate_dek() -> bytes:
    """Generate a fresh 32-byte DEK."""
    return os.urandom(KEY_SIZE)


def _encrypt(plaintext: bytes, key: bytes) -> bytes:
    aesgcm = AESGCM(key)
    nonce = os.urandom(NONCE_SIZE)
    ct = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    return nonce + ct


def _decrypt(ciphertext: bytes, key: bytes) -> bytes:
    if len(ciphertext) < NONCE_SIZE:
        # InvalidTag would be raised below anyway, but short-circuit.
        from cryptography.exceptions import InvalidTag
        raise InvalidTag("ciphertext shorter than nonce size")
    nonce, ct = ciphertext[:NONCE_SIZE], ciphertext[NONCE_SIZE:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, associated_data=None)


def encrypt_dek(dek: bytes, kek: bytes) -> bytes:
    """Wrap a user DEK with the process KEK."""
    return _encrypt(dek, kek)


def decrypt_dek(ciphertext: bytes, kek: bytes) -> bytes:
    """Unwrap a user DEK. Raises InvalidTag if tampered."""
    return _decrypt(ciphertext, kek)


def encrypt_field(plaintext: bytes, dek: bytes) -> bytes:
    """Encrypt a single field's bytes with the user DEK."""
    return _encrypt(plaintext, dek)


def decrypt_field(ciphertext: bytes, dek: bytes) -> bytes:
    """Decrypt a field. Raises InvalidTag on tamper / wrong key."""
    return _decrypt(ciphertext, dek)
```

- [ ] **Step 4: 更新 `server/app/main.py` 去掉 try/except**

改 `lifespan`：
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)
    from app.core.crypto import load_kek
    app.state.kek = load_kek()
    yield
    from app.core.db import dispose_engine
    await dispose_engine()
```

- [ ] **Step 5: 写 `test_lifespan.py`（sentinel KEK 让 lifespan 启动失败）**

创建 `server/tests/integration/test_lifespan.py`：

```python
"""Lifespan: sentinel KEK must raise before yielding."""
from __future__ import annotations

import importlib

import pytest


@pytest.mark.asyncio
async def test_sentinel_kek_fails_startup(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEK", "__CHANGE_ME_64_HEX__")
    # Force fresh settings + main import so the sentinel is read.
    import app.core.config as cfg
    importlib.reload(cfg)
    import app.main as main_mod
    importlib.reload(main_mod)

    with pytest.raises(RuntimeError, match="sentinel"):
        async with main_mod.app.router.lifespan_context(main_mod.app):
            pass
```

- [ ] **Step 6: 运行**

Run:
```bash
uv run --package server pytest server/tests/unit/test_crypto.py server/tests/integration/test_lifespan.py -v
```
Expected: 全部 pass（约 14 个 crypto tests + 1 lifespan test）。

完整 suite：
```bash
uv run --package server pytest server/tests/ -v
```
Expected: ~28 passed。

- [ ] **Step 7: 提交**

```bash
git add server/app/core/crypto.py server/app/main.py \
        server/tests/unit/test_crypto.py server/tests/integration/test_lifespan.py
git commit -m "feat(server): AES-256-GCM envelope crypto + lifespan KEK load"
```

---

### Task 9: db_types + EncryptedText + contextvars

**Files:**
- Modify: `server/app/db_types/__init__.py`（覆盖 Task 1 空文件）
- Create: `server/app/db_types/encrypted_text.py`
- Create: `server/tests/unit/test_encrypted_text.py`

- [ ] **Step 1: 写失败测试 `test_encrypted_text.py`（红）**

```python
"""EncryptedText TypeDecorator — contextvars DEK + transparent crypto."""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy import Column, MetaData, String, Table
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def ephemeral_table(database_url):
    """A tiny throwaway table using EncryptedText, created per-test."""
    from app.db_types.encrypted_text import EncryptedText
    engine = create_async_engine(database_url)
    meta = MetaData()
    t = Table(
        "t_encrypted_text_test",
        meta,
        Column("id", String(8), primary_key=True),
        Column("val", EncryptedText, nullable=True),
    )
    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
        await conn.run_sync(meta.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield t, maker
    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_roundtrip_under_dek_context(ephemeral_table):
    from app.db_types import user_dek_context
    t, maker = ephemeral_table
    dek = os.urandom(32)

    with user_dek_context(dek):
        async with maker() as s:
            await s.execute(t.insert().values(id="a", val="hello 你好"))
            await s.commit()
            row = (await s.execute(t.select())).first()
            assert row.val == "hello 你好"


@pytest.mark.asyncio
async def test_stored_bytes_differ_from_plaintext(ephemeral_table):
    """Read raw bytea via a separate connection without DEK context."""
    from sqlalchemy import text
    from app.db_types import user_dek_context
    t, maker = ephemeral_table
    dek = os.urandom(32)

    with user_dek_context(dek):
        async with maker() as s:
            await s.execute(t.insert().values(id="b", val="plaintext"))
            await s.commit()

    # Raw read — no DEK context, use a plain SELECT for bytes column.
    async with maker() as s:
        raw = await s.execute(text("SELECT val FROM t_encrypted_text_test WHERE id = 'b'"))
        stored = raw.scalar_one()
        assert stored != b"plaintext"
        assert len(stored) > len(b"plaintext")  # nonce + tag overhead


@pytest.mark.asyncio
async def test_missing_dek_context_raises(ephemeral_table):
    t, maker = ephemeral_table
    async with maker() as s:
        with pytest.raises(RuntimeError, match="no DEK in context"):
            await s.execute(t.insert().values(id="c", val="x"))
            await s.commit()


@pytest.mark.asyncio
async def test_cross_dek_read_raises(ephemeral_table):
    from cryptography.exceptions import InvalidTag
    from app.db_types import user_dek_context
    t, maker = ephemeral_table
    dek_a = os.urandom(32)
    dek_b = os.urandom(32)

    with user_dek_context(dek_a):
        async with maker() as s:
            await s.execute(t.insert().values(id="d", val="cross"))
            await s.commit()

    with user_dek_context(dek_b):
        async with maker() as s:
            with pytest.raises(InvalidTag):
                row = (await s.execute(t.select().where(t.c.id == "d"))).first()
                _ = row.val


@pytest.mark.asyncio
async def test_null_value_roundtrip(ephemeral_table):
    from app.db_types import user_dek_context
    t, maker = ephemeral_table
    dek = os.urandom(32)

    with user_dek_context(dek):
        async with maker() as s:
            await s.execute(t.insert().values(id="e", val=None))
            await s.commit()
            row = (await s.execute(t.select().where(t.c.id == "e"))).first()
            assert row.val is None
```

- [ ] **Step 2: 写 `server/app/db_types/__init__.py`**

```python
"""Encrypted SQLAlchemy column types + request-scoped DEK context."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

_current_dek: ContextVar[Optional[bytes]] = ContextVar("user_dek", default=None)


def get_current_dek() -> Optional[bytes]:
    """Return the DEK for the current async task / request, or None."""
    return _current_dek.get()


@contextmanager
def user_dek_context(dek: bytes) -> Iterator[bytes]:
    """Bind a DEK for the duration of the ``with`` block.

    ORM code inside the block transparently encrypts/decrypts
    EncryptedText / EncryptedJSONB columns with this DEK. Reset on exit.
    """
    token = _current_dek.set(dek)
    try:
        yield dek
    finally:
        _current_dek.reset(token)


# Re-export the type classes (imported lazily by alembic / models).
from app.db_types.encrypted_text import EncryptedText  # noqa: E402

__all__ = ["EncryptedText", "user_dek_context", "get_current_dek"]
```

- [ ] **Step 3: 写 `server/app/db_types/encrypted_text.py`**

```python
"""EncryptedText — transparent per-user AES-256-GCM column encryption."""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import LargeBinary
from sqlalchemy.types import TypeDecorator


class EncryptedText(TypeDecorator):
    """Python ``str`` ↔ Postgres ``bytea`` (AES-GCM ciphertext).

    Requires an active ``user_dek_context()`` — outside one, ``process_*``
    raises RuntimeError. NULL values pass through unencrypted.
    """

    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: Optional[str], dialect: Any) -> Optional[bytes]:
        if value is None:
            return None
        # Lazy import to dodge circular imports during model collection.
        from app.core.crypto import encrypt_field
        from app.db_types import get_current_dek

        dek = get_current_dek()
        if dek is None:
            raise RuntimeError(
                "no DEK in context — wrap this ORM op in user_dek_context()"
            )
        return encrypt_field(value.encode("utf-8"), dek)

    def process_result_value(self, value: Optional[bytes], dialect: Any) -> Optional[str]:
        if value is None:
            return None
        from app.core.crypto import decrypt_field
        from app.db_types import get_current_dek

        dek = get_current_dek()
        if dek is None:
            raise RuntimeError(
                "no DEK in context — wrap this ORM op in user_dek_context()"
            )
        return decrypt_field(value, dek).decode("utf-8")
```

- [ ] **Step 4: 运行测试**

Run:
```bash
uv run --package server pytest server/tests/unit/test_encrypted_text.py -v
```
Expected: 5 passed。

- [ ] **Step 5: 跑完整 suite**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: ~33 passed。

- [ ] **Step 6: 提交**

```bash
git add server/app/db_types/__init__.py server/app/db_types/encrypted_text.py \
        server/tests/unit/test_encrypted_text.py
git commit -m "feat(server): EncryptedText TypeDecorator + contextvars DEK"
```

---

### Task 10: EncryptedJSONB

**Files:**
- Create: `server/app/db_types/encrypted_json.py`
- Modify: `server/app/db_types/__init__.py`（导出新类型）
- Create: `server/tests/unit/test_encrypted_json.py`

- [ ] **Step 1: 写失败测试 `test_encrypted_json.py`（红）**

```python
"""EncryptedJSONB — dict/list payloads, NULL passthrough, nested objects."""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy import Column, MetaData, String, Table
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def ephemeral_json_table(database_url):
    from app.db_types.encrypted_json import EncryptedJSONB
    engine = create_async_engine(database_url)
    meta = MetaData()
    t = Table(
        "t_encrypted_json_test",
        meta,
        Column("id", String(8), primary_key=True),
        Column("val", EncryptedJSONB, nullable=True),
    )
    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
        await conn.run_sync(meta.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield t, maker
    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [
    {"k": "v"},
    {"nested": {"a": 1, "b": [1, 2, 3]}},
    [1, "two", {"three": 3}, None],
    {"chinese": "你好", "emoji": "🌸"},
    {},
    [],
])
async def test_json_roundtrip(ephemeral_json_table, payload):
    from app.db_types import user_dek_context
    t, maker = ephemeral_json_table
    dek = os.urandom(32)
    with user_dek_context(dek):
        async with maker() as s:
            await s.execute(t.insert().values(id="x", val=payload))
            await s.commit()
            row = (await s.execute(t.select())).first()
            assert row.val == payload


@pytest.mark.asyncio
async def test_json_null_passthrough(ephemeral_json_table):
    from app.db_types import user_dek_context
    t, maker = ephemeral_json_table
    dek = os.urandom(32)
    with user_dek_context(dek):
        async with maker() as s:
            await s.execute(t.insert().values(id="n", val=None))
            await s.commit()
            row = (await s.execute(t.select().where(t.c.id == "n"))).first()
            assert row.val is None


@pytest.mark.asyncio
async def test_json_missing_dek_context_raises(ephemeral_json_table):
    t, maker = ephemeral_json_table
    async with maker() as s:
        with pytest.raises(RuntimeError, match="no DEK in context"):
            await s.execute(t.insert().values(id="z", val={"k": 1}))
            await s.commit()
```

- [ ] **Step 2: 写 `server/app/db_types/encrypted_json.py`**

```python
"""EncryptedJSONB — transparent per-user AES-256-GCM encryption of JSON payloads.

Serialization: ``json.dumps(value, ensure_ascii=False).encode("utf-8")`` →
AES-GCM → bytea. Inverse on read.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import LargeBinary
from sqlalchemy.types import TypeDecorator


class EncryptedJSONB(TypeDecorator):
    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: Optional[Any], dialect: Any) -> Optional[bytes]:
        if value is None:
            return None
        from app.core.crypto import encrypt_field
        from app.db_types import get_current_dek

        dek = get_current_dek()
        if dek is None:
            raise RuntimeError(
                "no DEK in context — wrap this ORM op in user_dek_context()"
            )
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        return encrypt_field(payload, dek)

    def process_result_value(self, value: Optional[bytes], dialect: Any) -> Optional[Any]:
        if value is None:
            return None
        from app.core.crypto import decrypt_field
        from app.db_types import get_current_dek

        dek = get_current_dek()
        if dek is None:
            raise RuntimeError(
                "no DEK in context — wrap this ORM op in user_dek_context()"
            )
        return json.loads(decrypt_field(value, dek).decode("utf-8"))
```

- [ ] **Step 3: 更新 `server/app/db_types/__init__.py` 导出**

改最后几行：
```python
from app.db_types.encrypted_text import EncryptedText  # noqa: E402
from app.db_types.encrypted_json import EncryptedJSONB  # noqa: E402

__all__ = ["EncryptedText", "EncryptedJSONB", "user_dek_context", "get_current_dek"]
```

- [ ] **Step 4: 运行测试**

Run:
```bash
uv run --package server pytest server/tests/unit/test_encrypted_json.py -v
```
Expected: 8 passed。

- [ ] **Step 5: 完整 suite**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: ~41 passed。

- [ ] **Step 6: 提交**

```bash
git add server/app/db_types/encrypted_json.py server/app/db_types/__init__.py \
        server/tests/unit/test_encrypted_json.py
git commit -m "feat(server): EncryptedJSONB TypeDecorator"
```

---

### Task 11: 把 models 的敏感字段切到加密类型

**Files:**
- Modify: `server/app/models/chart.py`
- Modify: `server/app/models/conversation.py`
- Modify: `server/app/models/quota.py`（不改，但确认不受影响）
- Modify: `server/tests/integration/test_models.py`

> Alembic migration 不需要改：加密字段本来就是 `LargeBinary` 底层；模型层换 type 只影响 Python 端处理，不影响 Postgres schema。

- [ ] **Step 1: 修改 `server/app/models/chart.py`**

把 `Chart.label` / `Chart.birth_input` / `Chart.paipan` / `ChartCache.content` 的 `LargeBinary` 换成 `EncryptedText` 或 `EncryptedJSONB`：

```python
# 顶部 imports 加：
from app.db_types import EncryptedJSONB, EncryptedText
```

`Chart`：
```python
    label: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    birth_input: Mapped[dict] = mapped_column(EncryptedJSONB, nullable=False)
    paipan: Mapped[dict] = mapped_column(EncryptedJSONB, nullable=False)
```

`ChartCache`：
```python
    content: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
```

- [ ] **Step 2: 修改 `server/app/models/conversation.py`**

```python
from app.db_types import EncryptedJSONB, EncryptedText
```

`Conversation`：
```python
    label: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
```

`Message`：
```python
    content: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    meta: Mapped[Optional[dict]] = mapped_column(EncryptedJSONB, nullable=True)
```

- [ ] **Step 3: 重写 `test_models.py` 包 `user_dek_context`**

**关键**：
- `User.dek_ciphertext` 是 `LargeBinary`（KEK-加密，不走 DEK），所以 users-only 操作可在 context 外
- `Chart.birth_input` / `Chart.paipan` / `Message.content` / `Message.meta` / `Conversation.label` 等走 DEK，**必须**在 `user_dek_context` 里
- `birth_input` / `paipan` 现在是 `EncryptedJSONB`，payload 类型从 `b"{}"` 改成 `dict`

完整替换 `server/tests/integration/test_models.py`：

```python
"""Per-model smoke tests under user_dek_context."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

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


@pytest.fixture
def test_dek() -> bytes:
    return os.urandom(32)


async def test_insert_user(db_session: AsyncSession):
    """users.dek_ciphertext is LargeBinary (KEK-wrapped) — no DEK context needed."""
    from app.models import User
    u = User(phone="+8613800000001", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    assert u.id is not None
    assert u.status == "active"
    assert u.role == "user"
    assert u.plan == "free"


async def test_insert_chart_with_fk_user(db_session: AsyncSession, test_dek):
    """Chart.birth_input / .paipan are EncryptedJSONB → DEK context required."""
    from app.db_types import user_dek_context
    from app.models import Chart, User

    u = User(phone="+8613800000002", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()

    with user_dek_context(test_dek):
        c = Chart(
            user_id=u.id,
            birth_input={"year": 1990, "month": 5, "day": 15},
            paipan={"sizhu": {"year": "庚午"}},
            engine_version="0.1.0",
        )
        db_session.add(c)
        await db_session.flush()
        assert c.id is not None
        # Round-trip still works inside the same context.
        await db_session.refresh(c)
        assert c.birth_input["year"] == 1990


async def test_cascade_delete_messages(db_session: AsyncSession, test_dek):
    """Deleting a Conversation cascades to its Messages (ondelete='CASCADE')."""
    from sqlalchemy import delete, select

    from app.db_types import user_dek_context
    from app.models import Chart, Conversation, Message, User

    u = User(phone="+8613800000003", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()

    with user_dek_context(test_dek):
        c = Chart(user_id=u.id, birth_input={}, paipan={}, engine_version="0.1.0")
        db_session.add(c)
        await db_session.flush()
        conv = Conversation(chart_id=c.id)
        db_session.add(conv)
        await db_session.flush()
        m = Message(conversation_id=conv.id, role="user", content="hi")
        db_session.add(m)
        await db_session.flush()
        message_id = m.id

    # Deletion itself doesn't touch encrypted columns — no DEK context needed.
    await db_session.execute(delete(Conversation).where(Conversation.id == conv.id))
    await db_session.flush()

    found = await db_session.execute(select(Message).where(Message.id == message_id))
    assert found.scalar_one_or_none() is None


async def test_unique_chart_cache_slot(db_session: AsyncSession, test_dek):
    """UNIQUE (chart_id, kind, key) on chart_cache."""
    from sqlalchemy.exc import IntegrityError

    from app.db_types import user_dek_context
    from app.models import Chart, ChartCache, User

    u = User(phone="+8613800000004", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()

    with user_dek_context(test_dek):
        c = Chart(user_id=u.id, birth_input={}, paipan={}, engine_version="0.1.0")
        db_session.add(c)
        await db_session.flush()

        cc1 = ChartCache(chart_id=c.id, kind="section", key="career")
        db_session.add(cc1)
        await db_session.flush()

        cc2 = ChartCache(chart_id=c.id, kind="section", key="career")
        db_session.add(cc2)
        with pytest.raises(IntegrityError):
            await db_session.flush()
```

- [ ] **Step 4: 运行 test_models**

Run:
```bash
uv run --package server pytest server/tests/integration/test_models.py -v
```
Expected: 4 passed。

- [ ] **Step 5: 跑完整 suite**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: ~41 passed。

- [ ] **Step 6: 提交**

```bash
git add server/app/models/chart.py server/app/models/conversation.py \
        server/tests/integration/test_models.py
git commit -m "feat(server): switch sensitive model fields to EncryptedText/JSONB"
```

---

## Phase D：auth 骨架 + 加密集成测试（2 tasks）

### Task 12: auth/deps.py 骨架

**Files:**
- Create: `server/app/auth/deps.py`
- Create: `server/tests/unit/test_auth_deps.py`

- [ ] **Step 1: 写失败测试 `test_auth_deps.py`（红）**

```python
"""auth.deps: all dependencies must raise NotImplementedError in Plan 2.

Plan 3 removes the raise; signature stays the same."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


@pytest.mark.asyncio
async def test_current_user_raises_not_implemented():
    from app.auth.deps import current_user
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await current_user(request=MagicMock(), db=MagicMock())


@pytest.mark.asyncio
async def test_optional_user_raises_not_implemented():
    from app.auth.deps import optional_user
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await optional_user(request=MagicMock(), db=MagicMock())


@pytest.mark.asyncio
async def test_require_admin_raises_not_implemented():
    from app.auth.deps import require_admin
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await require_admin(user=MagicMock())


@pytest.mark.asyncio
async def test_check_quota_closure_raises_not_implemented():
    from app.auth.deps import check_quota
    dep = check_quota("chat_message")
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await dep(user=MagicMock(), db=MagicMock())
```

- [ ] **Step 2: 运行，确认红**

Run:
```bash
uv run --package server pytest server/tests/unit/test_auth_deps.py -v
```
Expected: ImportError on `app.auth.deps`。

- [ ] **Step 3: 写 `server/app/auth/deps.py`**

```python
"""Auth dependencies — skeleton only.

All functions raise NotImplementedError; Plan 3 will replace the raises.
Signatures and names are STABLE — Plan 3 must not change them.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Request

from app.core.db import get_db


async def current_user(
    request: Request,
    db=Depends(get_db),
):
    """Must-be-logged-in dependency. → User. Plan 3."""
    raise NotImplementedError("auth is implemented in Plan 3")


async def optional_user(
    request: Request,
    db=Depends(get_db),
) -> Optional[object]:
    """Optional login. → User | None. Plan 3."""
    raise NotImplementedError("auth is implemented in Plan 3")


async def require_admin(user=Depends(current_user)):
    """Admin-only. → User. Plan 3."""
    raise NotImplementedError("auth is implemented in Plan 3")


def check_quota(kind: str):
    """Quota-ticket factory. Returns a dependency that raises on exhaustion.

    Signature contract: returns a dependency callable; the dependency itself
    yields a QuotaTicket (Plan 3 defines QuotaTicket).
    """
    async def _dep(user=Depends(current_user), db=Depends(get_db)):
        raise NotImplementedError("quota is implemented in Plan 3")
    return _dep
```

- [ ] **Step 4: 运行**

Run:
```bash
uv run --package server pytest server/tests/unit/test_auth_deps.py -v
```
Expected: 4 passed。

- [ ] **Step 5: 完整 suite**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: ~45 passed。

- [ ] **Step 6: 提交**

```bash
git add server/app/auth/deps.py server/tests/unit/test_auth_deps.py
git commit -m "feat(server): auth/deps skeleton (all NotImplementedError)"
```

---

### Task 13: crypto-shredding + DEK 隔离集成测试

**Files:**
- Create: `server/tests/integration/test_crypto_shredding.py`
- Create: `server/tests/integration/test_dek_isolation.py`

- [ ] **Step 1: 写 `test_crypto_shredding.py`**

```python
"""Crypto-shredding: dropping a DEK makes prior ciphertext permanently
unreadable — even the attacker with KEK and DB backup can't recover."""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from cryptography.exceptions import InvalidTag
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.mark.asyncio
async def test_shredding_makes_ciphertext_unreadable(database_url):
    """Scenario:
      1. User has DEK A; encrypt chart
      2. User requests account deletion → DEK A is destroyed
      3. Attacker holds KEK + DB backup; generates DEK B (random)
      4. Attacker cannot decrypt — DEK B ≠ DEK A, AESGCM fails.
    """
    from app.core.crypto import decrypt_field, encrypt_field, generate_dek

    dek_a = generate_dek()
    ciphertext = encrypt_field(b"my private birth data", dek_a)

    # Shredding: pretend we overwrote DEK A. Attacker guesses.
    dek_b = generate_dek()
    with pytest.raises(InvalidTag):
        decrypt_field(ciphertext, dek_b)

    # Proof of positive control: with the original DEK, it still decrypts
    # (i.e. ciphertext is otherwise intact — the key is the only missing piece).
    assert decrypt_field(ciphertext, dek_a) == b"my private birth data"


@pytest.mark.asyncio
async def test_shredding_end_to_end_with_db(database_url):
    """Integration: write via ORM, drop the DEK, confirm neither new DEK nor
    the original column value can reveal the plaintext."""
    from sqlalchemy import text
    from app.db_types import EncryptedText, user_dek_context
    from sqlalchemy import Column, MetaData, String, Table

    engine = create_async_engine(database_url)
    meta = MetaData()
    t = Table(
        "t_shred_test",
        meta,
        Column("id", String(8), primary_key=True),
        Column("val", EncryptedText, nullable=False),
    )
    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
        await conn.run_sync(meta.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    dek_a = os.urandom(32)
    # Step 1: write with DEK A
    with user_dek_context(dek_a):
        async with maker() as s:
            await s.execute(t.insert().values(id="1", val="secret"))
            await s.commit()

    # Step 2: raw read — confirm ciphertext is in DB
    async with maker() as s:
        raw = (await s.execute(text("SELECT val FROM t_shred_test WHERE id='1'"))).scalar_one()
    assert raw != b"secret"

    # Step 3: "shred" DEK A (simulated: just forget it). Try DEK B.
    dek_b = os.urandom(32)
    with user_dek_context(dek_b):
        async with maker() as s:
            with pytest.raises(InvalidTag):
                row = (await s.execute(t.select())).first()
                _ = row.val

    # Step 4: DEK A still decrypts (positive control)
    with user_dek_context(dek_a):
        async with maker() as s:
            row = (await s.execute(t.select())).first()
            assert row.val == "secret"

    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
    await engine.dispose()
```

- [ ] **Step 2: 写 `test_dek_isolation.py`**

```python
"""Two users' DEKs must be independent: user A's ciphertext must be opaque
to user B's DEK context."""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from cryptography.exceptions import InvalidTag
from sqlalchemy import Column, MetaData, String, Table
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.mark.asyncio
async def test_two_users_cannot_read_each_others_rows(database_url):
    from app.db_types import EncryptedText, user_dek_context

    engine = create_async_engine(database_url)
    meta = MetaData()
    t = Table(
        "t_isolation_test",
        meta,
        Column("id", String(8), primary_key=True),
        Column("val", EncryptedText, nullable=False),
    )
    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
        await conn.run_sync(meta.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    dek_alice = os.urandom(32)
    dek_bob = os.urandom(32)

    with user_dek_context(dek_alice):
        async with maker() as s:
            await s.execute(t.insert().values(id="alice", val="alice's secret"))
            await s.commit()
    with user_dek_context(dek_bob):
        async with maker() as s:
            await s.execute(t.insert().values(id="bob", val="bob's secret"))
            await s.commit()

    # Alice reading Alice's row → OK
    with user_dek_context(dek_alice):
        async with maker() as s:
            row = (await s.execute(t.select().where(t.c.id == "alice"))).first()
            assert row.val == "alice's secret"

    # Alice reading Bob's row → InvalidTag
    with user_dek_context(dek_alice):
        async with maker() as s:
            with pytest.raises(InvalidTag):
                row = (await s.execute(t.select().where(t.c.id == "bob"))).first()
                _ = row.val

    async with engine.begin() as conn:
        await conn.run_sync(meta.drop_all)
    await engine.dispose()
```

- [ ] **Step 3: 运行**

Run:
```bash
uv run --package server pytest server/tests/integration/test_crypto_shredding.py \
  server/tests/integration/test_dek_isolation.py -v
```
Expected: 3 passed。

- [ ] **Step 4: 完整 suite**

Run:
```bash
uv run --package server pytest server/tests/ -v
```
Expected: ~48 passed。

- [ ] **Step 5: 提交**

```bash
git add server/tests/integration/test_crypto_shredding.py \
        server/tests/integration/test_dek_isolation.py
git commit -m "test(server): crypto-shredding + cross-user DEK isolation"
```

---

## Phase E：验收（2 tasks）

### Task 14: wheel 构建验证

**Files:** 无新文件；可能调整 `server/pyproject.toml`

- [ ] **Step 1: 构建 wheel**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/lucid-yalow-97b48c
uv build --package server
ls dist/server-*.whl
```
Expected: `dist/server-0.1.0-py3-none-any.whl`。

- [ ] **Step 2: 隔离 venv 冒烟安装**

Run:
```bash
python3 -m venv /tmp/server-smoke
/tmp/server-smoke/bin/pip install --upgrade pip
/tmp/server-smoke/bin/pip install dist/server-0.1.0-py3-none-any.whl
```
Expected: 安装成功，拉下 FastAPI / SQLAlchemy / cryptography 等依赖。

- [ ] **Step 3: 冒烟 import**

Run:
```bash
ENV=test \
ENCRYPTION_KEK=$(python3 -c 'import secrets; print(secrets.token_hex(32))') \
DATABASE_URL=postgresql+asyncpg://u:p@h/d \
/tmp/server-smoke/bin/python -c "from app.main import app; print(app.title)"
```
Expected: `bazi-analysis backend`。

- [ ] **Step 4: 清理**

```bash
rm -rf /tmp/server-smoke dist/
```

- [ ] **Step 5: 提交（如 pyproject 有调整）**

```bash
git status
# 若 pyproject.toml 有修改，commit 之；否则跳过
```

---

### Task 15: ACCEPTANCE.md + CI workflow

**Files:**
- Create: `server/ACCEPTANCE.md`
- Create: `.github/workflows/server-ci.yml`

- [ ] **Step 1: 跑覆盖率生成实际数字**

Run:
```bash
uv sync --package server --extra dev
uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/ 2>&1 | tail -25
```
记录下每个 `app/` 模块的覆盖率，填入 ACCEPTANCE.md。

- [ ] **Step 2: 测并行耗时**

Run:
```bash
time uv run --package server pytest server/tests/ -n auto 2>&1 | tail -3
```
记录下 `real` 时间，应 < 30s。

- [ ] **Step 3: 写 `server/ACCEPTANCE.md`**

```markdown
# server Backend Foundation — Acceptance Checklist

依 Plan 2 验收条款逐条验证（Task 15 Step 1-2 的实测数字填在下方）。

## Hard Gates

- [x] **测试全绿**
  - `uv run --package server pytest server/tests/ -n auto 2>&1 | tail -1`
  - 实测：<N> passed in <T>s
- [x] **源码覆盖率 ≥ 85%（`server/app/*`）**
  - 逐模块：
    - `app/core/crypto.py`: 100%
    - `app/core/config.py`: ≥ 90%
    - `app/core/logging.py`: ≥ 85%
    - `app/core/db.py`: ≥ 80%
    - `app/db_types/encrypted_text.py`: ≥ 95%
    - `app/db_types/encrypted_json.py`: ≥ 95%
    - `app/auth/deps.py`: 100%
    - `app/main.py`: ≥ 85%
    - `app/models/*`: ≥ 80%
  - Source TOTAL: <N>% (实测填)
- [x] **并行 CI runtime < 30s**
  - `time uv run --package server pytest server/tests/ -n auto`
  - 实测：real <T>s
- [x] **wheel 可装 + 可跑**
  - Task 14 流程：`uv build --package server` → 装进隔离 venv → `from app.main import app` 成功
- [x] **Alembic 双向干净**
  - `alembic upgrade head && alembic downgrade base && alembic upgrade head`
  - 集成测试 `test_migrations.py` 覆盖
- [x] **Crypto-shredding 验证**
  - `test_crypto_shredding.py` 双测试通过
- [x] **auth/deps.py 全 `NotImplementedError`**
  - `grep -c "raise NotImplementedError" server/app/auth/deps.py` ≥ 4
- [x] **无业务路由**
  - `ls server/app/api/ 2>/dev/null` 不存在
  - `grep -r "@app.get\|@app.post" server/app/ | grep -v /api/health` 为空
- [x] **CI workflow 在 GitHub Actions 能跑通**
  - `.github/workflows/server-ci.yml` 就位，testcontainers 自启 Postgres

## Handoff to Plan 3

以下合同 Plan 3 可直接依赖：

- `app.auth.deps.current_user` / `optional_user` / `require_admin` / `check_quota` 签名稳定
- `app.db_types.user_dek_context` / `EncryptedText` / `EncryptedJSONB`
- `app.core.crypto.{load_kek, generate_dek, encrypt_dek, decrypt_dek, encrypt_field, decrypt_field}`
- `app.core.db.{get_db, create_engine_from_settings, dispose_engine}`
- `app.core.config.settings`
- `app.models.{User, InviteCode, Session, SmsCode, Chart, ChartCache, Conversation, Message, QuotaUsage, LlmUsageLog}`
- `app.models.Base.metadata`

Plan 3 实现路径：替换 `auth/deps.py` 里的 `raise NotImplementedError` 为真实逻辑；
追加 Alembic migration（如 auth 流程需要新列）；不改上述任何签名。
```

- [ ] **Step 4: 写 `.github/workflows/server-ci.yml`**

```yaml
name: server tests

on:
  push:
    paths:
      - 'server/**'
      - 'paipan/**'
      - 'pyproject.toml'
      - 'uv.lock'
      - '.github/workflows/server-ci.yml'
  pull_request:
    paths:
      - 'server/**'
      - 'paipan/**'
      - 'pyproject.toml'
      - 'uv.lock'
      - '.github/workflows/server-ci.yml'

jobs:
  test:
    runs-on: ubuntu-latest
    # Asia/Shanghai for consistency with Plan 1's paipan test suite.
    env:
      TZ: Asia/Shanghai
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - name: install python
        run: uv python install 3.12
      - name: sync deps
        run: uv sync --package server --extra dev
      - name: run tests in parallel (testcontainers starts its own postgres)
        run: uv run --package server pytest server/tests/ -n auto
```

- [ ] **Step 5: 跑最终 suite 确认绿**

Run:
```bash
uv run --package server pytest server/tests/ -n auto 2>&1 | tail -3
```
Expected: `N passed in Ts`，N ≈ 48。

- [ ] **Step 6: 提交**

```bash
git add server/ACCEPTANCE.md .github/workflows/server-ci.yml
git commit -m "docs(server): acceptance checklist + CI workflow"
```

---

## Plan 2 终点

产出物：
- `server/`：独立 Python 包，`uv build` 可出 wheel
- Postgres 16 schema 全量就位（10 张表 + Alembic baseline）
- AES-256-GCM 信封加密就位（KEK + DEK + `EncryptedText` / `EncryptedJSONB`）
- `current_user` / `check_quota` 依赖签名稳定（实现 Plan 3 接）
- 48+ 单元 + 集成测试，覆盖率 ≥ 85%
- testcontainers-based CI workflow

下一个 plan：**Plan 3 — Auth Business Layer**（SMS / 注册 / 登录 / 注销 / 邀请码 / session rolling）
