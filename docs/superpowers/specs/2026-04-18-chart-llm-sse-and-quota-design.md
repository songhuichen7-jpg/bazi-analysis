# Chart LLM SSE + Quota 设计文档

> **状态**：设计 · 待出实施计划
> **上游 spec**：`2026-04-17-user-accounts-and-deployment-design.md`（完整后端设计）
> **前置 plan**：
> - `2026-04-17-backend-foundation.md`（Plan 2 · 已完成）
> - `2026-04-17-auth-business-design.md`（Plan 3 · 已完成）
> - `2026-04-18-charts-crud-and-paipan-integration-design.md`（Plan 4 · 已完成）
> **范围**：上游 spec §3.2（Chart LLM 长文 SSE 路由 + 配额路由）+ §4（LLM 输出缓存 + 配额机制）chart 相关部分
> **撰写日期**：2026-04-18

---

## 0. 目标与范围

### 0.1 目标

在 Plan 4 的 chart CRUD 基础上接入 LLM（OpenAI-compatible MiMo），提供 chart-scoped 的长文生成 SSE 路由 + 缓存 + 配额机制：

- 5 个 chart LLM SSE 路由：`verdicts` / `sections` / `dayun/{index}` / `liunian` / `chips`
- 1 个配额快照路由：`GET /api/quota`
- 1 个 engine_version 升级后的重算路由：`POST /api/charts/:id/recompute`
- 缓存命中 replay 分支 + 首次生成免费 + force 重生扣 `<kind>_regen` 配额
- primary 模型错误 / 首 delta 超时 → fallback 模型自动切换
- `llm_usage_logs` 同步写（`done` 之后，try/except 包裹）
- 端口 MVP chart-level LLM 代码：`llm.js` → `openai-python` + fallback 包装；`prompts.js`（chart 部分 ~500 行）→ `app/prompts/<kind>.py`；`retrieval.js` → `app/retrieval/service.py`；`verdicts.js` → `app/prompts/verdicts.py`

### 0.2 非目标（留给 Plan 6 或 Plan 7）

- 对话层：`conversations` / `messages` CRUD · chat SSE（router → expert 两段式）· `gua` SSE · intent 分类器
- chips 的 history 上下文支持（Plan 5 无 history 参数）
- 首屏 `quota_snapshot` 嵌入 `/api/auth/me`（Plan 6）
- 前端（Plan 7）
- 真 LLM 调用 smoke test（Plan 7 部署期）
- cron 硬删软删盘
- `POST /api/charts/:id/import`（localStorage 迁移）

### 0.3 关键决定速览

| # | 决定 | 理由 |
|---|---|---|
| 1 | LLM client 用 `openai-python` `AsyncOpenAI`（MiMo base_url） | MiMo OpenAI-compatible；省 200 行 HTTP/SSE 解析；fallback 自己在 service 层包 |
| 2 | Prompts 端口拆成 `app/prompts/<kind>.py` 每个 builder 一个文件 | 单文件 1000 行不利于 LLM 上下文；按 builder 切文件与 Plan 4 的 `services/chart.py` 风格一致；Plan 6 同目录追加 `router/expert/chat/gua.py` 不破坏既有 |
| 3 | Prompts 不做 workspace member，留在 `server/app/prompts/` 子包 | prompts 只被 server 用，不像 paipan 需要独立冻结；是活代码随业务变 |
| 4 | SSE wire format 照 MVP：单 `data:` 通道 + JSON `type` 标签 | 跟现有 MVP 前端兼容；cache 回放加 `source: 'cache'` 字段即可 |
| 5 | Retrieval 走 `@lru_cache(maxsize=None)` lazy 读盘 | 效果等价 eager startup load；代码更简单；spec §2.5 "启动时 load 到内存" 的本意 ≡ 热路径零磁盘 IO |
| 6 | `?force=true` 查询字符串；force + cache 存在时 pre-check `<kind>_regen` 配额 | spec §4.1 明确 "首次生成免费，手动重生扣配额"；新盘首次 force 无 cache 视同生成不扣配额 |
| 7 | `/api/charts/:id/recompute` 只重跑 paipan + 清 chart_cache；**不**触发 LLM；**不**扣配额 | GET 保持幂等（spec §0.3 #4）；recompute 是显式"我要重新算"动作；LLM 重生仍走各自 `?force=true` |
| 8 | fallback：错误/空返回始终触发；首 delta 超时 env 可控默认禁用 | 跟 MVP 对齐；B 阶段观察 P50 再调阈值 |
| 9 | `llm_usage_logs` 同步写 `yield done` 之后，包 try/except | FastAPI BackgroundTasks 对 StreamingResponse 时序不可靠；`asyncio.create_task` 可能被 GC；同步 +20ms 用户感知为零 |
| 10 | chips 无 cache / 无配额 / 无 `force` / 无 history（Plan 5）/ FAST_MODEL | spec §4.3 cache key 表不含 chips；spec §3.2 明确 "不扣配额"；Plan 6 再加 history 参数 |
| 11 | 所有 chart SSE 路由首件事：`chart_service.get_chart(db, user, chart_id)` 做 owner 校验 | 跨用户 / 不存在 / 软删 统一 404 防枚举（继承 Plan 4） |
| 12 | 4 个 cache-aware 路由共享同一个 `stream_chart_llm` generator | DRY；verdicts/sections/dayun/liunian 只是 messages builder + retrieval_kind 不同 |
| 13 | `openai` SDK 的自动重试禁用（`max_retries=0`） | fallback 语义由我们自己控制，不希望 SDK 静默重试 primary 后才触发 fallback |
| 14 | 4xx HTTP 错误（404 / 422 / 429）必须在 StreamingResponse 之前 raise | 一旦 SSE 200 header 发出，无法再改 status；所有 pre-check 在 route 函数顶部同步做 |
| 15 | 顺手补 Plan 4 遗留：`server/pyproject.toml` 声明 `paipan = {workspace=true}` | 新 clone `uv sync --package server` 当前会漏装 paipan；这单行修正自然放 Plan 5（本就要改 pyproject.toml 加 openai） |

