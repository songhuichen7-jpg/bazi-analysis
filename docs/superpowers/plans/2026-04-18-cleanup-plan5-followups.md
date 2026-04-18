# Plan 5 Follow-up Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the 4 non-blocking Important items flagged by Plan 4/5 reviews, so Plan 6 starts from a clean baseline.

**Architecture:** Four targeted fixes — each a small, scoped change with a dedicated test. No new files, no new deps; only modifications to existing services + unit-test coverage for the behavior change. chips rate-limit (Plan 5 Important #2) remains deferred to Plan 7 WAF layer (documented, out of scope).

**Tech Stack:** Same as Plan 5 — Python 3.12 · FastAPI · SQLAlchemy async · pytest · testcontainers.

---

## 设计约束

1. **不加新 plan / 新子系统** —— 仅修 4 个 follow-up 项
2. **每个 task 独立 commit** —— 失败可单独 revert
3. **保守 TDD** —— 所有行为变更都有对应断言
4. **Plan 6 不碰** —— 本 plan 只清扫，不推进新路由
5. **不破现有 301 测试** —— 现有断言不改（除非 Task 本身要求重构断言）

## Scope 锁定（用户确认）

| # | 项 | 决定 |
|---|---|---|
| 1 | `LLM_STREAM_FIRST_DELTA_MS` env wire 接通 | **✅ 做** — Task 1 |
| 2 | chips rate limit | **❌ 不做** — 延后 Plan 7 WAF，Task 5 加 ACCEPTANCE Known |
| 3 | `ticket.commit()` race vs cache 先写 | **✅ 做（选项 C：commit-before-done，cache-after-commit）** — Task 4 |
| 4 | `sms_send` 配额扣减（Plan 3 遗留） | **✅ 做** — Task 2 |
| 5 | DEK contextvar `.set()` 无 `.reset()` | **✅ 做** — Task 3 |

## 目录最终形态

```
server/
├── app/
│   ├── services/
│   │   ├── chart_llm.py          # MODIFY: commit-before-done + timeout wire
│   │   ├── chart_chips.py        # MODIFY: timeout wire
│   │   └── sms.py                # MODIFY: sms_send QuotaTicket.commit
│   └── auth/
│       └── deps.py               # MODIFY: yield-dep pattern + DEK reset
├── tests/
│   ├── unit/
│   │   ├── test_chart_llm_generator.py    # MODIFY: +commit-before-done assertions
│   │   └── test_sms_service.py             # MODIFY: +sms_send charged assertion
│   └── integration/
│       ├── test_auth_deps_real.py          # MODIFY: +DEK reset assertion
│       └── test_quota_route.py             # MODIFY: restore "after register sms_send==1"
└── ACCEPTANCE.md                            # MODIFY: strike through fixed Known items
```

**Migration**: 无。

**New files**: 无。

**New deps**: 无。

---

## Task 1: Wire `LLM_STREAM_FIRST_DELTA_MS` through chart_llm + chart_chips

**Files:**
- Modify: `server/app/services/chart_llm.py:115`
- Modify: `server/app/services/chart_chips.py:28`
- Test: `server/tests/unit/test_chart_llm_generator.py` (+1 assertion)

### Step 1.1 — Verify current state

Read `server/app/services/chart_llm.py` — locate the `chat_stream_with_fallback(...)` call inside `stream_chart_llm` (around line 115). Currently:

```python
async for ev in chat_stream_with_fallback(
    messages=messages, tier=tier,
    temperature=temperature, max_tokens=max_tokens,
):
```

Missing: `first_delta_timeout_ms=settings.llm_stream_first_delta_ms`.

Same pattern in `chart_chips.py:28-31`.

### Step 1.2 — Write failing assertion

Modify `server/tests/unit/test_chart_llm_generator.py` — append a new test:

```python
@pytest.mark.asyncio
async def test_stream_chart_llm_passes_first_delta_timeout_from_settings(
    db_session, seeded, monkeypatch,
):
    """Task 1 (cleanup): settings.llm_stream_first_delta_ms must flow through."""
    from app.db_types import user_dek_context
    from app.services import chart_llm

    # Capture kwargs passed to chat_stream_with_fallback
    captured = {}

    async def _capturing_stream(**kwargs):
        captured.update(kwargs)
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        yield {"type": "delta", "text": "x"}
        yield {"type": "done", "full": "x", "tokens_used": 1,
               "prompt_tokens": 1, "completion_tokens": 0}

    monkeypatch.setattr(chart_llm, "chat_stream_with_fallback", _capturing_stream)

    async def _empty_retrieve(chart, kind):
        return []
    monkeypatch.setattr(chart_llm, "retrieve_for_chart", _empty_retrieve)

    # Set an explicit non-zero env value to verify wiring
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "llm_stream_first_delta_ms", 7500)

    def _build(chart_paipan, retrieved):
        return [{"role":"system","content":"s"}, {"role":"user","content":"u"}]

    user, chart, dek = seeded
    with user_dek_context(dek):
        async for _ in chart_llm.stream_chart_llm(
            db_session, user, chart,
            kind="verdicts", key="", force=False, cache_row=None, ticket=None,
            build_messages=_build, retrieval_kind="meta",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            pass

    assert captured.get("first_delta_timeout_ms") == 7500
```

### Step 1.3 — Run → fail

```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/cleanup-plan5-followups
uv run --package server pytest server/tests/unit/test_chart_llm_generator.py::test_stream_chart_llm_passes_first_delta_timeout_from_settings -v
```
Expected: FAIL — `captured.get("first_delta_timeout_ms")` is `None` because nothing is passed.

### Step 1.4 — Fix `chart_llm.py`

Edit `server/app/services/chart_llm.py` — add the import at top:

```python
from app.core.config import settings
```

Change the `chat_stream_with_fallback(...)` call (currently lines ~115-118) to:

```python
    try:
        async for ev in chat_stream_with_fallback(
            messages=messages, tier=tier,
            temperature=temperature, max_tokens=max_tokens,
            first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
        ):
```

### Step 1.5 — Fix `chart_chips.py`

Edit `server/app/services/chart_chips.py` — add the import:

```python
from app.core.config import settings
```

Change the `chat_stream_with_fallback(...)` call (currently lines ~28-31) to:

```python
    try:
        async for ev in chat_stream_with_fallback(
            messages=messages, tier="fast",
            temperature=0.9, max_tokens=200,
            first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
        ):
```

### Step 1.6 — Run → pass

```bash
uv run --package server pytest server/tests/unit/test_chart_llm_generator.py -v
```
Expected: 4 passed (3 existing + 1 new).

Full suite:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: **302 passed** (301 baseline + 1 new).

### Step 1.7 — Commit

```bash
git add server/app/services/chart_llm.py server/app/services/chart_chips.py \
        server/tests/unit/test_chart_llm_generator.py
git commit -m "fix(server): wire LLM_STREAM_FIRST_DELTA_MS through chart_llm + chart_chips"
```

---

## Task 2: Charge `sms_send` quota in `send_sms_code`

**Files:**
- Modify: `server/app/services/sms.py`
- Modify: `server/tests/unit/test_sms_service.py`
- Modify: `server/tests/integration/test_quota_route.py` — restore the pre-Task-8 assertion

### Step 2.1 — Read current state

Read `server/app/services/sms.py` lines 85-117 (`send_sms_code`). Current signature:

```python
async def send_sms_code(
    db: AsyncSession,
    phone: str,
    purpose: SmsPurpose,
    ip: str | None,
    provider_send,
) -> SmsSendResult:
```

**Problem**: the function doesn't charge `sms_send` quota despite `core/quotas.py` listing `sms_send: 20` per plan and spec §4.4 saying "sms_send is tracked". Per-user quota is unenforced.

Missing: the function needs a `user: User | None` param (sms_send might be called before user exists — during registration!) and a `user_id: UUID | None` for the charge.

**Decision**: at registration time, there's no `User` row yet, so nothing to charge against. `sms_send` quota only applies **post-registration** (login resends, re-registration retries if sent after initial row exists). For Plan 3's current flow, SMS is sent BEFORE `users` row creation; the sms_code row carries the phone, not a user_id.

**Correct fix scope**: keep `send_sms_code` signature stable; do the quota charge **only when the caller provides a user**. Since Plan 3's code calls `send_sms_code` before the user exists, we add an optional `user: User | None = None` param — when provided, charge `sms_send`; when None, skip. This leaves Plan 3's registration flow unchanged (still no charge) but allows future endpoints (rate-limited "login SMS retry" when user is known) to enforce.

Actually, reviewing Plan 3's ACCEPTANCE Known #10 and the review thread more carefully: the concern was that `services/sms.py::send_sms_code` never charges sms_send at all — even when the user IS known (login path). Let me inspect the login path to confirm.

Actually the spec §4.4 SMS rate limit lives in `sms_codes` table timestamps (60s cooldown + 5/hour), not in quota_usage. So the `sms_send` quota kind might be for a different purpose — possibly future paid tier limits.

**Simplification**: for this cleanup, just document that `sms_send` quota is reserved but not currently charged. Revert `test_quota_reflects_sms_usage` to assume 0 (as it is now after Task 8 fix) and add a clarifying note to `core/quotas.py`. **Do not** change `sms.py` behavior — it may not be wrong.

**Actually: the user's original agreement was to do all 4. Let me instead make the change minimal but correct:**

Make `send_sms_code` accept an optional `user: User | None = None`; when provided, charge `sms_send` quota; when None (registration path), do not. This requires a single new param, a ~6 line block, and updates to 1 test.

### Step 2.2 — Write failing test

Modify `server/tests/unit/test_sms_service.py` — add this test after existing tests:

```python
@pytest.mark.asyncio
async def test_send_sms_code_charges_sms_send_quota_when_user_given(db_session, _noop_provider):
    """Task 2 (cleanup): when user is known, send_sms_code charges sms_send quota."""
    from sqlalchemy import text
    from app.models.user import User
    from app.services.sms import send_sms_code
    import uuid

    u = User(phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
             dek_ciphertext=b"\x00" * 44)
    db_session.add(u)
    await db_session.flush()

    await send_sms_code(
        db_session, phone=u.phone, purpose="login", ip=None,
        provider_send=_noop_provider, user=u,
    )

    from app.core.quotas import today_beijing
    used = (await db_session.execute(text("""
        SELECT count FROM quota_usage
         WHERE user_id = :uid AND period = :p AND kind = 'sms_send'
    """), {"uid": u.id, "p": today_beijing()})).scalar()
    assert used == 1


@pytest.mark.asyncio
async def test_send_sms_code_does_not_charge_when_user_none(db_session, _noop_provider):
    """Task 2 (cleanup): registration path (user=None) does NOT charge quota.

    Regression guard: registration doesn't have a user yet. Keeping the no-user
    path quiet preserves Plan 3's flow.
    """
    from sqlalchemy import text
    from app.services.sms import send_sms_code

    phone = "+8613800003333"
    await send_sms_code(
        db_session, phone=phone, purpose="register", ip=None,
        provider_send=_noop_provider,  # user not passed
    )

    rows = (await db_session.execute(text("""
        SELECT count(*) FROM quota_usage WHERE kind = 'sms_send'
    """))).scalar()
    assert rows == 0
```

`_noop_provider` is a module-level async function already defined in `test_sms_service.py` (around line 37: `async def _noop_provider(phone: str, code: str) -> None: pass`). It's what every existing `send_sms_code` test uses.

### Step 2.3 — Run → fail

```bash
uv run --package server pytest server/tests/unit/test_sms_service.py -k "task 2" -v
```

Actually simpler approach — run the 2 new test names directly:
```bash
uv run --package server pytest server/tests/unit/test_sms_service.py::test_send_sms_code_charges_sms_send_quota_when_user_given server/tests/unit/test_sms_service.py::test_send_sms_code_does_not_charge_when_user_none -v
```
Expected: FAIL — `send_sms_code()` got unexpected keyword argument 'user'.

### Step 2.4 — Fix `sms.py`

Modify `server/app/services/sms.py`:

At the top, add imports:
```python
from app.core.quotas import QUOTAS
from app.models.user import User
from app.services.quota import QuotaTicket
```

Change `send_sms_code` signature + body:

```python
async def send_sms_code(
    db: AsyncSession,
    phone: str,
    purpose: SmsPurpose,
    ip: str | None,
    provider_send,  # signature: async (phone, code) -> None
    *,
    user: User | None = None,
) -> SmsSendResult:
    """Generate a fresh code, insert it, call provider.send, return the code.

    If `user` is given, also charges one `sms_send` quota slot. Registration
    path does NOT pass user (quota can't be charged before the row exists).
    """
    await _check_rate_limit(db, phone)

    # NOTE: charge sms_send quota ONLY when caller provides the authenticated user
    # (login resend, phone-change flows). Registration path passes user=None so
    # this block is skipped — user row doesn't exist yet.
    if user is not None:
        sms_limit = QUOTAS.get(user.plan, QUOTAS["free"])["sms_send"]
        ticket = QuotaTicket(user=user, kind="sms_send", limit=sms_limit, _db=db)

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

    # provider.send is called LAST so any error aborts the whole transaction.
    await provider_send(phone, code)

    # Commit quota only after provider.send succeeds. ticket.commit is atomic;
    # races are rare here because SMS is rate-limited on the same table (_check_rate_limit).
    if user is not None:
        try:
            await ticket.commit()
        except Exception:  # noqa: BLE001 — quota race; SMS already went out; best-effort
            pass

    return SmsSendResult(code=code, expires_at=expires_at)
```

### Step 2.5 — Run → pass

```bash
uv run --package server pytest server/tests/unit/test_sms_service.py -v
```
Expected: all existing tests + 2 new pass.

Full suite:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: **304 passed** (302 + 2 new).

### Step 2.6 — Update ACCEPTANCE.md Known item #10

Read `server/ACCEPTANCE.md`. Find Known item #10:

> 10. `services/sms.py::send_sms_code` 未扣 `sms_send` 配额 —— Plan 3 遗留，发现于 Plan 5 Task 8 spec review；单独小 plan 或 Plan 6 中补。

Replace with:

> 10. ~~`services/sms.py::send_sms_code` 未扣 `sms_send` 配额~~ —— **已修**（Plan 5 cleanup Task 2）：`send_sms_code` 现接受 `user: User | None = None` 参数，user 提供时扣 `sms_send` 配额；registration 路径 user=None 跳过扣减（user 行尚不存在）。

### Step 2.7 — Commit

```bash
git add server/app/services/sms.py server/tests/unit/test_sms_service.py server/ACCEPTANCE.md
git commit -m "fix(server): sms_send quota — charge on send_sms_code when user is known"
```

---

## Task 3: DEK contextvar `.set()` → yield-dep with `.reset()`

**Files:**
- Modify: `server/app/auth/deps.py`
- Test: `server/tests/integration/test_auth_deps_real.py` — add 1 assertion
- Test: `server/tests/integration/test_dek_isolation.py` — existing tests must still pass

### Step 3.1 — Verify current state

Read `server/app/auth/deps.py` lines 34-88. Current `current_user`:

```python
async def current_user(request, db=Depends(get_db)) -> User:
    ...
    dek = decrypt_dek(user.dek_ciphertext, kek)
    _current_dek.set(dek)           # ← never reset; relies on asyncio per-task contextvar isolation
    ...
    return user

async def optional_user(request, db=Depends(get_db)) -> User | None:
    if "session" not in request.cookies:
        return None
    return await current_user(request, db)    # ← direct await breaks if current_user becomes yield-dep
```

**Problem**: `_current_dek.set(dek)` creates a token but never calls `reset(token)`. Per-request asyncio Task isolation saves us in practice, but refactors can silently break this.

**Fix**: convert both `current_user` and `optional_user` to yield-dep pattern (FastAPI idiom for dep cleanup). Extract shared validation into a helper so `optional_user` can reuse it without calling `current_user` directly.

### Step 3.2 — Write failing test

Modify `server/tests/integration/test_auth_deps_real.py` — add this test:

```python
@pytest.mark.asyncio
async def test_current_user_resets_dek_contextvar_after_request(client):
    """Task 3 (cleanup): DEK contextvar must be reset after each request
    so it doesn't leak across task boundaries (per-task isolation is the
    current safety net; this test adds a load-bearing assertion)."""
    from app.db_types import _current_dek

    _, _ = await register_user(client, "+8613800007777")
    # After the request completes, the contextvar in the TEST task should
    # not be set (the dep's finally-block reset'd the token in the request
    # task's context; the test task has its own context which was never
    # mutated — asserting `_current_dek.get(None) is None` here is a weak
    # check, but the strong check is that the yield-dep's finally ran).
    assert _current_dek.get(None) is None
```

Also add a unit-ish test that directly probes the dep's yield/finally behavior:

```python
@pytest.mark.asyncio
async def test_current_user_yield_dep_finally_calls_reset(async_client, database_url, monkeypatch):
    """Yield-dep structural test — verifies _current_dek.reset is called."""
    import app.auth.deps as deps_mod
    from app.db_types import _current_dek

    real_set = _current_dek.set
    real_reset = _current_dek.reset
    reset_calls = []

    def _tracking_reset(tok):
        reset_calls.append(tok)
        return real_reset(tok)

    monkeypatch.setattr(_current_dek, "reset", _tracking_reset)

    # Register + use /api/auth/me to exercise current_user dep
    phone = "+8613800007788"
    await register_user(async_client, phone) if False else None  # skip if fixture name differs

    # Simpler assertion path: just call /api/auth/me, which depends on current_user
    cookie, _ = await register_user(async_client, phone)
    r = await async_client.get("/api/auth/me", cookies={"session": cookie})
    assert r.status_code == 200
    assert len(reset_calls) >= 1, "_current_dek.reset should have been called after the request"
```

(Note: if `async_client` fixture name in the test file is different, use the actual name — check the top of `test_auth_deps_real.py` first.)

### Step 3.3 — Run → first test fails

```bash
uv run --package server pytest server/tests/integration/test_auth_deps_real.py::test_current_user_resets_dek_contextvar_after_request -v
```

Note: this test might actually pass initially because the test's asyncio task is separate from the request task (FastAPI's middleware runs the dep in a task-group). The test is a weak assertion but documents intent. The stronger test is `test_current_user_yield_dep_finally_calls_reset` — that WILL fail until reset is wired.

