# Auth Business Layer 设计文档

> **状态**：设计 · 待出实施计划
> **上游 spec**：`2026-04-17-user-accounts-and-deployment-design.md`（完整后端设计）
> **前置 plan**：`2026-04-17-backend-foundation.md`（Plan 2，已完成）
> **范围**：上游 spec §3（Auth 路由表 + 鉴权流）+ §2.6 crypto-shredding 的业务层；charts / LLM / frontend 全部在后续 plan
> **撰写日期**：2026-04-17

---

## 0. 目标与范围

### 0.1 目标

在 Plan 2 的 FastAPI + DB + 加密骨架之上，落地完整的手机号短信登录 / 注册 / 注销业务：

- 7 个 `/api/auth/*` 端点：`sms/send` · `register` · `login` · `logout` · `me` · `account` · `sessions`
- `current_user` / `optional_user` / `require_admin` / `check_quota` 依赖从 `NotImplementedError` 骨架切到真实实现
- SMS provider 抽象 + 本地 dev 桩 + Aliyun 骨架（真 API 留到 Plan 7 部署）
- SMS rate limit（60s 冷却 + 5/h 小时限额）
- 邀请码校验与消耗
- Session cookie 30 天 rolling 续期
- `/account` 注销走 crypto-shredding（置 `users.dek_ciphertext = NULL`，所有密文永久不可解）

### 0.2 非目标（留给后续 plan）

- `/api/config` 与 `/api/cities`（公共资源层，Plan 4 与 charts 一起）
- 微信登录（C 阶段 + 需要企业资质）
- 真正阿里云 API 调用（Plan 7 部署时填）
- `/api/charts` · conversations · LLM（Plan 4+）
- 前端 auth UI（Plan 6）
- JWT / OAuth（本 plan 只用 cookie session）

### 0.3 关键决定速览

| # | 决定 | 理由 |
|---|---|---|
| 1 | SMS provider 仅 dev 桩 + Aliyun 骨架（`NotImplementedError`） | 真发短信需要 ICP + 阿里云账号，属 Plan 7 部署环节 |
| 2 | SMS code 存 `sha256` 不加盐 | 6 位 + 5 分钟过期，rainbow table 不值当 |
| 3 | `attempts >= 5` 直接 burn 整条 code 记录 | 非"第 5 次拒"，是"作废该 code"，防 replay |
| 4 | Rate limit 查同表 `sms_codes`，不引 Redis | 单机阶段够用；横向扩展时另立项 |
| 5 | dev mode 把 code 回显到 response body（`__devCode`） | 联调方便；prod 下该字段绝对不出现 |
| 6 | Login 对"手机号未注册"返回 404（不做防枚举） | 手机号隐私价值低，防枚举 UX 代价高于安全增益 |
| 7 | QuotaTicket：前置 check + 后置 commit + 可 rollback | spec §4.4 的 INSERT ... ON CONFLICT ... WHERE count < limit 原子扣减 |
| 8 | `optional_user` 对破损 cookie 仍抛 401（不降级 None） | 破损 cookie 是异常信号，静默降级会误导用户 |
| 9 | DEK 在 `current_user` 里解密并挂 contextvar；请求结束由 asyncio task GC 自动卸 | 每请求独立上下文，免手动 reset |
| 10 | Crypto-shredding 把 `users.dek_ciphertext` 置 NULL（不 DELETE users 行） | 其他表 FK 是 RESTRICT；保留 users 行 + `status='disabled'` 即可失效登录 |
| 11 | Migration `0002_user_fields_for_auth.py` 允许 `dek_ciphertext` 为 NULL，加 `agreed_to_terms_at` | crypto-shredding 要写 NULL；注册要记同意时间 |
| 12 | Phone 完整值永远不在响应里出现；只返回 `phone_last4` | 防响应 PII 泄露 |

---

## 1. 模块布局（Plan 3 产出）

