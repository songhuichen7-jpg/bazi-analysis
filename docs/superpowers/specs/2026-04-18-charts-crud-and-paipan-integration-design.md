# Charts CRUD + Paipan 接入 设计文档

> **状态**：设计 · 待出实施计划
> **上游 spec**：`2026-04-17-user-accounts-and-deployment-design.md`（完整后端设计）
> **前置 plan**：
> - `2026-04-17-backend-foundation.md`（Plan 2 · 已完成）
> - `2026-04-17-auth-business-design.md`（Plan 3 · 已完成）
> - `paipan-port-plan`（Plan 1 · 已完成，Python paipan 包可用）
> **范围**：上游 spec §3（Charts CRUD 路由 + 公共资源路由）+ §2.2（charts / chart_cache 表已建好，本 plan 开始写入）+ paipan Python 包接入
> **撰写日期**：2026-04-18

---

## 0. 目标与范围

### 0.1 目标

在 Plan 2 的 DB + 加密骨架 与 Plan 3 的认证闭环之上，接入 paipan Python 包并落地命盘 CRUD：

- 2 个公开路由：`GET /api/config`、`GET /api/cities`
- 5 个 charts CRUD 路由：`GET /api/charts`、`POST /api/charts`、`GET /api/charts/:id`、`PATCH /api/charts/:id`、`DELETE /api/charts/:id`
- 1 个 restore 路由：`POST /api/charts/:id/restore`
- `app.services.paipan_adapter` 薄封装：规范化城市、调 `paipan.compute`、映射 `ValueError` → 400
- `app.services.chart` CRUD：15 盘上限（post-check）、软删 30 天窗口、owner 严格校验（非 owner 一律 404 防枚举）
- `cache_slots` / `cache_stale` 字段契约在本 plan 固化，Plan 5 LLM 路由写 cache 时直接复用
- 所有 `birth_input` / `paipan` / `label` 字段走 Plan 2 的 `EncryptedJSONB` / `EncryptedText` 自动透明加解密

### 0.2 非目标（留给后续 plan）

- `POST /api/charts/import`（localStorage 迁移）—— 单独短 plan
- LLM 长文 SSE 路由（`verdicts` / `sections` / `dayun_step` / `liunian` / `chips`）—— Plan 5
- `conversations` / `messages` / `gua` —— Plan 5
- `GET /api/quota` 聚合视图 —— Plan 5
- `POST /api/charts/:id/recompute`（engine_version 升级后主动重算）—— Plan 5
- 软删 30 天硬删 cron worker —— Plan 7 部署期
- admin / guest 路由 —— 后续 plan
- 前端 Charts UI —— Plan 6

### 0.3 关键决定速览

| # | 决定 | 理由 |
|---|---|---|
| 1 | 范围锁定为 2 + 5 + 1 = 8 个路由（不含 `import`） | `import` 依赖 legacy localStorage 形态，单独短 plan 做清爽；restore 与软删同一 service 方法一起写完避免 Plan 5 回炒 |
| 2 | API body `{birth_input: {<paipan kwargs>}, label?}`，`birth_input` 原生 paipan 入参 | Q2 用户选 C；label 独立一列，birth_input 存/读/重算都一个字段，省一层 mapper |
| 3 | `/api/cities` 一次性返回全表（~3000 条） + `ETag` / `Cache-Control: public, max-age=86400` | Q3 用户选 A；~150KB gzipped 可接受，前端本地过滤省请求；后端 POST chart 时仍跑一次 `get_city_coords` 做权威规范化 |
| 4 | GET `/api/charts/:id` 仅返回 `cache_stale` flag，**不在 GET 内做任何写操作** | Q4 用户选 A；GET 保持幂等；重算走 Plan 5 独立 POST 路由 |
| 5 | 软删打 `deleted_at` 时间戳；列表 `WHERE deleted_at IS NULL`；restore 仅允许 `deleted_at > now() - 30d`；窗口外 404 | Q5 用户选 A；硬删 cron 单独 plan；防枚举选 404 不选 410 |
| 6 | 15 盘上限**只算 active**（软删不占 slot） | 站在用户侧更自然；绕过风险低 |
| 7 | `/api/config` 返回最小必要 flag：`{require_invite, engine_version, max_charts_per_user}` | Q6 用户选 A；不给 Plan 5+ 空占位，避免死契约 |
| 8 | 15 盘上限用 **post-check**（INSERT 后 `SELECT count(*)` > 15 → rollback） | 简单正确；不需要 `FOR UPDATE` 锁 user 行；并发竞态由事务 rollback 兜底 |
| 9 | `engine_version` 从 `paipan.VERSION` 运行时读，不写 env | 单一来源；Plan 4 不引新环境变量 |
| 10 | paipan 的 `warnings`（未识别城市 / DST 提示）**不落 DB**，作为 POST response 一次性字段 | warnings 会随 paipan 升级变动，存了反而不 stable |
| 11 | paipan.compute 同步跑 event loop，不丢 `run_in_executor` | ~200ms CPU；B 阶段 100 用户并发可接受；C 阶段压测证明瓶颈再改 |
| 12 | PATCH 仅允许改 `label`，不允许改 `birth_input` | 改生日就是新盘；保留旧 paipan + 已有 LLM cache 一致性 |
| 13 | 跨用户访问 / 软删超窗 / 不存在 统一返 404 `CHART_NOT_FOUND` | 防枚举（和 spec §3.4 ownership 不 403 同一哲学） |
| 14 | `ChartResponse` 永远包含 `cache_slots: list[CacheSlot]` 字段（Plan 4 返回 `[]`） | 前端契约稳定；Plan 5 加 LLM cache 写入时不破坏 response 结构 |