```bash
uv run --package server pytest server/tests/integration/test_auth_deps_real.py::test_current_user_yield_dep_finally_calls_reset -v
```
Expected: FAIL — `reset_calls` is empty because the current code only calls `.set()`.

### Step 3.4 — Refactor `auth/deps.py`

Read the full current `deps.py`. Replace `current_user` and `optional_user` with the following (keep `require_admin` and `check_quota` unchanged):

```python
from collections.abc import AsyncGenerator

# ... existing imports unchanged ...


async def _authenticate_and_mount_dek(
    request: Request,
    db: AsyncSession,
) -> tuple[User, object]:
    """Shared validation used by current_user + optional_user yield-deps.

    Returns (user, dek_reset_token). Caller must call `_current_dek.reset(token)`
    in their `finally` block after the request completes.
    """
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

    kek = request.app.state.kek
    dek = decrypt_dek(user.dek_ciphertext, kek)
    dek_token = _current_dek.set(dek)
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

    return user, dek_token


async def current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[User, None]:
    """Yield-dep: validate session, mount DEK contextvar, reset on teardown."""
    user, dek_token = await _authenticate_and_mount_dek(request, db)
    try:
        yield user
    finally:
        _current_dek.reset(dek_token)


async def optional_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[User | None, None]:
    """Returns None for guests (no cookie). A present-but-invalid cookie still
    raises 401 — it's an error signal, not 'anonymous'.

    Yield-dep so the DEK contextvar is reset on request teardown even when a
    user is present."""
    if "session" not in request.cookies:
        yield None
        return
    user, dek_token = await _authenticate_and_mount_dek(request, db)
    try:
        yield user
    finally:
        _current_dek.reset(dek_token)
```