---

## 1. 模块布局

```
server/
├── app/
│   ├── llm/                           # ← NEW
│   │   ├── __init__.py
│   │   ├── client.py                  AsyncOpenAI wrapper + chat_stream_with_fallback
│   │   ├── events.py                  sse_pack + replay_cached
│   │   └── logs.py                    insert_llm_usage_log (sync, try/except wrapped)
│   ├── prompts/                       # ← NEW (Plan 5 = chart-level; Plan 6 追加 chat 类)
│   │   ├── __init__.py
│   │   ├── loader.py                  SKILL.md / guide / shards 读取，@lru_cache
│   │   ├── context.py                 compact_chart_context + today/timing helpers
│   │   ├── anchor.py                  build_classical_anchor (retrieval → prompt 片段)
│   │   ├── verdicts.py                build_messages
│   │   ├── sections.py                build_messages + parse_sections_text
│   │   ├── dayun_step.py              build_messages
│   │   ├── liunian.py                 build_messages
│   │   └── chips.py                   build_messages + parse_chips_json
│   ├── retrieval/                     # ← NEW
│   │   ├── __init__.py
│   │   ├── loader.py                  classics file reader + extract_qiongtong_section, @lru_cache
│   │   └── service.py                 retrieve_for_chart(chart, kind) — 移植 retrieval.js
│   ├── services/
│   │   ├── chart_llm.py               # ← NEW: cache-aware SSE generator（verdicts/sections/dayun/liunian 共享）
│   │   ├── chart_chips.py             # ← NEW: chips 专用
│   │   ├── chart.py                   MODIFY: +recompute
│   │   └── quota.py                   MODIFY: +get_snapshot
│   ├── schemas/
│   │   ├── llm.py                     # ← NEW: SectionBody / LiunianBody
│   │   └── quota.py                   # ← NEW: QuotaKindUsage / QuotaResponse
│   ├── api/
│   │   ├── charts.py                  MODIFY: +6 路由（5 SSE + recompute）
│   │   └── quota.py                   # ← NEW: GET /api/quota
│   ├── core/
│   │   └── config.py                  MODIFY: +MIMO_API_KEY / MIMO_BASE_URL / LLM_MODEL 等
│   └── main.py                        MODIFY: include quota_router
├── pyproject.toml                     MODIFY: +openai>=1.40; +paipan workspace dep
└── ACCEPTANCE.md                      REWRITE: Plan 2+3+4+5 合并
```

**paipan 不动**。**不加 Alembic migration**（chart_cache + quota_usage + llm_usage_logs 三张表 Plan 2 已建）。

---

## 2. API 契约

### 2.1 请求 schema（`app/schemas/llm.py`）

