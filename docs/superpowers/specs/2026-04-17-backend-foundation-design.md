# Backend Foundation 设计文档

> **状态**：设计 · 待出实施计划
> **上游 spec**：`2026-04-17-user-accounts-and-deployment-design.md`（完整后端设计）
> **范围**：上游 spec §1-2 的基础设施子集；auth 业务 / charts / LLM 全部在后续 plan
> **撰写日期**：2026-04-17

---

## 0. 目标与范围

### 0.1 目标

把 `paipan/` Python 包（Plan 1 产出）之上，搭一层"信任根"HTTP 服务骨架：

- FastAPI 应用能跑、`/api/health` 可访问
- Postgres 16 + SQLAlchemy 2.0 + Alembic 一条 baseline migration 建齐 10 张表
- 应用层加密（AES-256-GCM 信封加密）完整实现，字段透明加解密
- `current_user` / `check_quota` 依赖签名就位（实现留给 Plan 3）

**做完这个 Plan，下一个 Plan（auth 业务）可以 drop-in 接入，不用动 infra。**

### 0.2 非目标（留给后续 plan）

- 短信 / 注册 / 登录 / 登出 / 注销（Plan 3）
- `/api/charts` CRUD、排盘接入（Plan 4）
- LLM / agent / SSE（Plan 5）
- 前端任何改动（Plan 6）
- Docker / Nginx / CI 部署（Plan 7）
- `archive/server-js/` 归档旧 Node server（Plan 7）
- KEK 轮换脚本（预留 `dek_key_version` 字段，真正 rekey 流程后续单独立项）

### 0.3 关键决定速览

| # | 决定 | 理由 |
|---|---|---|
| 1 | uv workspace 增加 `server/` member | 与 `paipan/` 同一 monorepo，pyproject 走 uv |
| 2 | FastAPI + Python 3.12 + pydantic-settings + structlog | 上游 spec 已定 |
| 3 | 测试 DB 用 testcontainers Postgres 16 | 与生产同构；JSONB/bytea/事务真实；CI 天然支持 |
| 4 | SQLAlchemy 2.0 async + asyncpg driver | async 原生；和 FastAPI async 对齐 |
| 5 | Alembic async 模式，baseline 手写 | Autogenerate 对 `EncryptedJSONB` 不稳，显式写一次清晰 |
| 6 | UUID 在 DB 端生成（`gen_random_uuid()`） | 不走 Python uuid4，减少跨语言差异 |
| 7 | DEK 上下文用 `contextvars` | async 天然支持；TypeDecorator 透明读 |
| 8 | `current_user` / `check_quota` Plan 2 返回 `NotImplementedError` | 让后续 plan drop-in 替换，业务代码不改 import |
| 9 | 非白名单 key 进日志立即丢弃 | 防 PII 泄露于源头 |
| 10 | `docs_url` 仅 dev 开启 | 生产隐藏 OpenAPI |

---

## 1. 仓库结构（Plan 2 产出）