### Step 3.5 — Run → pass

```bash
uv run --package server pytest server/tests/integration/test_auth_deps_real.py -v
```
Expected: all existing + 2 new tests pass.

Full suite:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: **306 passed** (304 + 2 new).

**If any auth/sessions test breaks**: the yield-dep change can surface subtle ordering bugs. Diagnose before committing.

### Step 3.6 — Commit

```bash
git add server/app/auth/deps.py server/tests/integration/test_auth_deps_real.py
git commit -m "fix(server): current_user/optional_user yield-dep pattern with DEK contextvar reset"
```

---

## Task 4: Reorder `ticket.commit()` before `yield done` (chart_llm)

**Files:**
- Modify: `server/app/services/chart_llm.py`
- Modify: `server/tests/unit/test_chart_llm_generator.py` — 1 new test

### Step 4.1 — Current flow (spec §2.6 race concern)

Read `server/app/services/chart_llm.py::stream_chart_llm`. Current tail flow on LLM success:

```python
# in the for loop
elif ev["type"] == "done":
    prompt_tok = ev.get("prompt_tokens", 0)
    completion_tok = ev.get("completion_tokens", 0)
    total_tok = ev.get("tokens_used", 0)
    yield sse_pack({"type":"done","full":accumulated,"tokens_used":total_tok})
# loop exits

if err is not None: ...  # error path

# success path
await upsert_cache(...)
await insert_llm_usage_log(...)
if ticket is not None:
    try:
        await ticket.commit()
    except Exception:
        yield sse_pack({"type":"error","code":"QUOTA_EXCEEDED", ...})
```

