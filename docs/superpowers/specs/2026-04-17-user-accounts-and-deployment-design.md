# 用户账号 + 部署 + 多人访问 设计文档

> **状态**：设计 · 待出实施计划
> **阶段规划**：B（邀请制内测）→ C（公开产品）
> **撰写日期**：2026-04-17

---

## 0. 产品与范围

### 0.1 目标

将现有 MVP（React + 裸 Node + localStorage）升级为支持**账号、持久化、多人访问、国内部署**的正式产品：

- **B 阶段**：邀请制内测，< 100 人，面向国内用户，个人主体
- **C 阶段**：公开产品，游客可试用，后续接付费订阅
- B → C 不重构，公共基础设施 day 1 就按 C 的要求搭

### 0.2 关键决定速览

| # | 决定 |
|---|---|
| 1 | 国内部署 + ICP 备案（个人主体） |
| 2 | B 邀请制强登录 → C 游客可试用；一套代码两种开关 |
| 3 | 手机号 + 短信验证码（B 阶段）；微信登录延后至 C 阶段（需企业资质） |
| 4 | 邀请码：用户输入码 + 手机号注册（a 方案） |
| 5 | 配额 + 服务端 LLM 缓存；首次生成免费、重生成扣；15 命盘/人、30 对话/天 |
| 6 | 付费 C 阶段做，schema 今天预留 `plan` 字段 |
| 7 | 后端重写：FastAPI + Python 3.12 + uv |
| 8 | ORM：SQLAlchemy 2.0 + Alembic；DB model 与 API schema 分离（独立 Pydantic） |
| 9 | 排盘：port 到 Python（`lunar-python`），Node 版作为 oracle 做回归对拍 |
| 10 | 前端：React 19 + Vite 保留；全量 TS；TanStack Query；OpenAPI 类型自动生成 |
| 11 | 部署：阿里云 ECS 单机 + docker-compose + 宿主 Nginx + Let's Encrypt |
| 12 | 敏感字段应用层加密：KEK + per-user DEK + AES-256-GCM；crypto-shredding |

### 0.3 非目标

- 不做移动端原生或小程序（个人主体 + 规模不值当）
- 不做微服务 / K8s（单机 docker-compose 起步）
- 不做 staging 环境（B 阶段 local + production 两环境够）
- 不做 CDN / 多地部署（国内单机即可）
- 不趁重写扩功能：神煞、纳音、六亲这些都是 port 完后再立项

---

## 1. 总体架构

```
浏览器（React 19 + TS + Vite）
  LoginScreen | FormScreen | Shell
  状态：Zustand（UI 局部） + TanStack Query（服务端状态缓存）
  持久化：cookie（session） + localStorage（游客草稿）
          │  HTTPS
          │  • JSON POST for mutations
          │  • fetch + ReadableStream for SSE（cookie 自动带）
          ▼
Nginx（反代 + 静态，宿主 systemd）
  /        → frontend/dist
  /api/*   → 127.0.0.1:8000
          │
          ▼
FastAPI 应用（server/app）
  api/      auth / chart / sections / verdicts / dayun / liunian / chat / gua / chips / invite / quota
  agents/   chat_agent / verdicts_agent / sections_agent / ...
  services/ auth / quota / llm / retrieval / cache / paipan_service
  sse/      AgentEvent 联合类型 + adapter
  core/     config / logging / db / crypto
          │
          ├──▶ Postgres 16（docker 内部）：users / sessions / invite_codes / sms_codes /
          │                                 charts / chart_cache / conversations / messages /
          │                                 quota_usage / llm_usage_logs
          ├──▶ MiMo API（OpenAI 兼容）
          └──▶ 阿里云短信
```

**关键说明**：

1. **单机部署**：ECS 一台，Postgres/uvicorn/Nginx 同机；B 阶段不需要分布式；Postgres 未来外置到 RDS 只是改 connection string。
2. **ReadableStream SSE**：沿用现有 `lib/api.js` 的 `fetch + reader` 模式（而非 `EventSource`），因为要带 cookie 鉴权 + 承载复杂事件协议。FastAPI 侧用 `sse-starlette` 的 `EventSourceResponse`。
3. **Agent 层解耦**：`app/agents/` 独立模块，HTTP 层只做传输；今天的"单次 LLM 流式"是 agent 的退化实现；未来多步/工具调用/反思都在 agent 内部进化，不动 HTTP 层。
4. **缓存一等公民**：所有长文 LLM 输出（七板块、总论、大运、流年）入 `chart_cache`，重复访问回放不消耗。
5. **配额收敛在 middleware**：所有扣配额路由走 `Depends(check_quota(kind))`，业务代码不散落扣费逻辑。

### 仓库结构

```
bazi-analysis/
├── frontend/               # React 19 + Vite + TS，渐进迁移
├── server/                 # FastAPI 应用
│   ├── app/
│   │   ├── main.py
│   │   ├── api/            # 路由分组
│   │   ├── auth/           # 鉴权 / session / invite
│   │   ├── models/         # SQLAlchemy ORM models
│   │   ├── schemas/        # Pydantic API schemas
│   │   ├── services/       # 业务逻辑
│   │   ├── agents/         # agent 编排层
│   │   ├── sse/            # SSE 协议 + adapter
│   │   ├── jobs/           # 预留：长任务队列
│   │   └── core/           # config / logging / db / crypto
│   ├── alembic/            # migrations
│   ├── tests/
│   └── pyproject.toml
├── paipan/                 # 独立 Python 包（排盘）
│   ├── paipan/
│   │   ├── compute.py / solar_time.py / china_dst.py / zi_hour.py
│   │   ├── ganzhi.py / shi_shen.py / cang_gan.py
│   │   ├── force.py / ge_ju.py / dayun.py / ui.py
│   │   ├── cities.py / types.py / constants.py
│   ├── tests/unit/
│   ├── tests/regression/fixtures/   # 300+ oracle JSON
│   └── pyproject.toml
├── classics/               # 古籍原文（保留）
├── shards/                 # 提示词片段（保留）
├── data/                   # 古籍切片
├── scripts/                # 数据预处理
├── deploy/                 # docker-compose / Dockerfile / nginx.conf / ship.sh
├── docs/
├── archive/                # 旧 server.js + 旧 paipan-engine（oracle 参考保留半年）
└── .env.example
```

**包管理器**：Python 用 **uv**（uv workspace，`paipan/` 和 `server/` 为 members）；前端用 npm。

---

## 2. 数据模型 / DB Schema

按关注点分 5 组。字段用 SQLAlchemy 风格描述，实际 migration 由 Alembic 生成。

### 2.1 账号与访问

