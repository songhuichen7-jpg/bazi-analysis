# Auth Business Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 2 的 FastAPI + 加密骨架之上，落地完整的手机号短信登录 / 注册 / 注销业务（7 个 `/api/auth/*` 端点 + 真实 `current_user`/`check_quota` 实现 + crypto-shredding）。

**Architecture:** 三层分离：`schemas/` 纯 Pydantic 请求响应、`services/` 纯业务逻辑（抛自定义异常）、`api/` 纯 HTTP（cookie + 状态码映射）。SMS 用 Protocol + factory 模式，dev 桩记日志并 response 回显 `__devCode`，Aliyun 实现骨架留到 Plan 7 部署填。Session 用 sha256 的 cookie token + sessions 表，`current_user` 解密 DEK 挂 contextvar 让加密字段透明读写。Crypto-shredding 置 `users.dek_ciphertext = NULL` 让所有密文永久不可解。

**Tech Stack:** Python 3.12 · FastAPI · SQLAlchemy 2.0 async · asyncpg · Postgres 16 · `cryptography` (AES-GCM) · pydantic v2 · pytest + testcontainers

---

## 设计约束（每一 task 必须遵守）

1. **不引入新依赖**——所有库 Plan 2 已在 `server/pyproject.toml` 列过
2. **不碰业务路由以外的东西**——不动 `paipan/`、不动 charts / LLM / frontend、不加 `/api/cities` `/api/config`
3. **每个 task 必须 commit + `uv run pytest` 绿**
4. **TDD**：红 → 绿 → 提交
5. **`# NOTE:` 注释标注 spec 来源**（延续 Plan 1/2 纪律）
6. **Plan 2 合同不变**：`auth/deps.py` 4 个函数的签名（`current_user` / `optional_user` / `require_admin` / `check_quota`）保持，只改实现
7. **Phone 完整值不在任何响应里出现**，只 `phone_last4`
8. **dev mode 的 `__devCode` 回显仅在 `settings.env == "dev"`**，prod 绝对不出现

## 目录最终形态（plan 执行完的样子）

```
server/
├── alembic/versions/
│   ├── 0001_baseline.py                 # Plan 2
│   └── 0002_user_fields_for_auth.py     # ← 本 plan 产出
├── app/
│   ├── sms/                              # ← 本 plan 产出
│   │   ├── __init__.py
│   │   ├── dev.py
│   │   └── aliyun.py
│   ├── services/                         # ← 本 plan 产出
│   │   ├── __init__.py
│   │   ├── sms.py
│   │   ├── auth.py
│   │   └── session.py
│   ├── api/                              # ← 本 plan 产出
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   └── sessions.py
│   ├── schemas/                          # ← 本 plan 产出
│   │   ├── __init__.py
│   │   └── auth.py
│   ├── core/
│   │   ├── config.py                     # Plan 2（不动；`require_invite` 字段 Plan 3 补）
│   │   └── quotas.py                     # ← 本 plan 产出
│   ├── auth/
│   │   └── deps.py                       # ← 本 plan 修改：落实 4 个函数
│   ├── models/
│   │   └── user.py                       # ← 本 plan 修改：dek_ciphertext → nullable; +agreed_to_terms_at
│   └── main.py                           # ← 本 plan 修改：include_router
└── tests/
    ├── unit/
    │   ├── test_sms_provider.py          # ← 本 plan
    │   ├── test_sms_service.py           # ← 本 plan
    │   └── test_quota_ticket.py          # ← 本 plan
    └── integration/
        ├── test_auth_register.py         # ← 本 plan
        ├── test_auth_login.py            # ← 本 plan
        ├── test_auth_logout.py           # ← 本 plan
        ├── test_auth_me.py               # ← 本 plan
        ├── test_auth_account_delete.py   # ← 本 plan
        ├── test_auth_sessions.py         # ← 本 plan
        ├── test_auth_deps_real.py        # ← 本 plan
        └── test_crypto_shredding_via_api.py  # ← 本 plan
```

---

## Phase A：schemas + SMS package（3 tasks）

### Task 1: schemas/auth.py + 自定义异常

**Files:**
- Create: `server/app/schemas/__init__.py` (empty)
- Create: `server/app/schemas/auth.py`
- Create: `server/app/services/__init__.py` (empty)
- Create: `server/app/services/exceptions.py`

- [ ] **Step 1: 创建 `server/app/schemas/__init__.py` 空文件**

```bash
touch server/app/schemas/__init__.py
```

- [ ] **Step 2: 创建 `server/app/services/__init__.py` 空文件**

```bash
touch server/app/services/__init__.py
```

- [ ] **Step 3: 写 `server/app/services/exceptions.py`**

```python
"""Service-layer exceptions. API layer catches these and maps to HTTP responses.

Defining exceptions in services/ (not api/) keeps services HTTP-agnostic — a
service can be reused from a non-HTTP caller (e.g., a management script) and
still raise meaningful typed errors.
"""
from __future__ import annotations

from dataclasses import dataclass


class ServiceError(Exception):
    """Base for all service-layer errors.

    ``code`` is machine-readable (SCREAMING_SNAKE_CASE); ``message`` is the
    user-visible Chinese text. ``details`` is optional structured context for
    the UI (retry_after, limit, etc.). ``status`` suggests the HTTP status
    code but API layer makes the final call.
    """

    code: str = "INTERNAL"
    message: str = "服务异常"
    status: int = 500

    def __init__(self, message: str | None = None, *, details: dict | None = None):
        super().__init__(message or self.message)
        self.message = message or self.message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "details": self.details}


class SmsRateLimitError(ServiceError):
    code = "SMS_RATE_LIMIT"
    message = "短信发送过于频繁"
    status = 429


class SmsCooldownError(SmsRateLimitError):
    code = "SMS_COOLDOWN"
    message = "短信发送冷却中，请稍后再试"


class SmsHourlyLimitError(SmsRateLimitError):
    code = "SMS_HOURLY_LIMIT"
    message = "1 小时内短信发送已达上限，请稍后再试"


class SmsCodeInvalidError(ServiceError):
    code = "SMS_CODE_INVALID"
    message = "验证码错误或已过期"
    status = 400


class TermsNotAgreedError(ServiceError):
    code = "TERMS_NOT_AGREED"
    message = "需要同意用户协议和隐私政策"
    status = 400


class InviteCodeError(ServiceError):
    code = "INVITE_CODE_INVALID"
    message = "邀请码无效"
    status = 400


class PhoneAlreadyRegisteredError(ServiceError):
    code = "PHONE_ALREADY_REGISTERED"
    message = "手机号已注册"
    status = 409


class UserNotFoundError(ServiceError):
    code = "USER_NOT_FOUND"
    message = "该手机号未注册"
    status = 404


class AccountDisabledError(ServiceError):
    code = "ACCOUNT_DISABLED"
    message = "账号已停用"
    status = 403


class AccountShreddedError(ServiceError):
    code = "ACCOUNT_SHREDDED"
    message = "账号已注销"
    status = 401


class SessionNotFoundError(ServiceError):
    code = "SESSION_NOT_FOUND"
    message = "会话不存在或已过期"
    status = 404


class QuotaExceededError(ServiceError):
    code = "QUOTA_EXCEEDED"
    message = "配额已用完"
    status = 429

    def __init__(self, kind: str, limit: int):
        super().__init__(
            message=f"今日 {kind} 配额已用完",
            details={"kind": kind, "limit": limit},
        )
```

- [ ] **Step 4: 写 `server/app/schemas/auth.py`**

```python
"""Pydantic request/response schemas for /api/auth/*.

Schemas are the HTTP-layer contract. They do NOT share fields with
``app/models/*`` (ORM). Fields like ``phone`` (raw) never appear in responses —
only ``phone_last4`` does.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ---- request bodies ---------------------------------------------------

SmsPurpose = Literal["register", "login", "bind"]


class SmsSendRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    purpose: SmsPurpose


class RegisterRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    code: str = Field(pattern=r"^\d{6}$")
    invite_code: str = Field(min_length=4, max_length=16)
    nickname: str | None = Field(default=None, max_length=40)
    agreed_to_terms: bool


class LoginRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    code: str = Field(pattern=r"^\d{6}$")


class AccountDeleteRequest(BaseModel):
    # NOTE: must match literal — protects against accidental account loss.
    confirm: Literal["DELETE MY ACCOUNT"]


# ---- response bodies --------------------------------------------------


class SmsSendResponse(BaseModel):
    expires_in: int = 300
    # Dev-only field; only present when settings.env == "dev".
    # Using a double-underscore prefix so any accidental logger + toJSON
    # pass through obvious grep filters.
    devCode: str | None = Field(default=None, alias="__devCode")

    model_config = {"populate_by_name": True}


class UserResponse(BaseModel):
    id: UUID
    phone_last4: str
    nickname: str | None
    role: Literal["user", "admin"]
    plan: Literal["free", "pro"]
    plan_expires_at: datetime | None
    created_at: datetime


class MeResponse(BaseModel):
    user: UserResponse
    # Plan 3 returns {} placeholder; Plan 4 fills {kind: {used, limit, reset_at}}.
    quota_snapshot: dict = Field(default_factory=dict)


class SessionResponse(BaseModel):
    id: UUID
    user_agent: str | None
    ip: str | None
    created_at: datetime
    last_seen_at: datetime
    is_current: bool


class AccountDeleteResponse(BaseModel):
    shredded_at: datetime


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
```

- [ ] **Step 5: 冒烟导入**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/lucid-yalow-97b48c
DATABASE_URL="postgresql+asyncpg://u:p@h/d" ENCRYPTION_KEK="$(python3 -c 'print("aa"*32)')" \
  uv run --package server python -c "
from app.schemas.auth import (SmsSendRequest, RegisterRequest, LoginRequest,
    UserResponse, MeResponse, SessionResponse, AccountDeleteRequest,
    AccountDeleteResponse, ErrorResponse)
from app.services.exceptions import (ServiceError, SmsRateLimitError,
    SmsCooldownError, SmsHourlyLimitError, SmsCodeInvalidError,
    TermsNotAgreedError, InviteCodeError, PhoneAlreadyRegisteredError,
    UserNotFoundError, AccountDisabledError, AccountShreddedError,
    SessionNotFoundError, QuotaExceededError)
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 6: 完整 suite 确认没 regression**

Run:
```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 49 passed.

- [ ] **Step 7: 提交**

```bash
git branch --show-current   # MUST be claude/lucid-yalow-97b48c
git add server/app/schemas/ server/app/services/
git commit -m "feat(server): auth schemas + service exception hierarchy"
```

---

### Task 2: sms/ package (Protocol + DevSmsProvider + AliyunSmsProvider 骨架)

**Files:**
- Create: `server/app/sms/__init__.py`
- Create: `server/app/sms/dev.py`
- Create: `server/app/sms/aliyun.py`

- [ ] **Step 1: 写 `server/app/sms/dev.py`**

```python
"""Dev SMS provider — logs only; does not actually send.

The code itself is NOT logged (structlog PII whitelist would drop it anyway,
but belt-and-suspenders). Dev-mode echo of the code into the HTTP response
body happens in api/auth.py, not here.
"""
from __future__ import annotations

import structlog

_log = structlog.get_logger(__name__)


class DevSmsProvider:
    async def send(self, phone: str, code: str) -> None:
        _log.info(
            "dev_sms_sent",
            # NOTE: do NOT log the raw code; only last 4 digits of phone for debug.
            phone_last4=phone[-4:],
            code_len=len(code),
        )
```

- [ ] **Step 2: 写 `server/app/sms/aliyun.py`**

```python
"""Aliyun SMS provider — skeleton. Real API call lands in Plan 7 deployment.

The real integration requires ICP filing + aliyun account + signed SMS
template. Until then, instantiating this class with non-None credentials
still only raises at send time — good enough for the factory pattern.
"""
from __future__ import annotations


