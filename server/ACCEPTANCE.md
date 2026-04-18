# server Backend — Acceptance Checklist

Plan 2 (Foundation) + Plan 3 (Auth Business) + Plan 4 (Charts CRUD + paipan) +
Plan 5 (Chart LLM SSE + Quota + Recompute) 合并状态。

## Hard Gates

- [x] **全部测试并行全绿**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **301 passed in 16.0s** → ✅
- [x] **源码覆盖率 ≥ 85%**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **85%** → ✅
- [x] **并行 CI runtime < 60s** — Wall time: **16.0s** → ✅
- [x] **wheel 可装可跑** — 24 业务路由 (health + 7 auth + 2 sessions + 2 public
      + 6 charts CRUD + 5 chart SSE + recompute + /api/quota) → ✅
- [x] **Alembic 双向干净** (Plan 2/3 migrations 0001 + 0002 unchanged) → ✅
- [x] **chart SSE 路由 owner 校验** (跨用户 / 软删 / 不存在 统一 404) → ✅
- [x] **cache 命中 replay 零 LLM 调用** — `test_verdicts_cache_hit_replays` 中 boom
      fixture 保证 → ✅
- [x] **force + cache 存在扣 `<kind>_regen` 配额** — `test_verdicts_force_cache_charges_regen_quota` → ✅
- [x] **force + 无 cache 首次生成不扣配额** — `test_verdicts_force_no_cache_generates_without_quota` → ✅
- [x] **regen 配额超限 → 429 前置** — `test_verdicts_force_regen_quota_exceeded_429` → ✅
- [x] **LLM 双失败 → SSE error event + cache 未写** — `test_verdicts_llm_error_sse_error_no_cache` → ✅
- [x] **fallback 激活发 model event** — `test_verdicts_fallback_takes_over_on_primary_error` → ✅
- [x] **recompute 清 chart_cache + 更新 engine_version + 不扣配额** → ✅
- [x] **chips 无 cache / 无 quota / FAST_MODEL** → ✅
- [x] **GET /api/quota 未登录 401 / 登录返 7 kinds** → ✅
- [x] **server/pyproject.toml 声明 openai>=1.40 + paipan workspace dep** → ✅
- [x] **Plan 2/3/4 现有 256 测试全部不回归** (`git diff main..HEAD -- server/app/auth/ server/app/api/auth.py server/app/api/sessions.py server/app/services/auth.py server/app/services/sms.py` 零修改) → ✅

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
10. `services/sms.py::send_sms_code` 未扣 `sms_send` 配额 —— Plan 3 遗留，发现于 Plan 5 Task 8 spec review；单独小 plan 或 Plan 6 中补。

## Sign-off

Plan 5 在 Plan 2+3+4 之上执行。301 测试全绿 · 覆盖率 ≥85% · CI < 60s · wheel 可装可跑。
Plan 6 可在此基础上加 conversation 对话层。