---

## 1. 模块布局（Plan 4 产出）

```
server/
├── app/
│   ├── api/
│   │   ├── charts.py                    # NEW · 7 个 charts 路由
│   │   └── public.py                    # NEW · /api/config + /api/cities
│   ├── services/
│   │   ├── chart.py                     # NEW · CRUD + 15 盘 + 软删 + restore
│   │   └── paipan_adapter.py            # NEW · paipan.compute wrapper + resolve_city + is_cache_stale
│   ├── schemas/
│   │   ├── chart.py                     # NEW · BirthInput / ChartCreateRequest / ChartResponse / ChartListItem / CacheSlot
│   │   └── config.py                    # NEW · ConfigResponse / CityItem
│   ├── services/exceptions.py           # MODIFY · + ChartNotFound / ChartLimitExceeded / ChartAlreadyDeleted / InvalidBirthInput
│   ├── core/quotas.py                   # MODIFY · + MAX_CHARTS_PER_USER = 15
│   └── main.py                          # MODIFY · include charts + public routers
├── tests/
│   ├── unit/
│   │   ├── test_paipan_adapter.py       # NEW · resolve_city / is_cache_stale / run_paipan 异常映射
│   │   └── test_chart_service_pure.py   # NEW · 若有纯函数
│   └── integration/
│       ├── test_public_routes.py        # NEW · /api/config + /api/cities（含 ETag）
│       ├── test_charts_create.py        # NEW
│       ├── test_charts_read.py          # NEW · list + get + cache_stale
│       ├── test_charts_update_delete.py # NEW · patch + delete
│       ├── test_charts_restore.py       # NEW
│       └── test_charts_e2e.py           # NEW · 注册→建盘→软删→restore→注销 shred
└── ACCEPTANCE.md                        # REWRITE · Plan 2+3+4 合并版

paipan/
├── paipan/cities.py                     # MODIFY · + all_cities() helper
└── paipan/__init__.py                   # MODIFY · export all_cities
```

**不动**：`auth/*`、`sms/*`、`services/session.py`、`services/auth.py`、`models/*`（含 chart.py ORM，Plan 2 已到位）、`db_types/*`、`alembic/*`、`core/crypto.py`、`core/db.py`、`core/config.py`。

**不新增 migration**：Plan 2 的 0001 baseline 已经有 charts + chart_cache 表；Plan 3 的 0002 改了 users 表。Plan 4 纯业务层，不改 schema。

**不新增 Python 依赖**：paipan 已在 uv workspace；FastAPI / Pydantic / SQLAlchemy / cryptography 都在。

---

## 2. API 契约

### 2.1 Schema（`app/schemas/chart.py`）