```
server/
├── app/
│   ├── sms/                              # NEW
│   │   ├── __init__.py                   # SmsProvider Protocol + get_sms_provider()
│   │   ├── dev.py                        # DevSmsProvider (logs + response echo)
│   │   └── aliyun.py                     # AliyunSmsProvider skeleton
│   ├── services/                         # NEW
│   │   ├── __init__.py
│   │   ├── sms.py                        # send/verify/rate-limit + code hashing
│   │   ├── auth.py                       # register / login / logout / shred_account
│   │   └── session.py                    # create / list / revoke
│   ├── api/                              # NEW
│   │   ├── __init__.py
│   │   ├── auth.py                       # /api/auth/{sms/send, register, login, logout, me, account}
│   │   └── sessions.py                   # /api/auth/sessions, /api/auth/sessions/:id
│   ├── schemas/                          # NEW
│   │   ├── __init__.py
│   │   └── auth.py                       # Pydantic request/response models
│   ├── auth/
│   │   └── deps.py                       # MODIFY: drop NotImplementedError, fill real impl
│   ├── core/
│   │   └── quotas.py                     # NEW: QUOTA limits per plan
│   ├── main.py                           # MODIFY: include auth + sessions routers
│   └── models/user.py                    # MODIFY: add agreed_to_terms_at column
└── alembic/versions/
    └── 0002_user_fields_for_auth.py      # NEW
```

**边界原则：**
- `schemas/` 仅请求/响应 Pydantic，不含任何业务逻辑
- `services/` 仅业务逻辑，不含 HTTP / cookie / status code
- `api/` 仅 HTTP 层：cookie 读写、状态码映射、依赖注入
- `services` 抛自定义异常（`QuotaExceededError` / `SmsRateLimitError` 等），`api` 转成 HTTP 响应

---

## 2. SMS Provider + Rate Limit

### 2.1 Provider 接口

`app/sms/__init__.py`：

```python
from typing import Protocol

class SmsProvider(Protocol):
    async def send(self, phone: str, code: str) -> None: ...


def get_sms_provider() -> SmsProvider:
    """Factory: DevSmsProvider if settings.aliyun_sms_access_key is None,
    else AliyunSmsProvider. Cached module-level (lru_cache)."""
```

### 2.2 Dev provider

`app/sms/dev.py`：

```python
class DevSmsProvider:
    async def send(self, phone: str, code: str) -> None:
        logger.info("dev_sms_sent", phone_last4=phone[-4:], code_len=len(code))
        # code itself does NOT go to logs (PII scrub whitelist drops it).
        # Dev echo happens in api/auth.py, not here.
```

### 2.3 Aliyun skeleton

`app/sms/aliyun.py`：

```python
class AliyunSmsProvider:
    def __init__(self, access_key: str, secret: str, template: str): ...

    async def send(self, phone: str, code: str) -> None:
        raise NotImplementedError(
            "aliyun SMS integration lands in Plan 7 deployment phase — "
            "requires ICP filing + aliyun account + signed template"
        )
```

### 2.4 Send 流程

`app/services/sms.py::send_sms_code`：

1. Rate limit：
   - `SELECT 1 FROM sms_codes WHERE phone=:p AND created_at > now()-interval '60 seconds'` → 存在 → `SmsRateLimitError("SMS_COOLDOWN", retry_after=remaining)`
   - `SELECT count(*) FROM sms_codes WHERE phone=:p AND created_at > now()-interval '1 hour'` → `>= 5` → `SmsRateLimitError("SMS_HOURLY_LIMIT", retry_after=3600)`
2. Generate 6-digit code：`"{:06d}".format(secrets.randbelow(1_000_000))`
3. `INSERT sms_codes (phone, code_hash=sha256(code), purpose, expires_at=now()+5min, ip)`
4. `check_quota("sms_send")` → `ticket.commit()`
5. `provider.send(phone, code)`（provider 抛则整事务回滚）
6. Return `{"code": code, "expires_at": ...}`（code 字段只给 api 层用，决定是否回显 dev）

### 2.5 Verify 流程

`app/services/sms.py::verify_sms_code`：

1. Find latest `sms_codes` for `(phone, purpose, used_at IS NULL, expires_at > now())` ordered by `created_at DESC`
2. 若找不到 → raise `SmsCodeInvalidError("SMS_CODE_NOT_FOUND_OR_EXPIRED")`
3. 若 `sha256(code) != row.code_hash`：
   - `UPDATE ... SET attempts = attempts + 1`
   - 若 `attempts >= 5` → `UPDATE ... SET used_at = now()` (burn)
   - raise `SmsCodeInvalidError("SMS_CODE_MISMATCH", attempts_left=max(0, 5-attempts))`