class AliyunSmsProvider:
    def __init__(self, access_key: str, secret: str, template: str) -> None:
        self._access_key = access_key
        self._secret = secret
        self._template = template

    async def send(self, phone: str, code: str) -> None:
        raise NotImplementedError(
            "aliyun SMS integration lands in Plan 7 deployment phase — "
            "requires ICP filing + aliyun account + signed template"
        )
```

- [ ] **Step 3: 写 `server/app/sms/__init__.py` (Protocol + factory)**

```python
"""SMS provider Protocol + lazy factory.

Factory picks DevSmsProvider unless all three aliyun_sms_* settings are set,
in which case it returns an AliyunSmsProvider. This means:
  - Tests: no credentials set → always DevSmsProvider → no real SMS.
  - Prod (Plan 7): all three set → AliyunSmsProvider (raises NotImplementedError
    until that plan's implementation lands).

The provider instance is cached module-level via functools.lru_cache to avoid
re-instantiating per request.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Protocol

from app.core.config import settings
from app.sms.aliyun import AliyunSmsProvider
from app.sms.dev import DevSmsProvider


class SmsProvider(Protocol):
    async def send(self, phone: str, code: str) -> None: ...


@lru_cache(maxsize=1)
def get_sms_provider() -> SmsProvider:
    """Return the singleton provider for this process."""
    if (
        settings.aliyun_sms_access_key
        and settings.aliyun_sms_secret
        and settings.aliyun_sms_template
    ):
        return AliyunSmsProvider(
            access_key=settings.aliyun_sms_access_key,
            secret=settings.aliyun_sms_secret,
            template=settings.aliyun_sms_template,
        )
    return DevSmsProvider()


__all__ = ["SmsProvider", "DevSmsProvider", "AliyunSmsProvider", "get_sms_provider"]
```

- [ ] **Step 4: 冒烟导入**

```bash
DATABASE_URL="postgresql+asyncpg://u:p@h/d" ENCRYPTION_KEK="$(python3 -c 'print("aa"*32)')" \
  uv run --package server python -c "
from app.sms import get_sms_provider, SmsProvider, DevSmsProvider, AliyunSmsProvider
p = get_sms_provider()
assert isinstance(p, DevSmsProvider), f'expected DevSmsProvider, got {type(p).__name__}'
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 5: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 49 passed.

- [ ] **Step 6: 提交**

```bash
git add server/app/sms/
git commit -m "feat(server): SMS provider Protocol + dev stub + aliyun skeleton"
```

---

### Task 3: sms provider 单元测试

**Files:**
- Create: `server/tests/unit/test_sms_provider.py`

- [ ] **Step 1: 写失败测试 `test_sms_provider.py`**

```python
"""Unit tests for sms provider factory + Dev stub + Aliyun skeleton."""
from __future__ import annotations

import pytest


def test_factory_returns_dev_when_aliyun_key_missing(monkeypatch):
    """Default test env has no aliyun_sms_* settings → DevSmsProvider."""
    # Clear factory cache so monkeypatching is honored.
    from app.sms import get_sms_provider, DevSmsProvider
    get_sms_provider.cache_clear()

    monkeypatch.setattr("app.core.config.settings.aliyun_sms_access_key", None)
    monkeypatch.setattr("app.core.config.settings.aliyun_sms_secret", None)
    monkeypatch.setattr("app.core.config.settings.aliyun_sms_template", None)

    p = get_sms_provider()
    assert isinstance(p, DevSmsProvider)

    # Clear cache for subsequent tests
    get_sms_provider.cache_clear()


def test_factory_returns_aliyun_when_all_keys_set(monkeypatch):
    from app.sms import get_sms_provider, AliyunSmsProvider
    get_sms_provider.cache_clear()

    monkeypatch.setattr("app.core.config.settings.aliyun_sms_access_key", "AK123")
    monkeypatch.setattr("app.core.config.settings.aliyun_sms_secret", "secret")
    monkeypatch.setattr("app.core.config.settings.aliyun_sms_template", "SMS_123")

    p = get_sms_provider()
    assert isinstance(p, AliyunSmsProvider)

    get_sms_provider.cache_clear()


@pytest.mark.asyncio
async def test_dev_provider_does_not_send(caplog):
    """DevSmsProvider.send should only log, not raise; code is NOT in the log."""
    import logging
    from app.sms import DevSmsProvider

    with caplog.at_level(logging.INFO):
        p = DevSmsProvider()
        await p.send("+8613800001234", "654321")

    # The raw code should not appear anywhere in the log output.
    for record in caplog.records:
        assert "654321" not in record.getMessage()


@pytest.mark.asyncio
async def test_aliyun_skeleton_raises_not_implemented():
    from app.sms import AliyunSmsProvider

    p = AliyunSmsProvider(access_key="AK", secret="S", template="T")
    with pytest.raises(NotImplementedError, match="Plan 7"):
        await p.send("+8613800001234", "654321")
```

- [ ] **Step 2: 运行测试**

```bash
uv run --package server pytest server/tests/unit/test_sms_provider.py -v
```
Expected: 4 passed.

- [ ] **Step 3: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 53 passed.

- [ ] **Step 4: 提交**

```bash
git add server/tests/unit/test_sms_provider.py
git commit -m "test(server): SMS provider factory + stub behavior"
```

---

## Phase B：services/sms + migration（3 tasks）

### Task 4: Alembic migration 0002 + model update

**Files:**
- Create: `server/alembic/versions/0002_user_fields_for_auth.py`
- Modify: `server/app/models/user.py`
- Modify: `server/app/core/config.py`（加 `require_invite` 字段）

- [ ] **Step 1: 修改 `server/app/models/user.py` — 加 agreed_to_terms_at + dek_ciphertext nullable**

Find the `User` class. Change `dek_ciphertext` field to nullable and add `agreed_to_terms_at`:

Current `User.dek_ciphertext`:
```python
    dek_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
```

Change to:
```python
    # NOTE: nullable post crypto-shredding — spec §2.6. Registration sets it;
    # DELETE /api/auth/account sets it to NULL, making ciphertext unrecoverable.
    dek_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
```

Add `agreed_to_terms_at` right after `dek_key_version`:
```python
    # NOTE: set at registration (Plan 3). Used for ToS compliance audit.
    agreed_to_terms_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 2: 修改 `server/app/core/config.py` — 加 require_invite**

Inside `class Settings(BaseSettings)`, after `encryption_kek`:
```python
    # B 阶段邀请制开关；C 阶段设 false 开放注册
    require_invite: bool = True
```

- [ ] **Step 3: 写 `server/alembic/versions/0002_user_fields_for_auth.py`**

```python
"""user_fields_for_auth: allow dek_ciphertext NULL + add agreed_to_terms_at

Revision ID: 0002_user_fields_for_auth
Revises: 0001_baseline
Create Date: 2026-04-17 14:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_user_fields_for_auth"
down_revision: Union[str, Sequence[str], None] = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("agreed_to_terms_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("users", "dek_ciphertext", nullable=True)


def downgrade() -> None:
    op.alter_column("users", "dek_ciphertext", nullable=False)
    op.drop_column("users", "agreed_to_terms_at")
```

- [ ] **Step 4: 写 migration 回归测试**

Append to `server/tests/integration/test_migrations.py`:

```python
def test_0002_adds_agreed_to_terms_at_and_nullable_dek(alembic_config):
    """Ensures 0002 migration lands fields correctly (for Task 5+ features)."""
    from alembic import command
    from sqlalchemy import create_engine, inspect, text

    cfg, sync_url = alembic_config
    command.upgrade(cfg, "head")

    engine = create_engine(sync_url)
    inspector = inspect(engine)
    cols = {c["name"]: c for c in inspector.get_columns("users")}

    assert "agreed_to_terms_at" in cols
    assert cols["agreed_to_terms_at"]["nullable"] is True
    assert cols["dek_ciphertext"]["nullable"] is True

    engine.dispose()
```

Wait — this test uses `create_engine` + `inspect` which is sync, and Plan 2's Task 7 reviewer converted the inspector to async. Check `test_migrations.py` for the current pattern and match.

Re-read `server/tests/integration/test_migrations.py` first. If it uses `_inspect()` helper (async), use the async form:

```python
@pytest.mark.asyncio
async def test_0002_adds_agreed_to_terms_at_and_nullable_dek(alembic_config):
    from alembic import command
    from sqlalchemy import inspect
    from sqlalchemy.ext.asyncio import create_async_engine

    cfg, sync_url = alembic_config
    command.upgrade(cfg, "head")

    # Use the project's async inspector pattern (see test_upgrade_creates_all_tables).
    async_url = sync_url.replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(async_url)
    try:
        async with engine.connect() as conn:
            cols = {c["name"]: c for c in await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_columns("users")
            )}
    finally:
        await engine.dispose()

    assert "agreed_to_terms_at" in cols
    assert cols["agreed_to_terms_at"]["nullable"] is True
    assert cols["dek_ciphertext"]["nullable"] is True
```

If the existing `test_migrations.py` uses sync `create_engine`, use sync (whichever the file already uses — match style).

- [ ] **Step 5: 运行 migration + test**

```bash
uv run --package server pytest server/tests/integration/test_migrations.py -v
```
Expected: all existing tests pass + 1 new test passes.

- [ ] **Step 6: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 54 passed (53 before + 1 new migration test).

- [ ] **Step 7: 提交**

```bash
git add server/alembic/versions/0002_user_fields_for_auth.py \
        server/app/models/user.py \
        server/app/core/config.py \
        server/tests/integration/test_migrations.py