```python
Section = Literal["career", "personality", "wealth", "relationship",
                  "health", "appearance", "special"]

class SectionBody(BaseModel):
    section: Section

class LiunianBody(BaseModel):
    dayun_index: int = Field(..., ge=0)
    year_index: int = Field(..., ge=0)

# verdicts / dayun / chips: 无 body；index 走 URL path；force 走 query string
```

### 2.2 响应 schema（`app/schemas/quota.py`）

```python
QuotaKind = Literal["chat_message", "section_regen", "verdicts_regen",
                    "dayun_regen", "liunian_regen", "gua", "sms_send"]

class QuotaKindUsage(BaseModel):
    used: int
    limit: int
    resets_at: datetime                                 # 下一个北京时间 00:00

class QuotaResponse(BaseModel):
    plan: Literal["free", "pro"]
    usage: dict[QuotaKind, QuotaKindUsage]              # 7 项全量，未使用者 used=0
```

### 2.3 路由契约

| Method / Path | Query | Body | Success | 失败 |
|---|---|---|---|---|
| `POST /api/charts/{id}/verdicts` | `?force=bool` | — | 200 SSE | 401 · 404 `CHART_NOT_FOUND` · 429 `QUOTA_EXCEEDED`（仅 force+cache 存在时） |
| `POST /api/charts/{id}/sections` | `?force=bool` | `SectionBody` | 200 SSE | 401 · 404 · 422 · 429 |
| `POST /api/charts/{id}/dayun/{index}` | `?force=bool` | — | 200 SSE | 401 · 404 · 422（index 越界由 service 检查）· 429 |
| `POST /api/charts/{id}/liunian` | `?force=bool` | `LiunianBody` | 200 SSE | 401 · 404 · 422 · 429 |
| `POST /api/charts/{id}/chips` | — | — | 200 SSE | 401 · 404 |
| `POST /api/charts/{id}/recompute` | — | — | 200 `ChartResponse` (`cache_slots=[]`, `cache_stale=False`, `warnings=[]`) | 401 · 404 |
| `GET /api/quota` | — | — | 200 `QuotaResponse` | 401 |

所有 SSE 响应 header：
```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
X-Accel-Buffering: no
```

### 2.4 SSE 事件序列（4 个带 cache 的路由）

**命中缓存分支**（cache 存在 且 `force=false`）—— 不扣配额、不调 LLM：
```
data: {"type":"model","modelUsed":"cached","source":"cache"}
data: {"type":"delta","text":"<30 字切片>"}
... (切片间隔 20ms ≈ 1500 字/秒)
data: {"type":"done","full":"<完整内容>","tokens_used":0,"source":"cache"}
```

**生成分支**（cache 不存在 或 force=true）：
```
[可选] data: {"type":"retrieval","source":"穷通 + 三命"}
data: {"type":"model","modelUsed":"mimo-v2-pro"}                (首 delta 到达时)
data: {"type":"delta","text":"..."}  × N                         (LLM 流式)
[可选] data: {"type":"model","modelUsed":"mimo-v2-flash"}        (fallback 触发时)
data: {"type":"delta","text":"..."}  × N                         (fallback 续流)
data: {"type":"done","full":"<累积>","tokens_used":N}
```

**错误分支**（primary + fallback 都失败）：
```
data: {"type":"error","code":"UPSTREAM_LLM_FAILED","message":"..."}
(连接关闭)
```

**chips SSE 事件**（简化无 cache 无 retrieval）：
```
data: {"type":"model","modelUsed":"mimo-v2-flash"}
data: {"type":"delta","text":"..."} × N
data: {"type":"done","full":"<累积文本>","tokens_used":N}
```

chips 错误仍发 `{type:'error'}` event（跟 MVP "静默返空" 不同，前端自行处理）。

### 2.5 错误码映射

HTTP 响应前（JSON，spec §3.4）：
- 400 `INVALID_BIRTH_INPUT`（recompute 时 paipan raise ValueError，罕见）
- 401 `UNAUTHORIZED`（`current_user` dep）
- 404 `CHART_NOT_FOUND`（跨用户 / 不存在 / 软删态 / 软删超 30 天，防枚举）
- 422 Pydantic / `SectionBody` / `LiunianBody` / `dayun_index` 越界
- 429 `QUOTA_EXCEEDED`（`force=true` + cache 存在 + `<kind>_regen` 已达上限；`details: {kind, limit, resets_at}` + `Retry-After`）