**`users`**
```
id                    uuid  PK
phone                 varchar(20)  UNIQUE  NOT NULL
phone_hash            bytea  NULL  UNIQUE       -- C 阶段前启用（B 阶段占位）
phone_last4           varchar(4)                -- UI 显示"138****0012"
nickname              varchar(40)  NULL
status                varchar(16)  CHECK IN ('active','disabled')  DEFAULT 'active'
role                  varchar(16)  CHECK IN ('user','admin')       DEFAULT 'user'
plan                  varchar(16)  CHECK IN ('free','pro')         DEFAULT 'free'
plan_expires_at       timestamptz  NULL
invited_by_user_id    uuid  FK users.id  NULL
used_invite_code_id   uuid  FK invite_codes.id  NULL
wechat_openid         varchar(64)  NULL  UNIQUE    -- C 阶段填
wechat_unionid        varchar(64)  NULL  UNIQUE    -- C 阶段填
dek_ciphertext        bytea  NOT NULL              -- KEK 加密后的 per-user DEK
dek_key_version       smallint  DEFAULT 1          -- KEK 轮换用
created_at / updated_at  timestamptz
```

**`invite_codes`**
```
id             uuid  PK
code           varchar(16)  UNIQUE  NOT NULL      -- 如 'BAZI-K9X7Q4'
created_by     uuid  FK users.id  NOT NULL
max_uses       int   DEFAULT 1
used_count     int   DEFAULT 0
expires_at     timestamptz  NULL
disabled       bool  DEFAULT false
note           text  NULL
created_at     timestamptz
```
B → C 全局开关：env `REQUIRE_INVITE=false`，不校验邀请码。

**`sessions`**
```
id             uuid  PK
token_hash     varchar(64)  UNIQUE  NOT NULL   -- sha256(raw_token)；cookie 里是 raw
user_id        uuid  FK users.id  NOT NULL
user_agent     text  NULL
ip             inet  NULL
created_at     timestamptz
last_seen_at   timestamptz
expires_at     timestamptz                      -- 30 天 rolling 续期
```

**`sms_codes`**
```
id           uuid  PK
phone        varchar(20)  NOT NULL
code_hash    varchar(64)  NOT NULL              -- sha256(code)
purpose      varchar(16)  CHECK IN ('register','login','bind')
expires_at   timestamptz                         -- 默认 5 分钟
used_at      timestamptz  NULL
attempts     int  DEFAULT 0                      -- 错 5 次作废
ip           inet  NULL
created_at   timestamptz
```
SMS rate limit 查同表：`phone + created_at > now()-60s` 存在 → 拒；`phone + created_at > now()-1h` count ≥ 5 → 拒。

### 2.2 命盘与缓存

**`charts`**
```
id              uuid  PK
user_id         uuid  FK users.id  NOT NULL
label           text                              -- EncryptedText
birth_input     bytea  NOT NULL                   -- EncryptedJSONB
paipan          bytea  NOT NULL                   -- EncryptedJSONB
engine_version  varchar(16)  NOT NULL             -- '1.0.0'
created_at / updated_at  timestamptz
deleted_at      timestamptz  NULL                 -- 软删 30 天
```
索引：`(user_id, created_at DESC) WHERE deleted_at IS NULL`。每用户 15 张命盘上限在 service 层检查。

**`chart_cache`**
```
id             uuid  PK
chart_id       uuid  FK charts.id  NOT NULL
kind           varchar(16)  CHECK IN ('verdicts','section','dayun_step','liunian')
key            varchar(40)                        -- verdicts:''; section:'career'/...; dayun_step:'3'; liunian:'3:7'
content        bytea                              -- EncryptedText
model_used     varchar(32)                         -- 'mimo-v2-pro' / '-flash' / 'cached' / 'imported'
tokens_used    int
generated_at   timestamptz
regen_count    int  DEFAULT 0
UNIQUE (chart_id, kind, key)
```

### 2.3 对话

**`conversations`**
```
id           uuid  PK
chart_id     uuid  FK charts.id  NOT NULL
label        bytea                                 -- EncryptedText
position     int  DEFAULT 0
created_at / updated_at
deleted_at   timestamptz  NULL
```

**`messages`**
```
id              uuid  PK
conversation_id uuid  FK conversations.id  NOT NULL
role            varchar(16)  CHECK IN ('user','assistant','gua','cta')
content         bytea                              -- EncryptedText
meta            bytea  NULL                        -- EncryptedJSONB
created_at      timestamptz
```
索引：`(conversation_id, created_at ASC)`。对话删除级联硬删 messages（价值低不保留）。

### 2.4 配额与审计

**`quota_usage`**
```
id            uuid  PK
user_id       uuid  FK users.id
period        varchar(10)                          -- 'YYYY-MM-DD'（北京时间）
kind          varchar(24)  CHECK IN (
              'chat_message','section_regen','verdicts_regen',
              'dayun_regen','liunian_regen','gua','sms_send')
count         int  DEFAULT 0
updated_at    timestamptz
UNIQUE (user_id, period, kind)
```

配额常量（`core/quotas.py`）：
```python
QUOTAS = {
  'free': {
    'chat_message': 30, 'section_regen': 5, 'verdicts_regen': 3,
    'dayun_regen': 10, 'liunian_regen': 10, 'gua': 20,
  },
  'pro': { ... }   # 预留
}
```

**`llm_usage_logs`**（审计 + 成本核算）
```
id                 uuid  PK
user_id            uuid  FK users.id  NULL
chart_id           uuid  FK charts.id  NULL
endpoint           varchar(32)                      -- 'sections' / 'verdicts' / 'chat' / ...
model              varchar(32)
prompt_tokens      int
completion_tokens  int
duration_ms        int
intent             varchar(24)  NULL
error              text  NULL
created_at         timestamptz
```
异步 insert（fire-and-forget，失败不影响主流）；**不记 prompt / completion 内容**。

### 2.5 杂项

- **提示词片段** `shards/*.md`、**古籍切片** `data/`：走文件系统，启动时 load 到内存。
- **软删策略**：`charts`/`conversations` 软删 30 天；其他（messages/quota/sms/sessions）硬删；封号用 `users.status='disabled'`，不删数据。

### 2.6 敏感数据保护（加密）

#### 威胁模型

| 风险 | 防御 |
|---|---|
| DB 拖库 / 备份泄露 | 敏感字段应用层 AES-256-GCM 加密 |
| DBA / 运维访问 | 同上，DB 连接也读不到明文 |
| 日志夹带 PII | 日志白名单 + scrub middleware + 单元测试断言 |
| 开发环境拿到真实数据 | 生产 env 不离生产机；dev 用假数据 |
| 用户行使 PIPL 删除权 | **Crypto-shredding**：删 DEK 即所有密文失效 |

#### 信封加密（envelope encryption）

```
主密钥 KEK（32 字节）
  存储：生产 env（chmod 600），未来升级到阿里云 KMS
  永远不落盘，进程启动时加载
        │
        ▼  加解密
每用户 DEK（32 字节，注册时生成）
  存储：users.dek_ciphertext（KEK 加密后的密文）
  用途：加解密该用户所有敏感字段
```