```python
# BirthInput: paipan.compute kwargs 的 Pydantic 1:1 映射
class BirthInput(BaseModel):
    year: int = Field(..., ge=1900, le=2100)
    month: int = Field(..., ge=1, le=12)
    day: int = Field(..., ge=1, le=31)
    hour: int = Field(..., ge=-1, le=23)          # -1 表示时辰未知
    minute: int = Field(0, ge=0, le=59)
    city: str | None = Field(None, max_length=40)
    longitude: float | None = Field(None, ge=-180, le=180)
    gender: Literal["male", "female"]
    ziConvention: Literal["early", "late"] = "early"
    useTrueSolarTime: bool = True

class ChartCreateRequest(BaseModel):
    birth_input: BirthInput
    label: str | None = Field(None, max_length=40)

class CacheSlot(BaseModel):
    kind: Literal["verdicts", "section", "dayun_step", "liunian"]
    key: str
    has_cache: bool
    model_used: str | None = None
    regen_count: int = 0
    generated_at: datetime | None = None

class ChartListItem(BaseModel):
    id: UUID
    label: str | None
    engine_version: str
    cache_stale: bool
    created_at: datetime
    updated_at: datetime

class ChartDetail(BaseModel):
    id: UUID
    label: str | None
    birth_input: BirthInput
    paipan: dict                                  # paipan.compute 返回原样
    engine_version: str
    created_at: datetime
    updated_at: datetime

class ChartResponse(BaseModel):
    chart: ChartDetail
    cache_slots: list[CacheSlot]                  # Plan 4 永远返回 []
    cache_stale: bool
    warnings: list[str] = []                      # POST 时 paipan warnings；其他动作为空

class ChartListResponse(BaseModel):
    items: list[ChartListItem]
```

### 2.2 Schema（`app/schemas/config.py`）

```python
class CityItem(BaseModel):
    name: str
    lng: float
    lat: float

class CitiesResponse(BaseModel):
    items: list[CityItem]

class ConfigResponse(BaseModel):
    require_invite: bool
    engine_version: str
    max_charts_per_user: int
```

### 2.3 路由契约

| Method / Path | Auth | Request body | Response | 错误分支 |
|---|---|---|---|---|
| GET `/api/config` | public | — | `ConfigResponse` | 无 |
| GET `/api/cities` | public | — | `CitiesResponse` + `ETag: "<sha1>"` + `Cache-Control: public, max-age=86400` | 304（`If-None-Match` 命中） |
| GET `/api/charts` | user | — | `ChartListResponse` | 无 |
| POST `/api/charts` | user | `ChartCreateRequest` | `201 ChartResponse`（含 warnings） | 400 `INVALID_BIRTH_INPUT`（paipan `ValueError`）· 409 `CHART_LIMIT_EXCEEDED` · 422 Pydantic |
| GET `/api/charts/:id` | user | — | `ChartResponse`（cache_slots=[], warnings=[]） | 404 `CHART_NOT_FOUND`（不存在 / 非 owner / 软删过期） |
| PATCH `/api/charts/:id` | user | `{label: str \| null}` | `ChartResponse` | 404 · 422 label > 40 字 |
| DELETE `/api/charts/:id` | user | — | `204 No Content` | 404 · 409 `CHART_ALREADY_DELETED` |
| POST `/api/charts/:id/restore` | user | — | `ChartResponse` | 404（不存在 / 非 owner / 非软删态 / 软删超 30 天）· 409 `CHART_LIMIT_EXCEEDED` |

### 2.4 错误响应格式（沿用 spec §3.4）

```json
{
  "error": {
    "code": "CHART_LIMIT_EXCEEDED",
    "message": "已达 15 盘上限",
    "details": { "limit": 15 }
  }
}
```

**HTTP code 映射**：
- 400 `INVALID_BIRTH_INPUT`（paipan 抛 `ValueError`，业务语义错）
- 401 未登录（`current_user` dep 兜，已在 Plan 3 完成）
- 404 `CHART_NOT_FOUND`（不存在 / 非 owner / 软删超窗 / restore 找不到 / 非软删态）
- 409 `CHART_LIMIT_EXCEEDED`（POST 或 restore 后 active 超 15）
- 409 `CHART_ALREADY_DELETED`（DELETE 已软删盘）
- 422 Pydantic validation（hour 超范围、label 超 40 字等）

### 2.5 `/api/cities` 细节