4. `UPDATE ... SET used_at = now()`（绝不重复使用）
5. Return True

### 2.6 api 层 dev 回显

`api/auth.py::send_sms_code_endpoint`：

```python
result = await sms_service.send_sms_code(db, request.phone, request.purpose, client_ip)
body = {"expires_in": 300}
if settings.env == "dev":
    body["__devCode"] = result.code
return body
```

Prod 下 `settings.env != "dev"`，`__devCode` 永不出现。

---

## 3. Register / Login / Logout / Me 流程

### 3.1 `POST /api/auth/register`

**Schema：**
```python
class RegisterRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    code: str = Field(pattern=r"^\d{6}$")
    invite_code: str = Field(min_length=4, max_length=16)
    nickname: str | None = Field(default=None, max_length=40)
    agreed_to_terms: bool
```

**Service 流程**（`services/auth.py::register`，整个函数单 DB 事务）：

```
1. verify_sms_code(phone, code, purpose='register')      → 400 if invalid
2. agreed_to_terms must be True                          → 400 TERMS_NOT_AGREED
3. SELECT 1 FROM users WHERE phone = :p → 存在           → 409 PHONE_ALREADY_REGISTERED
4. if settings.require_invite:
     find invite_code, check not expired / disabled /
     used_count < max_uses                               → 400 INVITE_CODE_*
5. dek = generate_dek()
   dek_ciphertext = encrypt_dek(dek, app.state.kek)
6. INSERT users (
     phone, phone_last4=phone[-4:], nickname,
     invited_by_user_id=invite_code.created_by,
     used_invite_code_id=invite_code.id,
     dek_ciphertext, dek_key_version=1,
     status='active', role='user', plan='free',
     agreed_to_terms_at=now()
   )
7. UPDATE invite_codes SET used_count = used_count + 1
     WHERE id = :ic AND used_count < max_uses
     (原子条件；返回 0 行 → INVITE_CODE_RACE_LOST → 500 redoable)
8. raw_token = secrets.token_urlsafe(32)
   token_hash = sha256(raw_token)
   INSERT sessions (token_hash, user_id, user_agent, ip,
                    expires_at=now()+30d, last_seen_at=now())
9. COMMIT
10. Return (UserResponse, raw_token)
```

API 层把 `raw_token` 设为 cookie：
```
Set-Cookie: session=<raw_token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

`Secure` 在 `settings.env == "dev"` 时关闭（允许 HTTP 本地联调）。

### 3.2 `POST /api/auth/login`

```
1. verify_sms_code(phone, code, purpose='login')         → 400 if invalid
2. SELECT users WHERE phone = :p                         → 404 USER_NOT_FOUND
3. user.status != 'active'                               → 403 ACCOUNT_DISABLED
4. create session (同 register 步 8)
5. COMMIT; return (UserResponse, raw_token)
```

注意：login 不生成 DEK（注册时已生成）；不解密 DEK（由后续请求的 `current_user` 解密）。

### 3.3 `POST /api/auth/logout`

```
1. current_user dependency (resolves session + user)
2. DELETE FROM sessions WHERE id = request.state.session.id
3. Set-Cookie: session=; Max-Age=0
4. return 200 {"ok": true}
```

### 3.4 `GET /api/auth/me`

```
1. current_user dependency
2. return {
     "user": UserResponse(id, phone_last4, nickname, role, plan, plan_expires_at, created_at),
     "quota_snapshot": {}  # Plan 4 填充实际 quota；Plan 3 返回 {} 占位
   }
```

### 3.5 UserResponse schema

```python
class UserResponse(BaseModel):
    id: UUID
    phone_last4: str          # NOT phone
    nickname: str | None
    role: Literal["user", "admin"]
    plan: Literal["free", "pro"]
    plan_expires_at: datetime | None
    created_at: datetime