```
bazi-analysis/
├── pyproject.toml                     # 现有 uv workspace 根，add "server" to members
├── paipan/                            # Plan 1 产出，不动
├── server/                            # ← 本 plan 产出
│   ├── pyproject.toml
│   ├── README.md
│   ├── .env.example                   # 哨兵值 + 占位
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py                     # async 模式
│   │   └── versions/
│   │       └── 0001_baseline.py       # 手写，建全部 10 张表
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI + lifespan + /api/health
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py              # pydantic-settings
│   │   │   ├── logging.py             # structlog + PII scrub
│   │   │   ├── db.py                  # AsyncEngine + get_db 依赖
│   │   │   └── crypto.py              # KEK / DEK / AES-GCM
│   │   ├── models/
│   │   │   ├── __init__.py            # Base + import all models
│   │   │   ├── user.py                # User, InviteCode, Session, SmsCode
│   │   │   ├── chart.py               # Chart, ChartCache
│   │   │   ├── conversation.py        # Conversation, Message
│   │   │   └── quota.py               # QuotaUsage, LlmUsageLog
│   │   ├── db_types/
│   │   │   ├── __init__.py            # user_dek_context + EncryptedText/JSON
│   │   │   ├── encrypted_text.py
│   │   │   └── encrypted_json.py
│   │   └── auth/
│   │       ├── __init__.py
│   │       └── deps.py                # current_user / check_quota 骨架
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py                # testcontainers + KEK/DEK fixtures
│       ├── unit/
│       │   ├── __init__.py
│       │   ├── test_crypto.py
│       │   ├── test_config.py
│       │   ├── test_logging.py
│       │   ├── test_encrypted_text.py
│       │   ├── test_encrypted_json.py
│       │   └── test_auth_deps.py
│       └── integration/
│           ├── __init__.py
│           ├── test_health.py
│           ├── test_lifespan.py
│           ├── test_migrations.py
│           └── test_models.py
```

---

## 2. 数据模型 / DB Schema

**10 张表**，字段定义直接引用上游 spec §2。本文档只标注与 Plan 2 相关的实现细节。

### 2.1 表清单

| 组 | 表 | 加密字段 | 关键索引 | FK 行为 |
|---|---|---|---|---|
| 账号 | `users` | `dek_ciphertext`(bytea, KEK-加密) | — | `invited_by_user_id` RESTRICT; `used_invite_code_id` RESTRICT |
| 账号 | `invite_codes` | — | UNIQUE(`code`) | `created_by` RESTRICT |
| 账号 | `sessions` | — | UNIQUE(`token_hash`) | `user_id` CASCADE |
| 账号 | `sms_codes` | — | `(phone, created_at DESC)` | — |
| 命盘 | `charts` | `label`, `birth_input`, `paipan` | `(user_id, created_at DESC) WHERE deleted_at IS NULL` | `user_id` RESTRICT |
| 命盘 | `chart_cache` | `content` | UNIQUE(`chart_id, kind, key`) | `chart_id` CASCADE |
| 对话 | `conversations` | `label` | `(chart_id, deleted_at)` | `chart_id` RESTRICT |
| 对话 | `messages` | `content`, `meta` | `(conversation_id, created_at ASC)` | `conversation_id` CASCADE |
| 配额 | `quota_usage` | — | UNIQUE(`user_id, period, kind`) | `user_id` RESTRICT |
| 审计 | `llm_usage_logs` | — | `(user_id, created_at DESC)` | `user_id` SET NULL; `chart_id` SET NULL |

### 2.2 实现要点

- **UUID 主键**：`server_default=text("gen_random_uuid()")`，依赖 Postgres 16 内建函数
- **时间戳**：`timestamptz`，`server_default=text("now()")`
- **软删字段**（`charts.deleted_at`, `conversations.deleted_at`）：nullable timestamptz，业务层写入
- **CHECK 约束**：照 spec 字面（如 `status IN ('active','disabled')`），通过 `sa.CheckConstraint`
- **加密字段类型**：SQL 层 `LargeBinary`（bytea），Python 层 `EncryptedText` / `EncryptedJSONB`
- **Base 类**：`DeclarativeBase` 子类，带 `metadata = MetaData(naming_convention={...})` 保证约束名可预测

### 2.3 Baseline migration 策略

- 一条手写 `0001_baseline.py`，不用 autogenerate
- `upgrade()` 按依赖顺序建表（`users` → `invite_codes` → `sessions` → `sms_codes` → `charts` → `chart_cache` → `conversations` → `messages` → `quota_usage` → `llm_usage_logs`）
- `downgrade()` 反向 DROP（CASCADE 让级联关系自然拆除）
- 显式创建所有索引（不依赖 model definition 的 `index=True`）

### 2.4 Migration 测试

`tests/integration/test_migrations.py`：