- 数据源：`paipan.cities.all_cities()` —— Plan 4 在 paipan 包里新增此 helper（现有 `_build_index()` 的公开 wrapper）；返回 `list[tuple[str, float, float]]`，按 name 字母排序确保 ETag 稳定。
- Response：`{items: [{name, lng, lat}, ...]}`；生成一次后 module-level `@lru_cache`。
- `ETag = sha1(f"{paipan.VERSION}:{len(items)}")[:16]`；客户端 `If-None-Match` 匹配直接 304 空体。
- `Cache-Control: public, max-age=86400`（1 天）。
- 若 paipan 升级导致 `VERSION` 变，ETag 自动变，客户端拿到新版。

### 2.6 `/api/config` 细节

- `require_invite = settings.require_invite`（Plan 3 已有的 env）
- `engine_version = paipan.VERSION`
- `max_charts_per_user = app.core.quotas.MAX_CHARTS_PER_USER`（新增常量 = 15）

---

## 3. Service 层

### 3.1 `app/services/paipan_adapter.py`

```python
from paipan import compute as paipan_compute
from paipan import VERSION as PAIPAN_VERSION
from paipan.cities import get_city_coords
from app.schemas.chart import BirthInput
from app.services.exceptions import InvalidBirthInput

def resolve_city(raw: str | None) -> dict | None:
    """返回 {canonical: str, lng: float, lat: float} 或 None。
    service 层落盘前调一次做权威规范化：前端可能传没标准化的名字。"""
    c = get_city_coords(raw)
    if c is None:
        return None
    return {"canonical": c.canonical, "lng": c.lng, "lat": c.lat}

def run_paipan(birth: BirthInput) -> tuple[dict, list[str], str]:
    """调 paipan.compute，返回 (paipan_dict, warnings, engine_version)。
    paipan 内部抛 ValueError → InvalidBirthInput（HTTP 400）。
    warnings 不落 DB（会随 paipan 升级变化），POST response 一次性返回。"""
    try:
        result = paipan_compute(**birth.model_dump())
    except ValueError as e:
        raise InvalidBirthInput(str(e)) from e
    warnings = result.pop("warnings", [])
    return result, warnings, PAIPAN_VERSION

def is_cache_stale(chart_engine_version: str) -> bool:
    return chart_engine_version != PAIPAN_VERSION
```

### 3.2 `app/services/chart.py`

全部 async 方法接 `db: AsyncSession, user: User`；事务在方法内部 `async with db.begin()`；route 层只负责调用 + schema 序列化。

```python
MAX_CHARTS = MAX_CHARTS_PER_USER  # 15
SOFT_DELETE_WINDOW = timedelta(days=30)

async def create_chart(db, user, req: ChartCreateRequest) -> tuple[Chart, list[str]]:
    """
    1. 规范化 city（若传了 city）：resolve_city(birth.city) 命中则把 canonical 回写
       到 birth.city。longitude 不预填（paipan.compute 内部会按 city 自己查），
       仅做落盘前的名字统一化 + 前端回显一致。
    2. run_paipan(birth) → paipan_dict, warnings, engine_version
    3. INSERT chart(user_id=user.id, label=req.label,
                    birth_input=birth.model_dump(),      # EncryptedJSONB
                    paipan=paipan_dict,                   # EncryptedJSONB
                    engine_version=engine_version)
    4. post-check: SELECT count(*) FROM charts
                   WHERE user_id=:uid AND deleted_at IS NULL
       若 > MAX_CHARTS → raise ChartLimitExceeded（事务 rollback）
    5. return (chart, warnings)
    """

async def list_charts(db, user) -> list[Chart]:
    """WHERE user_id AND deleted_at IS NULL ORDER BY created_at DESC."""

async def get_chart(db, user, chart_id, include_soft_deleted: bool = False) -> Chart:
    """
    WHERE id=:cid AND user_id=:uid
    - include_soft_deleted=False（默认，GET/PATCH 路径）:
        额外加 deleted_at IS NULL；0 行 → ChartNotFound
    - include_soft_deleted=True（DELETE/restore 路径）:
        不过滤 deleted_at；但 deleted_at 超 30d 窗口的 → ChartNotFound
    其他任何缺失（不存在 / 非 owner）统一 → ChartNotFound（防枚举）。
    """

async def update_label(db, user, chart_id, label: str | None) -> Chart:
    """UPDATE charts SET label=:label, updated_at=now()
       WHERE id AND user_id AND deleted_at IS NULL RETURNING ...;
       0 行 → ChartNotFound."""

async def soft_delete(db, user, chart_id) -> None:
    """先 get_chart(include_soft_deleted=True)：
       - 不存在 / 非 owner → ChartNotFound
       - deleted_at IS NOT NULL → ChartAlreadyDeleted
       UPDATE charts SET deleted_at = now() WHERE id AND user_id."""

async def restore(db, user, chart_id) -> Chart:
    """
    SELECT ... WHERE id AND user_id
              AND deleted_at IS NOT NULL
              AND deleted_at > now() - INTERVAL '30 days'
    - 0 行 → ChartNotFound
    post-check active count：若 >= MAX_CHARTS → ChartLimitExceeded
    UPDATE charts SET deleted_at = NULL, updated_at = now();
    return refreshed row."""

async def get_cache_slots(db, chart_id) -> list[CacheSlot]:
    """SELECT kind, key, model_used, regen_count, generated_at FROM chart_cache
       WHERE chart_id=:cid.
       Plan 4 这张表永远没有行 → 返回 []。
       Plan 5 LLM 路由写 cache 后此函数自然返回非空。"""
```