git commit -m "feat(server): alembic 0002 + User.agreed_to_terms_at + nullable dek_ciphertext"
```

---

### Task 5: services/sms.py — send + verify + rate limit

**Files:**
- Create: `server/app/services/sms.py`

- [ ] **Step 1: 写 `server/app/services/sms.py`**

```python
"""SMS send + verify + rate limit business logic.

Uses sms_codes table as both rate-limit store and code store. Code is stored
as sha256 hash (no salt — 6 digits + 5-minute expiry makes rainbow-table
attacks uneconomical, and the added latency to every verify is not worth it).

Rate limits (spec §2.1):
  - 60s cooldown per phone
  - 5/hour per phone
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import SmsCode
from app.services.exceptions import (
    SmsCodeInvalidError,
    SmsCooldownError,
    SmsHourlyLimitError,
)

# NOTE: spec §2.1 — rate limit constants.
_COOLDOWN_SECONDS = 60
_HOURLY_LIMIT = 5
_EXPIRY_MINUTES = 5
_MAX_ATTEMPTS = 5

SmsPurpose = Literal["register", "login", "bind"]


@dataclass(frozen=True)
class SmsSendResult:
    code: str           # raw 6-digit code (caller decides whether to echo it)
    expires_at: datetime


def _hash_code(code: str) -> str:
    """SHA-256 hex of the raw code. No salt — see module docstring."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    """Return a zero-padded 6-digit numeric string."""
    return "{:06d}".format(secrets.randbelow(1_000_000))


async def _check_rate_limit(db: AsyncSession, phone: str) -> None:
    """Raise SmsCooldownError / SmsHourlyLimitError on violation."""
    # NOTE: spec §2.1 — 60s cooldown.
    cooldown_row = await db.execute(text("""
        SELECT EXTRACT(EPOCH FROM (now() - max(created_at))) AS elapsed
          FROM sms_codes
         WHERE phone = :phone
           AND created_at > now() - make_interval(secs => :cooldown)
    """), {"phone": phone, "cooldown": _COOLDOWN_SECONDS})
    r = cooldown_row.first()
    if r is not None and r[0] is not None:
        retry_after = int(_COOLDOWN_SECONDS - r[0])
        if retry_after < 1:
            retry_after = 1
        raise SmsCooldownError(
            details={"retry_after": retry_after},
        )

    # NOTE: spec §2.1 — 5 per hour.
    hourly_row = await db.execute(text("""
        SELECT count(*) FROM sms_codes
         WHERE phone = :phone
           AND created_at > now() - interval '1 hour'
    """), {"phone": phone})
    count = hourly_row.scalar_one()
    if count >= _HOURLY_LIMIT:
        raise SmsHourlyLimitError(
            details={"limit": _HOURLY_LIMIT, "retry_after": 3600},
        )


async def send_sms_code(
    db: AsyncSession,
    phone: str,
    purpose: SmsPurpose,
    ip: str | None,
    provider_send: callable,  # signature: (phone, code) -> Awaitable[None]
) -> SmsSendResult:
    """Generate a fresh code, insert it, call provider.send, return the code.

    Caller must then commit the session (api layer). If provider.send raises,
    caller should let the transaction roll back naturally.
    """
    await _check_rate_limit(db, phone)

    code = _generate_code()
    code_hash = _hash_code(code)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(minutes=_EXPIRY_MINUTES)

    row = SmsCode(
        phone=phone,
        code_hash=code_hash,
        purpose=purpose,
        expires_at=expires_at,
        ip=ip,
    )
    db.add(row)
    await db.flush()

    # provider.send is called LAST so any error aborts the whole transaction
    # (caller's outer session.commit will not run).
    await provider_send(phone, code)

    return SmsSendResult(code=code, expires_at=expires_at)


async def verify_sms_code(
    db: AsyncSession,
    phone: str,
    code: str,
    purpose: SmsPurpose,
) -> None:
    """Raises SmsCodeInvalidError on any failure. Burns the row on 5 attempts."""
    stmt = (
        select(SmsCode)
        .where(
            SmsCode.phone == phone,
            SmsCode.purpose == purpose,
            SmsCode.used_at.is_(None),
            SmsCode.expires_at > datetime.now(tz=timezone.utc),
        )
        .order_by(SmsCode.created_at.desc())
        .limit(1)
    )
    row: SmsCode | None = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise SmsCodeInvalidError("验证码不存在或已过期")

    if _hash_code(code) != row.code_hash:
        # attempts++; if reaches max, burn the row.
        new_attempts = row.attempts + 1
        row.attempts = new_attempts
        if new_attempts >= _MAX_ATTEMPTS:
            row.used_at = datetime.now(tz=timezone.utc)
            await db.flush()
            raise SmsCodeInvalidError(
                "验证码错误次数过多，请重新获取",
                details={"attempts_left": 0, "burned": True},
            )
        await db.flush()
        raise SmsCodeInvalidError(
            "验证码错误",
            details={"attempts_left": _MAX_ATTEMPTS - new_attempts},
        )

    # success — mark used so it can't be reused
    row.used_at = datetime.now(tz=timezone.utc)
    await db.flush()
```

- [ ] **Step 2: 冒烟导入**

```bash
DATABASE_URL="postgresql+asyncpg://u:p@h/d" ENCRYPTION_KEK="$(python3 -c 'print("aa"*32)')" \
  uv run --package server python -c "
from app.services.sms import send_sms_code, verify_sms_code, SmsSendResult
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 3: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 54 passed.

- [ ] **Step 4: 提交**

```bash
git add server/app/services/sms.py
git commit -m "feat(server): SMS service (send + verify + rate limit)"
```

---

### Task 6: services/sms 单元测试

**Files:**
- Create: `server/tests/unit/test_sms_service.py`

- [ ] **Step 1: 写失败测试 `test_sms_service.py`**

```python
"""Unit tests for services.sms — integration style (hits testcontainers DB)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services.exceptions import (
    SmsCodeInvalidError,
    SmsCooldownError,
    SmsHourlyLimitError,
)
from app.services.sms import (
    _EXPIRY_MINUTES,
    _HOURLY_LIMIT,
    _hash_code,
    send_sms_code,
    verify_sms_code,
)


@pytest_asyncio.fixture
async def db_session(database_url):
    """Per-test async session bound to a freshly-begun transaction."""
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


async def _noop_provider(phone: str, code: str) -> None:
    return None


@pytest.mark.asyncio
async def test_hash_is_sha256_hex_64():
    h = _hash_code("123456")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


@pytest.mark.asyncio
async def test_send_stores_hashed_code_not_plaintext(db_session):
    from sqlalchemy import select
    from app.models.user import SmsCode

    result = await send_sms_code(
        db_session, "+8613800001234", "register", ip="127.0.0.1",
        provider_send=_noop_provider,
    )
    row = (await db_session.execute(select(SmsCode))).scalar_one()
    assert row.code_hash != result.code
    assert row.code_hash == _hash_code(result.code)
    assert row.phone == "+8613800001234"
    assert row.purpose == "register"
    assert row.attempts == 0
    assert row.used_at is None


@pytest.mark.asyncio
async def test_verify_success_marks_used(db_session):
    from sqlalchemy import select
    from app.models.user import SmsCode

    result = await send_sms_code(
        db_session, "+8613800001235", "register", ip=None,
        provider_send=_noop_provider,
    )
    await verify_sms_code(db_session, "+8613800001235", result.code, "register")

    row = (await db_session.execute(select(SmsCode))).scalar_one()
    assert row.used_at is not None


@pytest.mark.asyncio
async def test_verify_wrong_code_increments_attempts(db_session):
    from sqlalchemy import select
    from app.models.user import SmsCode

    await send_sms_code(
        db_session, "+8613800001236", "register", ip=None,
        provider_send=_noop_provider,
    )
    with pytest.raises(SmsCodeInvalidError) as exc:
        await verify_sms_code(db_session, "+8613800001236", "000000", "register")

    assert exc.value.details["attempts_left"] == 4
    row = (await db_session.execute(select(SmsCode))).scalar_one()
    assert row.attempts == 1
    assert row.used_at is None


@pytest.mark.asyncio
async def test_verify_five_wrong_attempts_burn_row(db_session):
    from sqlalchemy import select
    from app.models.user import SmsCode

    await send_sms_code(
        db_session, "+8613800001237", "register", ip=None,
        provider_send=_noop_provider,
    )
    for i in range(4):
        with pytest.raises(SmsCodeInvalidError):
            await verify_sms_code(db_session, "+8613800001237", "000000", "register")

    # 5th wrong attempt → burned
    with pytest.raises(SmsCodeInvalidError) as exc:
        await verify_sms_code(db_session, "+8613800001237", "000000", "register")
    assert exc.value.details.get("burned") is True

    row = (await db_session.execute(select(SmsCode))).scalar_one()
    assert row.attempts == 5
    assert row.used_at is not None   # burned


@pytest.mark.asyncio
async def test_verify_used_code_rejected(db_session):
    result = await send_sms_code(
        db_session, "+8613800001238", "register", ip=None,
        provider_send=_noop_provider,
    )
    await verify_sms_code(db_session, "+8613800001238", result.code, "register")

    # Second verify of same code must fail — row is marked used.
    with pytest.raises(SmsCodeInvalidError):
        await verify_sms_code(db_session, "+8613800001238", result.code, "register")


@pytest.mark.asyncio
async def test_cooldown_blocks_second_send_within_60s(db_session):
    await send_sms_code(
        db_session, "+8613800001239", "register", ip=None,
        provider_send=_noop_provider,
    )
    with pytest.raises(SmsCooldownError) as exc:
        await send_sms_code(
            db_session, "+8613800001239", "register", ip=None,
            provider_send=_noop_provider,
        )
    assert "retry_after" in exc.value.details


@pytest.mark.asyncio
async def test_hourly_limit_blocks_sixth_send(db_session):
    from sqlalchemy import text

    # Insert 5 rows manually at different timestamps to bypass the cooldown.
    # All within the last hour.
    for i in range(_HOURLY_LIMIT):
        await db_session.execute(text("""
            INSERT INTO sms_codes (phone, code_hash, purpose, expires_at, created_at)
            VALUES (:phone, :hash, 'register', now() + interval '5 minutes',
                    now() - make_interval(mins => :minutes_ago))
        """), {
            "phone": "+8613800001240",
            "hash": _hash_code("{:06d}".format(i)),
            "minutes_ago": 2 + i * 2,  # all well past 60s ago
        })
    await db_session.flush()

    # Now the 6th attempt — even though cooldown is past — should hit hourly.
    with pytest.raises(SmsHourlyLimitError) as exc:
        await send_sms_code(
            db_session, "+8613800001240", "register", ip=None,
            provider_send=_noop_provider,
        )
    assert exc.value.details["limit"] == _HOURLY_LIMIT


@pytest.mark.asyncio
async def test_provider_error_prevents_commit(db_session):
    """If provider.send raises, the code row should not survive the rollback."""
    from sqlalchemy import select
    from app.models.user import SmsCode

    async def boom(phone: str, code: str) -> None:
        raise RuntimeError("provider down")

    with pytest.raises(RuntimeError, match="provider down"):
        await send_sms_code(
            db_session, "+8613800001241", "register", ip=None,
            provider_send=boom,
        )

    # The row was added (flushed) but the session's outer transaction will
    # rollback when the test fixture tears down — so the row should not
    # survive. We can check within this same session (it was flushed into
    # the transaction):
    rows = (await db_session.execute(
        select(SmsCode).where(SmsCode.phone == "+8613800001241")
    )).scalars().all()
    # Row WAS inserted (flush happened) — but will be rolled back by fixture.
    # This test is checking that provider error propagates, not that rows
    # are absent mid-transaction.
    assert len(rows) == 1  # present in this transaction; rollback happens at fixture tear-down
```

- [ ] **Step 2: 运行**

```bash
uv run --package server pytest server/tests/unit/test_sms_service.py -v
```
Expected: 8 passed.

- [ ] **Step 3: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 62 passed (54 before + 8 new).

- [ ] **Step 4: 提交**

```bash
git add server/tests/unit/test_sms_service.py
git commit -m "test(server): SMS service unit tests (hash / verify / rate limit / burn)"
```

---

## Phase C：核心 auth 流程（5 tasks）

### Task 7: core/quotas.py + QuotaTicket

**Files:**
- Create: `server/app/core/quotas.py`
- Create: `server/app/services/quota.py`
- Create: `server/tests/unit/test_quota_ticket.py`

- [ ] **Step 1: 写 `server/app/core/quotas.py`**

```python
"""Quota limits per plan + timezone helpers for daily-reset quotas.

NOTE: Plan 3 ONLY consumes 'sms_send' quota. Other kinds are placeholders
for Plan 4+ to consume. Values may be tuned per product feedback.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_BEIJING = ZoneInfo("Asia/Shanghai")


QUOTAS: dict[str, dict[str, int]] = {
    "free": {
        "sms_send":       20,
        "chat_message":   30,
        "section_regen":   5,
        "verdicts_regen":  3,
        "dayun_regen":    10,
        "liunian_regen":  10,
        "gua":            20,
    },
    "pro": {  # placeholder — Plan 5 revises when pricing is set
        "sms_send":       20,
        "chat_message":   30,
        "section_regen":   5,
        "verdicts_regen":  3,
        "dayun_regen":    10,
        "liunian_regen":  10,
        "gua":            20,
    },
}


def today_beijing() -> str:
    """YYYY-MM-DD string in Asia/Shanghai (quota reset boundary)."""
    return datetime.now(tz=_BEIJING).strftime("%Y-%m-%d")


def next_midnight_beijing() -> datetime:
    """Next 00:00:00 in Asia/Shanghai (when quota resets)."""
    now = datetime.now(tz=_BEIJING)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    return tomorrow


def seconds_until_midnight() -> int:
    """Seconds from now until the next Beijing midnight."""
    now = datetime.now(tz=_BEIJING)
    return int((next_midnight_beijing() - now).total_seconds())
```

- [ ] **Step 2: 写 `server/app/services/quota.py`**

```python
"""QuotaTicket: pre-check + atomic commit + rollback.

Pattern (Plan 4+ will use this heavily):
    ticket = await check_quota("chat_message")(user, db)   # 429 if already full
    result = await do_business()
    await ticket.commit()   # atomic increment; may raise if race pushes over limit
    return result
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.quotas import today_beijing
from app.models.user import User
from app.services.exceptions import QuotaExceededError


