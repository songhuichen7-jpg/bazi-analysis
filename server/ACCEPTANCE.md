# server Backend — Acceptance Checklist

Plan 2 (Foundation) + Plan 3 (Auth Business) + Plan 4 (Charts CRUD + paipan) 合并状态。

## Hard Gates

- [x] **全部测试并行全绿**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **199 passed in 16.95s** → ✅
- [x] **源码覆盖率 ≥ 85%**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **87%** → ✅
- [x] **并行 CI runtime < 60s**
  - Wall time: **16.95s** → ✅
- [x] **wheel 可装可跑**
  - Isolated venv import of `app.main:app` prints 17 business routes (health + 7 auth + 2 sessions + 2 public + 6 charts) → ✅
- [x] **Alembic 双向干净**
  - Plan 2/3 migrations 0001 + 0002 unchanged → ✅
- [x] **跨用户 / 不存在 / 软删超窗 统一 404**
  - `test_charts_*` 里每个 resource 路径都验证 → ✅
- [x] **GET 路由幂等**
  - `test_get_detail_cache_stale_flag` 证明 GET 返回 `cache_stale=true` 后 `engine_version` 未变 → ✅
- [x] **15 盘上限 post-check 正确**
  - `test_create_16th_returns_409` + `test_restore_at_cap_409` → ✅
- [x] **软删盘不占 slot**
  - `test_create_chart_soft_deleted_not_counted` → ✅
- [x] **paipan warnings 不落 DB**
  - `test_create_unknown_city_yields_warning` 确认 response 有，`charts.birth_input` 没有 → ✅
- [x] **Crypto-shredding 对 charts.birth_input 同样生效**
  - `test_chart_birth_input_unreadable_after_shredding` → ✅

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

## Handoff to Plan 5

以下 Plan 4 完成的契约保持稳定，Plan 5（LLM 长文 SSE + conversations + /api/quota）不改：

- `ChartResponse.chart` / `cache_slots` / `cache_stale` / `warnings` 字段形态
- `ChartListItem` 字段形态
- `app.services.chart.get_chart(db, user, chart_id, include_soft_deleted=False)` — owner + 软删窗口校验
- `app.services.chart.get_cache_slots(db, chart_id)` — Plan 5 LLM 路由写 cache 后天然非空
- `app.services.paipan_adapter.is_cache_stale` / `run_paipan` / `resolve_city`
- `InvalidBirthInput` / `ChartNotFound` / `ChartLimitExceeded` / `ChartAlreadyDeleted` 异常
- `app.core.quotas.MAX_CHARTS_PER_USER = 15`

## Known non-blocking items

1. `POST /api/charts/import`（localStorage 迁移）未实现 —— 单独短 plan 做。
2. 软删 30 天硬删 cron/worker 未实现 —— Plan 7 部署期加。
3. `paipan.compute` 同步跑 event loop，未丢 `run_in_executor` —— C 阶段压测证明瓶颈再改。
4. `chart_cache` 表 Plan 4 不写入；`get_cache_slots` 返回 `[]` 是契约而非 bug。
5. POST `/api/charts` 无 IP rate limit —— 15 盘上限是天然 ceiling。
6. `POST /api/charts/:id/recompute`（engine_version 升级后主动重算）—— Plan 5 和 LLM 路由一起加。

## Sign-off

Plan 4 在 Plan 2+3 之上执行。所有硬闸绿；Plan 5 可在此基础上加 LLM 长文 SSE 路由。