SSE 流中：
- `{"type":"error","code":"UPSTREAM_LLM_FAILED","message":"..."}`（primary + fallback 都抛非超时错误）
- `{"type":"error","code":"UPSTREAM_LLM_TIMEOUT","message":"..."}`（首 delta 超时且 fallback 失败）

### 2.6 Cache + Quota 流程（verdicts/sections/dayun/liunian 共享）

```
route pre-check:
  chart = await get_chart(db, user, chart_id)                    # 404 防枚举
  cache = await get_cache_row(db, chart.id, kind, key)
  if cache and force:
    ticket = await check_quota(f"{kind}_regen")(user, db)        # 429 前置
  else:
    ticket = None                                                 # 首次生成免费
  return StreamingResponse(stream_chart_llm(db, user, chart,
      kind, key, force, cache, ticket, build_messages, retrieval_kind, ...))

generator:
  if cache and not force:
    yield from replay_cached(cache.content, cache.model_used)    # 切片回放
    return

  retrieved = await retrieve_for_chart(chart.paipan, retrieval_kind)
  if retrieved: yield sse_pack({"type":"retrieval","source":...})

  messages = build_messages(chart.paipan, retrieved)
  accumulated = ""; model_used = None; t_start = time.monotonic()
  try:
    async for ev in chat_stream_with_fallback(messages=messages, tier=tier,
                       temperature=..., max_tokens=...,
                       first_delta_timeout_ms=settings.llm_stream_first_delta_ms):
      if ev["type"] == "model":
        model_used = ev["modelUsed"]
        yield sse_pack(ev)
      elif ev["type"] == "delta":
        accumulated += ev["text"]; yield sse_pack(ev)
      elif ev["type"] == "done":
        prompt_tok, completion_tok = ev["prompt_tokens"], ev["completion_tokens"]
        yield sse_pack({"type":"done","full":accumulated,"tokens_used":ev["tokens_used"]})
  except UpstreamLLMError as e:
    yield sse_pack({"type":"error","code":e.code,"message":e.message})
    return                                                        # cache 未写、ticket 未 commit

  await upsert_cache(db, chart.id, kind, key, accumulated,
                     model_used, tokens_used,
                     regen_increment=(cache is not None and force))
  await insert_llm_usage_log(db, user_id=user.id, chart_id=chart.id,
                             endpoint=kind, model=model_used,
                             prompt_tokens=prompt_tok,
                             completion_tokens=completion_tok,
                             duration_ms=int((time.monotonic()-t_start)*1000))
  if ticket: await ticket.commit()                                # 原子增量；race 时 raise QuotaExceededError
                                                                   # → 转成 SSE error event（已 done 之后；极罕见）
```

**并发竞态**（两设备同时首次生成同 slot）：`UPSERT ... ON CONFLICT DO NOTHING`；后到者读已写条目时在外层 `get_cache_row` 检查（下次请求自动 replay）。当次请求如果也到了 UPSERT 步骤，ON CONFLICT 保证只有一条。

### 2.7 Recompute 路由语义

```
POST /api/charts/:id/recompute

chart = await get_chart(db, user, chart_id)         # 默认 include_soft_deleted=False
                                                     # 软删盘不能 recompute，要先 restore
paipan_dict, warnings, engine_version = run_paipan(chart.birth_input)
UPDATE charts SET paipan=..., engine_version=..., updated_at=now()
   WHERE id = :cid
DELETE FROM chart_cache WHERE chart_id = :cid        # 所有 4 kind 的 cache 全清
return ChartResponse(chart, cache_slots=[], cache_stale=False, warnings=warnings)
```

**不**调用任何 LLM。用户想重新看长文自己按 `?force=true`。

---

## 3. 内部设计

### 3.1 `app/llm/client.py`

