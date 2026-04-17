# server Backend Foundation — Acceptance Checklist

Every criterion verified on `claude/lucid-yalow-97b48c` after Task 15.

## Hard Gates

- [x] **测试全绿（并行）**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **49 passed in 26.4s** → ✅
- [x] **源码覆盖率 ≥ 85%（`server/app/*`）**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **94%** (352 stmts / 21 missed) → ✅
- [x] **CI 并行耗时 < 30s**
  - `time uv run --package server pytest server/tests/ -n auto`
  - Result: **26.4s** wall time → ✅
- [x] **wheel 可装 + 可跑**
  - `uv build --package server` → `dist/server-0.1.0-py3-none-any.whl` (13.2 KB)
  - Isolated venv: `pip install dist/server-0.1.0-py3-none-any.whl && python -c "from app.main import app; print(app.title)"` → `bazi-analysis backend` → ✅
- [x] **Alembic 双向干净**
  - `test_migrations.py`: upgrade head → downgrade base → only `alembic_version` left; upgrade head again → all 10 tables + required indexes present → ✅
- [x] **Crypto-shredding 验证**
  - `test_crypto_shredding.py`: 2 tests (pure-function + ORM end-to-end) pass → ✅
  - `test_dek_isolation.py`: 1 test (Alice cannot read Bob's row under her DEK) passes → ✅
- [x] **auth/deps.py 全 `NotImplementedError`**
  - `grep -c "raise NotImplementedError" server/app/auth/deps.py` → **4** (matches the 4 dependencies: current_user, optional_user, require_admin, check_quota._dep) → ✅
- [x] **无业务路由（除 /api/health）**
  - `grep -r "@app\.\(get\|post\|put\|delete\|patch\)" server/app/` → only `/api/health` → ✅
  - `ls server/app/api/ 2>/dev/null` → absent → ✅
- [x] **CI workflow 就位**
  - `.github/workflows/server-ci.yml` — GitHub Actions with `TZ=Asia/Shanghai` + parallel pytest → ✅

## Per-module 覆盖率（source only）

| Module | Stmts | Missed | Coverage |
|---|---|---|---|
| `app/__init__.py` | 0 | 0 | 100% |
| `app/auth/__init__.py` | 0 | 0 | 100% |
| `app/auth/deps.py` | 14 | 0 | 100% |
| `app/core/__init__.py` | 0 | 0 | 100% |
| `app/core/config.py` | 15 | 0 | 100% |
| `app/core/crypto.py` | 37 | 3 | 92% |
| `app/core/db.py` | 30 | 16 | 47% |
| `app/core/logging.py` | 10 | 0 | 100% |
| `app/db_types/__init__.py` | 16 | 0 | 100% |
| `app/db_types/encrypted_json.py` | 27 | 1 | 96% |
| `app/db_types/encrypted_text.py` | 25 | 1 | 96% |
| `app/main.py` | 17 | 0 | 100% |
| `app/models/__init__.py` | 11 | 0 | 100% |
| `app/models/chart.py` | 32 | 0 | 100% |
| `app/models/conversation.py` | 27 | 0 | 100% |
| `app/models/quota.py` | 30 | 0 | 100% |
| `app/models/user.py` | 61 | 0 | 100% |
| **Source TOTAL** | **352** | **21** | **94%** |

`core/db.py` at 47% reflects that `get_db` + singleton `_ensure_engine` path aren't exercised in Plan 2 (no route uses them — Plan 3 does). All other modules at ≥ 92%.

## Test breakdown

| Category | Count |
|---|---|
| Unit: crypto primitives | 16 |
| Unit: config | 3 |
| Unit: logging | 2 |
| Unit: EncryptedText | 5 |
| Unit: EncryptedJSONB | 8 |
| Unit: auth deps skeleton | 4 |
| Integration: health smoke | 1 |
| Integration: lifespan sentinel | 1 |
| Integration: migrations | 3 |
| Integration: models | 4 |
| Integration: crypto-shredding | 2 |
| Integration: DEK isolation | 1 |
| **Total** | **49** |

## Handoff to Plan 3

These contracts are STABLE for Plan 3:

- `app.auth.deps.current_user` / `optional_user` / `require_admin` / `check_quota`  — signatures stable; Plan 3 only removes the `raise NotImplementedError` and fills in bodies
- `app.db_types.user_dek_context` + `EncryptedText` + `EncryptedJSONB` + `get_current_dek`
- `app.core.crypto.{load_kek, generate_dek, encrypt_dek, decrypt_dek, encrypt_field, decrypt_field}`
- `app.core.db.{get_db, create_engine_from_settings, dispose_engine}`
- `app.core.config.settings`
- `app.models.{User, InviteCode, UserSession, SmsCode, Chart, ChartCache, Conversation, Message, QuotaUsage, LlmUsageLog, Base}`

Plan 3 implementation path:
1. Replace `raise NotImplementedError` in `auth/deps.py` with real logic.
2. Add Alembic migrations if auth flow needs new columns (none expected in Plan 3).
3. Reuse `User.dek_ciphertext` to store KEK-encrypted per-user DEK generated at registration.
4. Inside `current_user` after session/user resolution, call `_current_dek.set(decrypt_dek(user.dek_ciphertext, kek))` — this transparently enables EncryptedText/JSONB for the rest of the request.

## Known non-blocking items

1. `core/db.py` coverage at 47% — singleton path not exercised in Plan 2. Plan 3 routes will hit it.
2. Deprecation warning on Alembic `path_separator` config option. Cosmetic; fix in a future Alembic bump.
3. `SAWarning: transaction already deassociated from connection` on `test_unique_chart_cache_slot` — harmless SQLAlchemy artifact when IntegrityError aborts a nested flush. Silence via savepoint wrapping if it ever matters.

## Sign-off

Plan 2 executed via `superpowers:subagent-driven-development` with two-stage review (spec + code quality) per task. 15 implementation tasks across 5 phases, plus ~5 inline review-fix commits. All hard gates green. Ready to merge.