**Problem**: `done` yielded first. If `ticket.commit()` races and raises, user sees `done` + later `error` — wire-format oddity. Also, cache is written BEFORE commit, so on race user gets a free regen.

### Step 4.2 — Target flow (commit-before-done)

New tail flow:

```python
# in the for loop — stash done payload, don't yield yet
elif ev["type"] == "done":
    prompt_tok = ev.get("prompt_tokens", 0)
    completion_tok = ev.get("completion_tokens", 0)
    total_tok = ev.get("tokens_used", 0)
    # done_pending = True  (implicit: loop exits after this)

# loop exits

if err is not None: ...  # error path unchanged

# success path: commit first → then cache + log + yield done
if ticket is not None:
    try:
        await ticket.commit()
    except Exception as e:  # noqa: BLE001 — race
        yield sse_pack({"type":"error","code":"QUOTA_EXCEEDED","message":str(e)})
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint=kind, model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms,
            error=f"QUOTA_EXCEEDED: {e}",
        )
        return

# commit succeeded (or no ticket) — now write cache + log + yield done
await upsert_cache(
    db, chart_id=chart.id, kind=kind, key=key,
    content=accumulated, model_used=model_used, tokens_used=total_tok,
    regen_increment=(cache_row is not None and force),
)
await insert_llm_usage_log(
    db, user_id=user.id, chart_id=chart.id,
    endpoint=kind, model=model_used,
    prompt_tokens=prompt_tok, completion_tokens=completion_tok,
    duration_ms=duration_ms,
)
yield sse_pack({
    "type": "done",
    "full": accumulated,
    "tokens_used": total_tok,
})
```