1. `upgrade head` → 查 `information_schema.tables`，断言 10 张表 + `alembic_version` 存在
2. 查 `pg_indexes`，断言 spec 列出的索引全部就位
3. 查 `information_schema.check_constraints`，断言 CHECK 到位
4. `downgrade base` → 只剩 `alembic_version`（14 张表能清掉 13 张）

---

## 3. 加密层（信任根）

### 3.1 三层结构

```
KEK (32 bytes)                        app/core/crypto.py 启动时加载
  ↓ AES-256-GCM（nonce 12B）
DEK (32 bytes, per user)              存 users.dek_ciphertext
  ↓ AES-256-GCM（nonce 12B）
字段密文 (bytes)                      charts.birth_input / messages.content / 等
```

**密文格式**：`nonce(12B) || ciphertext_with_tag`，bytea 存储。

### 3.2 `app/core/crypto.py` 对外 API

```python
def load_kek() -> bytes:
    """从 settings.encryption_kek 读 64 hex → 32 字节；哨兵值 → RuntimeError。"""

def generate_dek() -> bytes:
    """os.urandom(32)。"""

def encrypt_dek(dek: bytes, kek: bytes) -> bytes:
    """AES-GCM(kek) → dek_ciphertext。"""

def decrypt_dek(ct: bytes, kek: bytes) -> bytes:
    """逆向；篡改密文 → InvalidTag。"""

def encrypt_field(plaintext: bytes, dek: bytes) -> bytes:
    """nonce 每次 os.urandom(12)；返回 nonce || ct。"""

def decrypt_field(ct: bytes, dek: bytes) -> bytes:
    """验证 tag，篡改 → InvalidTag。"""
```

**常量**：`NONCE_SIZE = 12`，`KEY_SIZE = 32`。

**哨兵值检测**：`ENCRYPTION_KEK == "__CHANGE_ME_64_HEX__"` → `load_kek()` 抛 `RuntimeError("sentinel KEK detected — set a real key")`，app 启动失败。

### 3.3 DEK 上下文（contextvars）

```python
# app/db_types/__init__.py
_current_dek: ContextVar[bytes | None] = ContextVar("user_dek", default=None)

@contextmanager
def user_dek_context(dek: bytes):
    token = _current_dek.set(dek)
    try:
        yield
    finally:
        _current_dek.reset(token)
```

**接入时机**：Plan 3 的 `current_user` 依赖解密 DEK 后调 `_current_dek.set(dek)`，请求结束 FastAPI 自动把 contextvar 释放。

**Plan 2 的 TypeDecorator 测试**：`with user_dek_context(test_dek):` 包住 ORM 操作即可。

### 3.4 `EncryptedText` / `EncryptedJSONB` TypeDecorator

```python
class EncryptedText(TypeDecorator):
    impl = LargeBinary
    cache_ok = True
    def process_bind_param(self, value, dialect):
        if value is None: return None
        dek = _current_dek.get()
        if dek is None:
            raise RuntimeError("no DEK in context — wrap code in user_dek_context()")
        return encrypt_field(value.encode("utf-8"), dek)
    def process_result_value(self, value, dialect):
        if value is None: return None
        dek = _current_dek.get()
        if dek is None:
            raise RuntimeError(...)
        return decrypt_field(value, dek).decode("utf-8")
```

`EncryptedJSONB` 同理，但 `json.dumps(value).encode()` → encrypt，decrypt → `json.loads(plaintext.decode())`。

**NULL 直通**：`None → None`，不进加密路径。

### 3.5 加密测试矩阵

**`tests/unit/test_crypto.py`**（纯函数）：