```python
from openai import AsyncOpenAI, APIError, APITimeoutError

_client = AsyncOpenAI(
    api_key=settings.mimo_api_key,
    base_url=settings.mimo_base_url,
    max_retries=0,                       # 禁用 SDK 内部重试；fallback 自己控
)

class UpstreamLLMError(Exception):
    def __init__(self, code: Literal["UPSTREAM_LLM_FAILED","UPSTREAM_LLM_TIMEOUT"], message: str):
        self.code = code; self.message = message

def _model_for_tier(tier: Literal["primary","fast"]) -> str: ...
def _fallback_for(tier) -> str | None: ...

async def chat_with_fallback(*, messages, tier="primary", **opts) -> tuple[str, str]:
    """Non-stream. Returns (text, model_used). primary 错 / 空 → fallback。
    最终失败抛 UpstreamLLMError。"""

async def chat_stream_with_fallback(
    *, messages, tier="primary", temperature, max_tokens,
    first_delta_timeout_ms: int | None = None,
) -> AsyncIterator[dict]:
    """Yields:
      {"type":"model", "modelUsed": <primary>}                         (首 delta 到达)
      {"type":"delta", "text": <chunk>}                                × N
      {"type":"model", "modelUsed": <fallback>}                        (fallback 激活，可选)
      {"type":"done", "full": <str>, "tokens_used": <int>,
         "prompt_tokens": <int>, "completion_tokens": <int>}

    fallback 触发：
      - primary 抛 APIError / APITimeoutError / asyncio.CancelledError
      - primary 流结束但 accumulated 空
      - 首 delta 超 first_delta_timeout_ms（若非 None 且 > 0）

    最终失败（primary + fallback 都失败）→ 抛 UpstreamLLMError(
        code="UPSTREAM_LLM_TIMEOUT" if 超时触发, else "UPSTREAM_LLM_FAILED", ...)
    """
```

### 3.2 `app/llm/events.py`

```python
def sse_pack(obj: dict) -> bytes:
    """obj → 'data: {json-compact}\\n\\n'.encode('utf-8')"""

async def replay_cached(
    content: str, model_used_orig: str | None,
    *, chunk_size=30, interval_ms=20,
) -> AsyncIterator[bytes]:
    """Yields:
      sse_pack({"type":"model","modelUsed":"cached","source":"cache"})
      sse_pack({"type":"delta","text":<chunk>}) × N  (每 interval_ms 间隔)
      sse_pack({"type":"done","full":<content>,"tokens_used":0,"source":"cache"})
    """
```

### 3.3 `app/llm/logs.py`

```python
async def insert_llm_usage_log(
    db: AsyncSession, *,
    user_id: UUID, chart_id: UUID | None,
    endpoint: str, model: str | None,
    prompt_tokens: int | None, completion_tokens: int | None,
    duration_ms: int, error: str | None = None,
) -> None:
    """同步 INSERT；try/except 包裹，失败仅 logger.warning"""
```

### 3.4 `app/prompts/*`（chart-level 移植）

**端口纪律**（延续 Plan 1）：每函数 `# NOTE: prompts.js:<lines>` 注释；中文 prompt 逐字符照抄（LLM 输出一致性依赖）；参数名 snake_case，内部状态尽量纯函数。

```python
# app/prompts/loader.py
@lru_cache(maxsize=1)
def load_skill() -> str: ...                     # 读 $BAZI_REPO_ROOT/SKILL.md
@lru_cache(maxsize=1)
def load_guide() -> str: ...                     # conversation-guide.md
@lru_cache(maxsize=None)
def load_shard(intent: str) -> str: ...          # shards/<intent>.md；缺失返回 ""

# app/prompts/context.py
def compact_chart_context(paipan: dict) -> dict: ...
def resolve_today_year(paipan: dict) -> int: ...
def resolve_current_timing(ui: dict) -> dict: ...

# app/prompts/anchor.py
def build_classical_anchor(retrieved: list[RetrievalHit], *, terse=False) -> str: ...

# app/prompts/verdicts.py
def build_messages(paipan: dict, retrieved: list[RetrievalHit]) -> list[dict]: ...

# app/prompts/sections.py
def build_messages(paipan: dict, retrieved: list[RetrievalHit], *, section: str) -> list[dict]: ...
def parse_sections_text(raw: str) -> dict[str, str]: ...   # § 切片

# app/prompts/dayun_step.py
def build_messages(paipan: dict, retrieved: list[RetrievalHit], *, step_index: int) -> list[dict]: ...

# app/prompts/liunian.py
def build_messages(paipan: dict, retrieved: list[RetrievalHit],
                   *, dayun_index: int, year_index: int) -> list[dict]: ...

# app/prompts/chips.py
def build_messages(paipan: dict, history: list[dict] = ()) -> list[dict]: ...
def parse_chips_json(raw: str) -> list[str]: ...
```

### 3.5 `app/retrieval/*`（整文件移植 retrieval.js）