```

完整 `phone` 字段**绝不**在任何 `/api/auth/*` 响应中出现。

### 3.6 错误响应格式（spec §3.4）

```python
class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | None = None

class ErrorResponse(BaseModel):
    error: ErrorDetail
```

Status code 映射：
- 400 — SMS / invite code / terms 校验失败
- 401 — session 无效或过期
- 403 — admin 要求 / disabled 账号
- 404 — user 不存在（login） / session 不存在（revoke）
- 409 — phone 已注册
- 429 — SMS rate limit（header `Retry-After: <seconds>`）
- 500 — 内部错误（数据库 race 等）

---

## 4. `current_user` / `check_quota` 真实实现

Plan 3 交付给下游的合同：Plan 2 四个 `NotImplementedError` 骨架全部落实。签名保持 Plan 2 已发布。

### 4.1 `current_user`

```python
async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "未登录"})
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    session_row = await db.scalar(
        select(UserSession).where(UserSession.token_hash == token_hash)
    )
    if session_row is None or session_row.expires_at <= datetime.now(tz=timezone.utc):
        raise HTTPException(401, detail={"code": "SESSION_EXPIRED", "message": "会话已过期"})
    user = await db.get(User, session_row.user_id)
    if user is None or user.status != "active":
        raise HTTPException(401, detail={"code": "ACCOUNT_INACTIVE", "message": "账号已停用"})
    # Crypto-shredded: dek_ciphertext could be NULL
    if user.dek_ciphertext is None:
        raise HTTPException(401, detail={"code": "ACCOUNT_SHREDDED", "message": "账号已注销"})
    # Mount DEK into request-scoped contextvar
    kek = request.app.state.kek
    dek = decrypt_dek(user.dek_ciphertext, kek)
    _current_dek.set(dek)                 # from app.db_types
    # Stash for logout / sessions endpoints
    request.state.session = session_row
    # Rolling 30-day expiry
    await db.execute(
        update(UserSession)
        .where(UserSession.id == session_row.id)
        .values(last_seen_at=func.now(), expires_at=func.now() + timedelta(days=30))
    )
    return user
```

**关键点：**
- KEK 从 `request.app.state.kek` 取（Plan 2 lifespan 已挂）
- DEK 解出后挂 `_current_dek`（Plan 2 contextvar）——当前 asyncio task 内所有 ORM 读写透明解密
- FastAPI 请求结束时 task 释放，contextvar 自动清
- Rolling 续期写在这里，单次请求就完成

### 4.2 `optional_user`

```python
async def optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    if "session" not in request.cookies:
        return None
    # Cookie exists → must be valid; broken cookie STILL raises 401
    return await current_user(request, db)
```

### 4.3 `require_admin`

```python
async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, detail={"code": "FORBIDDEN_ADMIN_ONLY", "message": "需要管理员权限"})
    return user
```

### 4.4 `QuotaTicket` + `check_quota`

```python
@dataclass
class QuotaTicket:
    user: User
    kind: str
    limit: int
    _db: AsyncSession
    _committed: bool = False

    async def commit(self) -> int:
        """Atomic: INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit.
        Returns new count; raises QuotaExceededError if race pushed count over."""
        period = _today_beijing()
        row = await self._db.execute(text("""
            INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
            VALUES (:uid, :period, :kind, 1, now())
            ON CONFLICT (user_id, period, kind)
            DO UPDATE SET count = quota_usage.count + 1, updated_at = now()
            WHERE quota_usage.count < :limit
            RETURNING count
        """), {"uid": self.user.id, "period": period, "kind": self.kind, "limit": self.limit})
        r = row.first()
        if r is None:
            raise QuotaExceededError(kind=self.kind, limit=self.limit)
        self._committed = True
        return r[0]

    async def rollback(self) -> None:
        if not self._committed:
            return
        period = _today_beijing()
        await self._db.execute(text("""
            UPDATE quota_usage SET count = count - 1, updated_at = now()
             WHERE user_id=:uid AND period=:period AND kind=:kind AND count > 0
        """), {"uid": self.user.id, "period": period, "kind": self.kind})


def check_quota(kind: str):
    async def _dep(
        user: User = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> QuotaTicket:
        limit = QUOTAS[user.plan][kind]
        period = _today_beijing()
        # Pre-check (non-consuming) — for 429 fast-fail + UI display
        row = await db.execute(text("""
            SELECT count FROM quota_usage
             WHERE user_id=:uid AND period=:period AND kind=:kind
        """), {"uid": user.id, "period": period, "kind": kind})
        r = row.first()
        used = r[0] if r else 0
        if used >= limit:
            raise HTTPException(429, detail={
                "code": "QUOTA_EXCEEDED",
                "message": f"今日 {kind} 配额已用完",
                "details": {"limit": limit, "resets_at": _next_midnight_beijing().isoformat()},
            }, headers={"Retry-After": str(_seconds_until_midnight())})
        return QuotaTicket(user=user, kind=kind, limit=limit, _db=db)
    return _dep
```

### 4.5 `app/core/quotas.py`

```python
# NOTE: plan 3 ONLY consumes 'sms_send'; other keys are filled for Plan 4+ to use.
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
    "pro": {  # placeholder; equals free until Plan 5 revises
        "sms_send":       20,
        "chat_message":   30,
        "section_regen":   5,
        "verdicts_regen":  3,
        "dayun_regen":    10,
        "liunian_regen":  10,
        "gua":            20,
    },
}
```

### 4.6 时区辅助

```python
# app/core/quotas.py
_BEIJING = ZoneInfo("Asia/Shanghai")

def _today_beijing() -> str:
    return datetime.now(tz=_BEIJING).strftime("%Y-%m-%d")

def _next_midnight_beijing() -> datetime:
    now = datetime.now(tz=_BEIJING)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

def _seconds_until_midnight() -> int:
    return int((_next_midnight_beijing() - datetime.now(tz=_BEIJING)).total_seconds())
```

---

## 5. Sessions + Crypto-Shredding

### 5.1 `GET /api/auth/sessions`

```python
[
  {
    "id": "uuid",
    "user_agent": "Mozilla/5.0 ...",
    "ip": "111.222.111.222",
    "created_at": "...",
    "last_seen_at": "...",
    "is_current": true
  },
  ...
]
```

Query: `SELECT * FROM sessions WHERE user_id = :uid AND expires_at > now() ORDER BY last_seen_at DESC`.
`is_current` 标记：session.id == request.state.session.id。

### 5.2 `DELETE /api/auth/sessions/:id`

```python
1. current_user
2. DELETE FROM sessions WHERE id = :sid AND user_id = :uid
   row_count == 0 → 404 SESSION_NOT_FOUND  (隐藏他人 session 的存在)
3. 若 :sid == request.state.session.id → 清 cookie（等同 logout）
4. 204 No Content
```

### 5.3 `DELETE /api/auth/account`（Crypto-shredding）

**Schema：**
```python
class AccountDeleteRequest(BaseModel):
    confirm: Literal["DELETE MY ACCOUNT"]
```

**Service 流程**（`services/auth.py::shred_account`，单事务）：

```
1. user = current_user
2. if req.confirm != "DELETE MY ACCOUNT" → 400 INVALID_CONFIRMATION
3. BEGIN tx
4. DELETE FROM sessions WHERE user_id = user.id
5. DELETE FROM sms_codes WHERE phone = user.phone
6. UPDATE users SET
     status = 'disabled',
     phone = NULL,
     phone_last4 = NULL,
     nickname = NULL,
     invited_by_user_id = NULL,
     wechat_openid = NULL,
     wechat_unionid = NULL,
     dek_ciphertext = NULL                     # ← THE shred
   WHERE id = user.id
7. COMMIT
8. Set-Cookie: session=; Max-Age=0
9. return {"shredded_at": <iso>}
```

**保留**：
- `users` 行本身（其他表 FK → users 是 RESTRICT）
- `charts` / `chart_cache` / `conversations` / `messages` 加密行（密文依然在 DB，但 DEK 已毁）
- `invite_codes.created_by` → 保留引用（用户发出的邀请码依然对他人有效）
- `quota_usage` / `llm_usage_logs` 审计记录（不含 PII）

**结果**：
- 用户可用同手机号重新注册（新 users 行、新 DEK、完全独立身份）
- DB backup 持有者 + KEK 持有者 + 攻击者 → 无法解出该用户的 charts/messages 明文

### 5.4 Migration `0002_user_fields_for_auth.py`

```python
def upgrade():
    op.add_column("users",
        sa.Column("agreed_to_terms_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("users", "dek_ciphertext", nullable=True)


def downgrade():
    op.alter_column("users", "dek_ciphertext", nullable=False)
    op.drop_column("users", "agreed_to_terms_at")
```

ORM 同步修改 `server/app/models/user.py`：
- 新增 `agreed_to_terms_at: Mapped[Optional[datetime]]`
- `dek_ciphertext: Mapped[Optional[bytes]]` (from non-optional)

---

## 6. 测试策略

### 6.1 新测试文件（10 个，~58 测试）

| 文件 | 覆盖 | 估计数 |
|---|---|---|
| `tests/unit/test_sms_provider.py` | factory 选择 + dev provider + aliyun NotImplementedError | 3 |
| `tests/unit/test_sms_service.py` | code hash / attempts burn / rate limit 边界 | 8 |
| `tests/unit/test_quota_ticket.py` | commit / rollback / race (double commit) | 6 |
| `tests/integration/test_auth_register.py` | 完整流 + invite 失效 + phone 冲突 + terms 缺 | 10 |
| `tests/integration/test_auth_login.py` | 完整 + disabled + 错 code + user 不存在 | 6 |
| `tests/integration/test_auth_logout.py` | logout + cookie 清 | 2 |
| `tests/integration/test_auth_me.py` | /me + rolling 续期 | 3 |
| `tests/integration/test_auth_account_delete.py` | shredding + confirm 字符串 + charts 不可读 | 5 |
| `tests/integration/test_auth_sessions.py` | list / revoke / 跨用户拒绝 | 5 |
| `tests/integration/test_auth_deps_real.py` | current_user / optional_user / require_admin / check_quota 全链路 | 10 |

### 6.2 关键集成测试：`test_crypto_shredding_via_api.py`

走端到端 HTTP：

1. `POST /api/auth/sms/send` → dev code 拿到
2. `POST /api/auth/register` 注册 user A，cookie 带上
3. 手动直连 DB 插入一条 chart（模拟 Plan 4 会做的写加密数据）
4. `DELETE /api/auth/account {"confirm": "DELETE MY ACCOUNT"}` → 200
5. 尝试再次请求（用同 cookie）→ 401 ACCOUNT_SHREDDED
6. 直连 DB 查 `users.dek_ciphertext` = NULL
7. 直连 DB 读 chart 的 bytea 列 → 依然有密文
8. 试着用 `generate_dek()` 随机 DEK 解 → InvalidTag

### 6.3 覆盖率目标

| 模块 | 目标 | 备注 |
|---|---|---|
| `app/sms/*` | 95%+ | aliyun.py 的 `NotImplementedError` 分支豁免统计 |
| `app/services/*` | 90%+ | business logic core |
| `app/api/*` | 85%+ | thin HTTP layer, covered by integration tests |
| `app/auth/deps.py` | 95%+ | contract critical |
| `app/schemas/auth.py` | 90%+ | validation edge cases |
| `app/core/quotas.py` | 90%+ | |

Plan 3 新增模块合并覆盖率 ≥ 85%，和 Plan 2 对齐。

### 6.4 CI 并行时间

Plan 2 49 测试跑 26s 并行。Plan 3 +58 测试 → 预计 45s 左右。CI 目标 < 60s。

---

## 7. 任务分解（预览）

| Phase | Tasks | 内容 |
|---|---|---|
| A | 3 | `schemas/auth.py` · `sms/` package (dev + aliyun skeleton) · provider factory |
| B | 3 | `services/sms.py` · Alembic migration 0002 + model update · rate-limit + verify 测试 |
| C | 5 | `services/session.py` · `services/auth.py` register/login/logout · `/api/auth/*` 5 端点 · 各自集成测试 |
| D | 2 | `DELETE /api/auth/account` (shred) + `/api/auth/sessions` CRUD + 测试 |
| E | 2 | `deps.py` 4 个真实实现 + `QuotaTicket` + `core/quotas.py` + 单测 |
| F | 2 | 端到端集成（`test_crypto_shredding_via_api.py`）+ ACCEPTANCE 更新 |
| **合计** | **17** | |

---

## 8. 验收硬门槛

- [ ] `uv run --package server pytest server/tests/ -n auto` 全绿，< 60s
- [ ] 源码覆盖率 ≥ 85%（`sms/aliyun.py` 的 NotImplementedError 分支豁免）
- [ ] `grep -c "raise NotImplementedError" server/app/auth/deps.py` == 0
- [ ] Alembic `upgrade head && downgrade base && upgrade head` 双向干净
- [ ] 注册 → 登录 → /me → /sessions → /logout 端到端 httpx 集成测试通过
- [ ] Crypto-shredding 端到端测试通过（API 层，不是纯函数）
- [ ] SMS rate limit 3 场景（冷却 / 小时 / 正常）全覆盖
- [ ] `users.phone` 不在任何 `/api/auth/*` 响应中出现（只 `phone_last4`）
- [ ] dev mode 下响应含 `__devCode`；prod mode（monkeypatch env）下绝对不含
- [ ] Aliyun provider 在测试中**永不**被调用（dev provider 强制）
- [ ] `wheel` 可装可跑（Plan 2 基线 + Plan 3 新模块一起打包）

---

## 9. 与其他 Plan 的衔接

**上游**：Plan 2 提供 FastAPI + DB + 加密 + auth/deps 骨架。合同：
- `auth/deps.py` 函数签名不变（实现替换）
- `User.dek_ciphertext` 允许 NULL（Plan 3 migration 放开）
- `EncryptedText` / `EncryptedJSONB` + `user_dek_context` 由 Plan 2 提供
- `load_kek` / `encrypt_dek` / `decrypt_dek` / `generate_dek` 由 Plan 2 提供

**下游**：
- Plan 4 (Charts CRUD + paipan 接入) 可以直接 `Depends(current_user)` 保护路由，`Depends(check_quota("chat_message"))` 扣配额
- Plan 5 (LLM / SSE) 利用 `QuotaTicket.commit() / rollback()` 管理 regen 配额
- Plan 6 (Frontend) 开始做注册 / 登录 UI
- Plan 7 (Deployment) 实装 aliyun provider + 申请 ICP

---

## 10. 风险与应对

| 风险 | 应对 |
|---|---|
| SMS 发送代价（若不慎切 aliyun）| Aliyun provider 仅在 `settings.aliyun_sms_access_key` 非 None 时实例化；测试 env 里永远 None；实施时单测显式断言 provider 是 `DevSmsProvider` |
| SMS code 泄露（日志 / response）| `_LOG_WHITELIST` 不含 code 键；dev 回显仅 env=dev；Plan 1 logging 层扫 non-whitelist 键 |
| Session token 被窃 | `HttpOnly + SameSite=Lax`；rolling 续期限在 `current_user` 内 only；`/api/auth/sessions` 提供撤销能力 |
| Crypto-shredding 不可逆却误操作 | `confirm` 字段必须字面量 `"DELETE MY ACCOUNT"`；响应提示用户可用同手机号重开 |
| QuotaTicket 双 commit | `_committed` flag；`commit` 方法检查后设 flag，重复 commit 抛错 |
| Invite code race（两用户同时 used_count++ 到 max） | `UPDATE invite_codes WHERE used_count < max_uses`；returning 0 行 → 抛 INVITE_CODE_RACE_LOST；前端提示重试 |
| Phone 同号重新注册时 phone_hash 冲突 | `phone_hash` 仅 C 阶段启用；Plan 3 phone 明文 `UNIQUE` 约束，shred 时 phone=NULL 解除 unique，允许重注册 |
| DEK 解密慢（若 contextvar 每请求调一次）| AES-GCM 32B key 解密 < 1μs；不是瓶颈 |

---

## 11. 实施约束

- 不引入新依赖（除 spec 明确列出的）
- 不添加 charts / conversations / LLM 代码
- 不动 `paipan/` 包
- 不碰前端
- 每 task 必须 commit + `uv run pytest` 绿
- 遵循 Plan 1/2 的 `# NOTE:` 注释纪律（标注 spec 来源）
- Migration 文件 **单一 revision** `0002_user_fields_for_auth`——不拆多条