| 测试 | 检查 |
|---|---|
| `test_field_roundtrip_utf8` | 20 种 payload（empty, 1B, 1MiB, 中文, emoji）往返保真 |
| `test_dek_roundtrip` | KEK ↔ DEK 加解密保真 |
| `test_nonce_uniqueness` | 同 plaintext 加密 1000 次 nonce 不重复 |
| `test_tamper_ciphertext_raises` | 密文任意 1 bit flip → InvalidTag |
| `test_tamper_nonce_raises` | nonce 前 12 字节篡改 → InvalidTag |
| `test_wrong_key_raises` | DEK-A 加密、DEK-B 解密 → InvalidTag |
| `test_sentinel_kek_raises_runtime_error` | `load_kek()` 遇哨兵值抛 |
| `test_invalid_hex_kek_raises` | 非 64-hex env 值 → ValueError |

**`tests/unit/test_encrypted_text.py`** / `test_encrypted_json.py`（接 Postgres）：

| 测试 | 检查 |
|---|---|
| `test_insert_select_roundtrip` | `dek_context` 下 INSERT + SELECT 明文保真 |
| `test_bytea_in_db_is_ciphertext` | 绕过 ORM 查 raw bytea → 不等于明文 |
| `test_missing_dek_context_raises` | 未进 context → INSERT 抛 RuntimeError |
| `test_cross_dek_read_raises_invalid_tag` | A 写 / B 读 → InvalidTag |
| `test_null_value_roundtrip` | NULL 不触发加密 |
| `test_encrypted_json_nested_dict` | 嵌套 dict / list / None 往返保真 |

**`tests/integration/test_crypto_shredding.py`**：

1. 在 `dek_context(dek_A)` 下 INSERT 一行
2. 读原始 bytea 保存
3. "删除 DEK"：忘掉 `dek_A`（crypto-shredding 语义）
4. 用 `dek_B = generate_dek()` 尝试解密 → InvalidTag
5. 用原 `dek_A` 解密 → 成功（证明 shredding 等价于"丢 DEK"）

---

## 4. FastAPI 骨架

### 4.1 `app/main.py`

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)
    app.state.kek = load_kek()          # 哨兵 → RuntimeError, app 不启动
    yield
    await dispose_engine()

app = FastAPI(
    title="bazi-analysis backend",
    version=settings.version,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env == "dev" else None,
    redoc_url=None,
)

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.version, "env": settings.env}
```

Plan 2 只有 `/api/health` 一条路由，目的是证明"startup + lifespan + shutdown"链路通。

### 4.2 `app/core/config.py`

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["dev", "prod", "test"] = "dev"
    version: str = "0.1.0"
    log_level: str = "INFO"

    database_url: PostgresDsn                     # postgresql+asyncpg://...
    encryption_kek: str                           # 64 hex chars

    # Plan 3+ 预留
    aliyun_sms_access_key: str | None = None
    aliyun_sms_secret: str | None = None
    aliyun_sms_template: str | None = None

settings = Settings()
```

### 4.3 `app/core/logging.py`

```python
_LOG_WHITELIST = {
    "event", "level", "timestamp", "request_id",
    "user_id", "chart_id", "conversation_id",
    "endpoint", "method", "status", "duration_ms",
    "model", "tokens_used", "error_code",
}

def _pii_scrub_processor(logger, method_name, event_dict):
    return {k: v for k, v in event_dict.items() if k in _LOG_WHITELIST}

def setup_logging(level: str = "INFO"):
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _pii_scrub_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level)
        ),
    )
```

Plan 2 只做白名单过滤。Plan 3+ 加入 `request_id` 中间件、Sentry 接入、access log 格式化。

### 4.4 `app/core/db.py`

```python
_engine = create_async_engine(
    str(settings.database_url),
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)
_session_maker = async_sessionmaker(_engine, expire_on_commit=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

async def dispose_engine():
    await _engine.dispose()
```

**commit-on-success** 依赖：请求正常返回就 commit，异常 rollback。

### 4.5 `app/auth/deps.py`（骨架）