**算法**：AES-256-GCM（有认证，防篡改）；nonce 每次随机 12 字节前置。
**实现**：`cryptography` 库 `AESGCM`；SQLAlchemy 自定义 `EncryptedJSONB` / `EncryptedText` TypeDecorator 透明解密/加密。
**请求生命周期**：鉴权中间件解密 DEK → 挂 `request.state.user_dek` → ORM 读写自动使用 → 请求结束 GC。

#### 加密字段清单

| 表 | 字段 | 理由 |
|---|---|---|
| `charts` | `birth_input` | 最敏感——年月日时分 + 城市 + 性别 |
| `charts` | `paipan` | 衍生但可反推出生时间 |
| `charts` | `label` | 常含真实姓名 |
| `chart_cache` | `content` | LLM 对个人的解读 |
| `conversations` | `label` | 同上 |
| `messages` | `content` | 对话含真实事件/关系 |
| `messages` | `meta` | 可能含检索引用 + 个人片段 |

**不加密**：id、FK、时间戳、kind/role/model_used/tokens_used、quota_usage 全表、llm_usage_logs 元数据。

**phone 字段策略**：B 阶段明文（登录要精确匹配）；C 阶段前务必切 `phone_hash`（sha256+salt 唯一索引）+ `phone_ciphertext`（KEK 直接加密，不经 DEK，因注册时还没 user）。cutover 写成 migration 脚本。

#### Crypto-Shredding（注销）

用户"注销账号"：硬删 `users.dek_ciphertext` → 该用户所有密文字段**密码学上不可恢复**（备份里的副本也失效，前提是备份不同时保存 KEK+DEK）。符合 PIPL 第 47 条"删除个人信息"最强意义。

#### 日志防泄露

1. 白名单：只记 `user_id` / `chart_id` / endpoint / 耗时 / token 数
2. 静态扫描 + 运行时 scrub middleware 拦截敏感字段
3. `llm_usage_logs` 不记 prompt/completion 内容
4. 未来 Sentry `before_send` 剥离敏感字段
5. 生产前端 build 去除 `console.log`

#### 备份加密

- `pg_dump | gpg --cipher-algo AES256 -c` → 上传阿里云 OSS
- OSS bucket 启用版本控制 + MFA 删除保护
- 备份密码不放服务器，写本地密码管理器
- 季度恢复演练

#### 合规（PIPL）

- `/privacy` 页明示：收集项、用途、保存期限、第三方（MiMo/阿里云短信）、删除权
- 注册流程勾选同意《用户协议》《隐私政策》
- 设置页"注销账号"按钮 → crypto-shredding
- "导出我的数据"：C 阶段做，schema 已支持

#### 访问控制

- 所有命盘/对话 API 首件事：`WHERE user_id = session.user_id`；单元测试覆盖跨用户访问 → 必须 404
- admin 看聚合指标，不看单个用户内容
- 客服查看（未来）走用户主动授权的一次性只读 token

#### 开发期注意

- `.env.example` 里 `ENCRYPTION_KEK=__CHANGE_ME_64_HEX__`，启动若为默认值直接 panic
- 生产 DB 永不 dump 到本地；必要时走 anonymizer 替换 PII
- seed 脚本生成假出生信息

---

## 3. API 路由表 + 鉴权流

### 3.1 鉴权依赖链

```python
# app/auth/deps.py

async def current_user(request, db=Depends(get_db)) -> User:
    """必须登录。失败 → 401。"""
    token = request.cookies.get('session')
    if not token: raise Unauthorized()
    session_row = await get_session_by_hash(sha256(token))
    if not session_row or session_row.expired: raise Unauthorized()
    user = await session_row.user
    request.state.user_dek = decrypt_dek(user.dek_ciphertext)
    await touch_session(session_row)           # rolling 续期到 30 天
    return user

async def optional_user(request, ...) -> User | None:
    """可选登录。返回 None 给游客路由。"""

async def require_admin(user=Depends(current_user)) -> User:
    if user.role != 'admin': raise Forbidden()
    return user

def check_quota(kind: QuotaKind):
    async def _dep(user=Depends(current_user), db=Depends(get_db)):
        # 只检查不扣；扣减在业务成功后 commit
        return QuotaTicket(user=user, kind=kind)
    return _dep
```

**语义**：
- 配额检查前置、扣减后置；LLM 失败时回退配额
- session 30 天 rolling 续期
- DEK 挂 `request.state`，请求内 ORM 自动使用

### 3.2 路由表（全量）

**公共**（无需登录）：
```
GET   /api/health
GET   /api/cities
GET   /api/config                 → {require_invite, features}  前端渲染用
```

**Auth**：
```
POST  /api/auth/sms/send          {phone, purpose: 'register'|'login'}
POST  /api/auth/register          {phone, code, invite_code, nickname?, agreed_to_terms: true}
POST  /api/auth/login             {phone, code}
POST  /api/auth/logout            [current_user]
GET   /api/auth/me                [current_user]  → {user, quota_snapshot}
DELETE /api/auth/account          [current_user] {confirm: 'DELETE MY ACCOUNT'}
GET   /api/auth/sessions          [current_user]  登录设备列表
DELETE /api/auth/sessions/:id     [current_user]  踢掉某设备
```

**Charts CRUD**（全部 `[current_user]`）：
```
GET   /api/charts                               列表
POST  /api/charts                               body:{birth_input}；替代旧 /api/paipan
GET   /api/charts/:id                           → {chart, cache_status}
PATCH /api/charts/:id                           {label?}
DELETE /api/charts/:id                          软删
POST  /api/charts/:id/restore                   软删期内恢复
POST  /api/charts/import                        localStorage 迁移
```

**命盘 LLM 长文**（SSE）：
```
POST  /api/charts/:id/verdicts        ?force=true 扣 verdicts_regen
POST  /api/charts/:id/sections        body:{section}
POST  /api/charts/:id/dayun/:index
POST  /api/charts/:id/liunian         body:{dayun_index, year_index}
POST  /api/charts/:id/chips           对话建议；走 FAST_MODEL 不扣配额
```

**对话**：
```
GET   /api/charts/:id/conversations
POST  /api/charts/:id/conversations
PATCH /api/conversations/:id
DELETE /api/conversations/:id
GET   /api/conversations/:id/messages       分页 ?before=cursor
POST  /api/conversations/:id/messages       [check_quota('chat_message')]
POST  /api/charts/:id/gua                   [check_quota('gua')]
```

**配额**：
```
GET   /api/quota                  → {plan, usage: {kind: {used, limit, reset_at}}}
```

**管理员**（B 阶段，`[require_admin]`，IP 白名单）：
```
GET   /api/admin/invites / POST / DELETE
GET   /api/admin/stats                         聚合指标（用户数、LLM 调用量、异常率）
```
admin 不看单个用户的 `birth_input`/`messages.content`。

**游客**（C 阶段启用，B 阶段 404）：
```
POST  /api/guest/paipan           [optional_user]  算排盘不存 DB
POST  /api/guest/claim            [current_user]   认领 localStorage 盘
```

### 3.3 注册流程