**DEK**：`current_user` dep 已经把用户 DEK 挂 contextvar；`EncryptedJSONB` / `EncryptedText` 字段在 ORM flush/load 时透明加解密，service 里不需要任何显式 DEK 操作。

**事务粒度**：每个写方法（create / update / delete / restore）一个 `async with db.begin()`；读方法（list / get / get_cache_slots）不显式起事务，依靠 `AsyncSession` 的隐式 autocommit。

### 3.3 `app/api/charts.py`

```python
router = APIRouter(
    prefix="/api/charts",
    tags=["charts"],
    dependencies=[Depends(current_user)],
)

@router.get("", response_model=ChartListResponse)
async def list_charts_endpoint(db=Depends(get_db), user=Depends(current_user)):
    rows = await chart_service.list_charts(db, user)
    return ChartListResponse(items=[
        ChartListItem(
            id=r.id, label=r.label,
            engine_version=r.engine_version,
            cache_stale=paipan_adapter.is_cache_stale(r.engine_version),
            created_at=r.created_at, updated_at=r.updated_at,
        ) for r in rows
    ])

# ... 类似薄 route 函数：post / get / patch / delete / restore
```

每个 route 函数 3–10 行：接收 dep 注入的 `db` / `user` → 调 service → 翻译 exception → 返回 schema。不写业务逻辑。

### 3.4 `app/api/public.py`

```python
router = APIRouter(tags=["public"])

@router.get("/api/config", response_model=ConfigResponse)
async def get_config():
    return ConfigResponse(
        require_invite=settings.require_invite,
        engine_version=paipan.VERSION,
        max_charts_per_user=MAX_CHARTS_PER_USER,
    )

@lru_cache(maxsize=1)
def _cities_payload() -> tuple[CitiesResponse, str]:
    items = sorted(paipan.cities.all_cities(), key=lambda t: t[0])
    resp = CitiesResponse(items=[CityItem(name=n, lng=lng, lat=lat) for n, lng, lat in items])
    etag = hashlib.sha1(f"{paipan.VERSION}:{len(items)}".encode()).hexdigest()[:16]
    return resp, etag

@router.get("/api/cities")
async def get_cities(request: Request):
    resp, etag = _cities_payload()
    if request.headers.get("if-none-match") == f'"{etag}"':
        return Response(status_code=304)
    return JSONResponse(
        content=resp.model_dump(),
        headers={"ETag": f'"{etag}"', "Cache-Control": "public, max-age=86400"},
    )
```

### 3.5 Exception → HTTP 映射

`app/services/exceptions.py` 已有 `ServiceError` 基类。Plan 4 新增：

```python
class InvalidBirthInput(ServiceError):
    status_code = 400
    code = "INVALID_BIRTH_INPUT"

class ChartNotFound(ServiceError):
    status_code = 404
    code = "CHART_NOT_FOUND"

class ChartLimitExceeded(ServiceError):
    status_code = 409
    code = "CHART_LIMIT_EXCEEDED"
    def __init__(self, limit: int = MAX_CHARTS_PER_USER):
        super().__init__(f"已达 {limit} 盘上限")
        self.details = {"limit": limit}

class ChartAlreadyDeleted(ServiceError):
    status_code = 409
    code = "CHART_ALREADY_DELETED"
```

FastAPI exception handler（已在 Plan 3 `app/main.py` 里装）自动把 `ServiceError` 翻成统一错误响应格式。