@dataclass
class QuotaTicket:
    user: User
    kind: str
    limit: int
    _db: AsyncSession
    _committed: bool = field(default=False)

    async def commit(self) -> int:
        """Atomic: INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit.

        Returns new count. Raises QuotaExceededError if a concurrent commit
        pushed the count over the limit between pre-check and now.
        """
        if self._committed:
            # Defensive: prevent double-commit.
            raise RuntimeError("ticket already committed")

        period = today_beijing()
        result = await self._db.execute(text("""
            INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
            VALUES (:uid, :period, :kind, 1, now())
            ON CONFLICT (user_id, period, kind)
            DO UPDATE SET count = quota_usage.count + 1, updated_at = now()
            WHERE quota_usage.count < :limit
            RETURNING count
        """), {
            "uid": self.user.id,
            "period": period,
            "kind": self.kind,
            "limit": self.limit,
        })
        row = result.first()
        if row is None:
            raise QuotaExceededError(kind=self.kind, limit=self.limit)
        self._committed = True
        return row[0]

    async def rollback(self) -> None:
        """Decrement by 1 (if committed). No-op otherwise."""
        if not self._committed:
            return
        period = today_beijing()
        await self._db.execute(text("""
            UPDATE quota_usage
               SET count = count - 1, updated_at = now()
             WHERE user_id = :uid
               AND period = :period
               AND kind = :kind
               AND count > 0
        """), {
            "uid": self.user.id,
            "period": period,
            "kind": self.kind,
        })
        self._committed = False
```

- [ ] **Step 3: 写 `server/tests/unit/test_quota_ticket.py`**

```python
"""QuotaTicket unit tests — hits testcontainers Postgres."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services.exceptions import QuotaExceededError
from app.services.quota import QuotaTicket


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
async def user(db_session):
    from app.models.user import User
    u = User(phone="+8613800009999", dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()
    return u


@pytest.mark.asyncio
async def test_commit_increments_from_zero(db_session, user):
    from sqlalchemy import text
    ticket = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    count = await ticket.commit()
    assert count == 1

    row = (await db_session.execute(text("""
        SELECT count FROM quota_usage WHERE user_id=:uid AND kind='chat_message'
    """), {"uid": user.id})).scalar_one()
    assert row == 1


@pytest.mark.asyncio
async def test_commit_increments_existing(db_session, user):
    ticket_a = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    await ticket_a.commit()

    ticket_b = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    count = await ticket_b.commit()
    assert count == 2


@pytest.mark.asyncio
async def test_commit_fails_at_limit(db_session, user):
    # Prefill 3 with limit 3.
    for _ in range(3):
        await QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session).commit()

    # 4th commit must fail.
    bad = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    with pytest.raises(QuotaExceededError) as exc:
        await bad.commit()
    assert exc.value.details == {"kind": "chat_message", "limit": 3}


@pytest.mark.asyncio
async def test_rollback_decrements(db_session, user):
    from sqlalchemy import text
    ticket = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    await ticket.commit()
    await ticket.rollback()

    row = (await db_session.execute(text("""
        SELECT count FROM quota_usage WHERE user_id=:uid AND kind='chat_message'
    """), {"uid": user.id})).scalar_one()
    assert row == 0


@pytest.mark.asyncio
async def test_rollback_before_commit_is_noop(db_session, user):
    ticket = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    await ticket.rollback()   # should not raise
    # Nothing should be in the table.
    from sqlalchemy import text
    rows = (await db_session.execute(text("""
        SELECT count(*) FROM quota_usage WHERE user_id=:uid
    """), {"uid": user.id})).scalar_one()
    assert rows == 0


@pytest.mark.asyncio
async def test_double_commit_raises(db_session, user):
    ticket = QuotaTicket(user=user, kind="chat_message", limit=3, _db=db_session)
    await ticket.commit()
    with pytest.raises(RuntimeError, match="already committed"):
        await ticket.commit()
```

- [ ] **Step 4: 运行**

```bash
uv run --package server pytest server/tests/unit/test_quota_ticket.py -v
```
Expected: 6 passed.

- [ ] **Step 5: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 68 passed (62 before + 6 new).

- [ ] **Step 6: 提交**

```bash
git add server/app/core/quotas.py server/app/services/quota.py \
        server/tests/unit/test_quota_ticket.py
git commit -m "feat(server): QuotaTicket (commit/rollback) + quotas constants"
```

---

### Task 8: services/session.py — create / list / revoke

**Files:**
- Create: `server/app/services/session.py`

- [ ] **Step 1: 写 `server/app/services/session.py`**

```python
"""Session management: create / list / revoke / resolve cookie.

Cookie value is a raw 32-byte urlsafe token; DB stores sha256(token) only.
This means even a DB dump does not reveal active cookies.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserSession
from app.services.exceptions import SessionNotFoundError

# NOTE: spec §3 — 30-day rolling cookie.
_SESSION_TTL_DAYS = 30
_TOKEN_BYTES = 32


def _hash_token(raw: str) -> str:
    """sha256 hex of the raw cookie value."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_token() -> str:
    """Raw 32-byte urlsafe token (Set-Cookie value)."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


async def create_session(
    db: AsyncSession,
    user_id: UUID,
    user_agent: str | None,
    ip: str | None,
) -> tuple[UserSession, str]:
    """Create a new session. Returns (db_row, raw_token_for_cookie)."""
    raw = _generate_token()
    now = datetime.now(tz=timezone.utc)
    row = UserSession(
        token_hash=_hash_token(raw),
        user_id=user_id,
        user_agent=user_agent,
        ip=ip,
        expires_at=now + timedelta(days=_SESSION_TTL_DAYS),
        last_seen_at=now,
    )
    db.add(row)
    await db.flush()
    return row, raw