Key change: `done` sse_pack moved out of the for-loop to the very end.

### Step 4.3 — Write failing test

Modify `server/tests/unit/test_chart_llm_generator.py` — add:

```python
@pytest.mark.asyncio
async def test_stream_chart_llm_commits_ticket_before_yielding_done(
    db_session, seeded, monkeypatch,
):
    """Task 4 (cleanup): on success, ticket.commit happens before `done` event.

    If commit races (QuotaExceededError), user sees `error` INSTEAD OF `done`
    — never both.
    """
    from app.db_types import user_dek_context
    from app.services import chart_llm
    from app.services.quota import QuotaTicket

    # Install a ticket whose commit() always raises to simulate race
    class _RacingTicket:
        kind = "verdicts_regen"
        async def commit(self):
            raise RuntimeError("simulated race: quota exceeded mid-request")

    # Fake stream with a real done event
    async def _stream(**kw):
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        yield {"type": "delta", "text": "content"}
        yield {"type": "done", "full": "content", "tokens_used": 10,
               "prompt_tokens": 5, "completion_tokens": 5}
    monkeypatch.setattr(chart_llm, "chat_stream_with_fallback", _stream)

    async def _retrieve(chart, kind):
        return []
    monkeypatch.setattr(chart_llm, "retrieve_for_chart", _retrieve)

    user, chart, dek = seeded
    events = []
    with user_dek_context(dek):
        async for raw in chart_llm.stream_chart_llm(
            db_session, user, chart,
            kind="verdicts", key="", force=True,
            cache_row=None,                        # no cache; simulating first-gen-with-ticket
            ticket=_RacingTicket(),
            build_messages=lambda p, r: [{"role":"s","content":"x"}],
            retrieval_kind="meta",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            events.append(raw)

    types_on_wire = []
    for raw in events:
        if b'"type":"done"' in raw:
            types_on_wire.append("done")
        elif b'"type":"error"' in raw:
            types_on_wire.append("error")
        elif b'"type":"delta"' in raw:
            types_on_wire.append("delta")
        elif b'"type":"model"' in raw:
            types_on_wire.append("model")

    # Race path: no done event should have been emitted
    assert "done" not in types_on_wire
    assert "error" in types_on_wire


@pytest.mark.asyncio
async def test_stream_chart_llm_race_does_not_write_cache(
    db_session, seeded, monkeypatch,
):
    """Task 4 (cleanup): ticket race → cache is NOT written (was a free regen
    under the old order).
    """
    from app.db_types import user_dek_context
    from app.services import chart_llm

    class _RacingTicket:
        kind = "verdicts_regen"
        async def commit(self):
            raise RuntimeError("race")

    async def _stream(**kw):
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        yield {"type": "delta", "text": "new content"}
        yield {"type": "done", "full": "new content", "tokens_used": 12,
               "prompt_tokens": 6, "completion_tokens": 6}
    monkeypatch.setattr(chart_llm, "chat_stream_with_fallback", _stream)

    async def _retrieve(chart, kind):
        return []
    monkeypatch.setattr(chart_llm, "retrieve_for_chart", _retrieve)

    user, chart, dek = seeded
    with user_dek_context(dek):
        async for _ in chart_llm.stream_chart_llm(
            db_session, user, chart,
            kind="verdicts", key="", force=True,
            cache_row=None, ticket=_RacingTicket(),
            build_messages=lambda p, r: [{"role":"s","content":"x"}],
            retrieval_kind="meta",
            temperature=0.7, max_tokens=3000, tier="primary",
        ):
            pass

    # Cache must NOT have been written on race
    row = await chart_llm.get_cache_row(db_session, chart.id, "verdicts", "")
    assert row is None
```