```
① POST /api/auth/sms/send {phone, purpose:'register'}
  rate limit (phone 60s / 1h)
  生成 6 位码 hash → sms_codes
  调阿里云短信
  quota_usage.sms_send++
  ← {expires_in: 300}   dev 模式额外 __devCode

② POST /api/auth/register {phone, code, invite_code, nickname}  事务内
  校验 sms_code（hash 对比 / attempts++ / 超 5 次作废）
  校验 invite_code
  DEK = random(32)；dek_ciphertext = KEK_encrypt(DEK)
  INSERT users
  invite_codes.used_count += 1
  sms_codes.used_at = now
  生成 session token（32 字节）→ sessions.token_hash
  ← Set-Cookie: session=<raw>; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
    {user}
```

**登录**类似（不需 invite_code，purpose=login；新手机号拒绝）。

### 3.4 错误响应

JSON：
```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "...", "details": { "limit": 30, "resets_at": "..." } } }
```

SSE：
```
event: error
data: {"code":"UPSTREAM_LLM_TIMEOUT","message":"..."}
```

HTTP 状态码：
- 400 参数/业务校验 · 401 未登录 · 403 无权限 · 404 资源不存在或无权访问（ownership 不 403 防枚举）
- 409 冲突 · 422 格式错 · 429 配额 / rate limit（带 Retry-After）· 5xx 服务端错

### 3.5 旧 → 新路由映射

| 旧 MVP | 新 | 变化 |
|---|---|---|
| `POST /api/paipan` | `POST /api/charts` | 持久化创建 |
| `POST /api/sections` | `POST /api/charts/:id/sections` | chart_id 到 URL |
| `POST /api/verdicts` | `POST /api/charts/:id/verdicts` | 加 `?force=true` |
| `POST /api/dayun-step` | `POST /api/charts/:id/dayun/:index` | RESTful |
| `POST /api/liunian` | `POST /api/charts/:id/liunian` | |
| `POST /api/chips` | `POST /api/charts/:id/chips` | 需 chart 上下文 |
| `POST /api/chat` | `POST /api/conversations/:id/messages` | 绑定对话 |
| `POST /api/gua` | `POST /api/charts/:id/gua` | 绑定命盘 |
| `GET /api/health`, `/api/cities` | 不变 | |

---

## 4. LLM 输出缓存 + 配额机制

### 4.1 缓存命中流程

所有长文 SSE 路由共享抽象：
```
查 chart_cache (chart_id, kind, key)
  命中 且 ¬force  → 回放分支：不扣配额、不调 LLM、SSE 切片流回
  未命中 或 force → 生成分支：
    force=true 且已有缓存 → check_quota('<kind>_regen')，失败 429 断
    LLM 流式 + buffer 累积
    流完 → UPSERT chart_cache（force=true 时 regen_count++）
    commit quota ticket + llm_usage_logs 异步 insert
```

**首次生成免费**（产品决策：用户第一次看盘的长文应随时能看）；**手动重生扣配额**（控制重复消耗）。

### 4.2 SSE 回放语义

命中缓存时不一次性甩整段——前端打字动效会突兀消失。人工切片：

```python
async def replay(content: str, chunk_size=30, interval_ms=20):
    yield ModelEvent(model='cached', source='cache')
    for chunk in chunks(content, chunk_size):
        yield DeltaEvent(text=chunk)
        await asyncio.sleep(interval_ms / 1000)
    yield DoneEvent(tokens_used=0, source='cache')
```

- 30 字 / 20ms ≈ 1500 字/秒，比真实 LLM 流式略快但仍流式
- 前端 `onDelta`/`onDone` 同一套回调；`source:'cache'` 仅做埋点

### 4.3 缓存 key

```
kind         key
───────────────────────────────
verdicts     ''
section      'career' | 'personality' | 'wealth' | 'relationship' | 'health' | 'appearance' | 'special'
dayun_step   '3'                             大运 index
liunian      '3:7'                           dayun_index:year_index
```

UNIQUE `(chart_id, kind, key)` 保证一 slot 一份。

### 4.4 配额原子扣减

```sql
INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
VALUES ($1, $period, $kind, 1, now())
ON CONFLICT (user_id, period, kind)
DO UPDATE SET count = quota_usage.count + 1, updated_at = now()
WHERE quota_usage.count < $limit
RETURNING count;
```
返回 0 行 → 配额用完 → 抛 429；返回 1 行 → 扣减成功。

回滚：`UPDATE count = count - 1 WHERE ... AND count > 0`。

`QuotaTicket` 用法：业务 try 内 yield events；成功 `ticket.commit()`（no-op，已扣）；异常 `await ticket.rollback()`。

### 4.5 回退模型不重复计配额

主模型首 delta 超时切 flash 的行为保留。配额按**调用动作**算，一次 `/messages` 无论底下调几次 LLM 都只算 1 条。`llm_usage_logs` 每次 LLM 调用独立一行可区分。

### 4.6 engine_version 失效机制

- `charts.engine_version` 和代码 `paipan.VERSION` 绑定
- chart 打开时对比 version 不一致 → 标记 `cache_stale: true` → 后台/手动重算 paipan + 清该 chart 的 cache + 提示用户
- prompt 重大改动触发失效：migration 脚本清特定 kind 的 cache
- **不失效**：用户反复打开 · 配额 reset · 模型切换 · prompt 微调

### 4.7 容量预估

B 阶段乐观估计：100 用户 × 5 盘 × 43 条长文/盘 × 2KB ≈ 43 MB（加密后 ~22MB 实际数据，加密只加 28 字节/条）。C 阶段 100× 也就 2GB，Postgres 轻松。**不引 Redis**——DB 一张表管所有缓存最简单。

### 4.8 配额展示

- 输入框下方常显"今日 12/30"；>70% 变黄、=100% 变红禁用
- 429 前端弹气泡"今日对话已用完，明日 0 点重置"
- 重新生成按钮 hover 显示"本月剩余 X 次"
- `/api/quota` 不频繁调，每次页面切换 + 发送成功后 refetch
- 首屏 `quota_snapshot` 嵌在 `/api/auth/me` 返回

### 4.9 边界情形

| 场景 | 行为 |
|---|---|
| 生成中用户关页面 | SSE 断开；服务端继续跑完 → 写入 cache；下次命中 |
| LLM 彻底失败 | 不写 cache、回退配额、SSE 发 error |
| 两设备同时首次生成同 slot | DB `ON CONFLICT DO NOTHING`；先到先得，后到者读 cache |
| 手动 force 但配额不足 | 已有缓存保留；前端提示配额不足 |
| 模型切换中途断流 | 自动续接；最终整段写入 cache |
| engine_version 升级中用户在看 | 当前请求返回旧 cache + `cache_stale: true`；下次刷新命盘重算 |

---

## 5. localStorage 迁移 + 游客→账号认领

### 5.1 现有 localStorage

```
STORAGE_KEY = 'bazi_session_v1'
SESSION_VERSION = 3
每张命盘：{ id, label, meta, paipan, force, guards, dayun, sections, verdicts,
          conversations: [{id, label, messages, ts}], currentConversationId, gua, ts }
```