### 3.6 `paipan.cities.all_cities()` 新 helper

port 阶段没暴露全量 cities 数据。Plan 4 在 `paipan/paipan/cities.py` 末尾加：

```python
def all_cities() -> list[tuple[str, float, float]]:
    """返回 [(canonical_name, lng, lat), ...]，按 name 排序确保可复现。
    供 server `/api/cities` 路由使用；前端本地 typeahead。"""
    idx = _build_index()
    # exact map 的 key 就是 canonical name
    return sorted(
        [(name, lng, lat) for name, (lng, lat) in idx.exact.items()],
        key=lambda t: t[0],
    )
```

同步修改 `paipan/paipan/__init__.py` 加 `all_cities` 到 `__all__`。属于"在现有代码里做修工范围内的必要清理"。

---

## 4. 测试策略

沿用 Plan 2/3 的 `conftest.py` + `apply_migrations` fixture + `pytest-xdist` 并行。目标 ≥ 85% 源码覆盖，CI < 60s。

### 4.1 Unit（~8 条）

- `paipan_adapter.resolve_city`：命中 / 不命中 / None / 空串
- `paipan_adapter.run_paipan`：happy / `ValueError` → `InvalidBirthInput`
- `paipan_adapter.is_cache_stale`：同版本 False / 不同版本 True

### 4.2 Integration（~35 条）

**Public routes**
- `GET /api/config` 返回三个字段 + 正确值
- `GET /api/cities` 200 + `ETag` header + items 非空 + items 按 name 排序
- `GET /api/cities` 带 `If-None-Match` 命中 → 304 空体
- `GET /api/cities` 响应大小 sanity（< 500 KB uncompressed）

**POST /api/charts**
- happy：返 201、`ChartResponse`、`paipan` 字段非空、`warnings` 有 DST/未知城市场景
- 未登录 → 401
- 业务上 paipan 成功但 birth 合法（e.g. `minute` 缺省）
- 时辰未知 `hour=-1`
- `ziConvention='late'`
- 第 16 个盘 → 409 `CHART_LIMIT_EXCEEDED`
- label=null ok
- city 未识别 → 依然落盘，warnings 含"未识别城市"提示
- city 规范化回写（输入 "北京市" → DB 存 "北京"）
- 跨用户：A 的 session 建盘，B 看不到

**GET /api/charts**
- happy：列表按 created_at DESC
- 空列表
- 软删盘不出现
- 跨用户隔离

**GET /api/charts/:id**
- happy：`chart` + `cache_slots=[]` + `cache_stale=False` + `warnings=[]`
- `cache_stale=True`：手动 `UPDATE charts SET engine_version='0.0.0'` 后 GET 返 True
- 跨用户 → 404 `CHART_NOT_FOUND`
- 不存在 → 404
- 软删态 → 404（未过期也不给普通 GET 看）
- 软删超 30 天 → 404

**PATCH /api/charts/:id**
- happy 改 label
- label = null 清空
- label > 40 → 422
- 跨用户 → 404
- 软删盘 patch → 404

**DELETE /api/charts/:id**
- happy → 204
- 再删 → 409 `CHART_ALREADY_DELETED`
- 跨用户 → 404
- DELETE 后出现在 GET list：不出现
- DELETE 后 GET detail → 404

**POST /api/charts/:id/restore**
- happy：软删盘 restore 后 GET detail 200
- 非软删态（还未删） → 404
- 软删超 30 天 → 404
- 跨用户 → 404
- restore 后 active 超 15 → 409 `CHART_LIMIT_EXCEEDED`

**E2E**
- 注册 → POST chart → GET detail 对拍 paipan 字段 → DELETE → restore → 再 GET → 账户注销（crypto-shredding）→ 新建 User + 随机 DEK 读原 chart 的 birth_input → `InvalidTag`

### 4.3 覆盖率（预估，超过 85%）

| 模块 | 预估 stmts | 预估覆盖 |
|---|---|---|
| `app/api/charts.py` | ~70 | 90%（happy + 错误分支基本覆盖） |
| `app/api/public.py` | ~30 | 95% |
| `app/services/chart.py` | ~120 | 85%（罕见竞态分支欠覆盖可接受） |
| `app/services/paipan_adapter.py` | ~25 | 95% |
| `app/schemas/chart.py` | ~40 | 100%（Pydantic 校验由测试触发） |
| `app/schemas/config.py` | ~10 | 100% |