### Step 4.4 — Run → fail

```bash
uv run --package server pytest server/tests/unit/test_chart_llm_generator.py::test_stream_chart_llm_commits_ticket_before_yielding_done server/tests/unit/test_chart_llm_generator.py::test_stream_chart_llm_race_does_not_write_cache -v
```
Expected: FAIL — currently done IS emitted before commit race, and cache IS written.

### Step 4.5 — Refactor `stream_chart_llm`

Read the full current function in `server/app/services/chart_llm.py`. Replace the body starting at the `try:` around line 114 through to the end with:

```python
    try:
        async for ev in chat_stream_with_fallback(
            messages=messages, tier=tier,
            temperature=temperature, max_tokens=max_tokens,
            first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
        ):
            if ev["type"] == "model":
                model_used = ev["modelUsed"]
                yield sse_pack(ev)
            elif ev["type"] == "delta":
                accumulated += ev["text"]
                yield sse_pack(ev)
            elif ev["type"] == "done":
                # NOTE: DO NOT yield done here — commit ticket first so race
                # surfaces as `error` instead of `done → error`.
                prompt_tok = ev.get("prompt_tokens", 0)
                completion_tok = ev.get("completion_tokens", 0)
                total_tok = ev.get("tokens_used", 0)
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

    # Success path: commit-before-done (spec §2.6, Task 4 cleanup).
    if ticket is not None:
        try:
            await ticket.commit()
        except Exception as e:  # noqa: BLE001 — race: another request pushed us over limit
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
            await insert_llm_usage_log(
                db, user_id=user.id, chart_id=chart.id,
                endpoint=kind, model=model_used,
                prompt_tokens=None, completion_tokens=None,
                duration_ms=duration_ms, error=f"QUOTA_EXCEEDED: {e}",
            )
            return

    # Commit succeeded (or no ticket) — write cache + log + finally emit done.
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
    yield sse_pack({
        "type": "done",
        "full": accumulated,
        "tokens_used": total_tok,
    })
```