### 5.2 三种迁移场景

| 场景 | B 阶段 | C 阶段 |
|---|---|---|
| 老测试用户首次登录 | 弹导入确认 | 同 |
| 游客试用后注册 | 不发生 | 注册成功后自动 claim |
| 登录后又有新 localStorage（罕见） | 合并提示 | 同 |

### 5.3 迁移协议：`POST /api/charts/import`

**payload**：
```ts
{
  source: 'localstorage_v3' | 'guest_v1',
  exported_at: string,
  charts: Array<{
    client_id: string,
    label: string,
    birth_input: BirthInput,
    conversations?: Array<{
      client_id: string, label: string,
      messages: Array<{ role, content, meta?, ts }>,
    }>,
    cached_outputs?: {
      verdicts?: { content, generated_at },
      sections?: Record<string, { content, generated_at }>,
      dayun_step?: Record<string, { content, generated_at }>,
      liunian?: Record<string, { content, generated_at }>,
    }
  }>
}
```

**服务端**（每盘单独事务，失败隔离）：
1. 校验 birth_input（Pydantic）
2. 查 user 现有命盘数；≥ 15 → 剩余丢弃，`quota_reached=true`
3. 指纹去重（见 5.6）：重复 → 跳过
4. `paipan.compute(birth_input)` **服务端重新排盘**（不信任客户端 paipan）
5. INSERT charts
6. 迁 cached_outputs：kind/key 白名单、content 长度 ≤ 20KB；INSERT chart_cache（model_used='imported'）
7. 迁 conversations + messages：每盘最多 50 条 message（超出截断）
8. 记 {client_id → server_id} 到 response

**响应**：
```json
{
  "imported": [{ "client_id": "...", "server_id": "...", "label": "老王" }],
  "skipped":  [{ "client_id": "...", "reason": "duplicate" }],
  "failed":   [{ "client_id": "...", "reason": "invalid_birth_input", "detail": "..." }],
  "quota_reached": false
}
```

### 5.4 B 阶段 UX

登录成功 → `/api/auth/me` → 检查 `localStorage[STORAGE_KEY]`：

- 账号有盘 且 localStorage 无 → 无事
- 账号空 且 localStorage 有 N 张 → 弹模态 "[不导入，保留本机] [导入到账号]"
- 两边都有 → 弹冲突解决 "[保留账号，丢弃本机] [合并（上限 15）]"

"不导入"保留 localStorage，下次登录还弹；永久关闭入口在设置→本机数据。

### 5.5 C 阶段游客认领（预留）

1. 未登录 → `FormScreen`
2. 填完 → `POST /api/guest/paipan` → `{paipan, ui}`（不存 DB）
3. 前端存 `bazi_guest_v1`；展示四柱/十神/力量/大运
4. 点总论/对话/大运展开 → 拦截 → 登录/注册
5. 注册成功后前端检测 → `POST /api/guest/claim` → 认领

### 5.6 去重

```python
def fingerprint(birth_input) -> str:
    normalized = {
      'year','month','day','hour','minute','city','gender','is_solar',
    }
    return sha256(json.dumps(normalized, sort_keys=True)).hexdigest()
```

指纹**不入 DB**（birth_input 加密）——迁移时内存算、比对当前 user 已有的盘。重复默认跳过 + "已有这张盘"，可选"强制新副本"。

### 5.7 失败回退

- 单盘失败：进 `failed[]`，其他盘继续；localStorage 保留该盘供用户检查
- 全部失败或网络断：localStorage 完全不动，下次重试
- **单盘级事务**，不是全 payload 级

### 5.8 安全

| 情形 | 处理 |
|---|---|
| 伪造巨型 payload | 总大小 2MB 上限，超 413 |
| 伪造他人数据导入自己账号 | 不构成泄露（数据只绑你 user_id） |
| 重放 payload | fingerprint 去重 |
| XSS via content | RichText 只解析内联 markdown；server 加白名单兜底 |
| message 时序乱 | 按 payload.ts 排序后 INSERT |

### 5.9 localStorage 未来

登录后 localStorage 只剩 UI 状态（当前 chart_id、对话 id、偏好），**不再存命盘内容**。DB 是 source of truth。过渡期（B 阶段前 1-2 周）保留兼容代码处理迁移；之后彻底清除。

---

## 6. Agent 可扩展架构 + SSE 事件协议

### 6.1 Agent 协议

```python
# app/agents/base.py
class AgentContext:
    user: User; chart: Chart | None; conversation: Conversation | None
    db: AsyncSession; dek: bytes; quota: QuotaTicket | None
    signal: anyio.CancelScope

class Agent(Protocol):
    name: str
    async def run(self, ctx: AgentContext, input: dict) -> AsyncIterator[AgentEvent]: ...
```

**不变量**：
1. `run()` 必须 async generator，事件全 yield
2. 不直接触碰 HTTP/SSE
3. 尊重 `ctx.signal`，每个 await 点可被取消
4. 不管配额（HTTP 层守卫）
5. 不依赖请求生命周期（未来可被 job worker 调用）

HTTP 层（10 行）：
```python
@router.post('/conversations/{cid}/messages')
async def send_message(cid, body, ticket = Depends(check_quota('chat_message')), user = ...):
    ctx = await build_context(user, conversation_id=cid)
    return EventSourceResponse(sse_adapter(ChatAgent(), ctx, body))
```

### 6.2 SSE 事件协议（discriminated union）

**现在使用**：
```python
DeltaEvent         type='delta'       text: str
DoneEvent          type='done'        tokens_used: int, source: Literal['llm','cache']
ErrorEvent         type='error'       code: str, message: str
ModelEvent         type='model'       model: str
IntentEvent        type='intent'      intent: str, reason: str|None
RedirectEvent      type='redirect'    to: str
RetrievalEvent     type='retrieval'   refs: list[ClassicRef]
GuaEvent           type='gua'         gua: GuaState
```

**未来扩展占位**（协议预留，今天不用）：
```python
StepStartEvent     type='step.start'  step_id: str, label: str
StepDoneEvent      type='step.done'   step_id: str, duration_ms: int
ToolCallEvent      type='tool.call'   tool: str, args: dict, call_id: str
ToolResultEvent    type='tool.result' call_id: str, ok: bool, result?: dict, error?: str
ThinkingEvent      type='thinking'    text: str
```

前端 switch default 遇未知 type 只打日志不崩——后端加新 event 前端自动向前兼容。

### 6.3 7 个 LLM 路由映射

```
app/agents/
├── base.py
├── chat_agent.py              # 意图分类 + 分流（现有两阶段）
├── verdicts_agent.py          # 单次 LLM + 缓存
├── sections_agent.py
├── dayun_step_agent.py
├── liunian_agent.py
├── chips_agent.py
├── gua_agent.py
├── tools/                     # 预留
└── memory/                    # 预留
```

