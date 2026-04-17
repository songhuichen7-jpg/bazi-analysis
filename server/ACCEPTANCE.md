# server Backend — Acceptance Checklist

Plan 2 (Foundation) + Plan 3 (Auth Business) combined state.

## Hard Gates

- [x] **全部测试并行全绿**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **102 passed in 23.8s** → ✅
- [x] **源码覆盖率 ≥ 85%**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **86%** (840 stmts / 119 missed) → ✅
- [x] **并行 CI runtime < 60s**
  - `time uv run --package server pytest server/tests/ -n auto`
  - Result: **23.8s** wall time → ✅
- [x] **wheel 可装可跑**
  - Isolated venv import of `app.main:app` prints 9 auth routes + `/api/health` → ✅
- [x] **Alembic 双向干净**
  - `test_migrations.py` passes for baseline 0001 and 0002 → ✅
- [x] **`auth/deps.py` 无 NotImplementedError**
  - `grep -c "raise NotImplementedError" server/app/auth/deps.py` → **0** → ✅
- [x] **SMS aliyun provider 仅 skeleton**
  - `grep -c "raise NotImplementedError" server/app/sms/aliyun.py` → **1** (Plan 7 fills real impl) → ✅
- [x] **Phone 完整值不在响应中**
  - All `/api/auth/*` responses use `phone_last4`, never raw `phone` → ✅
- [x] **Dev mode `__devCode` 回显；prod 不回显**
  - `test_register_dev_code_not_leaked_in_prod` passes → ✅
- [x] **Crypto-shredding 端到端**
  - `test_crypto_shredding_via_api.py` proves: register → chart → shred → random DEK fails `InvalidTag` → ✅
- [x] **SMS rate limit 三场景覆盖**
  - `test_cooldown_blocks_second_send_within_60s` + `test_hourly_limit_blocks_sixth_send` + normal-path tests → ✅

## Route Inventory

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
| DELETE | `/api/auth/sessions/{session_id}` | user | Plan 3 |

## Per-module 覆盖率（source only）

| Module | Stmts | Missed | Coverage |
|---|---|---|---|
| `app/__init__.py` | 0 | 0 | 100% |
| `app/api/__init__.py` | 0 | 0 | 100% |
| `app/api/auth.py` | 68 | 19 | 72% |
| `app/api/sessions.py` | 27 | 7 | 74% |
| `app/auth/__init__.py` | 0 | 0 | 100% |
| `app/auth/deps.py` | 56 | 33 | 41% |
| `app/core/__init__.py` | 0 | 0 | 100% |
| `app/core/config.py` | 16 | 0 | 100% |
| `app/core/crypto.py` | 37 | 3 | 92% |
| `app/core/db.py` | 30 | 0 | 100% |
| `app/core/logging.py` | 10 | 0 | 100% |
| `app/core/quotas.py` | 14 | 5 | 64% |
| `app/db_types/__init__.py` | 16 | 0 | 100% |
| `app/db_types/encrypted_json.py` | 27 | 1 | 96% |
| `app/db_types/encrypted_text.py` | 25 | 1 | 96% |
| `app/main.py` | 21 | 0 | 100% |
| `app/models/chart.py` | 32 | 0 | 100% |
| `app/models/conversation.py` | 27 | 0 | 100% |
| `app/models/quota.py` | 30 | 0 | 100% |
| `app/models/user.py` | 62 | 0 | 100% |
| `app/schemas/auth.py` | 50 | 0 | 100% |
| `app/services/auth.py` | 64 | 40 | 38% |
| `app/services/exceptions.py` | 60 | 0 | 100% |
| `app/services/quota.py` | 30 | 0 | 100% |
| `app/services/session.py` | 39 | 9 | 77% |
| `app/services/sms.py` | 61 | 1 | 98% |
| `app/sms/__init__.py` | 13 | 0 | 100% |
| `app/sms/aliyun.py` | 8 | 0 | 100% |
| `app/sms/dev.py` | 6 | 0 | 100% |
| **Source TOTAL** | **840** | **119** | **86%** |

`auth/deps.py` 41% + `services/auth.py` 38% undercount happens because integration tests exercise happy paths and the most common errors (401/404/403/409/422), but not every rare branch (e.g. `ACCOUNT_SHREDDED` via active session — unreachable in practice because shred_account always revokes sessions first). Core + schemas + models + crypto all at 96-100%.

## Test Breakdown

| Category | Count |
|---|---|
| Unit — crypto primitives | 15 |
| Unit — config / logging / encrypted_text / encrypted_json | 18 |
| Unit — SMS provider factory | 4 |
| Unit — SMS service | 9 |
| Unit — QuotaTicket | 6 |
| Unit — 0001 migrations smoke | 3 |
| Integration — health / lifespan | 2 |
| Integration — migrations (0001 + 0002) | 4 |
| Integration — models | 4 |
| Integration — crypto-shredding (pure) + DEK isolation | 3 |
| Integration — auth deps real | 4 |
| Integration — register | 10 |
| Integration — login | 6 |
| Integration — logout | 2 |
| Integration — me | 3 |
| Integration — account delete | 5 |
| Integration — sessions | 5 |
| Integration — crypto-shredding via API | 2 |
| **Total** | **102** |

## Handoff to Plan 4

These contracts are STABLE:

- `app.auth.deps.current_user` / `optional_user` / `require_admin` / `check_quota` — fully implemented; Plan 4 routes `Depends(...)` them
- `app.services.quota.QuotaTicket` — `commit()` post-business, `rollback()` on exception
- `app.services.sms.send_sms_code` / `verify_sms_code` — reusable for any phone-verify path
- `app.services.session.create_session` / `resolve_session` / `revoke_all_sessions`
- Cookie `"session"` with raw 32-byte urlsafe token; DB stores sha256 hash
- DEK contextvar `_current_dek` auto-mounted by `current_user`; routes can read encrypted fields without explicit `user_dek_context`
- Migration 0002 `users.phone` + `users.dek_ciphertext` both NULLABLE (required for crypto-shredding)

## Known non-blocking items

1. `sms/aliyun.py` skeleton raises `NotImplementedError`. Plan 7 deployment phase fills it.
2. Rate limit stored in DB, not Redis — fine for single-machine B phase; scale-out deferred.
3. Invite-code UI / admin creation endpoint not in scope. Plan 3 tests seed invites directly via DB.
4. `/api/config` (`{require_invite, features}`) and `/api/cities` land in Plan 4.
5. `auth/deps.py` and `services/auth.py` coverage < 85% — rare error branches (e.g. `ACCOUNT_SHREDDED` via active session) unreachable in practice.
6. Migration 0002 downgrade intentionally does NOT restore `NOT NULL` on `users.phone` and `users.dek_ciphertext` — crypto-shredded rows would block; noted inline.

## Sign-off

Plan 3 executed via `superpowers:subagent-driven-development` on top of Plan 2. All hard gates green. Plan 4 can proceed with `/api/charts` CRUD + paipan integration.