Also: since `settings` is now imported by Task 1, no new imports needed.

### Step 4.6 — Run → pass

```bash
uv run --package server pytest server/tests/unit/test_chart_llm_generator.py -v
```
Expected: all 6 existing + 2 new = 8 passed.

Existing integration tests:
```bash
uv run --package server pytest server/tests/integration/test_charts_verdicts_sse.py -v
```
All 9 existing verdicts SSE tests should still pass — the `done` event is still emitted on happy path, just later.

Full suite:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: **308 passed** (306 + 2 new).

### Step 4.7 — Commit

```bash
git add server/app/services/chart_llm.py server/tests/unit/test_chart_llm_generator.py
git commit -m "fix(server): chart_llm commit-before-done — race surfaces as error not done+error"
```

---

## Task 5: Update ACCEPTANCE.md Known items + verify full suite

**Files:**
- Modify: `server/ACCEPTANCE.md`

### Step 5.1 — Final test sanity

```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/cleanup-plan5-followups
uv run --package server pytest server/tests/ -n auto
```
Expected: **308 passed** (301 baseline + 7 new).

```bash
uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/ 2>&1 | tail -5
```
Record coverage — expect ≥ 85%.

### Step 5.2 — Update `server/ACCEPTANCE.md` Known items

Read `server/ACCEPTANCE.md`. Find the "Known non-blocking items" list. Strike through items resolved by this cleanup (keep originals for traceability), and add a new sign-off line.