**ChatAgent** 示例（最复杂，两阶段）：
```python
class ChatAgent:
    async def run(self, ctx, input):
        intent = await classify_intent(input.content, history)
        yield IntentEvent(intent=intent.name, reason=intent.reason)
        if intent.name == 'divination' and not input.bypass_divination:
            yield RedirectEvent(to=f'/api/charts/{ctx.chart.id}/gua')
            return
        refs = await retrieve_for_chart(ctx.chart, intent=intent.name) or []
        if refs: yield RetrievalEvent(refs=refs)
        messages = build_chat_messages(ctx.chart, input, intent, refs)
        async for ev in stream_llm_with_fallback(messages, signal=ctx.signal):
            yield ev
```

### 6.4 未来复杂 agent 如何落（示意）

**多步事业分析**（不改 HTTP/SSE）：
```python
async def run(self, ctx, input):
    yield StepStartEvent(step_id='1', label='综合评估')
    overview = await run_llm(...)
    yield StepDoneEvent(step_id='1', duration_ms=...)
    yield StepStartEvent(step_id='2', label='找出关键张力')
    tensions = await run_llm(..., response_format='json')
    yield StepStartEvent(step_id='3', label='生成建议')
    async for ev in stream_llm(...): yield ev
```

**Tool calling**（协议已预留）：
```python
for tool_call in resp.tool_calls:
    yield ToolCallEvent(tool=tc.name, args=tc.args, call_id=tc.id)
    result = await tools[tc.name].impl(tc.args, ctx)
    yield ToolResultEvent(call_id=tc.id, ok=True, result=result)
```

**对话记忆 / 压缩**：agent 内部事，HTTP/SSE/前端不变。

### 6.5 取消传播（AbortSignal）

Python 的 `anyio.CancelScope`。规则：
1. HTTP 层监 `request.is_disconnected()`，断开→ cancel scope
2. Agent 所有 await 在 scope 内
3. LLM SDK 原生支持 cancel
4. DB 写（配额扣减、cache 写入）用 `shield` 保护本身不被中断，但不阻止整体取消
5. cancel 时不吞异常

```python
async def sse_adapter(agent, ctx, input, request):
    async with anyio.create_task_group() as tg:
        async def watch_disconnect():
            while True:
                if await request.is_disconnected():
                    tg.cancel_scope.cancel(); return
                await anyio.sleep(1)
        tg.start_soon(watch_disconnect)
        try:
            async for event in agent.run(ctx, input):
                yield format_sse(event)
        except anyio.get_cancelled_exc_class():
            log.info('stream cancelled by client'); raise
```

### 6.6 Job queue 预留

B 阶段不实现。架构位：
- ARQ（Redis 队列，async 原生，轻）
- `POST /api/jobs/start` → `{job_id}`；agent 在 worker 里跑
- `GET /api/jobs/:id/stream` SSE 桥接 Redis pub/sub
- `jobs` 表 `{id, user_id, agent_name, input, status, result?, error?}`
- Agent **本身不变**——输出通道从直接 SSE 变成写 channel

B 阶段留 `app/jobs/` 空目录 + README。

### 6.7 可观测性

```python
async def sse_adapter(agent, ctx, input):
    trace_id = uuid4(); start = time.monotonic()
    log.info('agent.start', extra={'agent': agent.name, 'trace_id': trace_id, 'user_id': ctx.user.id})
    try:
        async for event in agent.run(ctx, input):
            log.debug('agent.event', extra={'type': event.type, 'trace_id': trace_id})
            yield event
    except Exception as e:
        log.exception('agent.error', ...)
        yield ErrorEvent(code='INTERNAL', message='服务暂时异常')
    finally:
        duration = (time.monotonic() - start) * 1000
        log.info('agent.done', extra={'duration_ms': duration, ...})
```

未来接 Langfuse / OTel 只需在 llm_service 加装饰器。

### 6.8 为什么不引 LangGraph / PydanticAI

当前需求是顺序执行 + 偶尔分支，自写 30 行 async generator 比引 200KB 依赖清楚。等真的需要图执行（并行分支、条件回路、动态 DAG）再评估。

---

## 7. 部署与运维

### 7.1 基础设施（B 阶段最小集）

| 资源 | 规格 | 费用（年） |
|---|---|---|
| 阿里云 ECS | 2C4G 通用型 g8i，40GB SSD | ~¥500-800 |
| 域名 | `.com`/`.cn` 个人备案 | ~¥40-60 |
| ICP 备案 | 阿里云一站式 | 免费（7-20 天审核） |
| SSL | 阿里云免费 DV 或 Let's Encrypt | 免费 |
| 阿里云短信 | 个人实名；~¥0.045/条 | 按量 |
| 阿里云 OSS | 备份 1GB 级 | ~¥5/月 |
| MiMo API | 按 token | 用量 |

**总**：启动 ~¥1000，月 ~¥50 + LLM。月度预算 ¥200 警戒线。

### 7.2 Docker Compose

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: bazi
      POSTGRES_USER: bazi
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes: ["/srv/bazi/pgdata:/var/lib/postgresql/data"]
    secrets: [db_password]
    networks: [internal]
  server:
    # context 是 repo 根——server 和 paipan 两个 workspace 成员都要访问
    build: { context: .., dockerfile: server/Dockerfile }
    restart: unless-stopped
    env_file: /srv/bazi/server.env
    depends_on: [db]
    networks: [internal]
    ports: ["127.0.0.1:8000:8000"]
secrets:
  db_password: { file: /srv/bazi/secrets/db_password }
networks: { internal: {} }
```

Nginx **不**进 compose——走宿主 systemd（certbot 集成顺、reload 快、证书 mount 少坑）。

### 7.3 Dockerfile（server）

构建上下文为 repo 根（docker-compose 已设 `context: ..`），以便同时访问 `server/` 和 `paipan/`：

```dockerfile
# server/Dockerfile
FROM python:3.12-slim AS base
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

FROM base AS builder
RUN pip install uv
WORKDIR /repo
# uv workspace：根目录 pyproject.toml 声明 members=["server","paipan"]
COPY pyproject.toml uv.lock ./
COPY server ./server
COPY paipan ./paipan
RUN uv sync --frozen --no-dev --package server

FROM base AS runtime
WORKDIR /app
COPY --from=builder /repo/.venv /app/.venv
COPY --from=builder /repo/paipan /app/paipan          # 运行时也要能 import paipan
COPY server/app ./app
COPY server/alembic.ini ./
COPY server/alembic ./alembic
ENV PATH="/app/.venv/bin:$PATH"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

**根 `pyproject.toml`**（uv workspace 声明）：
```toml
[tool.uv.workspace]
members = ["server", "paipan"]
```

`server/pyproject.toml` 里 `dependencies` 包含 `paipan` 作为 workspace 依赖。

### 7.4 Nginx 关键配置