```python
# app/retrieval/loader.py
@lru_cache(maxsize=None)
def read_classic(rel_path: str) -> str: ...      # 读 $BAZI_REPO_ROOT/classics/<rel_path>
def extract_qiongtong_section(content: str, day_gan: str, month_zhi: str) -> str | None: ...

# app/retrieval/service.py
@dataclass
class RetrievalHit:
    source: str                                  # "穷通" / "三命" / "滴天" 等标签
    scope: str                                   # "full" / section 名
    chars: int
    text: str

PER_SOURCE_MAX = 2500
TOTAL_MAX = 6000
INTENT_ROUTES = {...}                            # 照搬 JS 字典

async def retrieve_for_chart(paipan: dict, kind: str) -> list[RetrievalHit]: ...
```

### 3.6 `app/services/chart_llm.py`

```python
async def get_cache_row(db, chart_id, kind, key) -> ChartCache | None: ...

async def upsert_cache(db, *, chart_id, kind, key, content,
                       model_used, tokens_used, regen_increment: bool) -> None: ...

async def stream_chart_llm(
    db, user, chart, *,
    kind: Literal["verdicts","section","dayun_step","liunian"],
    key: str,
    force: bool,
    cache_row: ChartCache | None,          # 上层 SELECT 过
    ticket: QuotaTicket | None,
    build_messages,                        # Callable (paipan, retrieved) -> messages
    retrieval_kind: str,
    temperature: float = 0.7,
    max_tokens: int = 3000,
    tier: Literal["primary","fast"] = "primary",
) -> AsyncIterator[bytes]:
    """Unified SSE generator. See §2.6 for pseudocode."""
```

### 3.7 `app/services/chart_chips.py`

```python
async def stream_chips(db, user, chart) -> AsyncIterator[bytes]:
    """FAST_MODEL tier. 无 cache 无 quota 无 retrieval。错误发 error event。"""
```

### 3.8 `app/services/chart.py` 扩展

```python
async def recompute(db, user, chart_id) -> tuple[Chart, list[str]]:
    """1. get_chart(db, user, chart_id)        # 404 防枚举；软删盘 404
       2. paipan_dict, warnings, engine_version = paipan_adapter.run_paipan(
              BirthInput(**chart.birth_input))
       3. UPDATE charts SET paipan, engine_version, updated_at
       4. DELETE FROM chart_cache WHERE chart_id = :cid
       5. return (chart, warnings)
    """
```

### 3.9 `app/services/quota.py` 扩展

```python
async def get_snapshot(db, user) -> QuotaResponse:
    """SELECT kind, count FROM quota_usage WHERE user_id AND period=today_beijing()
       合并 QUOTAS[user.plan] 缺失 kind 补 used=0；resets_at=next_midnight_beijing()"""
```

### 3.10 `app/api/charts.py` 新增路由（`/api/charts/{chart_id}/*`）

每路由结构一致（以 sections 为例）：