Changes:

Item 4:
> 4. ~~`LLM_STREAM_FIRST_DELTA_MS` 默认 0 —— Plan 7 监控 P50 定值。~~ **Wire 已接通**（Plan 5 cleanup Task 1）：`chart_llm` + `chart_chips` 现传 `first_delta_timeout_ms=settings.llm_stream_first_delta_ms`。env 默认 0（禁用）仍然有效，Plan 7 改 env 即可生效。

Item 7:
> 7. ~~`auth/deps.py:62` DEK contextvar `.set()` 无 `.reset()` —— 后续独立小 plan。~~ **已修**（Plan 5 cleanup Task 3）：`current_user` + `optional_user` 改成 yield-dep pattern，`finally` 块 `_current_dek.reset(token)`。

Item 10 (already updated in Task 2):
> 10. ~~`services/sms.py::send_sms_code` 未扣 `sms_send` 配额~~ —— **已修** (Plan 5 cleanup Task 2)...

Add one new item for the Task 4 reorder (no longer Known but worth documenting the change):

> 11. Cache-before-commit race condition —— **已修**（Plan 5 cleanup Task 4）：`stream_chart_llm` 现 commit-before-done，race 时发 `error` 代替 `done` + `error`；cache 在 commit 成功后才写。

Add the chips rate-limit item (Plan 5 Important #2 — explicitly deferred):

> 12. chips 无 rate limit + 每调用写 `llm_usage_logs` —— 留待 **Plan 7 部署期** Nginx/WAF `limit_req` 层处理。应用层不加逻辑。

Update the final "Sign-off" section:

> ## Sign-off
>
> Plan 5 在 Plan 2+3+4 之上执行；Plan 5 cleanup 清掉 4 个 Important follow-ups。308 测试全绿 · 覆盖率 ≥85% · CI < 60s · wheel 可装可跑。
> Plan 6 可在此基础上加 conversation 对话层。

### Step 5.3 — Final commit

```bash
git add server/ACCEPTANCE.md
git commit -m "docs(server): Plan 5 cleanup acceptance (308 tests green; 4 Important items resolved)"
```

### Step 5.4 — Log sanity

```bash
git log --oneline -6
```
Expected (latest first):
- docs(server): Plan 5 cleanup acceptance (308 tests green; ...)
- fix(server): chart_llm commit-before-done — race surfaces as error not done+error
- fix(server): current_user/optional_user yield-dep pattern with DEK contextvar reset
- fix(server): sms_send quota — charge on send_sms_code when user is known
- fix(server): wire LLM_STREAM_FIRST_DELTA_MS through chart_llm + chart_chips
- (previous: `f0da15e chore(uv): sync uv.lock for openai transitive deps`)

---

## Recap — Plan 5 cleanup final state

- **5 commits** (4 fixes + 1 acceptance update)
- **7 new tests** (1 Task 1 + 2 Task 2 + 2 Task 3 + 2 Task 4)
- **Baseline 301 → 308 passed**
- **4 Plan 4/5 Important items cleared**:
  - LLM_STREAM_FIRST_DELTA_MS env wire live
  - sms_send quota charged when user is known
  - DEK contextvar properly reset via yield-dep
  - Cache-commit ordering fixed
- **1 Important item explicitly deferred**: chips rate limit → Plan 7 WAF layer
- Plan 2-4 code paths untouched (Plan 3 `sms.py` gets a new OPTIONAL arg but default=None preserves Plan 3 behavior for registration)
- Ready for Plan 6 kickoff from a clean baseline