```nginx
server {
  listen 443 ssl http2;
  server_name bazi.example.com;
  ssl_certificate     /etc/letsencrypt/live/bazi.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/bazi.example.com/privkey.pem;

  root /srv/bazi/frontend-dist;
  index index.html;

  location / { try_files $uri $uri/ /index.html; add_header Cache-Control "public,max-age=3600" always; }
  location ~* \.(?:css|js)$ { add_header Cache-Control "public,max-age=31536000,immutable"; }

  location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE 关键
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    chunked_transfer_encoding on;
  }
  location /api/admin/ {
    proxy_pass http://127.0.0.1:8000;
    allow 你的家里IP; allow 公司IP; deny all;
  }
  client_max_body_size 3m;
}
server { listen 80; server_name bazi.example.com; return 301 https://$host$request_uri; }
```

### 7.5 环境变量与机密（三层）

1. 代码仓 `.env.example`：变量名 + 空值 + 注释，不提交真密钥
2. 宿主 `/srv/bazi/server.env`（chmod 600 root 拥有）：通过 `env_file` 挂入
3. 宿主 `/srv/bazi/secrets/*`：真机密（DB 密码、KEK）独立文件，通过 `secrets` 挂入

启动时断言：
```python
if settings.env == 'production':
    assert settings.encryption_kek != 'CHANGE_ME'
    assert len(settings.encryption_kek) >= 64
    assert settings.mimo_api_key.startswith('sk-')
```

### 7.6 部署流程

**日常**：
```bash
# deploy/ship.sh
set -e
cd "$(dirname "$0")/.."
git pull
cd frontend && npm ci && npm run build && cd ..
rsync -avz --delete frontend/dist/ root@ecs:/srv/bazi/frontend-dist/
rsync -avz --delete server/ paipan/ pyproject.toml deploy/ root@ecs:/srv/bazi/src/
ssh root@ecs bash -c '
  cd /srv/bazi/src/deploy
  docker compose build server
  docker compose up -d server
  docker compose exec -T server alembic upgrade head
'
```
一条 `./deploy/ship.sh` 发版。B 阶段手工；未来 GitHub Actions 自动化。回滚：`git checkout <prev-tag> && ./deploy/ship.sh`。

### 7.7 Migration 策略

- Alembic autogenerate → 人肉 review SQL → commit
- 破坏性改动分 2 步发版：加新列/双写 → 确认无读旧 → 删旧列
- 加密字段迁移（明文 → 加密）写专门脚本：新列 + 逐行重加密 + 切换 → 删旧列；B 阶段本身一开始就加密，不需要这种改造

### 7.8 备份

每天 3 点 cron：
```bash
DATE=$(date +%Y%m%d); DUMP=/tmp/bazi-$DATE.sql
docker compose exec -T db pg_dump -U bazi bazi > $DUMP
gpg --batch --yes --cipher-algo AES256 -c --passphrase-file /srv/bazi/secrets/backup_password \
    -o $DUMP.gpg $DUMP
rm $DUMP
ossutil cp $DUMP.gpg oss://bazi-backup/$(date +%Y/%m)/ --force
rm $DUMP.gpg
find /srv/bazi/local-backup -name '*.gpg' -mtime +7 -delete
```

- 加密密码写本地密码管理器，**不在服务器**
- OSS bucket：版本控制 + MFA 删除保护 + 独立 IAM 只允 Put/List
- 保留：OSS 30 天
- **季度恢复演练**

### 7.9 日志

- structlog JSON + 白名单字段（见 2.6）
- docker logs driver `json-file` `max-size=100m max-file=5` 自带 rotate
- B 阶段直接 `docker compose logs -f server`
- 未来 Loki + Grafana 或阿里云 SLS

### 7.10 监控（最小集）

1. **UptimeRobot** 免费版，每 5 分钟打 `/api/health`，失败告警邮件/短信
2. **磁盘告警** crontab：`df -h | awk '$5+0>80 {print}' | mail -s "disk" you@x.com`
3. **每日成本日报**：`app/scripts/daily_report.py` 晚 23:55 汇总 `llm_usage_logs` 估算当天费用，邮件你

### 7.11 环境

- **local**：`docker-compose.dev.yml` + 热重载；个人 MiMo key；短信打 console；REQUIRE_INVITE=false
- **production**：上面所有规格

**没有 staging**。B 阶段体量不值。DAU 破 100 或 C 阶段付费上线再加。

### 7.12 ICP 备案时间线

**今天开始办**，与开发并行：
- Day 0：阿里云买域名 + 启动 ECS（备案要求服务器在阿里云）
- Day 0-1：扫脸实名 + 提交申请（身份证 + 手持照 + 域名证书）
- Day 2-10：初审（电话回访）
- Day 10-20：管局审核（各省不等）
- Day 20：下证，可解析国内 IP

期间用 `ip:port` 裸跑或 Cloudflare Pages 内测。

**不办后果**：国内云服务器 80/443 被拦截跳警告页，无法绕过。

---

## 8. Paipan Python Port 计划

### 8.1 目标与非目标

**目标**：
- `paipan.compute(birth_input)` 输出与 Node 版**逐字段一致**（float < 1e-9）
- 独立 Python 包，`uv workspace` 成员
- 300+ 回归 fixture 全绿，CI < 30s
- 代码结构清晰的微重构；**不改算法字面翻译**

**非目标**：不加功能、不改 API、不性能优化、不优化字段名

### 8.2 Step 0：盘点 Node 引擎（第一件事）

产出 `paipan-port-inventory.md`：列出 `paipan-engine/src/*.js` 所有文件，每个：输入、输出、依赖、外部包、已知 edge case。架构文档只列 5 个文件，实际必有力量/格局/大运的独立模块——**先列清楚再动手**。

### 8.3 lunar-javascript ↔ lunar-python 对照

6tail 同门出品但不完全一致。第一优先级：
- 核对 Node 版 `EightChar.setSect(1|2)` 传什么（早晚子时流派）
- diff `getJieQiTable()` 返回键名
- 用最小 script 跑相同输入在两边 → 逐字段 diff

**不**盲信 API 对齐。

### 8.4 回归对拍语料（Oracle-Driven）

工具：`paipan/tests/regression/fixtures/*.json`：
```json
{
  "case_id": "001-basic-1990-male-beijing",
  "birth_input": { ... },
  "expected": { /* Node 版 compute() 完整输出 */ }
}
```

**生成**：Node 仓库写 `scripts/dump-oracle.js` 遍历 `birth_inputs.json` 列表 → 写 fixtures。Node 仓库冻结后归档到 `archive/paipan-engine/`。

**覆盖**（至少 300 条）：

| 类别 | 数量 |
|---|---|
| 节气切换前后 | 60（12 节气 × 前后 5） |
| 子时跨日 | 40（23:00-23:59 / 0:00-0:59 × 早晚子时流派） |
| 夏令时期 1986-1991 | 30 |
| 时区边界（西部城市） | 20 |
| 海外 | 10 |
| 闰月 | 20 |
| 五行齐全/缺一/极端 | 40 |
| 各种格局 | 40 |
| 极端大运（顺逆、起运年龄） | 20 |
| 随机采样 | 20 |