async def resolve_session(db: AsyncSession, raw_token: str) -> UserSession | None:
    """Look up a session by raw cookie value. Returns None if not found /
    expired; caller decides between 401 and silent fallback.
    """
    token_hash = _hash_token(raw_token)
    stmt = select(UserSession).where(
        UserSession.token_hash == token_hash,
        UserSession.expires_at > datetime.now(tz=timezone.utc),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def touch_session(db: AsyncSession, session_id: UUID) -> None:
    """Slide the 30-day window + update last_seen_at."""
    now = datetime.now(tz=timezone.utc)
    await db.execute(
        update(UserSession)
        .where(UserSession.id == session_id)
        .values(
            last_seen_at=now,
            expires_at=now + timedelta(days=_SESSION_TTL_DAYS),
        )
    )


async def list_sessions(
    db: AsyncSession,
    user_id: UUID,
) -> list[UserSession]:
    """All unexpired sessions for this user, newest-activity first."""
    stmt = (
        select(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.expires_at > datetime.now(tz=timezone.utc),
        )
        .order_by(UserSession.last_seen_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def revoke_session(
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID,
) -> None:
    """Revoke one of the user's own sessions. Raises SessionNotFoundError if
    the id doesn't belong to this user (privacy: don't distinguish
    'not yours' from 'doesn't exist' — both surface as 404)."""
    result = await db.execute(
        delete(UserSession).where(
            UserSession.id == session_id,
            UserSession.user_id == user_id,
        )
    )
    if result.rowcount == 0:
        raise SessionNotFoundError()


async def revoke_all_sessions(db: AsyncSession, user_id: UUID) -> int:
    """Revoke every session for this user (used by shred_account)."""
    result = await db.execute(
        delete(UserSession).where(UserSession.user_id == user_id)
    )
    return result.rowcount
```

- [ ] **Step 2: 冒烟**

```bash
DATABASE_URL="postgresql+asyncpg://u:p@h/d" ENCRYPTION_KEK="$(python3 -c 'print("aa"*32)')" \
  uv run --package server python -c "
from app.services.session import (create_session, resolve_session, touch_session,
    list_sessions, revoke_session, revoke_all_sessions)
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 3: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 68 passed.

- [ ] **Step 4: 提交**

```bash
git add server/app/services/session.py
git commit -m "feat(server): session service (create/resolve/touch/list/revoke)"
```

---

### Task 9: services/auth.py — register / login / logout

**Files:**
- Create: `server/app/services/auth.py`

- [ ] **Step 1: 写 `server/app/services/auth.py`**

```python
"""Core auth flows: register / login / logout / shred_account.

All functions take an AsyncSession and return Python-native types or raise
ServiceError subclasses. The api/ layer maps errors to HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import encrypt_dek, generate_dek
from app.models.user import InviteCode, SmsCode, User, UserSession
from app.services.exceptions import (
    AccountDisabledError,
    AccountShreddedError,
    InviteCodeError,
    PhoneAlreadyRegisteredError,
    TermsNotAgreedError,
    UserNotFoundError,
)
from app.services.session import create_session, revoke_all_sessions
from app.services.sms import verify_sms_code


@dataclass(frozen=True)
class AuthResult:
    user: User
    raw_token: str   # caller sets it as Set-Cookie


async def register(
    db: AsyncSession,
    *,
    phone: str,
    code: str,
    invite_code: str,
    nickname: str | None,
    agreed_to_terms: bool,
    user_agent: str | None,
    ip: str | None,
    kek: bytes,
) -> AuthResult:
    """Transactional register flow. Caller wraps in a transaction.

    Flow (spec §3.1):
      1. verify_sms_code
      2. agreed_to_terms must be True
      3. phone must not already be registered
      4. if settings.require_invite: validate invite_code (and increment atomically)
      5. generate DEK, encrypt with KEK
      6. INSERT users
      7. atomic UPDATE invite_codes SET used_count = used_count + 1 WHERE used_count < max_uses
      8. create session, return (user, raw_token)
    """
    await verify_sms_code(db, phone, code, "register")

    if not agreed_to_terms:
        raise TermsNotAgreedError()

    existing = await db.execute(select(User).where(User.phone == phone))
    if existing.scalar_one_or_none() is not None:
        raise PhoneAlreadyRegisteredError()

    invite_row: InviteCode | None = None
    if settings.require_invite:
        stmt = select(InviteCode).where(
            InviteCode.code == invite_code,
            InviteCode.disabled.is_(False),
        )
        invite_row = (await db.execute(stmt)).scalar_one_or_none()
        if invite_row is None:
            raise InviteCodeError("邀请码不存在或已禁用")
        if invite_row.expires_at is not None and invite_row.expires_at <= datetime.now(tz=timezone.utc):
            raise InviteCodeError("邀请码已过期")
        if invite_row.used_count >= invite_row.max_uses:
            raise InviteCodeError("邀请码已用完")

    dek = generate_dek()
    dek_ciphertext = encrypt_dek(dek, kek)

    user = User(
        phone=phone,
        phone_last4=phone[-4:],
        nickname=nickname,
        invited_by_user_id=invite_row.created_by if invite_row is not None else None,
        used_invite_code_id=invite_row.id if invite_row is not None else None,
        dek_ciphertext=dek_ciphertext,
        dek_key_version=1,
        agreed_to_terms_at=datetime.now(tz=timezone.utc),
    )
    db.add(user)
    await db.flush()

    if invite_row is not None:
        # NOTE: spec §3.3 — atomic used_count++; if concurrent caller raced us
        # past max_uses, result.rowcount == 0 and we raise.
        result = await db.execute(
            update(InviteCode)
            .where(
                InviteCode.id == invite_row.id,
                InviteCode.used_count < invite_row.max_uses,
            )
            .values(used_count=InviteCode.used_count + 1)
        )
        if result.rowcount == 0:
            raise InviteCodeError("邀请码并发竞争失败，请重试")

    _, raw_token = await create_session(db, user.id, user_agent=user_agent, ip=ip)
    return AuthResult(user=user, raw_token=raw_token)


async def login(
    db: AsyncSession,
    *,
    phone: str,
    code: str,
    user_agent: str | None,
    ip: str | None,
) -> AuthResult:
    """Login flow (spec §3.2). Does NOT generate DEK (that's registration-only)."""
    await verify_sms_code(db, phone, code, "login")

    user: User | None = (await db.execute(
        select(User).where(User.phone == phone)
    )).scalar_one_or_none()
    if user is None:
        raise UserNotFoundError()
    if user.status != "active":
        raise AccountDisabledError()
    if user.dek_ciphertext is None:
        # Account was crypto-shredded (phone should have been cleared too,
        # so this branch is theoretical, but belt-and-suspenders).
        raise AccountShreddedError()

    _, raw_token = await create_session(db, user.id, user_agent=user_agent, ip=ip)
    return AuthResult(user=user, raw_token=raw_token)


async def logout(db: AsyncSession, session_id) -> None:
    """Delete the current session (caller provides session_id from current_user)."""
    from sqlalchemy import delete
    await db.execute(delete(UserSession).where(UserSession.id == session_id))


async def shred_account(db: AsyncSession, user: User) -> datetime:
    """Crypto-shred user account. Returns the shred timestamp.

    Flow (spec §5.3):
      1. DELETE sessions for this user
      2. DELETE sms_codes for this phone
      3. UPDATE users SET
           status='disabled', phone=NULL, phone_last4=NULL, nickname=NULL,
           invited_by_user_id=NULL, wechat_openid=NULL, wechat_unionid=NULL,
           dek_ciphertext=NULL
      4. Caller commits.
    """
    from sqlalchemy import delete

    phone = user.phone
    await revoke_all_sessions(db, user.id)

    if phone is not None:
        await db.execute(delete(SmsCode).where(SmsCode.phone == phone))

    shredded_at = datetime.now(tz=timezone.utc)
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            status="disabled",
            phone=None,
            phone_last4=None,
            nickname=None,
            invited_by_user_id=None,
            wechat_openid=None,
            wechat_unionid=None,
            dek_ciphertext=None,
        )
    )
    return shredded_at
```

- [ ] **Step 2: 冒烟**

```bash
DATABASE_URL="postgresql+asyncpg://u:p@h/d" ENCRYPTION_KEK="$(python3 -c 'print("aa"*32)')" \
  uv run --package server python -c "
from app.services.auth import register, login, logout, shred_account, AuthResult
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 3: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 68 passed.

- [ ] **Step 4: 提交**

```bash
git add server/app/services/auth.py
git commit -m "feat(server): auth service (register/login/logout/shred)"
```

---

### Task 10: api/auth.py + main.py router 接入

**Files:**
- Create: `server/app/api/__init__.py` (empty)
- Create: `server/app/api/auth.py`
- Modify: `server/app/main.py` (include router)

- [ ] **Step 1: 创建 `server/app/api/__init__.py` 空文件**

```bash
touch server/app/api/__init__.py
```

- [ ] **Step 2: 写 `server/app/api/auth.py`**

```python
"""HTTP layer for /api/auth/*. Thin wrapper over services/*."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import current_user
from app.core.config import settings
from app.core.db import get_db
from app.models.user import User
from app.schemas.auth import (
    AccountDeleteRequest,
    AccountDeleteResponse,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    SmsSendRequest,
    SmsSendResponse,
    UserResponse,
)
from app.services import auth as auth_service
from app.services import sms as sms_service
from app.services.exceptions import ServiceError
from app.services.quota import QuotaTicket
from app.sms import get_sms_provider

router = APIRouter(prefix="/api/auth", tags=["auth"])

# NOTE: spec §3 — 30-day cookie.
_COOKIE_NAME = "session"
_COOKIE_MAX_AGE = 30 * 24 * 3600


def _set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=_COOKIE_NAME,
        value=raw_token,
        max_age=_COOKIE_MAX_AGE,
        path="/",
        httponly=True,
        secure=(settings.env != "dev"),
        samesite="lax",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(_COOKIE_NAME, path="/")


def _user_response(user: User) -> UserResponse:
    # Defensive: shredded users have phone_last4=None; never surface.
    return UserResponse(
        id=user.id,
        phone_last4=user.phone_last4 or "",
        nickname=user.nickname,
        role=user.role,
        plan=user.plan,
        plan_expires_at=user.plan_expires_at,
        created_at=user.created_at,
    )


def _http_error(err: ServiceError) -> HTTPException:
    detail = err.to_dict()
    headers = None
    if "retry_after" in err.details:
        headers = {"Retry-After": str(err.details["retry_after"])}
    return HTTPException(status_code=err.status, detail=detail, headers=headers)


@router.post("/sms/send", response_model=SmsSendResponse)
async def sms_send_endpoint(
    body: SmsSendRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SmsSendResponse:
    try:
        result = await sms_service.send_sms_code(
            db,
            phone=body.phone,
            purpose=body.purpose,
            ip=request.client.host if request.client else None,
            provider_send=get_sms_provider().send,
        )
    except ServiceError as e:
        raise _http_error(e)

    response = SmsSendResponse(expires_in=300)
    if settings.env == "dev":
        # NOTE: dev echo only. Prod never exposes this field.
        response = SmsSendResponse(expires_in=300, __devCode=result.code)  # type: ignore[call-arg]
    return response


@router.post("/register")
async def register_endpoint(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await auth_service.register(
            db,
            phone=body.phone,
            code=body.code,
            invite_code=body.invite_code,
            nickname=body.nickname,
            agreed_to_terms=body.agreed_to_terms,
            user_agent=request.headers.get("user-agent"),
            ip=request.client.host if request.client else None,
            kek=request.app.state.kek,
        )
    except ServiceError as e:
        raise _http_error(e)

    _set_session_cookie(response, result.raw_token)
    return {"user": _user_response(result.user).model_dump(mode="json")}


@router.post("/login")
async def login_endpoint(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await auth_service.login(
            db,
            phone=body.phone,
            code=body.code,
            user_agent=request.headers.get("user-agent"),
            ip=request.client.host if request.client else None,
        )
    except ServiceError as e:
        raise _http_error(e)

    _set_session_cookie(response, result.raw_token)
    return {"user": _user_response(result.user).model_dump(mode="json")}


@router.post("/logout")
async def logout_endpoint(
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = request.state.session
    await auth_service.logout(db, session.id)
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
async def me_endpoint(
    user: User = Depends(current_user),
) -> MeResponse:
    return MeResponse(user=_user_response(user), quota_snapshot={})


@router.delete("/account", response_model=AccountDeleteResponse)
async def delete_account_endpoint(
    body: AccountDeleteRequest,
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> AccountDeleteResponse:
    # `confirm` is typed Literal["DELETE MY ACCOUNT"] in the schema, so pydantic
    # already rejects any other value at the schema layer.
    shredded_at = await auth_service.shred_account(db, user)
    _clear_session_cookie(response)
    return AccountDeleteResponse(shredded_at=shredded_at)
```

- [ ] **Step 3: 修改 `server/app/main.py` 加 router**

Find the `app = FastAPI(...)` block. After it, add:

```python
from app.api.auth import router as auth_router

app.include_router(auth_router)
```

Full updated `main.py`:

```python
"""FastAPI entry point — foundation layer.

Only route: GET /api/health. Lifespan loads KEK (fails loudly on sentinel).
Business routes come in later plans.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.core.config import settings
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)

    # KEK is loaded inside lifespan so tests that don't need it (e.g. health
    # smoke) can override via monkeypatch before import.
    from app.core.crypto import load_kek
    app.state.kek = load_kek()
    yield
    from app.core.db import dispose_engine
    await dispose_engine()


app = FastAPI(
    title="bazi-analysis backend",
    version=settings.version,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env == "dev" else None,
    redoc_url=None,
)

app.include_router(auth_router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": settings.version, "env": settings.env}
```

- [ ] **Step 4: 冒烟**

```bash
DATABASE_URL="postgresql+asyncpg://u:p@h/d" ENCRYPTION_KEK="$(python3 -c 'print("aa"*32)')" \
  uv run --package server python -c "
from app.main import app
routes = [r.path for r in app.routes]
print(routes)
assert '/api/health' in routes
assert '/api/auth/sms/send' in routes
assert '/api/auth/register' in routes
assert '/api/auth/login' in routes
assert '/api/auth/logout' in routes
assert '/api/auth/me' in routes
assert '/api/auth/account' in routes
print('OK')
"
```
Expected: `OK` plus route list.

- [ ] **Step 5: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 68 passed (no new tests yet; Task 11 adds them).

- [ ] **Step 6: 提交**

```bash
git add server/app/api/ server/app/main.py
git commit -m "feat(server): /api/auth/* routes (sms_send/register/login/logout/me/account)"
```

---

### Task 11: auth/deps.py real impl + 其集成测试

**Files:**
- Modify: `server/app/auth/deps.py`（替换 NotImplementedError）
- Create: `server/tests/integration/test_auth_deps_real.py`

- [ ] **Step 1: 重写 `server/app/auth/deps.py`**

```python
"""Auth dependencies — real implementations (Plan 3).

Signature contract from Plan 2 is preserved:
    current_user(request, db=Depends(get_db)) -> User
    optional_user(request, db=Depends(get_db)) -> User | None
    require_admin(user=Depends(current_user)) -> User
    check_quota(kind: str) -> dependency callable -> QuotaTicket

DEK mounting: current_user decrypts the user's DEK and sets the contextvar
from app.db_types so EncryptedText / EncryptedJSONB columns work for the
rest of the request.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_dek
from app.core.db import get_db
from app.core.quotas import QUOTAS, next_midnight_beijing, seconds_until_midnight, today_beijing
from app.db_types import _current_dek  # type: ignore[attr-defined]
from app.models.user import User, UserSession
from app.services.quota import QuotaTicket


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


async def current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "未登录", "details": None})

    token_hash = _sha256(token)
    session_row: UserSession | None = (await db.execute(
        select(UserSession).where(UserSession.token_hash == token_hash)
    )).scalar_one_or_none()
    if session_row is None:
        raise HTTPException(401, detail={"code": "SESSION_INVALID", "message": "会话无效", "details": None})
    if session_row.expires_at <= datetime.now(tz=timezone.utc):
        raise HTTPException(401, detail={"code": "SESSION_EXPIRED", "message": "会话已过期", "details": None})

    user: User | None = await db.get(User, session_row.user_id)
    if user is None:
        raise HTTPException(401, detail={"code": "USER_NOT_FOUND", "message": "用户不存在", "details": None})
    if user.status != "active":
        raise HTTPException(401, detail={"code": "ACCOUNT_DISABLED", "message": "账号已停用", "details": None})
    if user.dek_ciphertext is None:
        raise HTTPException(401, detail={"code": "ACCOUNT_SHREDDED", "message": "账号已注销", "details": None})

    # Decrypt DEK and mount into request-scoped contextvar.
    kek = request.app.state.kek
    dek = decrypt_dek(user.dek_ciphertext, kek)
    _current_dek.set(dek)
    request.state.session = session_row

    # Rolling 30-day expiry.
    now = datetime.now(tz=timezone.utc)
    await db.execute(
        text("""
            UPDATE sessions
               SET last_seen_at = :now,
                   expires_at = :exp
             WHERE id = :sid
        """),
        {"now": now, "exp": now + timedelta(days=30), "sid": session_row.id},
    )

    return user


async def optional_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Returns None for guests (no cookie). A present-but-invalid cookie still
    raises 401 — it's an error signal, not 'anonymous'."""
    if "session" not in request.cookies:
        return None
    return await current_user(request, db)


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            403,
            detail={"code": "FORBIDDEN_ADMIN_ONLY", "message": "需要管理员权限", "details": None},
        )
    return user


def check_quota(kind: str):
    """Quota-ticket factory. Pre-checks current count; raises 429 if full.
    On success returns a QuotaTicket the caller commits after business work.
    """
    async def _dep(
        user: User = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> QuotaTicket:
        limit = QUOTAS[user.plan][kind]
        period = today_beijing()

        row = (await db.execute(text("""
            SELECT count FROM quota_usage
             WHERE user_id = :uid AND period = :period AND kind = :kind
        """), {"uid": user.id, "period": period, "kind": kind})).first()
        used = row[0] if row is not None else 0
        if used >= limit:
            raise HTTPException(
                429,
                detail={
                    "code": "QUOTA_EXCEEDED",
                    "message": f"今日 {kind} 配额已用完",
                    "details": {
                        "kind": kind,
                        "limit": limit,
                        "resets_at": next_midnight_beijing().isoformat(),
                    },
                },
                headers={"Retry-After": str(seconds_until_midnight())},
            )
        return QuotaTicket(user=user, kind=kind, limit=limit, _db=db)

    return _dep
```

- [ ] **Step 2: 更新 `server/tests/unit/test_auth_deps.py`**

The old file (from Plan 2) expects NotImplementedError. Those tests must now be deleted or adapted. Delete the file entirely; the real tests land in `test_auth_deps_real.py`:

```bash
rm server/tests/unit/test_auth_deps.py
```

- [ ] **Step 3: 写 `server/tests/integration/test_auth_deps_real.py`**

```python
"""Integration tests for app.auth.deps real implementations.

Exercises current_user / optional_user / require_admin / check_quota end-to-end
through the actual FastAPI app + testcontainers Postgres.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture
async def client():
    """Fresh client per test — forces lifespan / KEK / app.state.kek wiring."""
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        async with app.router.lifespan_context(app):
            yield c


async def _register_and_get_cookie(client: AsyncClient, phone: str) -> tuple[str, dict]:
    """Helper: register user with dev SMS; returns (cookie_value, user_dict)."""
    # Seed an invite code via direct DB (we don't have admin routes yet).
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy import text
    import os
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        # Need a creator user for the invite code; make a bootstrap user manually
        # with a random phone so this helper is reentrant.
        import uuid
        bootstrap_phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
        await s.execute(text("""
            INSERT INTO users (phone, phone_last4, dek_ciphertext, dek_key_version)
            VALUES (:phone, :last4, :ct, 1)
        """), {"phone": bootstrap_phone, "last4": bootstrap_phone[-4:],
                "ct": b"\x00" * 44})
        bootstrap_id = (await s.execute(text("""
            SELECT id FROM users WHERE phone=:p
        """), {"p": bootstrap_phone})).scalar_one()
        invite = f"INV-{uuid.uuid4().hex[:8].upper()}"
        await s.execute(text("""
            INSERT INTO invite_codes (code, created_by, max_uses) VALUES (:c, :u, 10)
        """), {"c": invite, "u": bootstrap_id})
        await s.commit()
    await engine.dispose()

    # 1. SMS send → dev code in response
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    assert r.status_code == 200, r.text
    code = r.json()["__devCode"]

    # 2. register
    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": invite,
        "nickname": "test", "agreed_to_terms": True,
    })
    assert r.status_code == 200, r.text
    cookie = r.cookies.get("session")
    assert cookie, "session cookie not set"
    user = r.json()["user"]
    return cookie, user


@pytest.mark.asyncio
async def test_current_user_blocks_no_cookie(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_current_user_blocks_bogus_cookie(client):
    r = await client.get("/api/auth/me", cookies={"session": "not-a-real-token"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "SESSION_INVALID"


@pytest.mark.asyncio
async def test_current_user_valid_cookie(client):
    cookie, user = await _register_and_get_cookie(client, "+8613811110001")
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 200
    assert r.json()["user"]["id"] == user["id"]
    assert r.json()["user"]["phone_last4"] == "0001"
    # phone full value must NOT appear
    assert "phone" not in r.json()["user"]


@pytest.mark.asyncio
async def test_phone_full_value_never_in_response(client):
    cookie, _ = await _register_and_get_cookie(client, "+8613811110002")
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert "+8613811110002" not in r.text
    assert "13811110002" not in r.text
```

- [ ] **Step 4: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: ~73 passed (68 before - 4 deleted + 4 added = 68... actually wait: we deleted test_auth_deps.py which had 4 tests, so 68-4=64; then added 4 = 68. Adjust if different).

Actually let's count more carefully. After Task 10 suite was 68 passed. Task 11:
- delete `test_auth_deps.py` (had 4 tests) → -4
- add `test_auth_deps_real.py` (4 tests) → +4
- net: 68 passed

Confirm `grep -c "raise NotImplementedError" server/app/auth/deps.py` returns 0:

```bash
grep -c "raise NotImplementedError" server/app/auth/deps.py
```
Expected: `0`.

- [ ] **Step 5: 提交**

```bash
git add server/app/auth/deps.py server/tests/integration/test_auth_deps_real.py
git rm server/tests/unit/test_auth_deps.py
git commit -m "feat(server): auth/deps real implementations (drops NotImplementedError)"
```

---

## Phase D：account + sessions（2 tasks）

### Task 12: register/login/logout/me 集成测试

**Files:**
- Create: `server/tests/integration/test_auth_register.py`
- Create: `server/tests/integration/test_auth_login.py`
- Create: `server/tests/integration/test_auth_logout.py`
- Create: `server/tests/integration/test_auth_me.py`
- Create: `server/tests/integration/test_auth_account_delete.py`

**Note on test helpers:** the plan below uses `from server.tests.integration._helpers import client, register_user` style imports. If pytest collection fails with `ModuleNotFoundError`, convert the helpers to fixtures in `server/tests/integration/conftest.py` — define `client`, `seed_invite_code`, and `register_user` as `@pytest_asyncio.fixture` returning callables. Test files then just take them as parameters: `async def test_x(client, register_user): ...`. All logic stays the same; only the plumbing changes. This is the more idiomatic pytest pattern but either works as long as the tests pass.

- [ ] **Step 1: 写 `server/tests/integration/conftest.py` (local fixtures)**

Put shared fixtures in a `conftest.py` at the integration-tests directory — this way pytest auto-discovers `client`, `seed_invite_code`, `register_user` without cross-file imports. Test files just use them as `def test_x(client, register_user): ...`.

```python
"""Shared fixtures for auth integration tests."""
from __future__ import annotations

import os
import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        async with app.router.lifespan_context(app):
            yield c


async def seed_invite_code(max_uses: int = 10) -> str:
    """Insert a bootstrap user + invite code; return the invite code string."""
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        bootstrap_phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
        await s.execute(text("""
            INSERT INTO users (phone, phone_last4, dek_ciphertext, dek_key_version)
            VALUES (:phone, :last4, :ct, 1)
        """), {"phone": bootstrap_phone, "last4": bootstrap_phone[-4:],
                "ct": b"\x00" * 44})
        bootstrap_id = (await s.execute(text("""
            SELECT id FROM users WHERE phone=:p
        """), {"p": bootstrap_phone})).scalar_one()
        invite = f"INV-{uuid.uuid4().hex[:8].upper()}"
        await s.execute(text("""
            INSERT INTO invite_codes (code, created_by, max_uses) VALUES (:c, :u, :mu)
        """), {"c": invite, "u": bootstrap_id, "mu": max_uses})
        await s.commit()
    await engine.dispose()
    return invite


async def register_user(client: AsyncClient, phone: str, invite: str | None = None) -> tuple[str, dict]:
    """Full register flow. Returns (session_cookie, user_dict)."""
    if invite is None:
        invite = await seed_invite_code()

    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    assert r.status_code == 200, r.text
    code = r.json()["__devCode"]

    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": invite,
        "nickname": "test", "agreed_to_terms": True,
    })
    assert r.status_code == 200, r.text
    return r.cookies.get("session"), r.json()["user"]
```

- [ ] **Step 2: 写 `test_auth_register.py` (10 tests)**

```python
"""Integration tests for POST /api/auth/register."""
from __future__ import annotations

import pytest
import uuid

from server.tests.integration._helpers import client, seed_invite_code  # noqa: F401


@pytest.mark.asyncio
async def test_register_full_flow(client):
    invite = await seed_invite_code()
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"

    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    assert r.status_code == 200
    code = r.json()["__devCode"]

    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": invite,
        "nickname": "测试", "agreed_to_terms": True,
    })
    assert r.status_code == 200
    assert r.cookies.get("session") is not None
    user = r.json()["user"]
    assert user["phone_last4"] == phone[-4:]
    assert "phone" not in user


@pytest.mark.asyncio
async def test_register_missing_terms_rejected(client):
    invite = await seed_invite_code()
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    code = r.json()["__devCode"]
    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": invite,
        "agreed_to_terms": False,
    })
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "TERMS_NOT_AGREED"


@pytest.mark.asyncio
async def test_register_bad_invite_code(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    code = r.json()["__devCode"]
    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": "NONEXIST",
        "agreed_to_terms": True,
    })
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "INVITE_CODE_INVALID"


@pytest.mark.asyncio
async def test_register_wrong_sms_code(client):
    invite = await seed_invite_code()
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": "000000", "invite_code": invite,
        "agreed_to_terms": True,
    })
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "SMS_CODE_INVALID"


@pytest.mark.asyncio
async def test_register_phone_already_registered(client):
    from server.tests.integration._helpers import register_user
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    await register_user(client, phone)

    # Second attempt — need a new invite code (since required), new SMS flow
    invite2 = await seed_invite_code()
    # Wait 60s cooldown? No — use a different phone for SMS, then reuse this phone.
    # Actually simplest: different phone for this test.
    # ... but we're testing "phone already registered"; need the SAME phone.
    # SMS cooldown is 60s. Monkey-patching time is painful.
    # Alternative: exploit that SMS cooldown is per-phone, and we already sent
    # once to this phone above. So sleep-free approach: just wait by inserting
    # a new sms_code directly via DB.
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import os, hashlib, datetime as dt
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    code2 = "654321"
    code_hash = hashlib.sha256(code2.encode()).hexdigest()
    async with maker() as s:
        await s.execute(text("""
            INSERT INTO sms_codes (phone, code_hash, purpose, expires_at, created_at)
            VALUES (:p, :h, 'register', now() + interval '5 minutes', now())
        """), {"p": phone, "h": code_hash})
        await s.commit()
    await engine.dispose()

    r = await client.post("/api/auth/register", json={
        "phone": phone, "code": code2, "invite_code": invite2,
        "agreed_to_terms": True,
    })
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "PHONE_ALREADY_REGISTERED"


@pytest.mark.asyncio
async def test_register_dev_code_not_leaked_in_prod(client, monkeypatch):
    """When env != 'dev', __devCode must not be in response."""
    # This is tricky: settings is module-level. We'd need to reload + re-create client.
    # The conftest autouse fixture resets env after each test, so we can mutate here.
    monkeypatch.setattr("app.core.config.settings.env", "prod")
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    body = r.json()
    assert r.status_code == 200
    assert "__devCode" not in body or body["__devCode"] is None


@pytest.mark.asyncio
async def test_register_invite_used_count_incremented(client):
    invite = await seed_invite_code(max_uses=3)
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "register"})
    code = r.json()["__devCode"]
    await client.post("/api/auth/register", json={
        "phone": phone, "code": code, "invite_code": invite,
        "agreed_to_terms": True,
    })

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import os
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        n = (await s.execute(text("SELECT used_count FROM invite_codes WHERE code=:c"),
                              {"c": invite})).scalar_one()
    await engine.dispose()
    assert n == 1


@pytest.mark.asyncio
async def test_register_invite_exhausted(client):
    invite = await seed_invite_code(max_uses=1)
    phone1 = f"+86138{uuid.uuid4().int % 10**8:08d}"
    r = await client.post("/api/auth/sms/send", json={"phone": phone1, "purpose": "register"})
    code1 = r.json()["__devCode"]
    await client.post("/api/auth/register", json={
        "phone": phone1, "code": code1, "invite_code": invite,
        "agreed_to_terms": True,
    })

    phone2 = f"+86138{uuid.uuid4().int % 10**8:08d}"
    r = await client.post("/api/auth/sms/send", json={"phone": phone2, "purpose": "register"})
    code2 = r.json()["__devCode"]
    r = await client.post("/api/auth/register", json={
        "phone": phone2, "code": code2, "invite_code": invite,
        "agreed_to_terms": True,
    })
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "INVITE_CODE_INVALID"


@pytest.mark.asyncio
async def test_register_dek_encrypted_in_db(client):
    """users.dek_ciphertext is set, non-null, and not equal to raw DEK."""
    from server.tests.integration._helpers import register_user
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import os

    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    _, user = await register_user(client, phone)

    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        row = (await s.execute(text("""
            SELECT dek_ciphertext, dek_key_version, agreed_to_terms_at
              FROM users WHERE id = :uid
        """), {"uid": user["id"]})).first()
    await engine.dispose()

    dek_ct, version, terms_at = row
    assert dek_ct is not None
    assert len(dek_ct) > 44  # 32-byte DEK + 12-byte nonce + 16-byte tag = 60 bytes minimum
    assert version == 1
    assert terms_at is not None


@pytest.mark.asyncio
async def test_register_invalid_phone_format(client):
    invite = await seed_invite_code()
    r = await client.post("/api/auth/register", json={
        "phone": "abc", "code": "123456", "invite_code": invite,
        "agreed_to_terms": True,
    })
    assert r.status_code == 422   # Pydantic validation error
```

- [ ] **Step 3: 写 `test_auth_login.py` (6 tests)**

```python
"""Integration tests for POST /api/auth/login."""
from __future__ import annotations

import pytest
import uuid

from server.tests.integration._helpers import client, register_user  # noqa: F401


async def _send_login_sms(client, phone):
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "login"})
    assert r.status_code == 200
    return r.json()["__devCode"]


@pytest.mark.asyncio
async def test_login_full_flow(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    await register_user(client, phone)

    # Logout by clearing cookie (new client call).
    code = await _send_login_sms(client, phone)
    r = await client.post("/api/auth/login", json={"phone": phone, "code": code})
    assert r.status_code == 200
    assert r.cookies.get("session") is not None
    assert r.json()["user"]["phone_last4"] == phone[-4:]


@pytest.mark.asyncio
async def test_login_unregistered_phone(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    code = await _send_login_sms(client, phone)
    r = await client.post("/api/auth/login", json={"phone": phone, "code": code})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "USER_NOT_FOUND"


@pytest.mark.asyncio
async def test_login_wrong_code(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    await register_user(client, phone)
    await _send_login_sms(client, phone)
    r = await client.post("/api/auth/login", json={"phone": phone, "code": "000000"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "SMS_CODE_INVALID"


@pytest.mark.asyncio
async def test_login_disabled_account(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    _, user = await register_user(client, phone)

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import os
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        await s.execute(text("UPDATE users SET status='disabled' WHERE id=:uid"),
                         {"uid": user["id"]})
        await s.commit()
    await engine.dispose()

    code = await _send_login_sms(client, phone)
    r = await client.post("/api/auth/login", json={"phone": phone, "code": code})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "ACCOUNT_DISABLED"


@pytest.mark.asyncio
async def test_login_preserves_existing_sessions(client):
    """Login creates a NEW session; existing sessions remain valid."""
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie1, _ = await register_user(client, phone)

    code = await _send_login_sms(client, phone)
    r = await client.post("/api/auth/login", json={"phone": phone, "code": code})
    cookie2 = r.cookies.get("session")

    assert cookie1 != cookie2
    # Both cookies can access /me
    r1 = await client.get("/api/auth/me", cookies={"session": cookie1})
    r2 = await client.get("/api/auth/me", cookies={"session": cookie2})
    assert r1.status_code == 200
    assert r2.status_code == 200


@pytest.mark.asyncio
async def test_login_phone_invalid_format(client):
    r = await client.post("/api/auth/login", json={"phone": "abc", "code": "123456"})
    assert r.status_code == 422
```

- [ ] **Step 4: 写 `test_auth_logout.py` (2 tests)**

```python
"""Integration tests for POST /api/auth/logout."""
from __future__ import annotations

import pytest
import uuid

from server.tests.integration._helpers import client, register_user  # noqa: F401


@pytest.mark.asyncio
async def test_logout_clears_cookie_and_blocks_future_calls(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)

    r = await client.post("/api/auth/logout", cookies={"session": cookie})
    assert r.status_code == 200
    # Subsequent call with the same cookie must fail (session row deleted)
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_logout_requires_auth(client):
    r = await client.post("/api/auth/logout")
    assert r.status_code == 401
```

- [ ] **Step 5: 写 `test_auth_me.py` (3 tests)**

```python
"""Integration tests for GET /api/auth/me + rolling session expiry."""
from __future__ import annotations

import pytest
import uuid

from server.tests.integration._helpers import client, register_user  # noqa: F401


@pytest.mark.asyncio
async def test_me_returns_current_user(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, user = await register_user(client, phone)
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["id"] == user["id"]
    assert body["quota_snapshot"] == {}


@pytest.mark.asyncio
async def test_me_requires_cookie(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_refreshes_expires_at(client):
    """Rolling: each /me call slides expires_at forward."""
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import hashlib, os

    token_hash = hashlib.sha256(cookie.encode()).hexdigest()
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        exp_before = (await s.execute(text("""
            SELECT expires_at FROM sessions WHERE token_hash=:h
        """), {"h": token_hash})).scalar_one()

    import asyncio
    await asyncio.sleep(1)
    await client.get("/api/auth/me", cookies={"session": cookie})

    async with maker() as s:
        exp_after = (await s.execute(text("""
            SELECT expires_at FROM sessions WHERE token_hash=:h
        """), {"h": token_hash})).scalar_one()
    await engine.dispose()

    assert exp_after > exp_before
```

- [ ] **Step 6: 写 `test_auth_account_delete.py` (5 tests)**

```python
"""Integration tests for DELETE /api/auth/account — crypto-shredding."""
from __future__ import annotations

import pytest
import uuid

from server.tests.integration._helpers import client, register_user  # noqa: F401


@pytest.mark.asyncio
async def test_delete_account_full_flow(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)

    r = await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )
    assert r.status_code == 200
    assert "shredded_at" in r.json()


@pytest.mark.asyncio
async def test_delete_account_wrong_confirm(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)

    r = await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "delete my account"},  # wrong case
    )
    assert r.status_code == 422   # Pydantic Literal match failure


@pytest.mark.asyncio
async def test_delete_account_sets_dek_null(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, user = await register_user(client, phone)

    await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import os
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        row = (await s.execute(text("""
            SELECT dek_ciphertext, phone, status FROM users WHERE id = :uid
        """), {"uid": user["id"]})).first()
    await engine.dispose()

    dek_ct, phone_db, status = row
    assert dek_ct is None
    assert phone_db is None
    assert status == "disabled"


@pytest.mark.asyncio
async def test_delete_account_revokes_all_sessions(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, user = await register_user(client, phone)

    await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )

    # Subsequent /me must 401
    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_delete_account_allows_same_phone_reregister(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)
    await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )

    # Re-register with the SAME phone; should succeed (new DEK).
    cookie2, user2 = await register_user(client, phone)
    assert cookie2 is not None
    assert cookie2 != cookie
```

- [ ] **Step 7: 运行全部新测试 + 整套**

```bash
uv run --package server pytest server/tests/integration/test_auth_*.py -v
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected (integration): 4 (deps_real from Task 11) + 10 + 6 + 2 + 3 + 5 = 30 passed.
Expected (full suite): 68 (before Task 12) + 26 new (10+6+2+3+5) = 94 passed.

- [ ] **Step 8: 提交**

```bash
git add server/tests/integration/_helpers.py server/tests/integration/test_auth_*.py
git commit -m "test(server): integration tests for register/login/logout/me/account"
```

---

### Task 13: api/sessions.py + 集成测试

**Files:**
- Create: `server/app/api/sessions.py`
- Modify: `server/app/main.py` (include router)
- Create: `server/tests/integration/test_auth_sessions.py`

- [ ] **Step 1: 写 `server/app/api/sessions.py`**

```python
"""HTTP layer for /api/auth/sessions — list + revoke."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.auth import SessionResponse
from app.services import session as session_service
from app.services.exceptions import ServiceError

router = APIRouter(prefix="/api/auth/sessions", tags=["auth"])


def _http_error(err: ServiceError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.to_dict())


@router.get("", response_model=list[SessionResponse])
async def list_sessions_endpoint(
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SessionResponse]:
    rows = await session_service.list_sessions(db, user.id)
    current_session_id = request.state.session.id
    return [
        SessionResponse(
            id=s.id,
            user_agent=s.user_agent,
            ip=str(s.ip) if s.ip is not None else None,
            created_at=s.created_at,
            last_seen_at=s.last_seen_at,
            is_current=(s.id == current_session_id),
        )
        for s in rows
    ]


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session_endpoint(
    session_id: UUID,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        await session_service.revoke_session(db, user.id, session_id)
    except ServiceError as e:
        raise _http_error(e)

    # If the revoked session is the current one, clear the cookie too.
    if session_id == request.state.session.id:
        response.delete_cookie("session", path="/")

    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 2: 修改 `server/app/main.py` 加 sessions router**

Add import and include_router:

```python
from app.api.sessions import router as sessions_router
# ...
app.include_router(auth_router)
app.include_router(sessions_router)
```

- [ ] **Step 3: 写 `server/tests/integration/test_auth_sessions.py` (5 tests)**

```python
"""Integration tests for GET / DELETE /api/auth/sessions."""
from __future__ import annotations

import pytest
import uuid

from server.tests.integration._helpers import client, register_user  # noqa: F401


@pytest.mark.asyncio
async def test_list_sessions_shows_current(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)
    r = await client.get("/api/auth/sessions", cookies={"session": cookie})
    assert r.status_code == 200
    sessions = r.json()
    assert len(sessions) == 1
    assert sessions[0]["is_current"] is True


@pytest.mark.asyncio
async def test_list_sessions_requires_auth(client):
    r = await client.get("/api/auth/sessions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_revoke_own_session(client):
    """Login twice; revoke the non-current session."""
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie1, _ = await register_user(client, phone)

    # second login
    r = await client.post("/api/auth/sms/send", json={"phone": phone, "purpose": "login"})
    code = r.json()["__devCode"]
    r = await client.post("/api/auth/login", json={"phone": phone, "code": code})
    cookie2 = r.cookies.get("session")

    # list via cookie1; find cookie2's session id
    r = await client.get("/api/auth/sessions", cookies={"session": cookie1})
    sessions = r.json()
    other_session_id = next(s["id"] for s in sessions if not s["is_current"])

    r = await client.delete(f"/api/auth/sessions/{other_session_id}",
                              cookies={"session": cookie1})
    assert r.status_code == 204

    # cookie2 must now 401
    r = await client.get("/api/auth/me", cookies={"session": cookie2})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_revoke_current_session_clears_cookie(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)
    r = await client.get("/api/auth/sessions", cookies={"session": cookie})
    current_id = r.json()[0]["id"]

    r = await client.delete(f"/api/auth/sessions/{current_id}", cookies={"session": cookie})
    assert r.status_code == 204

    # Cookie cleared; subsequent call without explicit cookie must 401
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_revoke_other_users_session_returns_404(client):
    """Privacy: revoking another user's session must 404, not 403."""
    phone_a = f"+86138{uuid.uuid4().int % 10**8:08d}"
    phone_b = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie_a, _ = await register_user(client, phone_a)
    cookie_b, _ = await register_user(client, phone_b)

    # B lists their session to get the id
    r = await client.get("/api/auth/sessions", cookies={"session": cookie_b})
    b_session_id = r.json()[0]["id"]

    # A tries to revoke B's session
    r = await client.delete(f"/api/auth/sessions/{b_session_id}",
                              cookies={"session": cookie_a})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "SESSION_NOT_FOUND"
```

- [ ] **Step 4: 运行 + 整套**

```bash
uv run --package server pytest server/tests/integration/test_auth_sessions.py -v
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 5 passed + total 99 passed.

- [ ] **Step 5: 提交**

```bash
git add server/app/api/sessions.py server/app/main.py \
        server/tests/integration/test_auth_sessions.py
git commit -m "feat(server): /api/auth/sessions (list + revoke)"
```

---

## Phase E：最终验收（2 tasks）

### Task 14: 端到端 crypto-shredding via API 测试

**Files:**
- Create: `server/tests/integration/test_crypto_shredding_via_api.py`

- [ ] **Step 1: 写 `test_crypto_shredding_via_api.py`**

```python
"""End-to-end crypto-shredding test — goes through real HTTP API.

Unlike tests/integration/test_crypto_shredding.py (Plan 2, pure crypto +
direct ORM), this exercises: register (via API) → write encrypted chart
directly to DB → DELETE /api/auth/account (via API) → confirm:
  - dek_ciphertext is NULL in users
  - raw bytea ciphertext still present in charts
  - random DEK cannot decrypt it → InvalidTag
"""
from __future__ import annotations

import os
import uuid

import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from server.tests.integration._helpers import client, register_user  # noqa: F401


@pytest.mark.asyncio
async def test_shredding_via_api_makes_chart_ciphertext_irrecoverable(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, user = await register_user(client, phone)
    user_id = user["id"]

    # Directly insert a chart row with encrypted birth_input, using the user's DEK.
    # We need to fish the DEK out via the KEK. But we don't have access to KEK
    # from the test — so instead, we use the fact that EncryptedJSONB reads the
    # contextvar at bind time, and push a DEK context manually.
    from app.core.crypto import decrypt_dek, generate_dek, encrypt_field
    from app.db_types import user_dek_context
    import json, os as _os

    # Read user.dek_ciphertext from DB, decrypt with the test KEK.
    test_kek = bytes.fromhex(_os.environ["ENCRYPTION_KEK"])

    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as s:
        dek_ct = (await s.execute(text("""
            SELECT dek_ciphertext FROM users WHERE id = :uid
        """), {"uid": user_id})).scalar_one()

    dek = decrypt_dek(dek_ct, test_kek)

    # Insert a chart with encrypted birth_input using the DEK context.
    with user_dek_context(dek):
        async with maker() as s:
            # Use SQLAlchemy ORM to exercise EncryptedJSONB.
            from app.models.chart import Chart
            c = Chart(
                user_id=user_id,
                birth_input={"year": 1990, "month": 5, "day": 15},
                paipan={"sizhu": {"year": "庚午"}},
                engine_version="0.1.0",
            )
            s.add(c)
            await s.commit()
            chart_id = c.id

    # Confirm raw bytea is ciphertext (not plaintext).
    async with maker() as s:
        raw = (await s.execute(text("""
            SELECT birth_input FROM charts WHERE id = :cid
        """), {"cid": chart_id})).scalar_one()
    assert b"1990" not in raw
    assert len(raw) > 10

    # Now: DELETE /api/auth/account via HTTP.
    r = await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )
    assert r.status_code == 200

    # Confirm users.dek_ciphertext is NULL.
    async with maker() as s:
        dek_ct_after = (await s.execute(text("""
            SELECT dek_ciphertext FROM users WHERE id = :uid
        """), {"uid": user_id})).scalar_one()
    assert dek_ct_after is None

    # Confirm charts.birth_input STILL has the ciphertext (not deleted).
    async with maker() as s:
        raw_after = (await s.execute(text("""
            SELECT birth_input FROM charts WHERE id = :cid
        """), {"cid": chart_id})).scalar_one()
    assert raw_after == raw    # ciphertext unchanged — just the KEY is gone

    # Random DEK must fail decryption.
    random_dek = generate_dek()
    from app.core.crypto import decrypt_field
    with pytest.raises(InvalidTag):
        decrypt_field(raw_after, random_dek)

    # Original DEK would still work (positive control). But the user can't
    # retrieve it anymore because dek_ciphertext is NULL.
    from app.core.crypto import decrypt_field as _dec
    recovered = json.loads(_dec(raw_after, dek).decode("utf-8"))
    assert recovered["year"] == 1990

    await engine.dispose()


@pytest.mark.asyncio
async def test_shredded_user_cookie_is_401(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    cookie, _ = await register_user(client, phone)

    await client.request(
        "DELETE",
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )

    r = await client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 401
    # Session row was deleted, so "SESSION_INVALID" — not "ACCOUNT_SHREDDED"
    # (the shredded branch is only reachable if the session survived, which
    # it doesn't because shred_account calls revoke_all_sessions).
```

- [ ] **Step 2: 运行**

```bash
uv run --package server pytest server/tests/integration/test_crypto_shredding_via_api.py -v
```
Expected: 2 passed.

- [ ] **Step 3: 完整 suite**

```bash
uv run --package server pytest server/tests/ -q 2>&1 | tail -3
```
Expected: 101 passed.

- [ ] **Step 4: 提交**

```bash
git add server/tests/integration/test_crypto_shredding_via_api.py
git commit -m "test(server): end-to-end crypto-shredding via API"
```

---

### Task 15: ACCEPTANCE + CI 更新 + wheel 冒烟

**Files:**
- Modify: `server/ACCEPTANCE.md`

- [ ] **Step 1: 跑覆盖率**

```bash
uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/ 2>&1 | tail -25
```

Record the table output for ACCEPTANCE.md.

- [ ] **Step 2: 跑并行耗时**

```bash
time uv run --package server pytest server/tests/ -n auto 2>&1 | tail -3
```

Record `real` duration.

- [ ] **Step 3: wheel 冒烟**

```bash
uv build --package server
python3 -m venv /tmp/server-smoke
/tmp/server-smoke/bin/pip install --quiet dist/server-0.1.0-py3-none-any.whl
ENV=test \
ENCRYPTION_KEK=$(python3 -c 'import secrets; print(secrets.token_hex(32))') \
DATABASE_URL=postgresql+asyncpg://u:p@h/d \
/tmp/server-smoke/bin/python -c "
from app.main import app
routes = sorted(r.path for r in app.routes)
print(routes)
print('title:', app.title)
"
rm -rf /tmp/server-smoke dist/
```
Expected: prints routes list including `/api/auth/*` + `/api/health`, and `title: bazi-analysis backend`.

- [ ] **Step 4: 确认 NotImplementedError 全清**

```bash
grep -c "raise NotImplementedError" server/app/auth/deps.py
```
Expected: `0`.

```bash
grep -c "raise NotImplementedError" server/app/sms/aliyun.py
```
Expected: `1` (the aliyun skeleton still has its placeholder — that's the sole exception).

- [ ] **Step 5: 重写 `server/ACCEPTANCE.md`**

```markdown
# server Backend — Acceptance Checklist

Plan 2 (Foundation) + Plan 3 (Auth Business) combined state.

## Hard Gates

- [x] **全部测试并行全绿**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **101 passed in <T>s** → ✅
- [x] **源码覆盖率 ≥ 85%（`server/app/*`）**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **<N>%** (<STMTS> stmts / <MISS> missed) → ✅ (fill from Step 1 output)
- [x] **并行 CI runtime < 60s**
  - `time uv run --package server pytest server/tests/ -n auto`
  - Result: **<T>s** wall time → ✅
- [x] **wheel 可装可跑**
  - Isolated venv import of `app.main:app` prints routes including `/api/auth/*` → ✅
- [x] **Alembic 双向干净**
  - `test_migrations.py` passes for both 0001 and 0002 → ✅
- [x] **`auth/deps.py` 无 NotImplementedError**
  - `grep -c "raise NotImplementedError" server/app/auth/deps.py` → **0** → ✅
- [x] **SMS aliyun provider 仅 skeleton**
  - `grep -c "raise NotImplementedError" server/app/sms/aliyun.py` → **1** (expected — real impl lands in Plan 7) → ✅
- [x] **Phone 完整值不在响应中**
  - All `/api/auth/*` responses use `phone_last4`, never raw `phone` → ✅
- [x] **Dev mode `__devCode` 回显；prod 不回显**
  - `test_register_dev_code_not_leaked_in_prod` passes → ✅
- [x] **Crypto-shredding 端到端**
  - `test_crypto_shredding_via_api.py` proves: register → chart → shred → random DEK fails InvalidTag → ✅

## Route inventory (Plan 2 + Plan 3)

| Method | Path | Auth | Status |
|---|---|---|---|
| GET | `/api/health` | public | Plan 2 |
| POST | `/api/auth/sms/send` | public | Plan 3 |
| POST | `/api/auth/register` | public | Plan 3 |
| POST | `/api/auth/login` | public | Plan 3 |
| POST | `/api/auth/logout` | user | Plan 3 |
| GET | `/api/auth/me` | user | Plan 3 |
| DELETE | `/api/auth/account` | user | Plan 3 |
| GET | `/api/auth/sessions` | user | Plan 3 |
| DELETE | `/api/auth/sessions/:id` | user | Plan 3 |

## Test breakdown

| Category | Count |
|---|---|
| Unit — crypto primitives | 16 |
| Unit — config / logging / types | 19 |
| Unit — SMS provider | 4 |
| Unit — SMS service | 8 |
| Unit — QuotaTicket | 6 |
| Integration — health / lifespan / migrations / models | ~9 |
| Integration — crypto-shredding (pure) + DEK isolation | 3 |
| Integration — auth deps real | 4 |
| Integration — register | 10 |
| Integration — login | 6 |
| Integration — logout | 2 |
| Integration — me | 3 |
| Integration — account delete | 5 |
| Integration — sessions | 5 |
| Integration — crypto-shredding via API | 2 |
| **Total** | **~101** |

## Handoff to Plan 4

These contracts are STABLE:

- `app.auth.deps.current_user` / `optional_user` / `require_admin` / `check_quota` — fully implemented; Plan 4 routes just `Depends(...)` them
- `app.services.quota.QuotaTicket` — use `commit()` post-business, `rollback()` on exception
- `app.services.sms.send_sms_code` / `verify_sms_code` — reusable if any other phone-verify path lands (currently only auth uses them)
- `app.services.session.create_session` / `resolve_session` / `revoke_all_sessions`
- Cookie name `"session"` + raw-token scheme + sha256 hash in DB
- DEK contextvar `_current_dek` is auto-mounted by `current_user`; routes can freely read encrypted fields without explicit `user_dek_context`

## Known non-blocking items

1. `sms/aliyun.py` skeleton raises `NotImplementedError`. Plan 7 deployment fills it with real Aliyun API calls.
2. Rate limit stored in DB, not Redis — fine for single-machine B phase; scale-out deferred.
3. Invite-code UI / admin creation endpoint not in scope. Plan 3 tests seed invites directly via DB.
4. `/api/config` (`{require_invite, features}`) and `/api/cities` (autocomplete) land in Plan 4.

## Sign-off

Plan 3 executed via `superpowers:subagent-driven-development` on top of Plan 2. All hard gates green. Plan 4 can proceed with `/api/charts` CRUD.
```

Fill the `<N>%`, `<T>s`, `<STMTS>`, `<MISS>` placeholders with the actual numbers from Step 1-2.

- [ ] **Step 6: 提交**

```bash
git add server/ACCEPTANCE.md
git commit -m "docs(server): update ACCEPTANCE for Plan 3 auth business layer"
```

---

## Plan 3 终点

产出物：
- `server/` 现在有完整手机号短信登录 / 注册 / 注销业务
- `/api/auth/*` 9 条端点（含 sessions CRUD）
- `current_user` / `check_quota` 真实实现 + `QuotaTicket`
- SMS provider 抽象 + dev 桩 + Aliyun 骨架（Plan 7 填真实现）
- Alembic migration 0002 支持 crypto-shredding
- ~52 新测试，覆盖率 ≥ 85%

下一个 plan：**Plan 4 — Charts CRUD + paipan 接入** （`/api/cities` / `/api/config` / `/api/charts/*` CRUD + paipan Python 包集成）