```python
@router.post("/{chart_id}/sections")
async def sections_endpoint(
    chart_id: UUID, body: SectionBody,
    force: bool = Query(False),
    db=Depends(get_db), user=Depends(current_user),
):
    chart = await chart_service.get_chart(db, user, chart_id)             # 404
    cache = await chart_llm_service.get_cache_row(db, chart.id, "section", body.section)
    ticket = await check_quota("section_regen")(user=user, db=db) if (cache and force) else None
    # 所有 4xx 错误在此之前 raise；SSE 一旦开始无法改 status

    return StreamingResponse(
        chart_llm_service.stream_chart_llm(
            db, user, chart,
            kind="section", key=body.section, force=force,
            cache_row=cache, ticket=ticket,
            build_messages=partial(prompts.sections.build_messages, section=body.section),
            retrieval_kind=f"section:{body.section}",
            temperature=0.7, max_tokens=3000, tier="primary",
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

其余 4 路由（verdicts/dayun/liunian/chips）同 pattern。chips 不过 cache/quota/retrieval。recompute 是 JSON 同步响应：

```python
@router.post("/{chart_id}/recompute", response_model=ChartResponse)
async def recompute_endpoint(chart_id: UUID, db, user):
    try:
        chart, warnings = await chart_service.recompute(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback(); raise _http_error(e)
    return await _chart_to_response(chart, db=db, warnings=warnings)
```

### 3.11 `app/api/quota.py`（新）

```python
router = APIRouter(tags=["quota"], dependencies=[Depends(current_user)])

@router.get("/api/quota", response_model=QuotaResponse)
async def get_quota(db=Depends(get_db), user=Depends(current_user)) -> QuotaResponse:
    return await quota_service.get_snapshot(db, user)
```

`main.py` include 顺序最终：`auth → sessions → charts → quota → public`。

---

## 4. 测试策略

**沿用 Plan 2-4 的 fixtures**：`apply_migrations` + `client` + `register_user` + `db_session` 等不变。新增 fixture：

- `mock_openai_client`（autouse on LLM tests）：monkeypatch `app.llm.client._client` 成 fake `AsyncOpenAI`，返回预编 chunks
- `seed_chart`：helper `(client, cookie) -> chart_id`

**目标**：≥ 85% 源码覆盖，CI < 60s，新增 ~70 条测试，合并套件 ~270 passed。

### 4.1 Unit 测试（~40）

- `llm/client.py`（~10）：happy / primary error → fallback / 首 delta timeout / 双失败 raise / token 统计 / max_retries=0 配置 / model tier 映射 / fallback 发第二次 model event / 空 stream 触发 fallback / openai APITimeoutError 映射
- `llm/events.py`（~5）：sse_pack bytes 格式 / replay_cached chunk 数 / replay_cached sleep 间隔 / cache `source` 字段 / done 事件 `tokens_used=0`
- `prompts/*`（~15）：每 builder 对 3 个 chart fixture 做 messages 快照；parse_sections_text / parse_chips_json 各 2-3 个 fixture（含异常输入）；load_skill / load_shard lru 命中
- `retrieval/service.py`（~6）：retrieve_for_chart × 3 chart × 核心 kind；PER_SOURCE_MAX / TOTAL_MAX 截断；missing classic file 安全
- `services/chart_llm.py` cache helper（~3）：get_cache_row / upsert_cache / regen_increment
- `services/quota.py` get_snapshot（~3）：空数据 / 部分填表 / 全满；resets_at 时区正确

### 4.2 Integration 测试（~30）

- `GET /api/quota`（3）：happy / 未登录 401 / 部分用量正确反映
- `POST /recompute`（5）：happy / 跨用户 404 / 软删盘 404 / 清 chart_cache / 不扣配额
- `POST /verdicts` SSE（6）：cache miss happy / cache hit replay（对比两次响应 content 一致）/ force + no cache → generate 不扣 / force + cache → 扣 verdicts_regen / regen 达上限 429 / LLM 错误 SSE error
- `POST /sections` SSE（5）：同 verdicts + 422 bad section + section key 不同生成独立 cache
- `POST /dayun/{index}`（3）：happy / index 越界 422 / cache key = str(index)
- `POST /liunian` SSE（4）：happy / body 422 / cache key = f"{d}:{y}" / force + cache
- `POST /chips` SSE（3）：happy / 跨用户 404 / LLM 错误发 error event（不扣配额）
- `chart_llm` 并发（1）：两请求并发同 slot 首次生成 → 两边都成功（第二个最终 replay）、chart_cache 只一条

### 4.3 SSE 断言 helper

```python
async def consume_sse(response) -> list[dict]:
    """逐行解析 `data: {json}\\n\\n`，返回事件列表"""

# 用法:
events = await consume_sse(r)
types = [e["type"] for e in events]
assert "model" in types and "delta" in types and "done" in types
assert "".join(e["text"] for e in events if e["type"] == "delta") == events[-1]["full"]
```

### 4.4 不做的测试

- 真 LLM 调用（部署期 Plan 7 smoke）
- prompts 端口跟 Node MVP 的 byte-for-byte 对拍（MVP prompts.js 本身是 spec 的事实上下游，冻结不合适；改用 Python 端手写 snapshot）
- 冷启动 prompts/retrieval lazy load 计时（手动 verify）

---

## 5. 验收闸（硬 Gate）

- [ ] `uv run --package server pytest server/tests/ -n auto` 全绿（预期 ~270 passed）
- [ ] `pytest --cov=app --cov-config=/dev/null server/tests/` ≥ 85%
- [ ] CI wall time < 60s
- [ ] wheel 可装可跑：24 业务路由（Plan 4 的 17 + Plan 5 的 7 新增：5 chart SSE（verdicts / sections / dayun / liunian / chips）+ recompute + /api/quota）
- [ ] Alembic 双向干净（Plan 5 无新 migration）
- [ ] 所有 chart SSE 路由 404 防枚举（跨用户 / 软删 / 不存在 统一 `CHART_NOT_FOUND`）
- [ ] GET /api/quota 未登录 401
- [ ] cache hit replay 的 `full` 与 cache miss 生成的 `full` 一致（SSE 回放完整性）
- [ ] force + cache 存在时扣 `<kind>_regen`；首次生成不扣
- [ ] LLM 失败 SSE `error` event 后 cache 未写、配额未扣
- [ ] fallback 激活时发 2 次 `model` event
- [ ] `server/pyproject.toml` 声明 `openai>=1.40` + `paipan = {workspace=true}`
- [ ] Plan 2/3/4 现有 256 测试全部不回归（`git diff main..HEAD -- server/app/auth/ server/app/api/auth.py server/app/api/sessions.py` 零修改验证）

---

## 6. Plan 6 交接契约

Plan 5 产出以下稳定契约，Plan 6（conversation 对话层）接入时可复用不改：

### 6.1 API 层
- `GET /api/quota` response shape 稳定
- `POST /api/charts/:id/chips` 的 SSE wire format 稳定（Plan 6 扩展 history 参数时追加 body，不破坏现有）

### 6.2 服务层
- `app.llm.client.chat_stream_with_fallback` / `chat_with_fallback`（chat SSE 复用）
- `app.llm.client.UpstreamLLMError`
- `app.llm.events.sse_pack` / `replay_cached`（对话路由复用同一 wire format）
- `app.llm.logs.insert_llm_usage_log`
- `app.retrieval.service.retrieve_for_chart(paipan, kind)` / `RetrievalHit`（对话 expert 路由按 intent 复用）
- `app.prompts.loader` / `app.prompts.context` / `app.prompts.anchor`（shared infra）
- `app.services.quota.get_snapshot(db, user)`（Plan 6 把 quota_snapshot 嵌到 `/api/auth/me`）

### 6.3 Schema
- `app.schemas.quota.QuotaKindUsage` / `QuotaResponse`

### 6.4 扩展点
- Plan 6 新增 `app/prompts/router.py` / `expert.py` / `chat.py` / `gua.py` 同目录追加不改 Plan 5 文件
- `chart_llm_service.stream_chart_llm` 对 Plan 6 不可见（那是对话，不走 chart_cache）

---

## 7. 非阻塞 TODO（显式留给后续）

1. `POST /api/charts/:id/import`（localStorage 迁移）未实现 —— 单独短 plan。
2. 软删 30 天硬删 cron/worker 未实现 —— Plan 7 部署期加。
3. `paipan.compute` 同步跑不 executor —— C 阶段压测证明瓶颈再改。
4. `LLM_STREAM_FIRST_DELTA_MS` 默认 0（禁用）—— Plan 7 监控 P50 首 delta 延迟后定阈值。
5. `llm_usage_logs` 同步写 ~20ms —— 若 B 阶段影响 SSE done 时序，改 `asyncio.create_task` + 全局 task set 保留强引用。
6. chips 错误发 error event vs MVP 静默返空 —— 前端 Plan 7 自行处理。
7. `retrieval` `@lru_cache` 进程级 —— 修改 classics/*.md 需重启服务；B 阶段可接受。
8. `BAZI_REPO_ROOT` 定位 Plan 7 部署期要固化；Plan 5 开发期推断即可。
9. `auth/deps.py:62` DEK contextvar `.set()` 无 `.reset()` —— Plan 4 遗留；Plan 5 不改 `auth/deps.py` 不碰；Plan 6 或单独小 plan 切 try/finally + reset。
10. POST `/api/charts` 无 rate limit —— 15 盘上限是天然 ceiling；Plan 7 部署期 WAF/Nginx 层加。
11. chips 无 history 上下文 —— Plan 6 补。

---

## 8. 参考文档

- `docs/superpowers/specs/2026-04-17-user-accounts-and-deployment-design.md` §3.2 / §4.1-4.9（上游 spec）
- `docs/superpowers/specs/2026-04-18-charts-crud-and-paipan-integration-design.md`（Plan 4 spec）
- `archive/server-mvp/llm.js`（254 行 · LLM client 参照）
- `archive/server-mvp/prompts.js`（1006 行 · chart-level builders 待移植的部分）
- `archive/server-mvp/retrieval.js`（341 行 · 古籍检索参照）
- `archive/server-mvp/verdicts.js`（60 行 · verdicts 流程参照）
- `server/ACCEPTANCE.md`（Plan 2+3+4 合并现状）
- OpenAI Python SDK: <https://github.com/openai/openai-python>（`AsyncOpenAI` + stream async iterator）