---

## 5. 验收闸（硬 Gate）

和 Plan 2/3 口径一致，追加 Plan 4 专属检查：

- [ ] `uv run --package server pytest server/tests/ -n auto` 全绿
- [ ] `pytest --cov=app --cov-config=/dev/null server/tests/` ≥ 85%
- [ ] 并行 CI wall time < 60s
- [ ] wheel 可装可跑：装到 isolated venv 后 `app.main:app` 启动打印**新增 9 条路由**（7 charts + 2 public）+ 原 10 条 auth/health
- [ ] Alembic 双向干净（Plan 4 不加 migration，仍跑 0001 + 0002）
- [ ] 任何 error path 的 response 不含 phone / 他人 user_id / 他人 chart_id
- [ ] `/api/cities` gzipped 体积 < 200 KB（sanity 压测，防数据膨胀）
- [ ] `/api/charts` CRUD 全部满足 owner 校验：跨用户 / 不存在 统一 404（不是 403）
- [ ] paipan 升级模拟：手动 UPDATE `charts.engine_version='0.0.0'` 后 GET `/api/charts/:id` 返 `cache_stale=true` 且 chart 数据未被动过
- [ ] E2E：注册 → POST chart → 软删 → restore → 注销 → `InvalidTag` 密文读取失败

---

## 6. 交接契约（给 Plan 5 用）

Plan 4 完成后，以下契约稳定，Plan 5 LLM 路由不得修改：

### 6.1 Response schema

- `ChartResponse.chart` 字段（id / label / birth_input / paipan / engine_version / created_at / updated_at）
- `ChartResponse.cache_slots: list[CacheSlot]`（Plan 5 填充非空数组）
- `ChartResponse.cache_stale: bool`
- `ChartListItem` 全字段

### 6.2 Service 函数

- `app.services.chart.get_chart(db, user, chart_id, include_soft_deleted=False) -> Chart`：owner 严格校验 + 软删窗口；Plan 5 所有 LLM 路由首件事调此函数拿 chart 上下文
- `app.services.paipan_adapter.is_cache_stale(engine_version) -> bool`：Plan 5 `POST /api/charts/:id/recompute` 会用
- `app.services.paipan_adapter.run_paipan(birth_input) -> (paipan, warnings, engine_version)`：Plan 5 recompute 会复用
- `app.services.chart.get_cache_slots(db, chart_id)`：Plan 5 写 cache 后天然返回非空

### 6.3 Exception 类

- `InvalidBirthInput` / `ChartNotFound` / `ChartLimitExceeded` / `ChartAlreadyDeleted`

### 6.4 常量

- `app.core.quotas.MAX_CHARTS_PER_USER = 15`

---

## 7. 非阻塞 TODO（显式留给后续）

1. `POST /api/charts/import`（localStorage 迁移）未实现 —— 单独短 plan 做。
2. 软删 30 天硬删 cron/worker 未实现 —— Plan 7 部署期加；Plan 4 仅打 `deleted_at` 时间戳。
3. `paipan.compute` 同步跑，不走 `run_in_executor` —— C 阶段压测证明瓶颈再改；service 代码里留 `# TODO(perf):` comment。
4. `/api/cities` 不做 i18n/多语言；海外城市以 paipan 内置为准。
5. `chart_cache` 表在 Plan 4 永远为空；`get_cache_slots` 返回 `[]` 是契约而非 bug。
6. POST `/api/charts` 未做 IP rate limit —— 15 盘上限天然是 ceiling，abuse 检测交给后续监控。
7. `POST /api/charts/:id/recompute`（engine_version 升级后主动重算 + 清 cache）—— Plan 5 和 LLM 路由一起加。

---

## 8. 参考文档

- `docs/superpowers/specs/2026-04-17-user-accounts-and-deployment-design.md` §2.2 / §3.2 / §3.5（旧 → 新路由映射）
- `docs/superpowers/specs/2026-04-17-backend-foundation-design.md`
- `docs/superpowers/specs/2026-04-17-auth-business-design.md`
- `server/ACCEPTANCE.md`（Plan 2 + 3 合并现状）
- `paipan/ACCEPTANCE.md`（paipan Python 端口验收）
- `paipan/paipan/compute.py` `compute()` signature
- `paipan/paipan/cities.py` `get_city_coords()` + `_build_index()`