```python
async def current_user(request: Request, db=Depends(get_db)) -> User:
    """必须登录 — Plan 3 实现。"""
    raise NotImplementedError("auth is implemented in Plan 3")

async def optional_user(request: Request, db=Depends(get_db)) -> User | None:
    raise NotImplementedError("auth is implemented in Plan 3")

async def require_admin(user=Depends(current_user)) -> User:
    raise NotImplementedError("auth is implemented in Plan 3")

def check_quota(kind: str):
    async def _dep(user=Depends(current_user), db=Depends(get_db)):
        raise NotImplementedError("quota is implemented in Plan 3")
    return _dep
```

**约束**：Plan 2 不允许实现这些函数。单测用 `assert raises NotImplementedError` 钉住。Plan 3 删除 `raise` 即落地。

---

## 5. 测试策略

### 5.1 Testcontainers 基座

**Import ordering contract**：`app.core.config.settings = Settings()` 在模块导入时就实例化，会校验 env。`tests/conftest.py` **必须在 `from app ...` 之前**设置 test env：

```python
# conftest.py 最顶部（任何 app 导入之前）
import os
os.environ.setdefault("ENV", "test")
os.environ.setdefault("ENCRYPTION_KEK", "00" * 32)       # 64 hex, 全零测试 key
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://placeholder")
# 真实 database_url 由 postgres_container fixture 动态覆盖
```

然后才能 `from app.main import app`。`database_url` 的占位会在 fixture 起来后 monkeypatch 掉。

**Fixtures**：

```python
@pytest.fixture(scope="session")
def postgres_container():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg

@pytest.fixture(scope="session")
def database_url(postgres_container):
    return postgres_container.get_connection_url().replace(
        "postgresql://", "postgresql+asyncpg://"
    )

@pytest.fixture(scope="session", autouse=True)
def apply_migrations(database_url):
    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", str(database_url))
    command.upgrade(alembic_cfg, "head")

@pytest.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    async with engine.connect() as conn:
        trans = await conn.begin()
        session_maker = async_sessionmaker(bind=conn, expire_on_commit=False)
        async with session_maker() as session:
            yield session
        await trans.rollback()

@pytest.fixture
def test_kek() -> bytes:
    return os.urandom(32)

@pytest.fixture
def test_dek(test_kek) -> bytes:
    return generate_dek()

@pytest.fixture
def dek_context(test_dek):
    with user_dek_context(test_dek):
        yield test_dek

@pytest.fixture
async def async_client():
    from httpx import AsyncClient, ASGITransport
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        yield client
```

**设计性质**：
- Session 级共享 Postgres 容器 + 一次 migration
- 每测试用嵌套事务 rollback 隔离（不 truncate）
- `dek_context` fixture 让加密测试直接 `db_session.add(chart)` 就生效

### 5.2 覆盖率目标

| 模块 | 目标 | 核心测试 |
|---|---|---|
| `core/crypto.py` | 100% | 8 个测试 |
| `core/config.py` | 90%+ | 3 个（env 缺失 / 哨兵 / 合法） |
| `core/logging.py` | 85%+ | whitelist / scrub |
| `core/db.py` | 80%+ | get_db commit / rollback |
| `db_types/*` | 95%+ | 见 §3.5 |
| `models/*` | 80%+ | INSERT/SELECT/FK/CHECK |
| `auth/deps.py` | 100% | 每个依赖抛 NotImplementedError |
| `main.py` | 85%+ | health / lifespan / bad KEK |

**总目标**：≥ 85%。

### 5.3 CI

`.github/workflows/server-ci.yml` 在 Phase E 写：

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      # 无需显式 postgres service — testcontainers 自起
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv python install 3.12
      - run: uv sync --package server --extra dev
      - run: uv run --package server pytest server/tests/ -n auto