**Runner**：
```python
@pytest.mark.parametrize("fixture_path", glob.glob(".../fixtures/*.json"))
def test_regression(fixture_path):
    data = json.loads(open(fixture_path).read())
    actual = compute(**data['birth_input']).to_dict()
    diff = deep_diff(actual, data['expected'], float_tolerance=1e-9)
    assert not diff, f"Mismatch in {data['case_id']}:\n{format_diff(diff)}"
```

**验收**：0 失败。一条不过不上线。

### 8.5 分模块 port 计划（依赖顺序）

| Step | 模块 | 工时 | 单元测试重点 |
|---|---|---|---|
| 1 | cities | 1d | 30 城市抽样 |
| 2 | solar_time + china_dst | 2d | 20 经纬度极端 case |
| 3 | zi_hour + 节气 | 2d | 10 子时跨日 + 12 节气切换 |
| 4 | 基础干支 | 2d | 50 case 对拍 |
| 5 | 十神 + 藏干 | 2d | 10×9=90 case 全覆盖 |
| 6 | 力量 | 3d | 50 case（五行偏旺偏弱） |
| 7 | 格局 + guards | 3d | 30 case（主要格局） |
| 8 | 大运 + 流年 | 2d | 30 case（顺逆、起运精度） |
| 9 | meta + ui | 2d | 20 case |
| 10 | 全量回归 | 3d | 所有 300+ fixture 全绿 |
| 11 | 集成到 server | 2d | E2E 视觉对比 |

**总**：~24 工作日 ≈ 1 个月。与其他工作并行。

### 8.6 并行时间线（2.5 个月工时预估）

```
周 1-2:  ICP 备案提交 + 搭骨架（FastAPI / alembic / Docker / CI）
         + paipan Step 0（盘点 + 对拍工具）
周 3-4:  auth / 邀请码 / 短信
         + paipan Step 1-4 + 生成 oracle 语料
周 5-6:  命盘 CRUD / 缓存 / 部署 ECS 内测
         + paipan Step 5-7
周 7-8:  SSE agent 路由全接通
         + paipan Step 8-10
周 9:    paipan Step 11 集成 + localStorage 迁移 + 用户设置
         + ICP 通常下证
周 10:   灰度内测 + 修 bug
周 11:   B 阶段正式放号
```

**阻塞**：部署上线等 ICP + paipan 全绿。server API 开发不等 paipan（用 fixture expected 做 stub）。

**投入假设**：每周 20-30 小时；业余 10 小时翻倍到 5-6 个月。

### 8.7 高风险 Edge Case（port 时重点）

1. 早晚子时流派（`setSect` 1 vs 2）——决定 23:00-23:59 月柱
2. 节气切换那一分钟——立春 04:58 生 vs 04:59 生的年月柱差异
3. 中国夏令时 1988-1991
4. 真太阳时负数偏移（>120°E）
5. 跨日子时的日柱
6. 闰月月柱（lunar-python 处理可能不同）
7. 起运年龄 float 精度（3.48 vs 3.5，向下 vs 四舍五入）
8. 顺逆行大运表（阴阳性别 + 阴阳年）
9. 藏干余气
10. 天干合化（甲己合土 etc.）

每条 ≥ 5-10 fixture 覆盖。

### 8.8 Python Package 结构

```
paipan/
├── pyproject.toml            # deps: lunar-python, pydantic
├── paipan/
│   ├── __init__.py           # export compute, VERSION, BirthInput, PaipanResult
│   ├── compute.py            # 主入口
│   ├── solar_time.py / china_dst.py / zi_hour.py
│   ├── ganzhi.py / shi_shen.py / cang_gan.py
│   ├── force.py / ge_ju.py / dayun.py / ui.py
│   ├── cities.py / types.py / constants.py
├── tests/unit/
├── tests/regression/
│   ├── fixtures/*.json       # 300+ oracle
│   ├── test_regression.py
│   └── generate_oracle.md    # 从 Node 仓 dump 说明
└── README.md
```

类型：
```python
class BirthInput(BaseModel):
    year: int; month: int; day: int; hour: int; minute: int = 0
    city: str
    gender: Literal['male','female']
    is_solar: bool = True

class PaipanResult(BaseModel):
    paipan: dict; force: dict; guards: list; dayun: list[DayunEntry]
    meta: Meta; ui: dict

VERSION = '1.0.0'
```

### 8.9 完成定义

- [ ] 300+ fixture 回归对拍 0 失败
- [ ] 10 个 edge case 每个 ≥ 5 fixture 全绿
- [ ] 单元覆盖 > 85%
- [ ] CI < 30s
- [ ] `uv add paipan` 本地可装
- [ ] 集成 server 后 5 张真实盘人工 check 无感差异
- [ ] Node 仓打 tag `paipan-engine-oracle-v1` 归档到 `archive/`

### 8.10 Port 约定

1. 不读 lunar-javascript 源码对齐——信 lunar-python 作者
2. 不重写算法——照抄
3. 不改字段名
4. magic number 保留 + `# NOTE: from paipan.js:123` 注释
5. Pythonic idioms OK（dataclass / @property / Pydantic）；逻辑字面翻译

---

## 9. 附录：设计小结一表

| Section | 主题 | 关键决定 |
|---|---|---|
| 1 | 总体架构 | 单机 docker-compose；Agent 层解耦；缓存一等公民 |
| 2 | 数据模型 | 10 张表；SQLAlchemy 2.0；软删 + 硬删分层 |
| 2.6 | 敏感数据加密 | KEK + per-user DEK；crypto-shredding；6 个字段加密 |
| 3 | API 路由 + 鉴权 | RESTful 化；cookie session；QuotaTicket 二阶段扣费 |
| 4 | LLM 缓存 + 配额 | 首次免费、重生扣；回放切片；ON CONFLICT 原子扣 |
| 5 | localStorage 迁移 | 单盘级事务；服务端重排盘；指纹去重 |
| 6 | Agent 架构 | Agent 协议 + AgentEvent 联合；取消传播；job queue 预留 |
| 7 | 部署 | 阿里云 ECS + docker-compose + 宿主 Nginx；手工 ship.sh |
| 8 | paipan port | Oracle-driven testing；300+ fixture；~1 个月工期 |

---

## 10. 开放问题与后续

### 10.1 C 阶段再定

- 微信登录（需企业主体）
- 付费订阅 / 支付接入（微信支付 / 支付宝）
- 游客模式 UX 细节
- 分享只读命盘链接
- 移动端适配
- 小程序（评估是否值得）
- 数据导出功能
- Sentry / Langfuse / Grafana 接入

### 10.2 引擎升级

- 神煞、纳音、六亲（port 完后独立立项）
- 古籍检索从片段级升句级 + embedding
- 自定义提示词（用户偏好流派）

### 10.3 运维演进

- Postgres 迁阿里云 RDS（用户过 500）
- Redis 引入（真有热点或队列需求）
- staging 环境（DAU > 100 或付费上线）
- GitHub Actions 自动发版
- KEK 迁阿里云 KMS

---

**版本**：v1.0 · 2026-04-17