```

运行时 target **< 30s**，和 Plan 1 对齐。

---

## 6. 任务分解（预览）

Phase 切分，详细 step 会在 writing-plans 阶段细化。

| Phase | Tasks | 内容 |
|---|---|---|
| A | 3 | uv workspace 扩展 · FastAPI 骨架 · testcontainers 基座 |
| B | 4 | `core/db.py` · 10 个 ORM model · Alembic init · baseline migration |
| C | 4 | `crypto.py` · DEK contextvars · `EncryptedText` · `EncryptedJSONB` |
| D | 2 | `auth/deps.py` 骨架 · crypto-shredding 集成测试 |
| E | 2 | wheel 构建验证 · `ACCEPTANCE.md` + CI |
| **合计** | **15** | |

---

## 7. 验收硬门槛

- [ ] `uv run --package server pytest server/tests/ -n auto` 全绿，< 30s
- [ ] 源码覆盖率 ≥ 85%
- [ ] `uv build --package server` 出 wheel，隔离 venv 里 `python -c "from app.main import app; print(app.title)"` 成功
- [ ] `alembic upgrade head && alembic downgrade base` 双向干净
- [ ] Crypto-shredding 集成测试通过（DEK 丢失后密文永久不可解）
- [ ] `auth/deps.py` 所有公开函数都是 `raise NotImplementedError`（`grep -c NotImplementedError` 确认）
- [ ] CI workflow 在 GitHub Actions 跑通（Postgres testcontainers）
- [ ] 无业务路由（除 `/api/health`），grep 确认 `app/api/` 不存在

---

## 8. 与其他 Plan 的衔接

**上游**：依赖 Plan 1 产出的 `paipan/` 包（本 Plan 不调用，但 uv workspace 要一起管理）。

**下游**：
- Plan 3（Auth）：实现 `current_user` / `check_quota` / SMS / 注册 / 登录 / 注销
- Plan 4（Charts CRUD + paipan 接入）
- Plan 5（LLM / SSE / agent / 缓存 / 配额扣减）
- Plan 6（前端 auth + localStorage 迁移）
- Plan 7（Docker / Nginx / 部署 / 归档 Node server）

本 Plan 的合同：
- 加密 TypeDecorator 对调用方透明
- `auth/deps.py` 签名稳定，Plan 3 只改实现
- DB schema 全量就位，后续 plan 仅 Alembic 追加 migration

---

## 9. 风险与应对

| 风险 | 应对 |
|---|---|
| testcontainers 在 CI 启动慢 | 用 `postgres:16-alpine`；session 级复用；pytest-xdist 并发执行 |
| `settings = Settings()` 在模块导入时校验 env 导致测试无法 collect | conftest.py 最顶部设 test env（见 §5.1 Import ordering contract） |
| 模块级 `_engine` 单例让测试难以用 testcontainers 的动态 URL | `db.py` 暴露 `create_engine_from_settings()` 工厂函数；测试 fixture 用自己的 URL 建 engine，不依赖模块单例 |
| `contextvars` 在 async 任务切换时丢上下文 | uvicorn + FastAPI 天然支持；测试验证 `asyncio.gather` 下正确 |
| `EncryptedJSONB` 往返慢（大文档） | `chart.paipan` 估计 2-5 KB，单次加解密 < 1ms；可接受 |
| Alembic 手写 baseline 漏字段 | `test_migrations.py` 对照 `models.__table__.columns` 断言完整性 |
| 哨兵 KEK 漏检测进生产 | CI 里跑一个 `test_config.py` 测试生产环境 env 不可是哨兵；部署脚本启动前再校验一次 |

---

## 10. 实施约束

- 不引入任何新依赖（除本 spec 明确列出的）
- 不添加业务路由（`/api/health` 唯一例外）
- 不写任何 auth/charts/LLM/quota 业务代码
- 不动 `paipan/` 包
- 每 task 必须 commit 且 `uv run pytest` 绿
- `# NOTE:` 注释标注关键 magic number 来源（遵循 Plan 1 纪律）
