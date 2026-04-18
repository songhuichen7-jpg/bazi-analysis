# Conversation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Plan 6 — conversation layer on top of Plan 5 chart-LLM foundation: 7 new server routes (conversations CRUD + messages pagination + chat SSE router→expert + gua SSE), chips wired to use real history, and frontend `Chat.jsx`/`ConversationSwitcher.jsx` switched to the new endpoints (UI/CSS frozen).

**Architecture:** Reuse Plan 5 SSE infrastructure (`chat_stream_with_fallback`, `replay_cached`, `retrieve_for_chart`, `QuotaTicket`, `EncryptedText/JSONB`). Add `app/services/{conversation,message,chat_router,conversation_chat,conversation_gua,gua_cast}.py` + `app/prompts/{router,expert,gua}.py` + `app/api/conversations.py`. CTA messages persist with `role='cta'` (schema already supports it); divination redirect inserts a CTA row, "起一卦" or "用命盘直接分析" consumes it via DELETE-on-action. Frontend persists `currentConversationId` in sessionStorage; all chat data is server-of-truth, ephemeral in store.

**Tech Stack:** Same as Plan 5 — Python 3.12 · FastAPI · SQLAlchemy 2.0 async · pytest + testcontainers. New: `lunar-python` 1.4.8 (already installed via paipan dep) for gua timing-cast. Frontend: React + Zustand (existing).

---

## 设计约束（每 task 必须遵守）

1. **TDD 红→绿→提交**：每个 step 单独可验证；每个 task 末尾 commit + 全绿
2. **Plan 2-5 不动**：`auth/*`、`chart.py` CRUD、`paipan_adapter`、`models/*`、`alembic/*`、`llm/*`、`retrieval/*`、`prompts/{verdicts,sections,dayun_step,liunian,context,anchor,loader}.py` 一行不改
3. **Schema 零改动**：`Conversation` + `Message` + `role` enum 已在 Plan 4 迁移 0002 落定；本 plan 不出新迁移
4. **owner 校验首件事**：每个 conversation/message/gua 路由先 `_get_owned_conversation` 或 `_get_owned_chart`，跨用户/不存在/软删一律 404 防枚举
5. **所有 4xx 在 StreamingResponse 之前 raise**：SSE 一旦 200 就只能走 in-band error event
6. **commit-before-done**：chat/gua SSE 在 emit `done` 前 commit ticket；race → emit error 代替 done+error；与 chart_llm 一致
7. **端口纪律**：从 `archive/server-mvp/{prompts,server,gua}.js` 移植时每函数附 `# NOTE: <file>.js:<line-range>` 注释；中文 prompt 文本逐字符照抄
8. **MVP 旧路由不再恢复**：Plan 4 已删 `/api/chat`、`/api/gua`、`/api/chips`（旧 shape）；本 plan 只新增
9. **frontend UI 冻结**：JSX 结构 + className + index.css 一行不改；只换 `lib/api.js` + `store/useAppStore.js` + 组件内的 `useEffect`/handler

## 目录最终形态

```
server/
├── app/
│   ├── data/zhouyi/
│   │   └── gua64.json                 # NEW: copy from archive/server-mvp/data/zhouyi/
│   ├── prompts/
│   │   ├── router.py                  # NEW
│   │   ├── expert.py                  # NEW
│   │   └── gua.py                     # NEW
│   ├── services/
│   │   ├── conversation.py            # NEW: CRUD + soft-delete/restore
│   │   ├── message.py                 # NEW: insert + keyset paginate
│   │   ├── chat_router.py             # NEW: Stage 1 (keyword + LLM)
│   │   ├── conversation_chat.py       # NEW: Stage 1+2 orchestrator + SSE
│   │   ├── conversation_gua.py        # NEW: gua SSE generator
│   │   ├── gua_cast.py                # NEW: 梅花易数 pure cast
│   │   ├── chart_chips.py             # MODIFY: accept conversation_id, load history
│   │   └── exceptions.py              # MODIFY: +ConversationGoneError
│   ├── schemas/
│   │   ├── conversation.py            # NEW
│   │   ├── message.py                 # NEW
│   │   ├── chat.py                    # NEW (request body)
│   │   └── gua.py                     # NEW (request body + gua dict shape)
│   ├── api/
│   │   ├── conversations.py           # NEW: 7 routes (list/create/get/patch/del/restore + messages + gua)
│   │   └── charts.py                  # MODIFY: chips_endpoint accepts ?conversation_id=
│   └── main.py                        # MODIFY: include conversations_router
├── tests/
│   ├── unit/
│   │   ├── test_gua_cast.py                    # NEW
│   │   ├── test_prompts_router.py              # NEW
│   │   ├── test_prompts_expert.py              # NEW
│   │   ├── test_prompts_gua.py                 # NEW
│   │   ├── test_services_conversation.py       # NEW
│   │   ├── test_services_message.py            # NEW
│   │   ├── test_services_chat_router.py        # NEW
│   │   └── test_chart_chips_history.py         # NEW (modify variant)
│   └── integration/
│       ├── test_conversations_crud.py          # NEW
│       ├── test_conversations_ownership.py     # NEW
│       ├── test_conversations_soft_delete.py   # NEW
│       ├── test_messages_pagination.py         # NEW
│       ├── test_chat_sse_happy.py              # NEW
│       ├── test_chat_sse_divination.py         # NEW (redirect + bypass-consume)
│       ├── test_chat_sse_quota.py              # NEW (429 + race)
│       ├── test_chat_sse_llm_error.py          # NEW
│       ├── test_gua_sse_happy.py               # NEW
│       ├── test_gua_sse_consume_cta.py         # NEW
│       ├── test_gua_sse_quota.py               # NEW
│       └── test_chips_history.py               # NEW (?conversation_id wiring)
└── ACCEPTANCE.md                                # MODIFY: append Plan 6 section

frontend/
├── src/
│   ├── lib/
│   │   └── api.js                      # MODIFY: +9 functions
│   ├── store/
│   │   └── useAppStore.js              # MODIFY: drop chat persist; add lazy-load actions
│   └── components/
│       ├── Chat.jsx                    # MODIFY: repoint streamSSE calls
│       └── ConversationSwitcher.jsx    # MODIFY: server-action hooks
├── tests/
│   ├── lib/api.test.js                 # MODIFY: +new function mocks
│   ├── store/useAppStore.test.js       # MODIFY: lazy-load + consumeCta
│   ├── Chat.test.jsx                   # MODIFY: server-mock layer
│   └── ConversationSwitcher.test.jsx   # MODIFY: server-mock layer
└── README.md                            # MODIFY: +1-line release note about localStorage drop
```

## Task 列表预览

- **Task 1** — Schemas: conversation/message/chat/gua Pydantic models + `ConversationGoneError`
- **Task 2** — `gua_cast.py` pure function + `gua64.json` copy + unit tests
- **Task 3** — `prompts/router.py` + unit tests
- **Task 4** — `prompts/expert.py` (chart slice + intent guide + builder) + unit tests
- **Task 5** — `prompts/gua.py` + unit tests
- **Task 6** — `services/conversation.py` + `services/message.py` + unit tests
- **Task 7** — `services/chat_router.py` Stage-1 + `services/conversation_chat.py` orchestrator + unit tests
- **Task 8** — `services/conversation_gua.py` + chart_chips history wiring + unit tests
- **Task 9** — `api/conversations.py` 7 routes + main.py wire + chips_endpoint extension + integration tests for CRUD/ownership/soft-delete/pagination
- **Task 10** — Integration tests: chat SSE happy / divination / quota / LLM error
- **Task 11** — Integration tests: gua SSE happy / consume-cta / quota + chips history
- **Task 12** — Frontend: `lib/api.js` + `store/useAppStore.js` + tests
- **Task 13** — Frontend: `Chat.jsx` + `ConversationSwitcher.jsx` + localStorage cleanup + tests
- **Task 14** — `ACCEPTANCE.md` Plan 6 section + wheel smoke + README release note

---

## Task 1: Schemas + ConversationGoneError

**Files:**
- Create: `server/app/schemas/conversation.py`
- Create: `server/app/schemas/message.py`
- Create: `server/app/schemas/chat.py`
- Create: `server/app/schemas/gua.py`
- Modify: `server/app/services/exceptions.py` (+ `ConversationGoneError`)
- Test: `server/tests/unit/test_schemas_conversation.py`

- [ ] **Step 1.1: Write failing schema tests**

Create `server/tests/unit/test_schemas_conversation.py`:

```python
"""Plan 6: conversation/message/chat/gua schema validation."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.conversation import (
    ConversationCreateRequest,
    ConversationDetail,
    ConversationListResponse,
    ConversationPatchRequest,
)
from app.schemas.message import MessageDetail, MessagesListResponse
from app.schemas.chat import ChatMessageRequest
from app.schemas.gua import GuaCastRequest


def test_conversation_create_label_optional():
    body = ConversationCreateRequest()
    assert body.label is None
    body2 = ConversationCreateRequest(label="工作")
    assert body2.label == "工作"


def test_conversation_patch_label_required_nonempty():
    with pytest.raises(ValidationError):
        ConversationPatchRequest()
    with pytest.raises(ValidationError):
        ConversationPatchRequest(label="")
    with pytest.raises(ValidationError):
        ConversationPatchRequest(label="   ")
    body = ConversationPatchRequest(label="感情")
    assert body.label == "感情"


def test_conversation_detail_shape():
    now = datetime.now(tz=timezone.utc)
    d = ConversationDetail(
        id=uuid4(), label="对话 1", position=0,
        created_at=now, updated_at=now,
        last_message_at=None, message_count=0,
        deleted_at=None,
    )
    j = d.model_dump(mode="json")
    assert set(j.keys()) >= {
        "id", "label", "position", "created_at", "updated_at",
        "last_message_at", "message_count", "deleted_at",
    }


def test_message_detail_role_enum_validates():
    now = datetime.now(tz=timezone.utc)
    for role in ("user", "assistant", "gua", "cta"):
        m = MessageDetail(id=uuid4(), role=role, content=None, meta=None, created_at=now)
        assert m.role == role
    with pytest.raises(ValidationError):
        MessageDetail(id=uuid4(), role="system", content=None, meta=None, created_at=now)


def test_messages_list_cursor_can_be_null():
    r = MessagesListResponse(items=[], next_cursor=None)
    assert r.next_cursor is None


def test_chat_message_request_strips_and_rejects_empty():
    body = ChatMessageRequest(message=" hello ")
    assert body.message == "hello"
    assert body.bypass_divination is False
    body2 = ChatMessageRequest(message="x", bypass_divination=True)
    assert body2.bypass_divination is True
    with pytest.raises(ValidationError):
        ChatMessageRequest(message="")
    with pytest.raises(ValidationError):
        ChatMessageRequest(message="   ")


def test_gua_cast_request_rejects_empty_question():
    body = GuaCastRequest(question="该不该换工作")
    assert body.question == "该不该换工作"
    with pytest.raises(ValidationError):
        GuaCastRequest(question="")
    with pytest.raises(ValidationError):
        GuaCastRequest(question="   ")
```

- [ ] **Step 1.2: Run tests — confirm RED**

Run: `uv run --package server pytest server/tests/unit/test_schemas_conversation.py -v`
Expected: collection errors / ImportError (modules don't exist).

- [ ] **Step 1.3: Create `server/app/schemas/conversation.py`**

```python
"""Plan 6: conversation request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ConversationCreateRequest(BaseModel):
    label: Optional[str] = None

    @field_validator("label")
    @classmethod
    def _strip_optional(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = v.strip()
        return s or None


class ConversationPatchRequest(BaseModel):
    label: str = Field(min_length=1)

    @field_validator("label")
    @classmethod
    def _must_be_nonblank(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("label must not be blank")
        return s


class ConversationDetail(BaseModel):
    id: UUID
    label: Optional[str]
    position: int
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime]
    message_count: int
    deleted_at: Optional[datetime]


class ConversationListResponse(BaseModel):
    items: list[ConversationDetail]
```

- [ ] **Step 1.4: Create `server/app/schemas/message.py`**

```python
"""Plan 6: message item + paginated list."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel

MessageRole = Literal["user", "assistant", "gua", "cta"]


class MessageDetail(BaseModel):
    id: UUID
    role: MessageRole
    content: Optional[str]
    meta: Optional[dict[str, Any]]
    created_at: datetime


class MessagesListResponse(BaseModel):
    items: list[MessageDetail]
    next_cursor: Optional[UUID]
```

- [ ] **Step 1.5: Create `server/app/schemas/chat.py`**

```python
"""Plan 6: POST /api/conversations/:id/messages request body."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1)
    bypass_divination: bool = False

    @field_validator("message")
    @classmethod
    def _strip(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("message must not be blank")
        return s
```

- [ ] **Step 1.6: Create `server/app/schemas/gua.py`**

```python
"""Plan 6: POST /api/conversations/:id/gua request body."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class GuaCastRequest(BaseModel):
    question: str = Field(min_length=1)

    @field_validator("question")
    @classmethod
    def _strip(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("question must not be blank")
        return s
```

- [ ] **Step 1.7: Add `ConversationGoneError` to `server/app/services/exceptions.py`**

Read the file first to find the existing pattern (other ServiceError subclasses live there). Append:

```python
class ConversationGoneError(ServiceError):
    """Soft-deleted conversation outside the 30-day restore window."""
    status = 410
    code = "GONE"

    def __init__(self, message: str = "已超过 30 天恢复期"):
        super().__init__(message=message)
```

(Match the pattern of existing ServiceError subclasses — the status/code attribute style and `__init__` signature MUST match what `_http_error` expects in `api/charts.py`. Read at least one existing subclass first to confirm the shape.)

- [ ] **Step 1.8: Run tests — confirm GREEN**

Run: `uv run --package server pytest server/tests/unit/test_schemas_conversation.py -v`
Expected: 7 passed.

- [ ] **Step 1.9: Commit**

```bash
git add server/app/schemas/conversation.py server/app/schemas/message.py \
        server/app/schemas/chat.py server/app/schemas/gua.py \
        server/app/services/exceptions.py \
        server/tests/unit/test_schemas_conversation.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 schemas + ConversationGoneError

Adds Pydantic request/response models for conversations, messages,
chat, gua. Adds 410 GONE error class for soft-delete restore window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: gua_cast pure function + gua64.json data file

**Files:**
- Create: `server/app/data/zhouyi/gua64.json` (copy from `archive/server-mvp/data/zhouyi/gua64.json`)
- Create: `server/app/services/gua_cast.py`
- Test: `server/tests/unit/test_gua_cast.py`

- [ ] **Step 2.1: Verify `lunar-python` is installed**

Run: `uv pip list | grep -i lunar`
Expected: `lunar-python  1.4.8`

If missing: add `lunar-python>=1.4.8` to `server/pyproject.toml` `dependencies` and `uv sync --extra dev`. (Already a transitive dep of `paipan` in this repo, so usually present.)

- [ ] **Step 2.2: Copy `gua64.json`**

```bash
mkdir -p server/app/data/zhouyi
cp archive/server-mvp/data/zhouyi/gua64.json server/app/data/zhouyi/gua64.json
ls -lh server/app/data/zhouyi/gua64.json
head -20 server/app/data/zhouyi/gua64.json
```

Confirm 64 entries by:
```bash
uv run --package server python -c "import json; d=json.load(open('server/app/data/zhouyi/gua64.json')); print(len(d), d[0].keys())"
```
Expected: `64 dict_keys(['id', 'name', 'symbol', 'upper', 'lower', 'guaci', 'daxiang'])` (verify the exact key set; if archive uses different names, take the archive shape verbatim and adjust the cast function accordingly).

- [ ] **Step 2.3: Write failing test**

Create `server/tests/unit/test_gua_cast.py`:

```python
"""gua_cast: 梅花易数·时间起卦 pure function. NOTE: archive/server-mvp/gua.js."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.services.gua_cast import cast_gua, GUA64, _hour_to_zhi_index, _mod


def test_gua64_loaded_with_64_entries():
    assert len(GUA64) == 64
    first = GUA64[0]
    for k in ("id", "name", "symbol", "upper", "lower", "guaci", "daxiang"):
        assert k in first


@pytest.mark.parametrize("h,expected", [
    (0, 1), (23, 1),    # 子时跨日
    (1, 2), (2, 2),     # 丑
    (3, 3), (4, 3),     # 寅
    (11, 7), (12, 7),   # 午
    (21, 12), (22, 12), # 亥
])
def test_hour_to_zhi_index(h, expected):
    assert _hour_to_zhi_index(h) == expected


def test_mod_returns_in_range():
    assert _mod(8, 8) == 8
    assert _mod(9, 8) == 1
    assert _mod(0, 8) == 8


def test_cast_gua_deterministic_for_fixed_timestamp():
    """Same input → same output (algorithm is pure)."""
    at = datetime(2026, 4, 18, 14, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
    g1 = cast_gua(at)
    g2 = cast_gua(at)
    assert g1 == g2


def test_cast_gua_returns_required_keys():
    at = datetime(2026, 4, 18, 14, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
    g = cast_gua(at)
    for k in ("id", "name", "symbol", "upper", "lower", "guaci", "daxiang",
              "dongyao", "drawn_at", "source"):
        assert k in g
    assert 1 <= g["dongyao"] <= 6
    assert g["upper"] in {"乾", "兑", "离", "震", "巽", "坎", "艮", "坤"}
    assert g["lower"] in {"乾", "兑", "离", "震", "巽", "坎", "艮", "坤"}
    src = g["source"]
    assert {"yearGz", "yearZhi", "lunarMonth", "lunarDay", "hourZhiIdx",
            "sumUpper", "sumLower", "formula"}.issubset(src.keys())


def test_cast_gua_zi_hour_crosses_midnight():
    """23:00 should be 子 (idx=1) just like 00:00 — both produce dongyao based on hourZhiIdx=1."""
    at_2300 = datetime(2026, 4, 18, 23, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    g = cast_gua(at_2300)
    assert g["source"]["hourZhiIdx"] == 1
```

- [ ] **Step 2.4: Run — confirm RED**

Run: `uv run --package server pytest server/tests/unit/test_gua_cast.py -v`
Expected: ImportError (`app.services.gua_cast` not found).

- [ ] **Step 2.5: Create `server/app/services/gua_cast.py`**

```python
"""梅花易数·时间起卦 — pure function port of archive/server-mvp/gua.js.

Given a timestamp, returns the cast hexagram + 动爻 + provenance source.
Deterministic; no IO besides reading gua64.json once at module load.
"""
from __future__ import annotations

import json
from datetime import datetime
from importlib.resources import files
from typing import Any

from lunar_python import Solar

# NOTE: gua.js:14 — 八卦序：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8
TRIGRAM_NAMES = ["乾", "兑", "离", "震", "巽", "坎", "艮", "坤"]

# NOTE: gua.js:30 — 地支序：子1, 丑2, ..., 亥12
ZHI_INDEX = {
    "子": 1, "丑": 2, "寅": 3, "卯": 4, "辰": 5, "巳": 6,
    "午": 7, "未": 8, "申": 9, "酉": 10, "戌": 11, "亥": 12,
}


def _load_gua64() -> list[dict[str, Any]]:
    data_path = files("app.data.zhouyi").joinpath("gua64.json")
    return json.loads(data_path.read_text(encoding="utf-8"))


GUA64: list[dict[str, Any]] = _load_gua64()


# NOTE: gua.js:18-26 — combo index keyed by upperIdx*10+lowerIdx → gua.id
def _build_combo_index() -> dict[int, int]:
    m: dict[int, int] = {}
    for g in GUA64:
        u = TRIGRAM_NAMES.index(g["upper"]) + 1 if g.get("upper") in TRIGRAM_NAMES else 0
        l = TRIGRAM_NAMES.index(g["lower"]) + 1 if g.get("lower") in TRIGRAM_NAMES else 0
        if u > 0 and l > 0:
            m[u * 10 + l] = g["id"]
    return m


COMBO_INDEX: dict[int, int] = _build_combo_index()


def _hour_to_zhi_index(hour: int) -> int:
    """NOTE: gua.js:33-37 — 子时跨日：23点也算子时."""
    if hour == 23 or hour == 0:
        return 1
    return (hour + 1) // 2 + 1


def _mod(n: int, m: int) -> int:
    """NOTE: gua.js:40-43 — 1..m mapping (0 → m)."""
    r = n % m
    return m if r == 0 else r


def cast_gua(at: datetime) -> dict[str, Any]:
    """Cast a hexagram for the given moment.

    NOTE: gua.js:50-100. Returns dict matching the JS shape; see test for keys.
    """
    solar = Solar.fromYmdHms(
        at.year, at.month, at.day,
        at.hour, at.minute, at.second,
    )
    lunar = solar.getLunar()

    year_gz = lunar.getYearInGanZhi()           # e.g. "丙午"
    year_zhi = year_gz[1]
    year_zhi_idx = ZHI_INDEX.get(year_zhi, 1)

    lunar_month = abs(lunar.getMonth())          # 闰月暂按本月
    lunar_day = lunar.getDay()
    hour_zhi_idx = _hour_to_zhi_index(at.hour)

    sum_upper = year_zhi_idx + lunar_month + lunar_day
    sum_lower = sum_upper + hour_zhi_idx
    upper_idx = _mod(sum_upper, 8)
    lower_idx = _mod(sum_lower, 8)
    dongyao = _mod(sum_lower, 6)

    gua_id = COMBO_INDEX.get(upper_idx * 10 + lower_idx)
    if gua_id is None:
        raise RuntimeError(f"gua lookup failed: upper={upper_idx} lower={lower_idx}")
    gua = next(g for g in GUA64 if g["id"] == gua_id)

    upper_name = TRIGRAM_NAMES[upper_idx - 1]
    lower_name = TRIGRAM_NAMES[lower_idx - 1]
    formula = (
        f"上卦 ({year_zhi_idx}+{lunar_month}+{lunar_day})mod8 = {upper_idx} {upper_name} / "
        f"下卦 ({sum_upper}+{hour_zhi_idx})mod8 = {lower_idx} {lower_name} / "
        f"动爻 mod6 = {dongyao}"
    )

    return {
        "id": gua["id"],
        "name": gua["name"],
        "symbol": gua["symbol"],
        "upper": gua["upper"],
        "lower": gua["lower"],
        "guaci": gua["guaci"],
        "daxiang": gua["daxiang"],
        "dongyao": dongyao,
        "drawn_at": solar.toYmdHms(),
        "source": {
            "yearGz": year_gz,
            "yearZhi": year_zhi,
            "yearZhiIdx": year_zhi_idx,
            "lunarMonth": lunar_month,
            "lunarDay": lunar_day,
            "hourZhiIdx": hour_zhi_idx,
            "sumUpper": sum_upper,
            "sumLower": sum_lower,
            "formula": formula,
        },
    }
```

- [ ] **Step 2.6: Make `app/data/zhouyi` importable**

Create empty `__init__.py` files so `importlib.resources` can find the JSON:

```bash
touch server/app/data/__init__.py server/app/data/zhouyi/__init__.py
```

Verify hatch picks them up: confirm the `[tool.hatch.build.targets.wheel]` section in `server/pyproject.toml` includes `app` (it does by default for src layout). If it uses an explicit `packages` list, ensure `app/data` is covered. Check by:

```bash
grep -n "tool.hatch\|packages\|include" server/pyproject.toml
```

If JSON is excluded by default, add:
```toml
[tool.hatch.build.targets.wheel.force-include]
"app/data/zhouyi/gua64.json" = "app/data/zhouyi/gua64.json"
```

- [ ] **Step 2.7: Run — confirm GREEN**

Run: `uv run --package server pytest server/tests/unit/test_gua_cast.py -v`
Expected: 8 passed.

- [ ] **Step 2.8: Commit**

```bash
git add server/app/data server/app/services/gua_cast.py \
        server/tests/unit/test_gua_cast.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 gua_cast pure function + gua64.json

Ports archive/server-mvp/gua.js (梅花易数·时间起卦) to Python with
lunar-python. Pure function, deterministic given timestamp; data
file copied verbatim from MVP archive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: prompts/router.py (Stage 1 keyword + LLM classifier prompt)

**Files:**
- Create: `server/app/prompts/router.py`
- Test: `server/tests/unit/test_prompts_router.py`

- [ ] **Step 3.1: Write failing test**

Create `server/tests/unit/test_prompts_router.py`:

```python
"""prompts/router: keyword fast-path + LLM router prompt + JSON parser.

NOTE: archive/server-mvp/prompts.js:367-466.
"""
from __future__ import annotations

import pytest

from app.prompts.router import (
    INTENTS,
    KEYWORDS,
    PRIORITY,
    build_messages,
    classify_by_keywords,
    parse_router_json,
)


def test_intents_list_complete():
    expected = {
        "relationship", "career", "wealth", "timing",
        "personality", "health", "meta", "chitchat", "other",
        "dayun_step", "liunian", "appearance", "special_geju",
        "divination",
    }
    assert set(INTENTS) == expected


@pytest.mark.parametrize("text,expected_intent", [
    ("我下周该不该跳槽", "divination"),
    ("今年运气怎么样", "timing"),
    ("我和老公感情", "relationship"),
    ("我长得帅吗", "appearance"),
    ("我适合创业吗", "divination"),     # "适合吗" 命中 divination
    ("飞天禄马是什么", "special_geju"),
    ("七杀是啥意思", "meta"),
    ("我这个人是不是太敏感", "personality"),
    ("最近压力大失眠", "health"),
])
def test_classify_by_keywords_priority(text, expected_intent):
    r = classify_by_keywords(text)
    assert r is not None
    assert r["intent"] == expected_intent
    assert r["source"] == "keyword"
    assert r["reason"].startswith("kw:")


def test_classify_by_keywords_chitchat_only_when_short():
    """chitchat 仅在消息 ≤ 8 字时命中，避免长问题被吞."""
    assert classify_by_keywords("你好") is not None
    assert classify_by_keywords("你好").get("intent") == "chitchat"
    long_msg = "你好我想问问我的事业方向"
    r = classify_by_keywords(long_msg)
    assert r is None or r["intent"] != "chitchat"


def test_classify_by_keywords_no_match_returns_none():
    assert classify_by_keywords("ahsdjkfhakjsdf 无关词") is None


def test_build_messages_includes_recent_history_max_4():
    history = [
        {"role": "user", "content": f"问题{i}"} for i in range(10)
    ]
    msgs = build_messages(history=history, user_message="新问题")
    # 1 system + ≤4 history + 1 user
    assert msgs[0]["role"] == "system"
    assert msgs[-1] == {"role": "user", "content": "新问题"}
    history_msgs = msgs[1:-1]
    assert len(history_msgs) <= 4


def test_parse_router_json_happy():
    raw = '{"intent": "career", "reason": "用户在问跳槽"}'
    r = parse_router_json(raw)
    assert r == {"intent": "career", "reason": "用户在问跳槽"}


def test_parse_router_json_with_codeblock_fence():
    raw = '```json\n{"intent": "wealth", "reason": "财运"}\n```'
    r = parse_router_json(raw)
    assert r["intent"] == "wealth"


def test_parse_router_json_invalid_intent_falls_back_other():
    raw = '{"intent": "nonsense", "reason": "?"}'
    r = parse_router_json(raw)
    assert r["intent"] == "other"


def test_parse_router_json_garbage_falls_back_other():
    assert parse_router_json("总之我觉得是事业问题")["intent"] == "other"
    assert parse_router_json("")["intent"] == "other"
    assert parse_router_json(None)["intent"] == "other"


def test_priority_divination_before_timing():
    """问'今年这事能不能成' — 同时含 timing+divination kw, divination 优先."""
    r = classify_by_keywords("今年这事能不能成")
    assert r is not None
    assert r["intent"] == "divination"
```

- [ ] **Step 3.2: Run — confirm RED**

Run: `uv run --package server pytest server/tests/unit/test_prompts_router.py -v`
Expected: ImportError.

- [ ] **Step 3.3: Create `server/app/prompts/router.py`**

Verbatim port of `archive/server-mvp/prompts.js:367-466`. Each Python constant matches its JS source 1:1 (Chinese keyword strings byte-identical).

```python
"""Stage 1 router: keyword fast-path + LLM intent classifier.

NOTE: archive/server-mvp/prompts.js:367-466 — KEYWORDS, PRIORITY,
classifyByKeywords, buildRouterMessages, parseRouterJSON.
"""
from __future__ import annotations

import json
import re
from typing import Optional

# NOTE: prompts.js:367-373
INTENTS: list[str] = [
    "relationship", "career", "wealth", "timing",
    "personality", "health", "meta", "chitchat", "other",
    "dayun_step", "liunian",
    "appearance", "special_geju",
    "divination",
]

# NOTE: prompts.js:375-387 — keyword sets (order within list does not matter)
KEYWORDS: dict[str, list[str]] = {
    "divination":   ['起卦','占卜','卦象','该不该','能不能','测一下','求一卦','占一下','问卦','吉凶','宜不宜','起一卦','要不要','合适吗','值不值','会成吗','可以吗','好不好'],
    "timing":       ['今年','明年','后年','大运','流年','这几年','最近几年','下半年','上半年','几岁','什么时候','何时','哪一年','近几年'],
    "relationship": ['感情','恋爱','爱情','对象','正缘','姻缘','婚姻','结婚','离婚','老公','老婆','配偶','男朋友','女朋友','暗恋','分手','复合','桃花'],
    "appearance":   ['长相','外貌','相貌','颜值','好看','好不好看','丑','帅','漂亮','胖瘦','身材','高矮','皮肤','脸型','五官','长得'],
    "career":       ['事业','工作','职业','跳槽','换工作','转行','创业','辞职','升职','老板','同事','上司','行业','方向','发展'],
    "wealth":       ['财运','钱','收入','投资','理财','副业','赚钱','亏钱','破财','存款','房产','买房'],
    "health":       ['身体','健康','生病','失眠','焦虑','抑郁','情绪','养生','压力大','累'],
    "special_geju": ['特殊格局','飞天禄马','倒冲','井栏叉','朝阳格','六乙鼠贵','六阴朝阳','金神格','魁罡','日刃','从格','化格','专旺','曲直'],
    "meta":         ['七杀','正官','正财','偏财','食神','伤官','正印','偏印','比肩','劫财','格局','用神','日主','十神','什么意思','怎么理解','是什么'],
    "personality":  ['性格','脾气','我这个人','我是不是','我是不是太','自我','待自己'],
    "chitchat":     ['你好','您好','hi','hello','谢谢','多谢','辛苦了','感谢','再见'],
}

# NOTE: prompts.js:391 — divination must come before timing/relationship
PRIORITY: list[str] = [
    "divination", "timing", "relationship", "appearance",
    "career", "wealth", "health", "special_geju",
    "meta", "personality", "chitchat",
]


def classify_by_keywords(user_message: Optional[str]) -> Optional[dict]:
    """Return {intent, reason, source} on hit; None on miss.

    NOTE: prompts.js:393-412.
    """
    if not user_message:
        return None
    text = str(user_message).lower()
    for intent in PRIORITY:
        if intent == "chitchat":
            continue
        for kw in KEYWORDS[intent]:
            if kw.lower() in text:
                return {"intent": intent, "reason": "kw:" + kw, "source": "keyword"}
    if len(str(user_message).strip()) <= 8:
        for kw in KEYWORDS["chitchat"]:
            if kw.lower() in text:
                return {"intent": "chitchat", "reason": "kw:" + kw, "source": "keyword"}
    return None


# NOTE: prompts.js:414-449 — verbatim Chinese system prompt
_SYSTEM_LINES = [
    '你是一个意图分类器。读用户最近几轮对话和当前消息，输出一个 JSON：',
    '{"intent": "<one of the list>", "reason": "<一句不超 20 字的判断依据>"}',
    '',
    '可选 intent（严格从中选一个）：',
    '- relationship  关系、感情、正缘、婚姻、配偶、亲密关系、家人',
    '- appearance    外貌、长相、相貌、身材、五官（自身或配偶）',
    '- special_geju  问到具体的特殊格局：飞天禄马、倒冲、六阴朝阳、魁罡、金神、日刃、从格、化格 等',
    '- career        事业、工作、方向、转行、创业、辞职、读书深造',
    '- wealth        财运、投资、副业、赚钱、破财',
    '- timing        大运、流年、今年、明年、某个具体岁数、时机',
    '- personality   自我性格、内在特质、如何看待自己',
    '- health        身体、情绪、睡眠、养生',
    '- meta          对命理概念本身的提问（如"什么是七杀"、"我的格局是什么意思"）',
    '- divination    用户在问一件具体的事"该不该/要不要/能不能/合不合适"——这类是非决策题，适合用起卦辅助，不适合直接用命盘分析回答',
    '- chitchat      打招呼、致谢、闲聊、测试',
    '- other         以上都不贴切的兜底',
    '',
    '规则：',
    '- 有上下文时按上下文判断（如上一轮在聊工作、这轮"那今年呢" → timing）',
    '- 只输出 JSON，第一个字符必须是 "{"，不要前言、不要 ```json 围栏',
    '- reason 用中文，一句话',
]


def build_messages(history: list[dict], user_message: str) -> list[dict]:
    """Build router LLM messages: system + last 4 history + user.

    NOTE: prompts.js:414-449.
    """
    sys = "\n".join(_SYSTEM_LINES)
    hist = [
        {"role": h["role"], "content": str(h.get("content") or "")[:300]}
        for h in (history or [])[-4:]
    ]
    return [{"role": "system", "content": sys}, *hist, {"role": "user", "content": user_message}]


def parse_router_json(raw: Optional[str]) -> dict:
    """Defensive parser. Returns {intent, reason}; falls back to 'other' on any failure.

    NOTE: prompts.js:451-466.
    """
    if not raw:
        return {"intent": "other", "reason": "empty_response"}
    s = str(raw).strip()
    # Try direct JSON first
    try:
        j = json.loads(s)
        if isinstance(j, dict) and j.get("intent") in INTENTS:
            return {"intent": j["intent"], "reason": str(j.get("reason") or "")}
    except (ValueError, TypeError):
        pass
    # Fall back to regex extract first {...} block
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        try:
            j = json.loads(m.group(0))
            if isinstance(j, dict) and j.get("intent") in INTENTS:
                return {"intent": j["intent"], "reason": str(j.get("reason") or "")}
        except (ValueError, TypeError):
            pass
    return {"intent": "other", "reason": "parse_failed"}
```

- [ ] **Step 3.4: Run — confirm GREEN**

Run: `uv run --package server pytest server/tests/unit/test_prompts_router.py -v`
Expected: 13 passed (parametrize counts toward total).

- [ ] **Step 3.5: Commit**

```bash
git add server/app/prompts/router.py server/tests/unit/test_prompts_router.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 prompts/router (Stage 1 intent classifier)

Ports archive/server-mvp/prompts.js Stage-1 router: keyword fast-path
with PRIORITY ordering (divination first), LLM-fallback prompt builder,
and defensive JSON parser. Chinese strings byte-identical to MVP.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: prompts/expert.py (Stage 2 — chart slice + intent guide + builder)

**Files:**
- Create: `server/app/prompts/expert.py`
- Test: `server/tests/unit/test_prompts_expert.py`

This task ports `archive/server-mvp/prompts.js:472-656` — the expert message
builder used by Stage 2 chat. It depends on `app.prompts.{loader,context,anchor}`
from Plan 5 (already in place).

- [ ] **Step 4.1: Read existing infra to understand interfaces**

Read `server/app/prompts/loader.py`, `context.py`, `anchor.py` first — note:
- `loader.load_shards_for(intent: str) -> str` returns concatenated shards (core + intent)
- `context.compact_chart_context(paipan: dict) -> str` returns the 【用户命盘】 block
- `anchor.build_classical_anchor(retrieved: list, terse: bool) -> str` returns 【挂出的古籍判词】 block

If any signature differs from the names above, adapt the calls in expert.py
accordingly (do NOT modify those modules).

- [ ] **Step 4.2: Write failing tests**

Create `server/tests/unit/test_prompts_expert.py`:

```python
"""prompts/expert: chart slice + INTENT_GUIDE + build_messages.

NOTE: archive/server-mvp/prompts.js:472-656.
"""
from __future__ import annotations

import pytest

from app.prompts.expert import (
    FALLBACK_STYLE,
    INTENT_GUIDE,
    build_messages,
    pick_chart_slice,
)


_SAMPLE_PAIPAN = {
    "PAIPAN": {"sizhu": {"year": "甲子", "month": "乙丑", "day": "丙寅", "hour": "丁卯"}},
    "META": {"rizhu": "丙", "rizhuGan": "丙", "dayStrength": "中和",
             "geju": "正官格", "yongshen": "甲木",
             "today": {"ymd": "2026-04-18", "yearGz": "丙午", "monthGz": "壬辰"},
             "input": {"year": 1990, "month": 5, "day": 5, "hour": 14, "minute": 0,
                       "city": "北京", "gender": "male"}},
    "FORCE": [
        {"name": "正财", "val": 5.5}, {"name": "偏财", "val": 1.2},
        {"name": "正官", "val": 7.8}, {"name": "七杀", "val": 2.1},
        {"name": "比肩", "val": 3.0}, {"name": "劫财", "val": 0.5},
        {"name": "食神", "val": 4.0}, {"name": "伤官", "val": 1.5},
        {"name": "正印", "val": 6.0}, {"name": "偏印", "val": 0.8},
    ],
    "GUARDS": [
        {"type": "liuhe", "note": "辰酉合（正财得地）"},
        {"type": "chong", "note": "子午冲"},
        {"type": "pair_mismatch", "note": "正印偏印悬殊"},
    ],
    "DAYUN": [
        {"age": 5, "gz": "丙寅", "ss": "比肩", "startYear": 1995, "endYear": 2004},
        {"age": 15, "gz": "丁卯", "ss": "劫财", "startYear": 2005, "endYear": 2014},
        {"age": 25, "gz": "戊辰", "ss": "食神", "startYear": 2015, "endYear": 2024},
        {"age": 35, "gz": "己巳", "ss": "伤官", "startYear": 2025, "endYear": 2034},
    ],
}


def test_intent_guide_covers_all_chat_intents():
    expected = {
        "relationship", "career", "wealth", "timing", "personality",
        "health", "meta", "chitchat", "other", "appearance", "special_geju",
        "liunian", "dayun_step",
    }
    assert expected.issubset(set(INTENT_GUIDE.keys()))


def test_pick_chart_slice_chitchat_returns_none():
    assert pick_chart_slice(_SAMPLE_PAIPAN, "chitchat") is None


def test_pick_chart_slice_other_returns_full():
    assert pick_chart_slice(_SAMPLE_PAIPAN, "other") == _SAMPLE_PAIPAN


def test_pick_chart_slice_relationship_filters_force():
    s = pick_chart_slice(_SAMPLE_PAIPAN, "relationship")
    names = {f["name"] for f in s["FORCE"]}
    assert names == {"正财", "偏财", "正官", "七杀", "比肩", "劫财"}


def test_pick_chart_slice_career_keeps_official_food_seal():
    s = pick_chart_slice(_SAMPLE_PAIPAN, "career")
    names = {f["name"] for f in s["FORCE"]}
    assert names == {"正官", "七杀", "食神", "伤官", "正印", "偏印"}


def test_pick_chart_slice_timing_window_around_current():
    """Today=2026 in 4th dayun (35-44, 己巳). Window = max(0,idx-1)..idx+3."""
    s = pick_chart_slice(_SAMPLE_PAIPAN, "timing")
    # idx=3 → slice [2..6) → indices 2,3 (only 2 entries beyond)
    assert len(s["DAYUN"]) >= 2
    # Verify current dayun is in the slice
    gzs = {d["gz"] for d in s["DAYUN"]}
    assert "己巳" in gzs


def test_build_messages_prepends_time_anchor_to_user_message():
    history = [{"role": "user", "content": "之前问题"}, {"role": "assistant", "content": "之前回答"}]
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=history,
        user_message="今年我适合换工作吗",
        intent="career", retrieved=[],
    )
    assert msgs[0]["role"] == "system"
    # last message must be user with anchor prepended
    last = msgs[-1]
    assert last["role"] == "user"
    assert "【当前时间锚】" in last["content"]
    assert "今年我适合换工作吗" in last["content"]


def test_build_messages_history_max_8():
    history = [{"role": "user", "content": f"q{i}"} for i in range(20)]
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=history,
        user_message="新", intent="other", retrieved=[],
    )
    # 1 system + 8 history + 1 user
    assert len(msgs) == 10


def test_build_messages_chitchat_skips_chart_and_classical():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="你好", intent="chitchat", retrieved=[],
    )
    sys = msgs[0]["content"]
    # chitchat goes through FALLBACK_STYLE, not the chart context
    assert "【用户命盘】" not in sys


def test_build_messages_includes_intent_guide():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="今年运气", intent="timing", retrieved=[],
    )
    assert "【本轮：时机/大运流年】" in msgs[0]["content"]


def test_fallback_style_present():
    assert isinstance(FALLBACK_STYLE, str)
    assert len(FALLBACK_STYLE) > 50
```

- [ ] **Step 4.3: Run — confirm RED**

Run: `uv run --package server pytest server/tests/unit/test_prompts_expert.py -v`
Expected: ImportError.

- [ ] **Step 4.4: Create `server/app/prompts/expert.py`**

```python
"""Stage 2 expert: intent-aware chart-slice + system prompt builder.

NOTE: archive/server-mvp/prompts.js:472-656 — pickChartSlice, INTENT_GUIDE,
buildExpertMessages.
"""
from __future__ import annotations

from typing import Any, Optional

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context
from app.prompts.loader import load_shards_for


# NOTE: prompts.js:44-51 — fallback style when no shard exists for an intent
FALLBACK_STYLE = """
你是一位懂命理的朋友。回复要：
1. 用聊天而非报告的语气；术语必须配白话翻译
2. 命理判断要有依据（命盘数据 + 古籍/经验）；不做空泛心灵鸡汤
3. 识别"真实边界"与"防御性回避"——前者尊重，后者温和挑战
4. 回复长度随内容走，写透为止，不要自行截断
5. 能用原话就用原话，避免机械的"我听到你说..."式复述
""".strip()


# NOTE: prompts.js:564-602 — verbatim intent-guide map
INTENT_GUIDE: dict[str, str] = {
    "relationship":
        '【本轮：关系/感情】聚焦日支（配偶宫）、正偏财与官杀的强弱与位置、六合/相冲对感情宫的影响、当前大运对关系的烘托。避免泛泛爱情鸡汤，要把判断挂在具体干支/十神/分数上。',
    "career":
        '【本轮：事业方向】聚焦格局（geju）、用神、官杀与食伤的配比（制/泄/化）、月令的土壤，再结合当前大运。给建议时要能落到"做什么类型的事"而不是"要努力"。',
    "wealth":
        '【本轮：财运】聚焦正偏财根气、食伤生财链路、比劫是否夺财、当前/下一步大运走财还是走印。不要给炒股吉凶，要给"你适合怎么挣钱"的结构化判断。',
    "timing":
        '【本轮：时机/大运流年】聚焦当前大运 + 下一步大运 + 近期流年，解释它对命主的结构意味着什么（补了什么、冲了什么）。日期要具体到岁数或年份。',
    "personality":
        '【本轮：性格自我】聚焦日主、十神结构、格局、十神组内的失衡（pair_mismatch）。用命盘"结构"解释性格的两面性，避免 MBTI 式标签化。',
    "health":
        '【本轮：身体情绪】聚焦五行偏枯、被冲最重的柱、过强/过弱的十神。只给结构性提醒（比如"水过弱、注意肾/泌尿与冬季"），不作医疗诊断。',
    "meta":
        '【本轮：命理概念】用户在问命理本身。先用两三句把概念讲清楚（白话+原理），再落回命主自身盘中对应的情况，不要只回答通识。',
    "chitchat":
        '【本轮：闲聊】用户没在问命盘。自然接话，不要硬塞八字分析。一两句即可。',
    "other":
        '【本轮：兜底】按常规方法论回答，若用户问题模糊可温和反问具体化。',
    "appearance":
        '【本轮：外貌/形象】聚焦三命通会"性情相貌"的体系：日主五行 + 主导十神 + 月令气候，对应身材、肤色、面相轮廓。挂出来的古籍是依据，不要随意加现代审美词。说"古籍把这种结构形容为...，落到你身上大概是..."。',
    "special_geju":
        '【本轮：特殊格局】用户问到了某个特殊格局名词。先用挂接的古籍原文确认它的成立条件，再对照命主盘看是否真的成立。如果不成立，明说"古籍要求 A、B、C，你的盘缺 C，所以这个格局不成立"。绝对不要凑话说成立。',
    "liunian":
        '【本轮：某一年的流年解读】\n'
        '在当前大运背景下讲这一年对命主的具体作用：\n'
        '- 年干支与日主的十神关系（ss 字段已给）\n'
        '- 年柱与大运干支的合冲刑害（同冲/同合会加码，互冲互合会缓和）\n'
        '- 落在"紧/松"哪种节奏：杀旺压身、财星辛劳、印年贵人等\n'
        '- 结尾给一句"这一年适合做什么 / 避免什么"，要具体\n'
        '- 4-8 行，口语，不要段落标题\n'
        '- 第一个字必须是具体干支或结论，不要"好的"、"这一年"这种套话开头。',
    "dayun_step":
        '【本轮：某一步大运的走向解读】\n'
        '分析这一步大运（干支 + 起运年龄）对日主的作用：干支各自是什么十神，和日主/用神的生克、与原局四柱的合冲。\n'
        '回答要落到具体十年里：前 2-3 年受上一步余气影响，中段（4-7 年）最纯，末 2 年过渡下一步。\n'
        '指出这十年哪条线被激活：事业/关系/财/健康，只选最突出的一两条。\n'
        '语气：像朋友在白板前给你画时间线。8-12 行，不用段落标题，不要前言后语。',
}


def _resolve_today_year(meta: dict) -> Optional[int]:
    ymd = (meta or {}).get("today", {}).get("ymd")
    if isinstance(ymd, str) and len(ymd) >= 4 and ymd[:4].isdigit():
        return int(ymd[:4])
    return None


def _resolve_current_dayun_index(paipan: dict) -> int:
    """Return index in DAYUN of the step containing today's year, or -1."""
    today = _resolve_today_year(paipan.get("META") or {})
    dayun = paipan.get("DAYUN") or []
    if today is None or not dayun:
        return -1
    for i, step in enumerate(dayun):
        try:
            sy, ey = int(step.get("startYear")), int(step.get("endYear"))
        except (TypeError, ValueError):
            continue
        if sy <= today <= ey:
            return i
    for i, step in enumerate(dayun):
        if step.get("current"):
            return i
    return -1


def pick_chart_slice(paipan: dict, intent: str) -> Optional[dict]:
    """Return a chart-shaped subset filtered for this intent, or None for chitchat.

    NOTE: prompts.js:472-562.
    """
    if not paipan:
        return None
    if intent == "chitchat":
        return None
    if intent == "other":
        return paipan

    P = paipan.get("PAIPAN") or {}
    M = paipan.get("META") or {}
    F = paipan.get("FORCE") or []
    G = paipan.get("GUARDS") or []
    D = paipan.get("DAYUN") or []
    cur_idx = _resolve_current_dayun_index(paipan)
    cur_dayun = D[cur_idx] if cur_idx >= 0 else None
    next_dayun = D[cur_idx + 1] if cur_idx >= 0 and cur_idx + 1 < len(D) else None

    base_meta = {
        "rizhu": M.get("rizhu"), "rizhuGan": M.get("rizhuGan"),
        "dayStrength": M.get("dayStrength"),
        "geju": M.get("geju"), "gejuNote": M.get("gejuNote"),
        "yongshen": M.get("yongshen"),
        "input": M.get("input"),
        "today": M.get("today"),
    }

    def pick_force(names: set[str]) -> list:
        return [x for x in F if x.get("name") in names]

    if intent == "relationship":
        return {
            "PAIPAN": P,
            "FORCE": pick_force({"正财", "偏财", "正官", "七杀", "比肩", "劫财"}),
            "GUARDS": [g for g in G if g.get("type") in {"liuhe", "chong"}
                       or "财" in (g.get("note") or "")
                       or "官" in (g.get("note") or "")],
            "DAYUN": [cur_dayun] if cur_dayun else [],
            "META": base_meta,
        }
    if intent == "career":
        return {
            "PAIPAN": P,
            "FORCE": pick_force({"正官", "七杀", "食神", "伤官", "正印", "偏印"}),
            "GUARDS": G,
            "DAYUN": [d for d in (cur_dayun, next_dayun) if d],
            "META": base_meta,
        }
    if intent == "wealth":
        return {
            "PAIPAN": P,
            "FORCE": pick_force({"正财", "偏财", "食神", "伤官", "比肩", "劫财"}),
            "GUARDS": [g for g in G if "财" in (g.get("note") or "")
                       or g.get("type") == "chong"],
            "DAYUN": [d for d in (cur_dayun, next_dayun) if d],
            "META": base_meta,
        }
    if intent == "timing":
        if cur_idx >= 0:
            window = D[max(0, cur_idx - 1):cur_idx + 3]
        else:
            window = D[:3]
        return {
            "PAIPAN": P, "FORCE": F, "GUARDS": G, "DAYUN": window, "META": base_meta,
        }
    if intent == "personality":
        return {
            "PAIPAN": P, "FORCE": F,
            "GUARDS": [g for g in G if g.get("type") == "pair_mismatch"],
            "DAYUN": [], "META": base_meta,
        }
    if intent == "health":
        sorted_force = sorted(F, key=lambda x: -(x.get("val") or 0))
        return {
            "PAIPAN": P, "FORCE": sorted_force,
            "GUARDS": [g for g in G if g.get("type") == "chong"],
            "DAYUN": [cur_dayun] if cur_dayun else [],
            "META": base_meta,
        }
    if intent == "meta":
        return {"PAIPAN": P, "FORCE": F, "GUARDS": [], "DAYUN": [], "META": base_meta}
    # appearance / special_geju / dayun_step / liunian → return full chart
    return paipan


def _runtime_constraints() -> str:
    """NOTE: prompts.js:608-617 — anti-tool-leak hard override."""
    return (
        '【运行时约束 — 最高优先级】\n'
        '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、```...```、'
        '"让我先查一下古籍" 这类过程性描述。\n'
        '古籍/方法论内容已内化在训练里，直接引用即可。\n'
        '\n'
        '【输出格式】纯文本或极简 Markdown。\n'
        '- 回复长度随内容走，写透为止，不要自行截断\n'
        '- 每个判断必须落到命盘里具体的干支/十神/分数，不要悬空下结论\n'
        '- 古籍引用不限于下文提供的判词——《滴天髓》《穷通宝鉴》《子平真诠》《神峰通考》'
        '里你训练数据中的任何原文都可自由引用；以「」包裹原文，立刻接白话，再接命盘对应'
    )


def build_messages(
    paipan: dict, history: list[dict],
    user_message: str, intent: str,
    retrieved: list[dict],
) -> list[dict]:
    """Build expert messages (system + history[-8:] + user with time anchor).

    NOTE: prompts.js:604-656.
    """
    parts: list[str] = []
    parts.append(_runtime_constraints())
    parts.append(INTENT_GUIDE.get(intent) or INTENT_GUIDE["other"])

    # Methodology: shards for non-chitchat; FALLBACK_STYLE for chitchat or missing shard
    if intent != "chitchat":
        shards = load_shards_for(intent)
        parts.append("--- 方法论 ---\n" + shards if shards else FALLBACK_STYLE)
    else:
        parts.append(FALLBACK_STYLE)

    # Chart slice
    sliced = pick_chart_slice(paipan, intent)
    if sliced:
        ctx = compact_chart_context(sliced)
        if ctx:
            parts.append(ctx)

    # Classical anchor (skip for chitchat)
    if intent != "chitchat":
        anchor = build_classical_anchor(retrieved or [], terse=True)
        if anchor:
            parts.append(anchor)

    # Time anchor — prepended to user msg (highest-attention slot)
    today = (paipan.get("META") or {}).get("today") or {}
    year_gz = today.get("yearGz")
    if year_gz:
        anchor_line = (
            "【当前时间锚】今天 " + (today.get("ymd") or "") + "，年柱 " + year_gz
            + (("，月柱 " + today["monthGz"]) if today.get("monthGz") else "")
            + '。所有"今年/明年/最近"默认以此为基准，不要自己另行推断。\n\n'
        )
    else:
        anchor_line = ""

    history_window = (history or [])[-8:]
    return [
        {"role": "system", "content": "\n\n".join(parts)},
        *history_window,
        {"role": "user", "content": anchor_line + user_message},
    ]
```

- [ ] **Step 4.5: Run — confirm GREEN**

Run: `uv run --package server pytest server/tests/unit/test_prompts_expert.py -v`
Expected: 11 passed.

If `test_pick_chart_slice_timing_window_around_current` fails because today's
year (2026 from `META.today.ymd`) doesn't fall into any DAYUN of the sample —
update the sample's DAYUN ranges so 2026 falls in the 4th step (already
configured: 4th step is 2025-2034 → 2026 included). If the test asserts
`len >= 2` and you get a different slice, recheck `_resolve_current_dayun_index`.

- [ ] **Step 4.6: Commit**

```bash
git add server/app/prompts/expert.py server/tests/unit/test_prompts_expert.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 prompts/expert (Stage 2 chat builder)

Ports archive/server-mvp/prompts.js Stage-2 expert: pick_chart_slice
filters chart by intent (relationship/career/wealth/timing/etc.);
INTENT_GUIDE map; build_messages assembles system+history+user with
time anchor prepended to user content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: prompts/gua.py (gua interpretation prompt)

**Files:**
- Create: `server/app/prompts/gua.py`
- Test: `server/tests/unit/test_prompts_gua.py`

- [ ] **Step 5.1: Write failing test**

Create `server/tests/unit/test_prompts_gua.py`:

```python
"""prompts/gua: 占卦师 system prompt + classical block.

NOTE: archive/server-mvp/prompts.js:759-803.
"""
from __future__ import annotations

from app.prompts.gua import build_messages


_SAMPLE_GUA = {
    "id": 51, "name": "震", "symbol": "☳☳",
    "upper": "震", "lower": "震",
    "guaci": "震亨。震来虩虩，笑言哑哑。",
    "daxiang": "洊雷，震；君子以恐惧修省。",
    "dongyao": 3,
    "drawn_at": "2026-04-18 14:30:00",
    "source": {"formula": "上卦 (5+4+18)mod8 = 3 离 / 下卦 (27+8)mod8 = 3 离 / 动爻 mod6 = 5"},
}


def test_build_messages_returns_system_and_user():
    msgs = build_messages(question="该不该跳槽", gua=_SAMPLE_GUA, birth_context=None)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1] == {"role": "user", "content": "我的问题：该不该跳槽"}


def test_system_block_includes_format_constraint_and_classical():
    msgs = build_messages(question="?", gua=_SAMPLE_GUA, birth_context=None)
    sys = msgs[0]["content"]
    # Output format constraint
    assert "§卦象" in sys
    assert "§原文" in sys
    assert "§白话" in sys
    assert "§你的问题" in sys
    # Classical anchor block format
    assert "<classical" in sys
    assert "卦辞：" + _SAMPLE_GUA["guaci"] in sys
    assert "大象：" + _SAMPLE_GUA["daxiang"] in sys


def test_birth_context_optional_appended_when_present():
    bc = {"rizhu": "丙", "currentDayun": "戊辰", "currentYear": "丙午"}
    msgs = build_messages(question="?", gua=_SAMPLE_GUA, birth_context=bc)
    sys = msgs[0]["content"]
    assert "【命主背景】" in sys
    assert "丙" in sys and "戊辰" in sys and "丙午" in sys


def test_birth_context_omitted_when_none():
    msgs = build_messages(question="?", gua=_SAMPLE_GUA, birth_context=None)
    assert "【命主背景】" not in msgs[0]["content"]
```

- [ ] **Step 5.2: Run — confirm RED**

Run: `uv run --package server pytest server/tests/unit/test_prompts_gua.py -v`
Expected: ImportError.

- [ ] **Step 5.3: Create `server/app/prompts/gua.py`**

```python
"""Gua interpretation prompt.

NOTE: archive/server-mvp/prompts.js:759-803 — buildGuaMessages.
"""
from __future__ import annotations

from typing import Any, Optional


_SYSTEM_LINES = [
    '你是一位精通周易的占卦师。你的分析必须严格基于本次起卦得到的卦辞 + 大象辞，'
    '禁止编造其他卦辞或引述未提供的卦。',
    '',
    '【输出格式 — 严格】',
    '只输出四段，每段之间用空行分隔，每段第一行是 "§" 加段名：',
    '',
    '§卦象',
    '一句话点出本卦的核心意象（如"雷雨同作，险中开路"），描述上下卦组合的画面。1-2 句。',
    '',
    '§原文',
    '把卦辞和大象辞用 > 引用符照抄一遍。先卦辞后大象。',
    '',
    '§白话',
    '把卦辞 + 大象用现代汉语翻译，告诉用户这卦在讲什么核心情境。3-4 句。',
    '',
    '§你的问题',
    '把卦的意象 / 古义对照用户的问题，给一个具体的判断（适合 / 不适合 / 慎重 / 顺势 / 等待）'
    '+ 一句行动建议。3-5 句。',
    '',
    '【硬约束】',
    '- 第一个字必须是 "§"，不要任何前言（"以下是占卦结果："等）',
    '- 引用古文必须从下面 <classical> 内逐字摘',
    '- 不要扯爻辞、互卦、变卦——本轮 MVP 只看本卦',
]


def build_messages(
    question: str,
    gua: dict[str, Any],
    birth_context: Optional[dict[str, Any]],
) -> list[dict]:
    """NOTE: prompts.js:759-803."""
    sys = "\n".join(_SYSTEM_LINES)

    gua_info = "\n".join([
        '【本次起卦】',
        '卦象：' + gua["symbol"] + '（' + gua["name"] + ' · 上' + gua["upper"]
            + '下' + gua["lower"] + '）',
        '起卦时刻：' + str(gua.get("drawn_at") or ""),
        '起卦推算：' + str((gua.get("source") or {}).get("formula") or ""),
        '',
        '<classical source="周易·' + gua["name"] + '">',
        '卦辞：' + gua["guaci"],
        '大象：' + gua["daxiang"],
        '</classical>',
    ])

    ctx_block = ""
    if birth_context:
        ctx_block = (
            '【命主背景】日主 ' + str(birth_context.get("rizhu") or "?")
            + '，当前大运 ' + str(birth_context.get("currentDayun") or "?")
            + '，当前流年 ' + str(birth_context.get("currentYear") or "?") + '。'
        )

    system_content = sys + "\n\n" + gua_info + (("\n\n" + ctx_block) if ctx_block else "")
    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": "我的问题：" + question},
    ]
```

- [ ] **Step 5.4: Run — confirm GREEN**

Run: `uv run --package server pytest server/tests/unit/test_prompts_gua.py -v`
Expected: 4 passed.

- [ ] **Step 5.5: Commit**

```bash
git add server/app/prompts/gua.py server/tests/unit/test_prompts_gua.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 prompts/gua (占卦师 system prompt)

Ports archive/server-mvp/prompts.js buildGuaMessages — strict §四段
output format, <classical> block carries 卦辞+大象, optional 命主背景.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: services/conversation.py + services/message.py

**Files:**
- Create: `server/app/services/conversation.py`
- Create: `server/app/services/message.py`
- Test: `server/tests/unit/test_services_conversation.py`
- Test: `server/tests/unit/test_services_message.py`

These are pure DB-access modules (no LLM). Both use existing fixtures (DEK
contextvar already mounted by Plan 3 auth deps; tests can use
`user_dek_context` from `app.db_types`).

- [ ] **Step 6.1: Read existing services for pattern parity**

Read `server/app/services/chart.py` (look at `list_charts`, `get_chart`,
`create_chart`, `soft_delete`, `restore`) — note:
- pattern uses `select(Chart).where(...)` + `await db.execute(...)`
- ownership joins to `User.id`
- soft-delete = `UPDATE ... SET deleted_at = now()`; restore = `UPDATE ... SET deleted_at = NULL`
- raises `ServiceError` subclasses (NotFoundError, etc.) — use the same conventions

- [ ] **Step 6.2: Write failing tests for conversation.py**

Create `server/tests/unit/test_services_conversation.py`:

```python
"""services/conversation: CRUD + ownership + soft-delete/restore."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.db_types import user_dek_context
from app.models.conversation import Conversation, Message
from app.services import conversation as conv_svc
from app.services.exceptions import (
    ConversationGoneError,
    NotFoundError,
)


pytestmark = pytest.mark.asyncio


# Test infra notes:
# - `db_session` fixture (from conftest) provides a clean AsyncSession
#   bound to a testcontainers Postgres.
# - `seeded` fixture (from conftest) provides {user, chart} bound to
#   the session, with DEK already loadable via fixture-provided dek bytes.


async def test_list_conversations_returns_only_active_for_owner(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c1 = await conv_svc.create_conversation(db_session, user, chart.id, label="对话 1")
        c2 = await conv_svc.create_conversation(db_session, user, chart.id, label="对话 2")
        await db_session.commit()

        rows = await conv_svc.list_conversations(db_session, user, chart.id)
        ids = [r.id for r in rows]
        assert c1.id in ids and c2.id in ids

        await conv_svc.soft_delete(db_session, user, c1.id)
        await db_session.commit()
        rows2 = await conv_svc.list_conversations(db_session, user, chart.id)
        assert c1.id not in [r.id for r in rows2]
        assert c2.id in [r.id for r in rows2]


async def test_get_conversation_cross_user_404(db_session, seeded, second_user_factory):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()

    other = await second_user_factory()
    with user_dek_context(other["dek"]):
        with pytest.raises(NotFoundError):
            await conv_svc.get_conversation(db_session, other["user"], c.id)


async def test_create_assigns_increasing_position(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c1 = await conv_svc.create_conversation(db_session, user, chart.id)
        c2 = await conv_svc.create_conversation(db_session, user, chart.id)
        c3 = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        assert c1.position == 0
        assert c2.position == 1
        assert c3.position == 2


async def test_patch_label_updates(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id, label="old")
        await db_session.commit()
        updated = await conv_svc.patch_label(db_session, user, c.id, "new")
        await db_session.commit()
        assert updated.label == "new"


async def test_soft_delete_then_restore_within_30d(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        await conv_svc.soft_delete(db_session, user, c.id)
        await db_session.commit()
        restored = await conv_svc.restore(db_session, user, c.id)
        await db_session.commit()
        assert restored.deleted_at is None


async def test_restore_outside_30d_raises_gone(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        # Manually backdate deleted_at past 30 days
        old = datetime.now(tz=timezone.utc) - timedelta(days=31)
        await db_session.execute(
            text("UPDATE conversations SET deleted_at = :d WHERE id = :id"),
            {"d": old, "id": c.id},
        )
        await db_session.commit()
        with pytest.raises(ConversationGoneError):
            await conv_svc.restore(db_session, user, c.id)


async def test_get_returns_message_count_and_last_message_at(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        # No messages
        d = await conv_svc.get_conversation(db_session, user, c.id)
        assert d.message_count == 0
        assert d.last_message_at is None

        # Add 3 messages
        from app.services import message as msg_svc
        await msg_svc.insert(db_session, conversation_id=c.id, role="user", content="a")
        await msg_svc.insert(db_session, conversation_id=c.id, role="assistant", content="b")
        await msg_svc.insert(db_session, conversation_id=c.id, role="gua", content=None,
                              meta={"gua": {}})
        await db_session.commit()

        d2 = await conv_svc.get_conversation(db_session, user, c.id)
        assert d2.message_count == 3
        assert d2.last_message_at is not None
```

If `second_user_factory` fixture does not exist, add it inline at the top of
the file as a `pytest_asyncio.fixture` that creates a fresh user (mirror the
existing `seeded` fixture in conftest); or use the existing
`seeded_alt`/`other_user` fixture if conftest provides one. **Verify in
`server/tests/conftest.py` first** — if no second-user fixture exists, add
one to conftest (preferred) or inline.

- [ ] **Step 6.3: Write failing tests for message.py**

Create `server/tests/unit/test_services_message.py`:

```python
"""services/message: insert + keyset pagination."""
from __future__ import annotations

import asyncio

import pytest

from app.db_types import user_dek_context
from app.services import conversation as conv_svc
from app.services import message as msg_svc


pytestmark = pytest.mark.asyncio


async def test_insert_returns_row_with_id(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        m = await msg_svc.insert(db_session, conversation_id=c.id,
                                  role="user", content="hi")
        await db_session.commit()
        assert m.id is not None
        assert m.role == "user"
        assert m.content == "hi"


async def test_paginate_returns_newest_first(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        for i in range(5):
            await msg_svc.insert(db_session, conversation_id=c.id,
                                  role="user", content=f"m{i}")
            await db_session.commit()
            # Sleep 1ms so created_at strictly increases
            await asyncio.sleep(0.001)

        page = await msg_svc.paginate(db_session, conversation_id=c.id, before=None, limit=10)
        contents = [m.content for m in page["items"]]
        assert contents == ["m4", "m3", "m2", "m1", "m0"]
        assert page["next_cursor"] is None


async def test_paginate_cursor_keyset(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        ids = []
        for i in range(7):
            m = await msg_svc.insert(db_session, conversation_id=c.id,
                                      role="user", content=f"m{i}")
            await db_session.commit()
            ids.append(m.id)
            import asyncio as _a
            await _a.sleep(0.001)

        page1 = await msg_svc.paginate(db_session, conversation_id=c.id, before=None, limit=3)
        assert [m.content for m in page1["items"]] == ["m6", "m5", "m4"]
        assert page1["next_cursor"] == ids[3]   # next_cursor = id of (limit+1)th from latest

        page2 = await msg_svc.paginate(db_session, conversation_id=c.id,
                                        before=page1["next_cursor"], limit=3)
        assert [m.content for m in page2["items"]] == ["m3", "m2", "m1"]


async def test_paginate_limit_clamps(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        # Out of range → ValueError
        with pytest.raises(ValueError):
            await msg_svc.paginate(db_session, conversation_id=c.id, before=None, limit=0)
        with pytest.raises(ValueError):
            await msg_svc.paginate(db_session, conversation_id=c.id, before=None, limit=101)


async def test_recent_history_for_chat_returns_user_assistant_only(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        await msg_svc.insert(db_session, conversation_id=c.id, role="user", content="u1")
        await msg_svc.insert(db_session, conversation_id=c.id, role="assistant", content="a1")
        await msg_svc.insert(db_session, conversation_id=c.id, role="cta",
                              content=None, meta={"question": "?"})
        await msg_svc.insert(db_session, conversation_id=c.id, role="gua",
                              content=None, meta={})
        await msg_svc.insert(db_session, conversation_id=c.id, role="user", content="u2")
        await db_session.commit()

        hist = await msg_svc.recent_chat_history(db_session, conversation_id=c.id, limit=8)
        roles = [h["role"] for h in hist]
        contents = [h["content"] for h in hist]
        # Chronological order, user/assistant only
        assert roles == ["user", "assistant", "user"]
        assert contents == ["u1", "a1", "u2"]


async def test_delete_last_cta_removes_only_latest(db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        await msg_svc.insert(db_session, conversation_id=c.id, role="cta",
                              content=None, meta={"question": "old"})
        import asyncio as _a
        await _a.sleep(0.001)
        cta2 = await msg_svc.insert(db_session, conversation_id=c.id, role="cta",
                                     content=None, meta={"question": "new"})
        await db_session.commit()

        deleted_id = await msg_svc.delete_last_cta(db_session, conversation_id=c.id)
        await db_session.commit()
        assert deleted_id == cta2.id

        # Second call returns None (only the older cta remains)
        rest = await msg_svc.paginate(db_session, conversation_id=c.id, before=None, limit=10)
        assert any(m.role == "cta" for m in rest["items"])
```

- [ ] **Step 6.4: Run tests — confirm RED**

```
uv run --package server pytest server/tests/unit/test_services_conversation.py \
    server/tests/unit/test_services_message.py -v
```
Expected: ImportError on `app.services.conversation` / `app.services.message`.

- [ ] **Step 6.5: Create `server/app/services/conversation.py`**

```python
"""Conversation CRUD + ownership + soft-delete/restore. NOTE: spec §4."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chart import Chart
from app.models.conversation import Conversation, Message
from app.models.user import User
from app.schemas.conversation import ConversationDetail
from app.services.exceptions import ConversationGoneError, NotFoundError


_RESTORE_WINDOW = timedelta(days=30)


async def _get_owned_chart(db: AsyncSession, user: User, chart_id: UUID) -> Chart:
    """Returns active (non-soft-deleted) chart owned by user, else 404."""
    stmt = select(Chart).where(
        Chart.id == chart_id,
        Chart.user_id == user.id,
        Chart.deleted_at.is_(None),
    )
    chart = (await db.execute(stmt)).scalar_one_or_none()
    if chart is None:
        raise NotFoundError(message="命盘不存在")
    return chart


async def _get_owned_conversation_row(
    db: AsyncSession, user: User, conv_id: UUID,
    *, allow_deleted: bool = False,
) -> Conversation:
    """JOIN conversations → charts → user_id; 404 on miss/cross-user."""
    stmt = (
        select(Conversation)
        .join(Chart, Conversation.chart_id == Chart.id)
        .where(Conversation.id == conv_id, Chart.user_id == user.id,
               Chart.deleted_at.is_(None))
    )
    conv = (await db.execute(stmt)).scalar_one_or_none()
    if conv is None:
        raise NotFoundError(message="对话不存在")
    if conv.deleted_at is not None and not allow_deleted:
        raise NotFoundError(message="对话不存在")
    return conv


async def _to_detail(db: AsyncSession, conv: Conversation) -> ConversationDetail:
    """Build ConversationDetail with message_count + last_message_at."""
    row = (await db.execute(
        select(func.count(Message.id), func.max(Message.created_at))
        .where(Message.conversation_id == conv.id)
    )).one()
    return ConversationDetail(
        id=conv.id, label=conv.label, position=conv.position,
        created_at=conv.created_at, updated_at=conv.updated_at,
        last_message_at=row[1], message_count=int(row[0] or 0),
        deleted_at=conv.deleted_at,
    )


async def list_conversations(
    db: AsyncSession, user: User, chart_id: UUID,
) -> list[ConversationDetail]:
    chart = await _get_owned_chart(db, user, chart_id)
    rows = (await db.execute(
        select(Conversation)
        .where(Conversation.chart_id == chart.id, Conversation.deleted_at.is_(None))
        .order_by(Conversation.position.asc(), Conversation.created_at.asc())
    )).scalars().all()
    return [await _to_detail(db, r) for r in rows]


async def create_conversation(
    db: AsyncSession, user: User, chart_id: UUID,
    *, label: Optional[str] = None,
) -> ConversationDetail:
    chart = await _get_owned_chart(db, user, chart_id)
    # next position
    pos_row = (await db.execute(
        select(func.coalesce(func.max(Conversation.position), -1))
        .where(Conversation.chart_id == chart.id, Conversation.deleted_at.is_(None))
    )).scalar_one()
    next_pos = int(pos_row) + 1
    if not label:
        # Default = "对话 N" where N = active count + 1
        cnt = (await db.execute(
            select(func.count(Conversation.id))
            .where(Conversation.chart_id == chart.id, Conversation.deleted_at.is_(None))
        )).scalar_one()
        label = f"对话 {int(cnt) + 1}"
    conv = Conversation(chart_id=chart.id, label=label, position=next_pos)
    db.add(conv)
    await db.flush()
    return await _to_detail(db, conv)


async def get_conversation(
    db: AsyncSession, user: User, conv_id: UUID,
) -> ConversationDetail:
    conv = await _get_owned_conversation_row(db, user, conv_id, allow_deleted=True)
    return await _to_detail(db, conv)


async def patch_label(
    db: AsyncSession, user: User, conv_id: UUID, label: str,
) -> ConversationDetail:
    conv = await _get_owned_conversation_row(db, user, conv_id)
    conv.label = label
    conv.updated_at = datetime.now(tz=timezone.utc)
    await db.flush()
    return await _to_detail(db, conv)


async def soft_delete(db: AsyncSession, user: User, conv_id: UUID) -> None:
    conv = await _get_owned_conversation_row(db, user, conv_id)
    conv.deleted_at = datetime.now(tz=timezone.utc)
    await db.flush()


async def restore(
    db: AsyncSession, user: User, conv_id: UUID,
) -> ConversationDetail:
    conv = await _get_owned_conversation_row(db, user, conv_id, allow_deleted=True)
    if conv.deleted_at is None:
        return await _to_detail(db, conv)
    if conv.deleted_at < datetime.now(tz=timezone.utc) - _RESTORE_WINDOW:
        raise ConversationGoneError()
    conv.deleted_at = None
    await db.flush()
    return await _to_detail(db, conv)
```

- [ ] **Step 6.6: Create `server/app/services/message.py`**

```python
"""Message insert + keyset pagination + helpers used by chat/gua orchestrators."""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Message
from app.schemas.message import MessageDetail


async def insert(
    db: AsyncSession, *,
    conversation_id: UUID, role: str,
    content: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> Message:
    """INSERT a message row. Caller commits."""
    m = Message(
        conversation_id=conversation_id,
        role=role, content=content, meta=meta,
    )
    db.add(m)
    await db.flush()
    await db.refresh(m, ["created_at", "id"])
    return m


def _to_detail(m: Message) -> MessageDetail:
    return MessageDetail(
        id=m.id, role=m.role, content=m.content, meta=m.meta,
        created_at=m.created_at,
    )


async def paginate(
    db: AsyncSession, *,
    conversation_id: UUID,
    before: Optional[UUID],
    limit: int,
) -> dict:
    """Newest-first keyset pagination. NOTE: spec §4.3.

    Returns {"items": [MessageDetail...], "next_cursor": UUID|None}.
    """
    if limit < 1 or limit > 100:
        raise ValueError(f"limit must be in [1, 100], got {limit}")

    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before is not None:
        # Resolve cursor row to (created_at, id) tuple
        cursor_row = (await db.execute(
            select(Message.created_at, Message.id).where(Message.id == before)
        )).one_or_none()
        if cursor_row is None:
            # Cursor refers to a non-existent message — treat as fresh page
            pass
        else:
            c_at, c_id = cursor_row
            stmt = stmt.where(
                (Message.created_at < c_at) |
                ((Message.created_at == c_at) & (Message.id < c_id))
            )

    stmt = stmt.order_by(desc(Message.created_at), desc(Message.id)).limit(limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].id if has_more and items else None
    return {"items": [_to_detail(m) for m in items], "next_cursor": next_cursor}


async def recent_chat_history(
    db: AsyncSession, *, conversation_id: UUID, limit: int = 8,
) -> list[dict]:
    """Last N user/assistant messages in chronological order, dict-shaped for prompts.

    Used by chat (limit=8), router (limit=4), chips (limit=6).
    """
    stmt = (
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role.in_(["user", "assistant"]),
        )
        .order_by(desc(Message.created_at), desc(Message.id))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    rows.reverse()  # chronological
    return [{"role": m.role, "content": m.content or ""} for m in rows]


async def delete_last_cta(
    db: AsyncSession, *, conversation_id: UUID,
) -> Optional[UUID]:
    """Atomic DELETE of the most recent role='cta' row. Returns deleted id or None.

    Used by chat (bypass_divination=True) and gua (consume on cast). Caller commits.
    NOTE: spec §5.4 / §6.1 step 10.
    """
    stmt = (
        select(Message.id)
        .where(Message.conversation_id == conversation_id, Message.role == "cta")
        .order_by(desc(Message.created_at), desc(Message.id))
        .limit(1)
    )
    last_id = (await db.execute(stmt)).scalar_one_or_none()
    if last_id is None:
        return None
    await db.execute(
        Message.__table__.delete().where(Message.id == last_id)
    )
    return last_id
```

- [ ] **Step 6.7: Verify second_user_factory exists in conftest (or add it)**

```bash
grep -n "second_user_factory\|second_user\|other_user" server/tests/conftest.py
```
If absent, add a fixture (mirror `seeded` minus the chart):

```python
@pytest_asyncio.fixture
async def second_user_factory(db_session, app_with_lifespan):
    """Factory that creates an additional fresh user with their own DEK."""
    async def _make():
        from app.services import auth as auth_svc
        # Use the same registration helper as `seeded` — adapt to actual signature.
        # If conftest's `seeded` calls a specific factory, mirror that path.
        ...
        return {"user": user, "dek": dek}
    return _make
```

(Read the existing `seeded` fixture in conftest first to match its mechanics —
do not invent a parallel auth path.)

- [ ] **Step 6.8: Run — confirm GREEN**

```
uv run --package server pytest \
    server/tests/unit/test_services_conversation.py \
    server/tests/unit/test_services_message.py -v
```
Expected: 13 passed.

- [ ] **Step 6.9: Commit**

```bash
git add server/app/services/conversation.py server/app/services/message.py \
        server/tests/unit/test_services_conversation.py \
        server/tests/unit/test_services_message.py \
        server/tests/conftest.py   # if you added second_user_factory
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 conversation + message services

Adds CRUD + soft-delete/restore on conversations (30d window enforced
via ConversationGoneError 410), and message insert + keyset
pagination + recent_chat_history helper + delete_last_cta atomic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: services/chat_router.py + services/conversation_chat.py (Stage 1+2 orchestrator)

**Files:**
- Create: `server/app/services/chat_router.py`
- Create: `server/app/services/conversation_chat.py`
- Test: `server/tests/unit/test_services_chat_router.py`
- Test: `server/tests/unit/test_services_conversation_chat.py`

- [ ] **Step 7.1: Write failing tests for chat_router**

Create `server/tests/unit/test_services_chat_router.py`:

```python
"""services/chat_router: classify (keyword fast-path or LLM fallback)."""
from __future__ import annotations

import pytest

from app.services import chat_router as cr


pytestmark = pytest.mark.asyncio


async def test_keyword_match_skips_llm(monkeypatch, db_session, seeded):
    user = seeded["user"]

    async def _boom(*a, **kw):
        raise AssertionError("LLM should not be called for keyword hit")

    monkeypatch.setattr("app.services.chat_router.chat_with_fallback", _boom)
    monkeypatch.setattr("app.services.chat_router.insert_llm_usage_log",
                         lambda *a, **kw: None)

    out = await cr.classify(
        db=db_session, user=user, chart_id=seeded["chart"].id,
        message="今年我该不该跳槽", history=[],
    )
    assert out["intent"] == "divination"
    assert out["source"] == "keyword"


async def test_llm_fallback_when_no_keyword(monkeypatch, db_session, seeded):
    user = seeded["user"]
    captured = {}

    async def _fake_llm(*, messages, tier, temperature, max_tokens):
        captured["tier"] = tier
        return {
            "text": '{"intent":"meta","reason":"问命理概念"}',
            "modelUsed": "mimo-v2-fast",
            "prompt_tokens": 100, "completion_tokens": 20, "tokens_used": 120,
        }

    log_calls = []
    async def _capture_log(*a, **kw):
        log_calls.append(kw)

    monkeypatch.setattr("app.services.chat_router.chat_with_fallback", _fake_llm)
    monkeypatch.setattr("app.services.chat_router.insert_llm_usage_log", _capture_log)

    out = await cr.classify(
        db=db_session, user=user, chart_id=seeded["chart"].id,
        message="阐述一下子平真诠的中心思想",
        history=[],
    )
    assert out["intent"] == "meta"
    assert out["source"] == "llm"
    assert captured["tier"] == "fast"
    assert log_calls and log_calls[0]["endpoint"] == "chat:router"


async def test_llm_error_falls_back_to_other(monkeypatch, db_session, seeded):
    from app.services.exceptions import UpstreamLLMError
    user = seeded["user"]

    async def _boom(*a, **kw):
        raise UpstreamLLMError(code="UPSTREAM_LLM_TIMEOUT", message="boom")

    monkeypatch.setattr("app.services.chat_router.chat_with_fallback", _boom)
    monkeypatch.setattr("app.services.chat_router.insert_llm_usage_log",
                         lambda *a, **kw: None)

    out = await cr.classify(
        db=db_session, user=user, chart_id=seeded["chart"].id,
        message="please describe my chart in english",
        history=[],
    )
    assert out["intent"] == "other"
    assert out["reason"] == "router_error"
    assert out["source"] == "llm"
```

- [ ] **Step 7.2: Create `server/app/services/chat_router.py`**

```python
"""Stage 1 router: keyword fast-path → LLM fallback. NOTE: spec §5.2."""
from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.client import chat_with_fallback
from app.llm.logs import insert_llm_usage_log
from app.models.user import User
from app.prompts.router import build_messages, classify_by_keywords, parse_router_json
from app.services.exceptions import UpstreamLLMError


async def classify(
    *, db: AsyncSession, user: User, chart_id: UUID,
    message: str, history: list[dict],
) -> dict:
    """Returns {intent, reason, source}. Logs llm_usage_logs row on LLM path."""
    routed = classify_by_keywords(message)
    if routed:
        return routed

    t_start = time.monotonic()
    model_used: str | None = None
    err: UpstreamLLMError | None = None
    parsed = {"intent": "other", "reason": "router_error"}
    prompt_tok = completion_tok = 0

    try:
        result = await chat_with_fallback(
            messages=build_messages(history=history, user_message=message),
            tier="fast", temperature=0, max_tokens=800,
        )
        model_used = result.get("modelUsed")
        prompt_tok = result.get("prompt_tokens", 0) or 0
        completion_tok = result.get("completion_tokens", 0) or 0
        parsed = parse_router_json(result.get("text"))
    except UpstreamLLMError as e:
        err = e
        # Fall through with parsed = router_error default

    duration_ms = int((time.monotonic() - t_start) * 1000)
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart_id,
        endpoint="chat:router", model=model_used,
        prompt_tokens=prompt_tok or None,
        completion_tokens=completion_tok or None,
        duration_ms=duration_ms,
        error=(f"{err.code}: {err.message}" if err else None),
    )

    return {**parsed, "source": "llm"}
```

- [ ] **Step 7.3: Run chat_router tests — confirm GREEN**

```
uv run --package server pytest server/tests/unit/test_services_chat_router.py -v
```
Expected: 3 passed.

If `chat_with_fallback` signature differs (it might return a `result` object
rather than a dict with `text`/`modelUsed`/`prompt_tokens`/`completion_tokens`
keys), read `app/llm/client.py` to confirm the actual return shape and adjust
both the test fakes and `chat_router.py` accordingly. (Plan 5 spec dictated
the dict shape; verify it shipped.)

- [ ] **Step 7.4: Write failing tests for conversation_chat orchestrator**

Create `server/tests/unit/test_services_conversation_chat.py`:

```python
"""services/conversation_chat: orchestrator (Stage 1+2 + persistence + quota)."""
from __future__ import annotations

import json
from typing import AsyncIterator

import pytest

from app.db_types import user_dek_context
from app.models.conversation import Message
from app.services import conversation as conv_svc
from app.services import conversation_chat as cc
from app.services import message as msg_svc
from app.services.exceptions import UpstreamLLMError
from app.services.quota import QuotaTicket


pytestmark = pytest.mark.asyncio


async def _consume(gen) -> list[dict]:
    """Drain SSE bytes generator and return parsed events."""
    out = []
    async for raw in gen:
        line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        # Extract JSON after "data: " prefix
        for chunk in line.split("\n\n"):
            chunk = chunk.strip()
            if chunk.startswith("data: "):
                out.append(json.loads(chunk[len("data: "):]))
    return out


def _fake_classify(intent="other", reason="ok", source="keyword"):
    async def _f(**_):
        return {"intent": intent, "reason": reason, "source": source}
    return _f


def _fake_stream_factory(deltas, tokens=42, model="mimo-v2-pro"):
    async def _f(**kwargs):
        yield {"type": "model", "modelUsed": model}
        for d in deltas:
            yield {"type": "delta", "text": d}
        yield {"type": "done", "tokens_used": tokens,
               "prompt_tokens": tokens // 3,
               "completion_tokens": tokens - tokens // 3}
    return _f


def _fake_stream_factory_error(err):
    async def _f(**kwargs):
        yield {"type": "model", "modelUsed": "mimo-v2-pro"}
        raise err
    return _f


async def test_normal_flow_writes_user_then_assistant(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="career", source="keyword"))
        monkeypatch.setattr("app.services.conversation_chat.chat_stream_with_fallback",
                             _fake_stream_factory(["你好", "世界"]))
        monkeypatch.setattr("app.services.conversation_chat.retrieve_for_chart",
                             lambda *a, **kw: [])

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="我想换工作", bypass_divination=False,
            ticket=ticket,
        ))
        await db_session.commit()

        types = [e["type"] for e in events]
        assert types[0] == "intent"
        assert "model" in types and "delta" in types
        assert types[-1] == "done"

        # DB: user + assistant rows
        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        # newest-first
        assert roles == ["assistant", "user"]
        assert page["items"][0].content == "你好世界"


async def test_divination_writes_cta_and_redirects(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="divination", source="keyword"))

        # Expert MUST NOT be called
        async def _boom_expert(**_):
            raise AssertionError("expert should not run on divination redirect")
            yield  # noqa
        monkeypatch.setattr("app.services.conversation_chat.chat_stream_with_fallback",
                             _boom_expert)

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="我能不能买这个房", bypass_divination=False,
            ticket=ticket,
        ))
        await db_session.commit()

        types = [e["type"] for e in events]
        assert "redirect" in types
        assert types[-1] == "done"

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["cta", "user"]
        assert page["items"][0].meta == {"question": "我能不能买这个房"}


async def test_bypass_divination_consumes_existing_cta(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        # pre-existing cta from prior turn
        await msg_svc.insert(db_session, conversation_id=c.id, role="cta",
                              content=None, meta={"question": "old"})
        await db_session.commit()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="divination", source="keyword"))
        monkeypatch.setattr("app.services.conversation_chat.chat_stream_with_fallback",
                             _fake_stream_factory(["分", "析"]))
        monkeypatch.setattr("app.services.conversation_chat.retrieve_for_chart",
                             lambda *a, **kw: [])

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="还是直接分析吧", bypass_divination=True,
            ticket=ticket,
        ))
        await db_session.commit()

        # cta should be gone; assistant landed
        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert "cta" not in roles
        assert "assistant" in roles


async def test_llm_error_keeps_user_msg_no_assistant(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()

        monkeypatch.setattr("app.services.conversation_chat.classify",
                             _fake_classify(intent="career"))
        monkeypatch.setattr(
            "app.services.conversation_chat.chat_stream_with_fallback",
            _fake_stream_factory_error(UpstreamLLMError(code="UPSTREAM_LLM_TIMEOUT", message="t/o")),
        )
        monkeypatch.setattr("app.services.conversation_chat.retrieve_for_chart",
                             lambda *a, **kw: [])

        ticket = QuotaTicket(user=user, kind="chat_message", limit=30, _db=db_session)
        events = await _consume(cc.stream_message(
            db=db_session, user=user, conversation_id=c.id,
            chart=chart, message="问问事业", bypass_divination=False,
            ticket=ticket,
        ))
        await db_session.commit()

        types = [e["type"] for e in events]
        assert types[-1] == "error"

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["user"]   # assistant NOT written
```

- [ ] **Step 7.5: Create `server/app/services/conversation_chat.py`**

```python
"""Stage 1+2 orchestrator. NOTE: spec §5.

Pattern mirrors app.services.chart_llm.stream_chart_llm: commit-before-done.
"""
from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.client import chat_stream_with_fallback
from app.llm.events import sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.user import User
from app.prompts import expert as prompts_expert
from app.retrieval.service import retrieve_for_chart
from app.services import message as msg_svc
from app.services.chat_router import classify
from app.services.exceptions import QuotaExceededError, UpstreamLLMError
from app.services.quota import QuotaTicket


async def stream_message(
    *, db: AsyncSession, user: User, conversation_id: UUID,
    chart, message: str, bypass_divination: bool,
    ticket: QuotaTicket,
) -> AsyncIterator[bytes]:
    """Generator yielding SSE-encoded bytes. NOTE: spec §5."""
    # Step 3 — load history BEFORE inserting user msg (so model sees prior context only)
    history = await msg_svc.recent_chat_history(db, conversation_id=conversation_id, limit=8)

    # Step 4 — INSERT user row immediately
    await msg_svc.insert(db, conversation_id=conversation_id, role="user", content=message)

    # Stage 1 — router
    routed = await classify(
        db=db, user=user, chart_id=chart.id,
        message=message, history=history,
    )
    yield sse_pack({"type": "intent", "intent": routed["intent"],
                     "reason": routed["reason"], "source": routed["source"]})

    intent = routed["intent"]

    # Divination redirect branch
    if intent == "divination" and not bypass_divination:
        await msg_svc.insert(db, conversation_id=conversation_id, role="cta",
                              content=None, meta={"question": message})
        yield sse_pack({"type": "redirect", "to": "gua", "question": message})
        try:
            await ticket.commit()
        except QuotaExceededError as e:
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
            return
        yield sse_pack({"type": "done", "full": ""})
        return

    # Stage 2 — expert
    effective_intent = "other" if intent == "divination" else intent

    # Bypass: consume existing cta (atomic with assistant insert at end)
    if bypass_divination:
        await msg_svc.delete_last_cta(db, conversation_id=conversation_id)

    retrieved: list[dict] = []
    if effective_intent != "chitchat":
        try:
            retrieved = await retrieve_for_chart(chart.paipan, effective_intent)
        except Exception:  # noqa: BLE001 — retrieval is best-effort
            retrieved = []
    if retrieved:
        sources = " + ".join(h.get("source", "?") for h in retrieved)
        yield sse_pack({"type": "retrieval", "source": sources})

    messages_llm = prompts_expert.build_messages(
        paipan=chart.paipan, history=history,
        user_message=message, intent=effective_intent,
        retrieved=retrieved,
    )

    accumulator = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err: UpstreamLLMError | None = None

    try:
        async for ev in chat_stream_with_fallback(
            messages=messages_llm, tier="primary",
            temperature=0.7, max_tokens=5000,
            first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
        ):
            t = ev["type"]
            if t == "model":
                model_used = ev["modelUsed"]
                yield sse_pack(ev)
            elif t == "delta":
                accumulator += ev["text"]
                yield sse_pack(ev)
            elif t == "done":
                prompt_tok = ev.get("prompt_tokens", 0) or 0
                completion_tok = ev.get("completion_tokens", 0) or 0
                total_tok = ev.get("tokens_used", 0) or 0
                # NOTE: do NOT yield done yet — commit-before-done invariant
    except UpstreamLLMError as e:
        err = e
        yield sse_pack({"type": "error", "code": e.code, "message": e.message})

    duration_ms = int((time.monotonic() - t_start) * 1000)

    if err is not None:
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="chat:expert", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"{err.code}: {err.message}",
        )
        return

    # Success path: commit ticket BEFORE writing assistant + emitting done
    try:
        await ticket.commit()
    except QuotaExceededError as e:
        yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="chat:expert", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"QUOTA_EXCEEDED: {e}",
        )
        return

    # Insert assistant + log + emit done
    await msg_svc.insert(
        db, conversation_id=conversation_id, role="assistant",
        content=accumulator,
        meta={
            "intent": effective_intent,
            "model_used": model_used,
            "retrieval_source": (
                " + ".join(h.get("source", "?") for h in retrieved) if retrieved else None
            ),
        },
    )
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart.id,
        endpoint="chat:expert", model=model_used,
        prompt_tokens=prompt_tok, completion_tokens=completion_tok,
        duration_ms=duration_ms,
    )
    yield sse_pack({"type": "done", "full": accumulator})
```

- [ ] **Step 7.6: Run tests — confirm GREEN**

```
uv run --package server pytest \
    server/tests/unit/test_services_chat_router.py \
    server/tests/unit/test_services_conversation_chat.py -v
```
Expected: 7 passed.

- [ ] **Step 7.7: Commit**

```bash
git add server/app/services/chat_router.py \
        server/app/services/conversation_chat.py \
        server/tests/unit/test_services_chat_router.py \
        server/tests/unit/test_services_conversation_chat.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 chat orchestrator (Stage 1 router + Stage 2 expert)

chat_router.classify() runs keyword fast-path then LLM fallback (FAST tier),
logs to llm_usage_logs as 'chat:router'. conversation_chat.stream_message()
orchestrates: load history → INSERT user → classify → divination redirect
(write cta + commit) OR expert stream → commit-before-done → INSERT
assistant + emit done. LLM errors keep user row, do not commit ticket.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: services/conversation_gua.py + chart_chips history wiring

**Files:**
- Create: `server/app/services/conversation_gua.py`
- Modify: `server/app/services/chart_chips.py` (accept `conversation_id`)
- Test: `server/tests/unit/test_services_conversation_gua.py`
- Test: `server/tests/unit/test_chart_chips_history.py`

- [ ] **Step 8.1: Write failing tests for conversation_gua**

Create `server/tests/unit/test_services_conversation_gua.py`:

```python
"""services/conversation_gua: cast + LLM SSE generator + cta consume."""
from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.db_types import user_dek_context
from app.services import conversation as conv_svc
from app.services import conversation_gua as cg
from app.services import message as msg_svc
from app.services.exceptions import UpstreamLLMError
from app.services.quota import QuotaTicket


pytestmark = pytest.mark.asyncio


async def _consume(gen) -> list[dict]:
    out = []
    async for raw in gen:
        line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        for chunk in line.split("\n\n"):
            chunk = chunk.strip()
            if chunk.startswith("data: "):
                out.append(json.loads(chunk[len("data: "):]))
    return out


def _fake_stream_factory(deltas, model="mimo-v2-pro"):
    async def _f(**kwargs):
        yield {"type": "model", "modelUsed": model}
        for d in deltas:
            yield {"type": "delta", "text": d}
        yield {"type": "done", "tokens_used": 100,
               "prompt_tokens": 30, "completion_tokens": 70}
    return _f


async def test_gua_happy_path_writes_role_gua_message(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()

        monkeypatch.setattr("app.services.conversation_gua.chat_stream_with_fallback",
                             _fake_stream_factory(["§卦象\n", "雷"]))

        ticket = QuotaTicket(user=user, kind="gua", limit=20, _db=db_session)
        events = await _consume(cg.stream_gua(
            db=db_session, user=user, conversation_id=c.id, chart=chart,
            question="该不该跳槽", ticket=ticket,
        ))
        await db_session.commit()

        types = [e["type"] for e in events]
        assert types[0] == "gua"
        assert "model" in types and "delta" in types
        assert types[-1] == "done"

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["gua"]
        gua_msg = page["items"][0]
        assert gua_msg.content is None
        assert "gua" in gua_msg.meta and "question" in gua_msg.meta
        assert gua_msg.meta["question"] == "该不该跳槽"


async def test_gua_consumes_existing_cta(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        await msg_svc.insert(db_session, conversation_id=c.id, role="user",
                              content="该不该 X")
        await msg_svc.insert(db_session, conversation_id=c.id, role="cta",
                              content=None, meta={"question": "该不该 X"})
        await db_session.commit()

        monkeypatch.setattr("app.services.conversation_gua.chat_stream_with_fallback",
                             _fake_stream_factory(["占算"]))

        ticket = QuotaTicket(user=user, kind="gua", limit=20, _db=db_session)
        events = await _consume(cg.stream_gua(
            db=db_session, user=user, conversation_id=c.id, chart=chart,
            question="该不该 X", ticket=ticket,
        ))
        await db_session.commit()

        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        roles = [m.role for m in page["items"]]
        assert roles == ["gua", "user"]   # cta gone


async def test_gua_llm_error_writes_no_message(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()

        async def _boom(**kwargs):
            yield {"type": "model", "modelUsed": "mimo-v2-pro"}
            raise UpstreamLLMError(code="UPSTREAM_LLM_TIMEOUT", message="boom")

        monkeypatch.setattr("app.services.conversation_gua.chat_stream_with_fallback", _boom)

        ticket = QuotaTicket(user=user, kind="gua", limit=20, _db=db_session)
        events = await _consume(cg.stream_gua(
            db=db_session, user=user, conversation_id=c.id, chart=chart,
            question="?", ticket=ticket,
        ))
        await db_session.commit()

        types = [e["type"] for e in events]
        assert types[-1] == "error"
        page = await msg_svc.paginate(db_session, conversation_id=c.id,
                                       before=None, limit=10)
        assert page["items"] == []
```

- [ ] **Step 8.2: Create `server/app/services/conversation_gua.py`**

```python
"""Gua SSE generator. NOTE: spec §6."""
from __future__ import annotations

import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.client import chat_stream_with_fallback
from app.llm.events import sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.user import User
from app.prompts.gua import build_messages as build_gua_messages
from app.services import message as msg_svc
from app.services.exceptions import QuotaExceededError, UpstreamLLMError
from app.services.gua_cast import cast_gua
from app.services.quota import QuotaTicket


def _derive_birth_context(paipan: dict) -> dict:
    """Pick rizhu + current dayun gz + current year gz from chart.paipan.

    NOTE: spec §6.3.
    """
    meta = paipan.get("META") or {}
    today = meta.get("today") or {}
    rizhu = meta.get("rizhu")

    today_year_str = (today.get("ymd") or "")[:4]
    today_year = int(today_year_str) if today_year_str.isdigit() else None

    current_dayun_gz = None
    if today_year is not None:
        for step in paipan.get("DAYUN") or []:
            try:
                sy, ey = int(step.get("startYear")), int(step.get("endYear"))
            except (TypeError, ValueError):
                continue
            if sy <= today_year <= ey:
                current_dayun_gz = step.get("gz")
                break

    return {
        "rizhu": rizhu,
        "currentDayun": current_dayun_gz,
        "currentYear": today.get("yearGz"),
    }


async def stream_gua(
    *, db: AsyncSession, user: User, conversation_id: UUID,
    chart, question: str, ticket: QuotaTicket,
) -> AsyncIterator[bytes]:
    """Cast hexagram → emit gua → stream LLM → consume cta → INSERT gua msg.

    NOTE: spec §6.1.
    """
    gua = cast_gua(datetime.now(tz=timezone.utc))
    yield sse_pack({"type": "gua", "data": gua})

    birth_ctx = _derive_birth_context(chart.paipan)
    messages_llm = build_gua_messages(question=question, gua=gua, birth_context=birth_ctx)

    accumulator = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err: UpstreamLLMError | None = None

    try:
        async for ev in chat_stream_with_fallback(
            messages=messages_llm, tier="primary",
            temperature=0.7, max_tokens=2000,
            first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
        ):
            t = ev["type"]
            if t == "model":
                model_used = ev["modelUsed"]
                yield sse_pack(ev)
            elif t == "delta":
                accumulator += ev["text"]
                yield sse_pack(ev)
            elif t == "done":
                prompt_tok = ev.get("prompt_tokens", 0) or 0
                completion_tok = ev.get("completion_tokens", 0) or 0
                total_tok = ev.get("tokens_used", 0) or 0
    except UpstreamLLMError as e:
        err = e
        yield sse_pack({"type": "error", "code": e.code, "message": e.message})

    duration_ms = int((time.monotonic() - t_start) * 1000)

    if err is not None:
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="gua", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"{err.code}: {err.message}",
        )
        return

    try:
        await ticket.commit()
    except QuotaExceededError as e:
        yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="gua", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"QUOTA_EXCEEDED: {e}",
        )
        return

    # Consume cta if present (atomic with insert below — single db.commit at route level)
    await msg_svc.delete_last_cta(db, conversation_id=conversation_id)
    await msg_svc.insert(
        db, conversation_id=conversation_id, role="gua",
        content=None,
        meta={
            "gua": gua, "question": question,
            "body": accumulator, "model_used": model_used,
        },
    )
    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=chart.id,
        endpoint="gua", model=model_used,
        prompt_tokens=prompt_tok, completion_tokens=completion_tok,
        duration_ms=duration_ms,
    )
    yield sse_pack({"type": "done", "full": accumulator})
```

- [ ] **Step 8.3: Write failing test for chart_chips history wiring**

Create `server/tests/unit/test_chart_chips_history.py`:

```python
"""chart_chips: history injection when conversation_id is provided. NOTE: spec §9."""
from __future__ import annotations

import json

import pytest

from app.db_types import user_dek_context
from app.services import chart_chips
from app.services import conversation as conv_svc
from app.services import message as msg_svc


pytestmark = pytest.mark.asyncio


async def test_stream_chips_loads_history_when_conversation_id_given(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    captured_history = {}

    def _fake_build(paipan, history):
        captured_history["value"] = list(history)
        return [{"role": "system", "content": "x"}, {"role": "user", "content": "y"}]

    async def _fake_stream(**kwargs):
        yield {"type": "model", "modelUsed": "fast"}
        yield {"type": "delta", "text": "[]"}
        yield {"type": "done", "tokens_used": 5}

    monkeypatch.setattr("app.services.chart_chips.build_messages", _fake_build)
    monkeypatch.setattr("app.services.chart_chips.chat_stream_with_fallback", _fake_stream)

    with user_dek_context(dek):
        c = await conv_svc.create_conversation(db_session, user, chart.id)
        await db_session.commit()
        await msg_svc.insert(db_session, conversation_id=c.id, role="user", content="u1")
        await msg_svc.insert(db_session, conversation_id=c.id, role="assistant", content="a1")
        await db_session.commit()

        async for _ in chart_chips.stream_chips(
            db_session, user, chart, conversation_id=c.id,
        ):
            pass

    hist = captured_history["value"]
    assert [h["role"] for h in hist] == ["user", "assistant"]
    assert [h["content"] for h in hist] == ["u1", "a1"]


async def test_stream_chips_history_empty_when_conversation_id_none(monkeypatch, db_session, seeded):
    user, chart, dek = seeded["user"], seeded["chart"], seeded["dek"]
    captured_history = {}

    def _fake_build(paipan, history):
        captured_history["value"] = list(history)
        return [{"role": "system", "content": "x"}]

    async def _fake_stream(**kwargs):
        yield {"type": "model", "modelUsed": "fast"}
        yield {"type": "done", "tokens_used": 1}

    monkeypatch.setattr("app.services.chart_chips.build_messages", _fake_build)
    monkeypatch.setattr("app.services.chart_chips.chat_stream_with_fallback", _fake_stream)

    with user_dek_context(dek):
        async for _ in chart_chips.stream_chips(
            db_session, user, chart, conversation_id=None,
        ):
            pass
    assert captured_history["value"] == []
```

- [ ] **Step 8.4: Modify `server/app/services/chart_chips.py`**

Read the current file first, then change the signature to accept
`conversation_id: UUID | None = None` and inject history. Append `from
app.services import message as msg_svc` and use `msg_svc.recent_chat_history`
to load up to 6 messages.

Diff sketch (apply to actual file):

```python
# top of file, add:
from typing import Optional
from uuid import UUID

# replace the function signature + body around build_messages call:
async def stream_chips(
    db: AsyncSession, user: User, chart: Chart,
    conversation_id: Optional[UUID] = None,
) -> AsyncIterator[bytes]:
    history: list[dict] = []
    if conversation_id is not None:
        from app.services import message as _msg
        history = await _msg.recent_chat_history(
            db, conversation_id=conversation_id, limit=6,
        )
    messages = build_messages(chart.paipan, history=history)
    # ... rest unchanged
```

Keep the existing log endpoint name (`endpoint="chips"`) and FAST_MODEL tier.

- [ ] **Step 8.5: Run tests — confirm GREEN**

```
uv run --package server pytest \
    server/tests/unit/test_services_conversation_gua.py \
    server/tests/unit/test_chart_chips_history.py -v
```
Expected: 5 passed.

Re-run the full unit suite to make sure no regression on existing chips tests:
```
uv run --package server pytest server/tests/unit/ -v
```
Expected: all green; existing `test_chart_chips*.py` tests should still pass
(they call `stream_chips` without `conversation_id`, which defaults to None).

- [ ] **Step 8.6: Commit**

```bash
git add server/app/services/conversation_gua.py \
        server/app/services/chart_chips.py \
        server/tests/unit/test_services_conversation_gua.py \
        server/tests/unit/test_chart_chips_history.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 gua orchestrator + chips history wiring

conversation_gua.stream_gua casts hexagram, emits gua event, streams
LLM, then consumes cta + INSERTs role='gua' message on success
(commit-before-done invariant; LLM error → no message, no commit).
chart_chips.stream_chips now accepts optional conversation_id and
loads the last 6 user/assistant messages as history input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: api/conversations.py + main.py wire + chips_endpoint extension + integration tests for CRUD/ownership/soft-delete/pagination

**Files:**
- Create: `server/app/api/conversations.py`
- Modify: `server/app/main.py` (include router)
- Modify: `server/app/api/charts.py` (chips_endpoint accepts `?conversation_id=`)
- Test: `server/tests/integration/test_conversations_crud.py`
- Test: `server/tests/integration/test_conversations_ownership.py`
- Test: `server/tests/integration/test_conversations_soft_delete.py`
- Test: `server/tests/integration/test_messages_pagination.py`

- [ ] **Step 9.1: Create `server/app/api/conversations.py`**

```python
"""Conversation/message/gua HTTP layer. NOTE: spec §3.1."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import check_quota, current_user
from app.core.db import get_db
from app.models.conversation import Conversation
from app.models.user import User
from app.schemas.chat import ChatMessageRequest
from app.schemas.conversation import (
    ConversationCreateRequest,
    ConversationDetail,
    ConversationListResponse,
    ConversationPatchRequest,
)
from app.schemas.gua import GuaCastRequest
from app.schemas.message import MessagesListResponse
from app.services import chart as chart_service
from app.services import conversation as conv_svc
from app.services import conversation_chat as cc
from app.services import conversation_gua as cg
from app.services import message as msg_svc
from app.services.exceptions import ServiceError


router = APIRouter(tags=["conversations"], dependencies=[Depends(current_user)])


def _http_error(err: ServiceError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.to_dict())


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


# ---- chart-scoped: list + create ----

@router.get("/api/charts/{chart_id}/conversations",
             response_model=ConversationListResponse)
async def list_conversations_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationListResponse:
    try:
        items = await conv_svc.list_conversations(db, user, chart_id)
    except ServiceError as e:
        raise _http_error(e)
    return ConversationListResponse(items=items)


@router.post("/api/charts/{chart_id}/conversations",
              response_model=ConversationDetail,
              status_code=status.HTTP_201_CREATED)
async def create_conversation_endpoint(
    chart_id: UUID,
    body: ConversationCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationDetail:
    try:
        d = await conv_svc.create_conversation(db, user, chart_id, label=body.label)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return d


# ---- single conversation ----

@router.get("/api/conversations/{conv_id}", response_model=ConversationDetail)
async def get_conversation_endpoint(
    conv_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationDetail:
    try:
        return await conv_svc.get_conversation(db, user, conv_id)
    except ServiceError as e:
        raise _http_error(e)


@router.patch("/api/conversations/{conv_id}", response_model=ConversationDetail)
async def patch_conversation_endpoint(
    conv_id: UUID,
    body: ConversationPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationDetail:
    try:
        d = await conv_svc.patch_label(db, user, conv_id, body.label)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return d


@router.delete("/api/conversations/{conv_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation_endpoint(
    conv_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> Response:
    try:
        await conv_svc.soft_delete(db, user, conv_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/conversations/{conv_id}/restore", response_model=ConversationDetail)
async def restore_conversation_endpoint(
    conv_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationDetail:
    try:
        d = await conv_svc.restore(db, user, conv_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return d


# ---- messages: paginate + post (SSE) ----

@router.get("/api/conversations/{conv_id}/messages",
             response_model=MessagesListResponse)
async def list_messages_endpoint(
    conv_id: UUID,
    before: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> MessagesListResponse:
    # Owner check: must reach the conv via chart owned by user
    try:
        await conv_svc.get_conversation(db, user, conv_id)
    except ServiceError as e:
        raise _http_error(e)
    try:
        page = await msg_svc.paginate(db, conversation_id=conv_id,
                                        before=before, limit=limit)
    except ValueError as ve:
        raise HTTPException(status_code=422,
                             detail={"code": "VALIDATION", "message": str(ve)})
    return MessagesListResponse(items=page["items"], next_cursor=page["next_cursor"])


@router.post("/api/conversations/{conv_id}/messages")
async def post_message_endpoint(
    conv_id: UUID,
    body: ChatMessageRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
    ticket = Depends(check_quota("chat_message")),
):
    # Resolve conv → chart in a single owner-checked path
    try:
        conv: ConversationDetail = await conv_svc.get_conversation(db, user, conv_id)
        if conv.deleted_at is not None:
            raise _http_error(__import__("app.services.exceptions", fromlist=["NotFoundError"]).NotFoundError(message="对话不存在"))
        # Need raw Conversation row to load chart; use a small helper
        raw = await conv_svc._get_owned_conversation_row(db, user, conv_id)
        chart = await chart_service.get_chart(db, user, raw.chart_id)
    except ServiceError as e:
        raise _http_error(e)

    async def _gen():
        async for raw_b in cc.stream_message(
            db=db, user=user, conversation_id=conv_id,
            chart=chart, message=body.message,
            bypass_divination=body.bypass_divination,
            ticket=ticket,
        ):
            yield raw_b
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream",
                              headers=_SSE_HEADERS)


@router.post("/api/conversations/{conv_id}/gua")
async def post_gua_endpoint(
    conv_id: UUID,
    body: GuaCastRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
    ticket = Depends(check_quota("gua")),
):
    try:
        raw = await conv_svc._get_owned_conversation_row(db, user, conv_id)
        chart = await chart_service.get_chart(db, user, raw.chart_id)
    except ServiceError as e:
        raise _http_error(e)

    async def _gen():
        async for raw_b in cg.stream_gua(
            db=db, user=user, conversation_id=conv_id, chart=chart,
            question=body.question, ticket=ticket,
        ):
            yield raw_b
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream",
                              headers=_SSE_HEADERS)
```

- [ ] **Step 9.2: Wire router into `server/app/main.py`**

Read main.py, then add:

```python
from app.api.conversations import router as conversations_router
# ...
app.include_router(conversations_router)
```

(Order does not matter; place near other includes.)

- [ ] **Step 9.3: Modify `server/app/api/charts.py::chips_endpoint`**

Add `conversation_id` query param + forward to service:

```python
@router.post("/{chart_id}/chips")
async def chips_endpoint(
    chart_id: UUID,
    conversation_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    try:
        chart = await chart_service.get_chart(db, user, chart_id)
    except ServiceError as e:
        raise _http_error(e)

    async def _gen():
        async for raw in chart_chips_service.stream_chips(
            db, user, chart, conversation_id=conversation_id,
        ):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream",
                              headers=_SSE_HEADERS)
```

(Replace the existing `chips_endpoint` body — only the query param + the
`conversation_id=conversation_id` kwarg are new.)

- [ ] **Step 9.4: Write CRUD integration tests**

Create `server/tests/integration/test_conversations_crud.py`:

```python
"""Integration: conversations CRUD round-trip."""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_create_then_list_then_get(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    # create
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={"label": "工作"})
    assert r.status_code == 201
    conv = r.json()
    assert conv["label"] == "工作" and conv["position"] == 0

    # list
    r2 = await authed_client.get(f"/api/charts/{cid}/conversations")
    assert r2.status_code == 200
    assert len(r2.json()["items"]) == 1

    # get single
    r3 = await authed_client.get(f"/api/conversations/{conv['id']}")
    assert r3.status_code == 200
    assert r3.json()["message_count"] == 0


async def test_create_default_label(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    assert r.status_code == 201
    assert r.json()["label"] == "对话 1"

    r2 = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    assert r2.json()["label"] == "对话 2"
    assert r2.json()["position"] == 1


async def test_patch_label(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    r2 = await authed_client.patch(f"/api/conversations/{conv_id}", json={"label": "感情"})
    assert r2.status_code == 200
    assert r2.json()["label"] == "感情"


async def test_patch_label_blank_422(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    r2 = await authed_client.patch(f"/api/conversations/{conv_id}", json={"label": "   "})
    assert r2.status_code == 422


async def test_delete_returns_204_and_hides_from_list(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    rd = await authed_client.delete(f"/api/conversations/{conv_id}")
    assert rd.status_code == 204
    rl = await authed_client.get(f"/api/charts/{cid}/conversations")
    assert rl.json()["items"] == []
```

The fixture names `authed_client` and `chart_fixture` should match what
`server/tests/conftest.py` provides for the existing chart-CRUD integration
tests. Read `tests/integration/test_charts_crud.py` first to see the actual
fixture names; reuse them. If they don't exist, add small wrappers in
`conftest.py`:

```python
@pytest_asyncio.fixture
async def chart_fixture(authed_client):
    """A freshly-created chart belonging to the authed test user."""
    r = await authed_client.post("/api/charts", json={...})  # match existing CRUD body
    return r.json()["chart"]
```

- [ ] **Step 9.5: Write ownership integration test**

Create `server/tests/integration/test_conversations_ownership.py`:

```python
"""Integration: cross-user 404 on every conversation/message route."""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_cross_user_get_404(authed_client, second_authed_client, chart_fixture):
    """Conv created by user A is invisible to user B."""
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    r2 = await second_authed_client.get(f"/api/conversations/{conv_id}")
    assert r2.status_code == 404


async def test_cross_user_patch_404(authed_client, second_authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    r2 = await second_authed_client.patch(f"/api/conversations/{conv_id}", json={"label": "x"})
    assert r2.status_code == 404


async def test_cross_user_delete_404(authed_client, second_authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    r2 = await second_authed_client.delete(f"/api/conversations/{conv_id}")
    assert r2.status_code == 404


async def test_cross_user_messages_404(authed_client, second_authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    r2 = await second_authed_client.get(f"/api/conversations/{conv_id}/messages")
    assert r2.status_code == 404
```

If `second_authed_client` fixture doesn't exist, add it to `conftest.py` in
the same shape as `authed_client` (different cookie / DEK).

- [ ] **Step 9.6: Write soft-delete integration test**

Create `server/tests/integration/test_conversations_soft_delete.py`:

```python
"""Integration: soft-delete + restore (within 30d window) + 410 outside."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text


pytestmark = pytest.mark.asyncio


async def test_restore_within_window(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    await authed_client.delete(f"/api/conversations/{conv_id}")
    r2 = await authed_client.post(f"/api/conversations/{conv_id}/restore")
    assert r2.status_code == 200
    assert r2.json()["deleted_at"] is None


async def test_restore_outside_window_410(authed_client, chart_fixture, db_session):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    await authed_client.delete(f"/api/conversations/{conv_id}")
    # Backdate deleted_at past 30 days
    old = datetime.now(tz=timezone.utc) - timedelta(days=31)
    await db_session.execute(
        text("UPDATE conversations SET deleted_at = :d WHERE id = :id"),
        {"d": old, "id": conv_id},
    )
    await db_session.commit()
    r2 = await authed_client.post(f"/api/conversations/{conv_id}/restore")
    assert r2.status_code == 410
    assert r2.json()["detail"]["code"] == "GONE"
```

- [ ] **Step 9.7: Write pagination integration test**

Create `server/tests/integration/test_messages_pagination.py`:

```python
"""Integration: keyset pagination over messages."""
from __future__ import annotations

import asyncio

import pytest


pytestmark = pytest.mark.asyncio


async def test_pagination_three_pages_of_60(authed_client, chart_fixture, db_session):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    # Seed 60 messages directly via the message service (faster than POSTs)
    from app.services import message as msg_svc
    from uuid import UUID
    for i in range(60):
        await msg_svc.insert(db_session, conversation_id=UUID(conv_id),
                              role="user", content=f"m{i}")
        await db_session.commit()
        await asyncio.sleep(0.001)

    r1 = await authed_client.get(
        f"/api/conversations/{conv_id}/messages?limit=25"
    )
    assert r1.status_code == 200
    page1 = r1.json()
    assert len(page1["items"]) == 25
    assert page1["items"][0]["content"] == "m59"
    assert page1["next_cursor"] is not None

    r2 = await authed_client.get(
        f"/api/conversations/{conv_id}/messages?limit=25&before={page1['next_cursor']}"
    )
    page2 = r2.json()
    assert len(page2["items"]) == 25
    assert page2["items"][0]["content"] == "m34"

    r3 = await authed_client.get(
        f"/api/conversations/{conv_id}/messages?limit=25&before={page2['next_cursor']}"
    )
    page3 = r3.json()
    assert len(page3["items"]) == 10
    assert page3["next_cursor"] is None


async def test_pagination_limit_validation(authed_client, chart_fixture):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]
    r1 = await authed_client.get(f"/api/conversations/{conv_id}/messages?limit=0")
    assert r1.status_code == 422
    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages?limit=101")
    assert r2.status_code == 422
```

- [ ] **Step 9.8: Run integration tests — confirm GREEN**

```
uv run --package server pytest server/tests/integration/test_conversations_crud.py \
    server/tests/integration/test_conversations_ownership.py \
    server/tests/integration/test_conversations_soft_delete.py \
    server/tests/integration/test_messages_pagination.py -v
```
Expected: all green.

- [ ] **Step 9.9: Verify OpenAPI lists new routes**

```bash
uv run --package server python -c "
from app.main import app
import json
paths = sorted(app.openapi()['paths'].keys())
for p in paths:
    if 'conversation' in p or 'gua' in p or 'messages' in p:
        print(p)
"
```
Expected output includes:
```
/api/charts/{chart_id}/conversations
/api/conversations/{conv_id}
/api/conversations/{conv_id}/gua
/api/conversations/{conv_id}/messages
/api/conversations/{conv_id}/restore
```

- [ ] **Step 9.10: Commit**

```bash
git add server/app/api/conversations.py server/app/main.py \
        server/app/api/charts.py \
        server/tests/integration/test_conversations_crud.py \
        server/tests/integration/test_conversations_ownership.py \
        server/tests/integration/test_conversations_soft_delete.py \
        server/tests/integration/test_messages_pagination.py \
        server/tests/conftest.py    # if any new fixtures added
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 6 conversations API + chips conversation_id query

Adds 7 new HTTP routes (list/create conversation under chart,
get/patch/delete/restore single, list/post messages, post gua) plus
chips_endpoint optional ?conversation_id= for history injection.
Wires router in main.py. Integration tests cover CRUD round-trip,
cross-user 404 on every endpoint, soft-delete + 30d restore window
(410 GONE outside), and 60-row keyset pagination over 3 pages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Integration tests — chat SSE (happy / divination / quota / LLM error)

**Files:**
- Test: `server/tests/integration/test_chat_sse_happy.py`
- Test: `server/tests/integration/test_chat_sse_divination.py`
- Test: `server/tests/integration/test_chat_sse_quota.py`
- Test: `server/tests/integration/test_chat_sse_llm_error.py`

These tests monkeypatch `app.llm.client._client` to a fake AsyncOpenAI (same
strategy Plan 5 used for chart_llm integration tests). Look at
`server/tests/integration/test_charts_verdicts_sse.py` (or similar Plan 5
test) to see exactly how the fake LLM is wired — reuse that pattern.

- [ ] **Step 10.1: Find Plan 5's fake-LLM helper**

```bash
grep -rn "_client\|FakeOpenAI\|fake.*openai\|monkeypatch.*llm" server/tests/integration/ | head
```

Identify the helper (likely `server/tests/integration/_llm_fake.py` or inline
in conftest). Reuse it; do not invent a parallel mock.

- [ ] **Step 10.2: Write happy-path SSE test**

Create `server/tests/integration/test_chat_sse_happy.py`:

```python
"""Integration: POST /messages happy path (router → expert → assistant row)."""
from __future__ import annotations

import json

import pytest


pytestmark = pytest.mark.asyncio


def _parse_sse(text: str) -> list[dict]:
    out = []
    for chunk in text.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            out.append(json.loads(chunk[len("data: "):]))
    return out


async def test_chat_message_happy_path(authed_client, chart_fixture, fake_llm):
    """Keyword route → expert stream → assistant row + done."""
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    fake_llm.set_stream(["你想问的", "事业", "方向"])

    async with authed_client.stream(
        "POST", f"/api/conversations/{conv_id}/messages",
        json={"message": "我想换工作", "bypass_divination": False},
    ) as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    events = _parse_sse(body)
    types = [e["type"] for e in events]
    assert types[0] == "intent"
    assert events[0]["intent"] == "career"
    assert "model" in types and "delta" in types
    assert types[-1] == "done"

    # Verify rows
    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    items = r2.json()["items"]
    roles = [m["role"] for m in items]
    assert roles == ["assistant", "user"]
    assert items[0]["content"] == "你想问的事业方向"
    assert items[1]["content"] == "我想换工作"


async def test_chat_message_loads_history(authed_client, chart_fixture, fake_llm):
    """Second message includes prior turn in expert prompt."""
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    fake_llm.set_stream(["A1"])
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "事业方向 A"}) as resp:
        async for _ in resp.aiter_text():
            pass

    captured_messages = []
    fake_llm.capture_next(captured_messages)
    fake_llm.set_stream(["A2"])
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "事业方向 B"}) as resp:
        async for _ in resp.aiter_text():
            pass

    # Second-call expert prompt should include "事业方向 A" + "A1"
    full_text = json.dumps(captured_messages, ensure_ascii=False)
    assert "事业方向 A" in full_text
    assert "A1" in full_text
```

The `fake_llm` fixture is whatever Plan 5 uses; if its API is different
(e.g. `set_response_text` instead of `set_stream`, `last_messages` instead
of `capture_next`), adapt. The intent is to assert that history is being
fed to Stage 2.

- [ ] **Step 10.3: Write divination + bypass test**

Create `server/tests/integration/test_chat_sse_divination.py`:

```python
"""Integration: divination redirect writes cta; bypass consumes cta."""
from __future__ import annotations

import json

import pytest

from server.tests.integration.test_chat_sse_happy import _parse_sse


pytestmark = pytest.mark.asyncio


async def test_divination_redirects_and_writes_cta(authed_client, chart_fixture, fake_llm):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    # divination keyword → no LLM expected for expert path; router uses keyword fast-path
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "我能不能买这套房子"}) as resp:
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    events = _parse_sse(body)
    types = [e["type"] for e in events]
    assert "redirect" in types
    redirect = next(e for e in events if e["type"] == "redirect")
    assert redirect["to"] == "gua"
    assert redirect["question"] == "我能不能买这套房子"
    assert types[-1] == "done"

    # DB rows: user + cta
    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    items = r2.json()["items"]
    roles = [m["role"] for m in items]
    assert roles == ["cta", "user"]
    assert items[0]["meta"]["question"] == "我能不能买这套房子"


async def test_bypass_divination_consumes_cta_and_writes_assistant(
    authed_client, chart_fixture, fake_llm,
):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    # First, trigger a cta
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "我能不能换工作"}) as resp:
        async for _ in resp.aiter_text():
            pass

    # Now bypass — expect cta gone, assistant in
    fake_llm.set_stream(["分", "析"])
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "用命盘分析就好",
                                            "bypass_divination": True}) as resp:
        async for _ in resp.aiter_text():
            pass

    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    items = r2.json()["items"]
    roles = [m["role"] for m in items]
    assert "cta" not in roles
    assert roles[0] == "assistant"
```

- [ ] **Step 10.4: Write quota tests**

Create `server/tests/integration/test_chat_sse_quota.py`:

```python
"""Integration: chat_message quota — pre-check 429 + race-on-commit error."""
from __future__ import annotations

import json

import pytest
from sqlalchemy import text


pytestmark = pytest.mark.asyncio


async def test_chat_quota_precheck_429(authed_client, chart_fixture, db_session, current_user):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    # Saturate chat_message quota directly in the DB
    from app.core.quotas import today_beijing, QUOTAS
    limit = QUOTAS["free"]["chat_message"]
    await db_session.execute(text("""
        INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
        VALUES (:uid, :p, 'chat_message', :c, now())
        ON CONFLICT (user_id, period, kind) DO UPDATE SET count = EXCLUDED.count
    """), {"uid": current_user.id, "p": today_beijing(), "c": limit})
    await db_session.commit()

    r2 = await authed_client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"message": "你好"},
    )
    assert r2.status_code == 429
    assert r2.json()["detail"]["code"] == "QUOTA_EXCEEDED"
    assert "Retry-After" in {k: v for k, v in r2.headers.items()}


async def test_chat_quota_race_on_commit_emits_error_no_assistant(
    authed_client, chart_fixture, db_session, current_user, fake_llm, monkeypatch,
):
    """If a concurrent request consumes the last quota slot during expert streaming,
    ticket.commit() raises and we emit error instead of done. No assistant row written."""
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    fake_llm.set_stream(["partial response"])

    # Patch QuotaTicket.commit to raise the race exception
    from app.services.exceptions import QuotaExceededError
    from app.services.quota import QuotaTicket

    async def _race_commit(self):
        raise QuotaExceededError(kind="chat_message", limit=30)

    monkeypatch.setattr(QuotaTicket, "commit", _race_commit)

    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "事业问题"}) as resp:
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    events = []
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            events.append(json.loads(chunk[len("data: "):]))
    types = [e["type"] for e in events]
    assert types[-1] == "error"
    assert events[-1]["code"] == "QUOTA_EXCEEDED"

    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    roles = [m["role"] for m in r2.json()["items"]]
    assert "assistant" not in roles    # only user remains
```

The `current_user` fixture should give the User row backing `authed_client`'s
session — verify in conftest. If named differently (e.g. `authed_user`),
adapt.

- [ ] **Step 10.5: Write LLM error test**

Create `server/tests/integration/test_chat_sse_llm_error.py`:

```python
"""Integration: chat expert LLM error keeps user row, no assistant, no quota commit."""
from __future__ import annotations

import json

import pytest


pytestmark = pytest.mark.asyncio


async def test_chat_llm_error_keeps_user_no_assistant(
    authed_client, chart_fixture, fake_llm, db_session, current_user,
):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    fake_llm.set_double_failure()    # primary + fallback both raise

    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "事业方向"}) as resp:
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    events = []
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            events.append(json.loads(chunk[len("data: "):]))
    types = [e["type"] for e in events]
    assert types[-1] == "error"

    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    roles = [m["role"] for m in r2.json()["items"]]
    assert roles == ["user"]    # assistant NOT written

    # Quota NOT charged
    from sqlalchemy import text
    from app.core.quotas import today_beijing
    row = (await db_session.execute(text("""
        SELECT count FROM quota_usage
         WHERE user_id = :uid AND period = :p AND kind = 'chat_message'
    """), {"uid": current_user.id, "p": today_beijing()})).first()
    assert row is None or row[0] == 0
```

If `fake_llm.set_double_failure()` is named differently in Plan 5's helper
(e.g. `set_primary_and_fallback_error()`), adapt.

- [ ] **Step 10.6: Run all chat SSE integration tests**

```
uv run --package server pytest \
    server/tests/integration/test_chat_sse_happy.py \
    server/tests/integration/test_chat_sse_divination.py \
    server/tests/integration/test_chat_sse_quota.py \
    server/tests/integration/test_chat_sse_llm_error.py -v
```
Expected: all green.

- [ ] **Step 10.7: Commit**

```bash
git add server/tests/integration/test_chat_sse_happy.py \
        server/tests/integration/test_chat_sse_divination.py \
        server/tests/integration/test_chat_sse_quota.py \
        server/tests/integration/test_chat_sse_llm_error.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(server): Plan 6 chat SSE integration coverage

Covers happy-path event order + DB row writes, history injection
across turns, divination redirect + cta persistence, bypass-divination
cta consume, chat_message pre-check 429 + race-on-commit error event,
and LLM error keeping user row without committing quota.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Integration tests — gua SSE + chips history

**Files:**
- Test: `server/tests/integration/test_gua_sse_happy.py`
- Test: `server/tests/integration/test_gua_sse_consume_cta.py`
- Test: `server/tests/integration/test_gua_sse_quota.py`
- Test: `server/tests/integration/test_chips_history.py`

- [ ] **Step 11.1: Write gua SSE happy test**

Create `server/tests/integration/test_gua_sse_happy.py`:

```python
"""Integration: POST /gua happy path (cast + LLM + role='gua' message)."""
from __future__ import annotations

import json

import pytest


pytestmark = pytest.mark.asyncio


async def test_gua_happy_path(authed_client, chart_fixture, fake_llm):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    fake_llm.set_stream(["§卦象\n", "雷雨同作", "\n\n§原文\n> 卦辞..."])

    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/gua",
                                      json={"question": "该不该跳槽"}) as resp:
        assert resp.status_code == 200
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    events = []
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            events.append(json.loads(chunk[len("data: "):]))
    types = [e["type"] for e in events]
    assert types[0] == "gua"
    gua_event = events[0]
    assert "name" in gua_event["data"] and "guaci" in gua_event["data"]
    assert "model" in types and "delta" in types
    assert types[-1] == "done"

    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    items = r2.json()["items"]
    roles = [m["role"] for m in items]
    assert roles == ["gua"]
    g = items[0]
    assert g["content"] is None
    assert "gua" in g["meta"] and g["meta"]["question"] == "该不该跳槽"
    assert g["meta"]["body"].startswith("§卦象")
```

- [ ] **Step 11.2: Write consume-cta test**

Create `server/tests/integration/test_gua_sse_consume_cta.py`:

```python
"""Integration: gua endpoint consumes prior cta row."""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_gua_after_divination_consumes_cta(authed_client, chart_fixture, fake_llm):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    # Trigger divination → cta row
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/messages",
                                      json={"message": "我能不能换工作"}) as resp:
        async for _ in resp.aiter_text():
            pass

    fake_llm.set_stream(["占算结果"])
    async with authed_client.stream("POST", f"/api/conversations/{conv_id}/gua",
                                      json={"question": "我能不能换工作"}) as resp:
        async for _ in resp.aiter_text():
            pass

    r2 = await authed_client.get(f"/api/conversations/{conv_id}/messages")
    roles = [m["role"] for m in r2.json()["items"]]
    # cta gone; gua + user remain (newest first)
    assert "cta" not in roles
    assert roles == ["gua", "user"]
```

- [ ] **Step 11.3: Write gua quota test**

Create `server/tests/integration/test_gua_sse_quota.py`:

```python
"""Integration: gua quota pre-check 429."""
from __future__ import annotations

import pytest
from sqlalchemy import text


pytestmark = pytest.mark.asyncio


async def test_gua_quota_precheck_429(authed_client, chart_fixture, db_session, current_user):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    from app.core.quotas import today_beijing, QUOTAS
    limit = QUOTAS["free"]["gua"]
    await db_session.execute(text("""
        INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
        VALUES (:uid, :p, 'gua', :c, now())
        ON CONFLICT (user_id, period, kind) DO UPDATE SET count = EXCLUDED.count
    """), {"uid": current_user.id, "p": today_beijing(), "c": limit})
    await db_session.commit()

    r2 = await authed_client.post(
        f"/api/conversations/{conv_id}/gua",
        json={"question": "?"},
    )
    assert r2.status_code == 429
    assert r2.json()["detail"]["code"] == "QUOTA_EXCEEDED"
```

- [ ] **Step 11.4: Write chips history test**

Create `server/tests/integration/test_chips_history.py`:

```python
"""Integration: chips endpoint accepts ?conversation_id and uses last 6 msgs."""
from __future__ import annotations

import json

import pytest


pytestmark = pytest.mark.asyncio


async def test_chips_with_conversation_id_loads_history(
    authed_client, chart_fixture, fake_llm, db_session,
):
    cid = chart_fixture["id"]
    r = await authed_client.post(f"/api/charts/{cid}/conversations", json={})
    conv_id = r.json()["id"]

    # Seed 8 messages so only last 6 should be loaded
    from app.services import message as msg_svc
    from uuid import UUID
    for i in range(4):
        await msg_svc.insert(db_session, conversation_id=UUID(conv_id),
                              role="user", content=f"u{i}")
        await msg_svc.insert(db_session, conversation_id=UUID(conv_id),
                              role="assistant", content=f"a{i}")
        await db_session.commit()

    captured = fake_llm.capture_messages()
    fake_llm.set_stream(['["问题1","问题2","问题3","问题4"]'])

    async with authed_client.stream(
        "POST", f"/api/charts/{cid}/chips?conversation_id={conv_id}",
    ) as resp:
        async for _ in resp.aiter_text():
            pass

    # The user-content of the chips prompt should include the last 6 entries.
    sent_messages = captured.last
    user_content = sent_messages[-1]["content"]   # build_messages puts history into user content
    # Last 6 are u1, a1, u2, a2, u3, a3 — verify u3 + a3 are present, u0 absent
    assert "u3" in user_content
    assert "a3" in user_content
    assert "u0" not in user_content
```

The `fake_llm.capture_messages()` API may differ; the goal is to assert
which messages reached the LLM. Adapt to whatever Plan 5's helper exposes.

- [ ] **Step 11.5: Run gua + chips integration tests**

```
uv run --package server pytest \
    server/tests/integration/test_gua_sse_happy.py \
    server/tests/integration/test_gua_sse_consume_cta.py \
    server/tests/integration/test_gua_sse_quota.py \
    server/tests/integration/test_chips_history.py -v
```
Expected: all green.

- [ ] **Step 11.6: Run full server test suite (regression check)**

```
uv run --package server pytest -n auto -q --no-header
```
Expected: 309 baseline + ≈40 new = ~349+ passed; 0 failed.

If any pre-existing test broke, fix at root cause (do NOT skip/xfail).

- [ ] **Step 11.7: Commit**

```bash
git add server/tests/integration/test_gua_sse_happy.py \
        server/tests/integration/test_gua_sse_consume_cta.py \
        server/tests/integration/test_gua_sse_quota.py \
        server/tests/integration/test_chips_history.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(server): Plan 6 gua SSE + chips history integration coverage

Covers gua happy-path (gua event + role='gua' row + meta with body),
cta consume after divination redirect, gua quota pre-check 429, and
chips ?conversation_id loading the last 6 user/assistant messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend lib/api.js + store/useAppStore.js refactor

**Files:**
- Modify: `frontend/src/lib/api.js` (add 9 conversation/SSE functions)
- Modify: `frontend/src/store/useAppStore.js` (drop chat-data persistence;
  add lazy-load actions + currentConversationId in sessionStorage)
- Modify: `frontend/src/lib/persistence.js` (strip chat fields from snapshot)
- Test: `frontend/tests/lib/api.test.js`
- Test: `frontend/tests/store/useAppStore.test.js`

This is the biggest frontend change. UI/CSS unchanged — store internals
swap from "messages live in localStorage and `chatHistory` mirrors them"
to "messages live on server, ephemeral `chatHistory` is the loaded view".

- [ ] **Step 12.1: Add new API functions to `frontend/src/lib/api.js`**

Append to the end of the file (do NOT modify existing exports):

```js
// ============================================================================
// Plan 6 — conversation layer
// ============================================================================

async function _getJSON(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
  return r.json();
}

async function _postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? null : JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
  return r.json();
}

async function _patchJSON(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
  return r.json();
}

async function _delete(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!r.ok && r.status !== 204) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
}

export async function listConversations(chartId) {
  return _getJSON(`/api/charts/${chartId}/conversations`);
}

export async function createConversation(chartId, label) {
  return _postJSON(`/api/charts/${chartId}/conversations`, { label });
}

export async function patchConversation(convId, label) {
  return _patchJSON(`/api/conversations/${convId}`, { label });
}

export async function deleteConversation(convId) {
  return _delete(`/api/conversations/${convId}`);
}

export async function restoreConversation(convId) {
  return _postJSON(`/api/conversations/${convId}/restore`, null);
}

export async function listMessages(convId, { before, limit = 50 } = {}) {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  if (before) qs.set('before', before);
  return _getJSON(`/api/conversations/${convId}/messages?${qs.toString()}`);
}

export async function streamMessage(convId, body, handlers = {}) {
  return streamSSE(`/api/conversations/${convId}/messages`, body, handlers);
}

export async function streamGua(convId, body, handlers = {}) {
  return streamSSE(`/api/conversations/${convId}/gua`, body, handlers);
}

export async function fetchChips(chartId, conversationId) {
  const qs = conversationId ? `?conversation_id=${conversationId}` : '';
  // chips returns SSE; collect the final JSON from the done event
  let final = '';
  await streamSSE(`/api/charts/${chartId}/chips${qs}`, null, {
    onDone: (full) => { final = full; },
  });
  // Parse chips JSON array
  try {
    const parsed = JSON.parse(final);
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
```

Note: `streamSSE` currently sends a JSON body — for chips with `null` body
it should still work (chips endpoint takes no body, just the query param).
If the existing `streamSSE` rejects empty/null body, modify to allow:

```js
// In streamSSE — change body line to:
body: body == null ? undefined : JSON.stringify(body),
```

Also add `credentials: 'include'` to the existing `streamSSE` fetch so session
cookies flow.

- [ ] **Step 12.2: Update `streamSSE` to forward credentials + handle null body**

Modify `frontend/src/lib/api.js` lines 5-11. New body:

```js
export async function streamSSE(url, body, handlers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    let msg = 'HTTP ' + resp.status;
    try { const err = await resp.json(); msg = err?.detail?.message || msg; } catch {}
    throw new Error(msg);
  }
  // ... rest unchanged
}
```

- [ ] **Step 12.3: Write failing api.js tests**

Create `frontend/tests/lib/api.test.js` (or modify if it exists):

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listConversations, createConversation, patchConversation,
  deleteConversation, restoreConversation, listMessages,
  fetchChips,
} from '../../src/lib/api.js';

describe('Plan 6 conversation API', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('listConversations GET /api/charts/:cid/conversations', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ items: [] }),
    });
    const r = await listConversations('chart-123');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/charts/chart-123/conversations',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(r.items).toEqual([]);
  });

  it('createConversation POST with label', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ id: 'c1', label: '工作', position: 0 }),
    });
    const r = await createConversation('chart-1', '工作');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/charts/chart-1/conversations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ label: '工作' }),
      }),
    );
    expect(r.label).toBe('工作');
  });

  it('patchConversation PATCH', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'c1', label: '感情' }) });
    const r = await patchConversation('c1', '感情');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/conversations/c1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(r.label).toBe('感情');
  });

  it('deleteConversation 204', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 });
    await deleteConversation('c1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/conversations/c1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('restoreConversation POST', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ id: 'c1', deleted_at: null }),
    });
    const r = await restoreConversation('c1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/conversations/c1/restore',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(r.deleted_at).toBeNull();
  });

  it('listMessages with before+limit query', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ items: [], next_cursor: null }),
    });
    await listMessages('c1', { before: 'msg-9', limit: 20 });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('before=msg-9');
    expect(url).toContain('limit=20');
  });

  it('throws with detail.message on non-2xx', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ detail: { code: 'QUOTA_EXCEEDED', message: '今日配额已用完' } }),
    });
    await expect(createConversation('c1')).rejects.toThrow('今日配额已用完');
  });
});
```

- [ ] **Step 12.4: Run tests — confirm GREEN**

```
cd frontend && npm test -- tests/lib/api.test.js
```
Expected: 7 passed.

- [ ] **Step 12.5: Refactor store: drop chat data from persistence**

Modify `frontend/src/store/useAppStore.js`:

**(a) `CHART_FIELDS` constant (line 7-9)** — remove `chatHistory`,
`conversations`, `currentConversationId`, `gua`:

```js
const CHART_FIELDS = ['paipan','force','guards','dayun','meta','birthInfo',
  'sections','dayunCache','liunianCache','verdicts'];
```

**(b) `BLANK_CHART` and `makeBlankChart`** — remove the conversations
fields. Replace lines ~131-152:

```js
const BLANK_CHART = {
  paipan: null, force: [], guards: [], dayun: [], meta: null, birthInfo: null,
  sections: [],
  // Plan 6: chat data is server-of-truth; ephemeral here, never persisted
  chatHistory: [],
  conversations: [],
  currentConversationId: null,
  guaCurrent: null,    // ephemeral last-cast gua (display only)
  dayunCache: {}, liunianCache: {},
  verdicts: blankVerdicts(),
};
function makeBlankChart() { return { ...BLANK_CHART }; }
```

**(c) Remove `hydrateConversations`, `activeMessagesOf`, `syncActive`,
`derivedLabelFromMessages`, `genConvId`, `blankConversation`** — these are
no longer needed; conversations come from the server.

**(d) Remove `appendChatMessage` import and `import { appendChatMessage }
from '../lib/chatHistory.js'`** if `chatHistory.js` is no longer used; or
leave the file alone if other code uses it.

**(e) Rewrite chat-action methods to be ephemeral-only** (replace existing
`pushChat`, `replaceLastAssistant`, `replaceLastCtaWithAssistant`,
`replacePlaceholderWithCta`, `pushGuaCard`, `updateLastGuaCard`,
`clearChat`, `newConversation`, `switchConversation`,
`deleteConversation`, `renameConversation`):

```js
  // ── Chat (ephemeral; server is source of truth) ──────────────────────────
  setChatHistory: (msgs) => set({ chatHistory: msgs || [] }),
  appendMessage: (msg) => set(s => ({ chatHistory: [...s.chatHistory, msg] })),
  replaceLastAssistant: (content) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') { arr[i] = { ...arr[i], content }; break; }
    }
    return { chatHistory: arr };
  }),
  replacePlaceholderWithCta: (question, manual = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') {
        arr[i] = { role: 'cta', content: { question, manual } };
        break;
      }
    }
    return { chatHistory: arr };
  }),
  replaceLastCtaWithAssistant: () => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'cta') { arr[i] = { role: 'assistant', content: '' }; break; }
    }
    return { chatHistory: arr };
  }),
  consumeCta: () => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'cta') { arr.splice(i, 1); break; }
    }
    return { chatHistory: arr };
  }),
  pushGuaCard: (guaData) => set(s => ({
    chatHistory: [...s.chatHistory, { role: 'gua', content: { ...guaData, streaming: true } }],
  })),
  updateLastGuaCard: (body, finalize = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'gua') {
        arr[i] = {
          ...arr[i],
          content: { ...arr[i].content, body,
                     streaming: finalize ? false : arr[i].content.streaming },
        };
        break;
      }
    }
    return { chatHistory: arr };
  }),
  clearChatLocal: () => set({ chatHistory: [] }),

  // ── Server-backed conversation actions ────────────────────────────────────
  loadConversations: async (chartId) => {
    const { listConversations } = await import('../lib/api.js');
    const data = await listConversations(chartId);
    const items = data.items || [];
    let currentId = sessionStorage.getItem('currentConversationId:' + chartId);
    if (!currentId || !items.some(c => c.id === currentId)) {
      currentId = items.length ? items[0].id : null;
    }
    set({ conversations: items, currentConversationId: currentId });
    return items;
  },
  selectConversation: async (convId) => {
    const s = get();
    if (s.currentId) {
      sessionStorage.setItem('currentConversationId:' + s.currentId, convId);
    }
    set({ currentConversationId: convId });
    await get().loadMessages(convId);
  },
  loadMessages: async (convId) => {
    const { listMessages } = await import('../lib/api.js');
    const data = await listMessages(convId, { limit: 50 });
    // Server returns newest-first; UI renders chronological → reverse.
    const chrono = (data.items || []).slice().reverse();
    set({ chatHistory: chrono.map(m => _serverMsgToUiMsg(m)) });
  },
  newConversationOnServer: async (chartId, label) => {
    const { createConversation } = await import('../lib/api.js');
    const conv = await createConversation(chartId, label);
    const list = [...(get().conversations || []), conv];
    sessionStorage.setItem('currentConversationId:' + chartId, conv.id);
    set({ conversations: list, currentConversationId: conv.id, chatHistory: [] });
    return conv;
  },
  renameConversationOnServer: async (convId, label) => {
    const { patchConversation } = await import('../lib/api.js');
    const updated = await patchConversation(convId, label);
    set(s => ({
      conversations: (s.conversations || []).map(c => c.id === convId ? updated : c),
    }));
    return updated;
  },
  deleteConversationOnServer: async (chartId, convId) => {
    const { deleteConversation } = await import('../lib/api.js');
    await deleteConversation(convId);
    const list = (get().conversations || []).filter(c => c.id !== convId);
    let nextId = get().currentConversationId;
    if (nextId === convId) {
      nextId = list[0]?.id || null;
      // If empty after delete, create a fresh one
      if (!nextId) {
        const fresh = await get().newConversationOnServer(chartId, '对话 1');
        return;
      }
      sessionStorage.setItem('currentConversationId:' + chartId, nextId);
    }
    set({ conversations: list, currentConversationId: nextId });
    if (nextId) await get().loadMessages(nextId);
  },
```

Add this helper at module top:

```js
function _serverMsgToUiMsg(m) {
  if (m.role === 'gua') {
    // Frontend GuaCard expects { ...gua, body, question }
    const { gua, body, question } = m.meta || {};
    return { role: 'gua', content: { ...(gua || {}), body, question, streaming: false } };
  }
  if (m.role === 'cta') {
    const { question } = m.meta || {};
    return { role: 'cta', content: { question, manual: false } };
  }
  return { role: m.role, content: m.content || '' };
}
```

**(f) `snapshotChart`** — drop the chat fields. Replace lines ~165-180:

```js
function snapshotChart(s, extra = {}) {
  return {
    paipan: s.paipan, force: s.force, guards: s.guards,
    dayun: s.dayun, meta: s.meta, birthInfo: s.birthInfo,
    sections: s.sections,
    dayunCache: s.dayunCache, liunianCache: s.liunianCache,
    verdicts: s.verdicts,
    ...extra,
  };
}
```

**(g) `switchChart` / `restoreFromSession` / `deleteChart`** — remove
`hydrateConversations` calls, `chatHistory` reads, `gua` read. After
switching to a chart, frontend calls `loadConversations(id)` +
`loadMessages(currentConversationId)` from `App.jsx` (Task 13).

E.g. inside `switchChart`:
```js
set({
  charts: updatedCharts,
  currentId: id,
  ...makeBlankChart(),
  paipan: target.paipan || null,
  force: target.force || [],
  guards: target.guards || [],
  dayun: target.dayun || [],
  meta: target.meta || null,
  birthInfo: target.birthInfo || null,
  sections: target.sections || [],
  // chat data: cleared; App.jsx will call loadConversations + loadMessages
  chatHistory: [], conversations: [], currentConversationId: null,
  guaCurrent: null,
  dayunCache: target.dayunCache || {},
  liunianCache: target.liunianCache || {},
  verdicts: hydrateVerdicts(target.verdicts),
  screen: 'shell',
  dayunOpenIdx: null, liunianOpenKey: null,
});
```

(`restoreFromSession` and `deleteChart` get the same treatment.)

- [ ] **Step 12.6: Update `frontend/src/lib/persistence.js`**

In `subscribeSave`'s state filter (lines ~70-80, after the comment "Merge
current flat state into charts map before persisting"), strip chat fields
before snapshotting. The persisted v3 schema must NOT contain `chatHistory`,
`conversations`, `currentConversationId`, `gua` per chart.

In `loadSession` v2-migration block (line ~24 onward) — simply drop the
`chatHistory`, `gua` fields when constructing the chart entry (they're
ignored on load anyway since the store no longer reads them).

Bump `SESSION_VERSION` to `4`. Add a v3→v4 migration that drops the chat
fields silently:

```js
// constants.js: SESSION_VERSION = 4
// persistence.js loadSession:
if (parsed.version === 3) {
  // v3 → v4: drop per-chart chat fields (now server-backed)
  const charts = {};
  for (const [id, c] of Object.entries(parsed.charts || {})) {
    const { chatHistory, conversations, currentConversationId, gua, ...rest } = c;
    charts[id] = rest;
  }
  return { version: SESSION_VERSION, currentId: parsed.currentId, charts };
}
```

Update the `if (parsed.version === SESSION_VERSION) return parsed;` arm
to match v4 directly.

- [ ] **Step 12.7: localStorage cleanup of legacy keys**

In `App.jsx` startup (after the `loadSession` call), delete any obsolete
top-level localStorage keys that legacy versions wrote:

```js
['conversations','chatHistory','gua','gua-history'].forEach(k => {
  try { localStorage.removeItem(k); } catch {}
});
```

(These keys were never set by recent versions but may exist in stale
browsers — harmless cleanup.)

- [ ] **Step 12.8: Write store tests**

Create/update `frontend/tests/store/useAppStore.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore.js';

vi.mock('../../src/lib/api.js', () => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  patchConversation: vi.fn(),
  deleteConversation: vi.fn(),
  listMessages: vi.fn(),
  streamSSE: vi.fn(),
  streamVerdicts: vi.fn(),
  fetchHealth: vi.fn(),
  fetchCities: vi.fn(),
  fetchPaipan: vi.fn(),
  fetchSections: vi.fn(),
}));

import * as api from '../../src/lib/api.js';

describe('Plan 6 store actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      chatHistory: [], conversations: [], currentConversationId: null,
      currentId: 'chart-1',
    });
    sessionStorage.clear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loadConversations populates store + picks first as default', async () => {
    api.listConversations.mockResolvedValue({
      items: [{ id: 'c1', label: '对话 1' }, { id: 'c2', label: '对话 2' }],
    });
    await useAppStore.getState().loadConversations('chart-1');
    const s = useAppStore.getState();
    expect(s.conversations.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(s.currentConversationId).toBe('c1');
  });

  it('loadConversations restores currentConversationId from sessionStorage', async () => {
    sessionStorage.setItem('currentConversationId:chart-1', 'c2');
    api.listConversations.mockResolvedValue({
      items: [{ id: 'c1' }, { id: 'c2' }],
    });
    await useAppStore.getState().loadConversations('chart-1');
    expect(useAppStore.getState().currentConversationId).toBe('c2');
  });

  it('appendMessage adds to chatHistory ephemerally', () => {
    useAppStore.getState().appendMessage({ role: 'user', content: 'hi' });
    expect(useAppStore.getState().chatHistory).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('replaceLastAssistant updates only the last assistant', () => {
    useAppStore.setState({
      chatHistory: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: '' },
      ],
    });
    useAppStore.getState().replaceLastAssistant('done');
    expect(useAppStore.getState().chatHistory[1].content).toBe('done');
  });

  it('replacePlaceholderWithCta turns last assistant into cta', () => {
    useAppStore.setState({
      chatHistory: [
        { role: 'user', content: '该不该' },
        { role: 'assistant', content: '' },
      ],
    });
    useAppStore.getState().replacePlaceholderWithCta('该不该', false);
    expect(useAppStore.getState().chatHistory[1]).toEqual({
      role: 'cta', content: { question: '该不该', manual: false },
    });
  });

  it('loadMessages reverses server order to chronological', async () => {
    api.listMessages.mockResolvedValue({
      items: [
        { id: '3', role: 'assistant', content: 'a2', meta: null, created_at: '2026-04-18T03:00:00Z' },
        { id: '2', role: 'user',      content: 'q2', meta: null, created_at: '2026-04-18T02:00:00Z' },
        { id: '1', role: 'user',      content: 'q1', meta: null, created_at: '2026-04-18T01:00:00Z' },
      ],
      next_cursor: null,
    });
    await useAppStore.getState().loadMessages('c1');
    const hist = useAppStore.getState().chatHistory;
    expect(hist.map(m => m.content)).toEqual(['q1', 'q2', 'a2']);
  });

  it('newConversationOnServer appends + selects + clears history', async () => {
    api.createConversation.mockResolvedValue({ id: 'cN', label: '对话 1' });
    useAppStore.setState({ conversations: [], chatHistory: [{ role: 'user', content: 'old' }] });
    await useAppStore.getState().newConversationOnServer('chart-1', '对话 1');
    const s = useAppStore.getState();
    expect(s.currentConversationId).toBe('cN');
    expect(s.chatHistory).toEqual([]);
  });
});
```

- [ ] **Step 12.9: Run frontend tests**

```bash
cd frontend && npm test
```
Expected: api + store tests green; existing tests may need touch-ups
(Chat.test.jsx will fail until Task 13). For now ensure api.test.js +
useAppStore.test.js + non-chat tests pass; address Chat/ConversationSwitcher
tests in Task 13.

- [ ] **Step 12.10: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/store/useAppStore.js \
        frontend/src/lib/persistence.js frontend/src/lib/constants.js \
        frontend/tests/lib/api.test.js \
        frontend/tests/store/useAppStore.test.js
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(frontend): Plan 6 api.js + store refactor (server-backed chat)

api.js: +9 functions for conversation CRUD, messages pagination, chat/gua
SSE streaming, chips with conversation_id. streamSSE forwards credentials
and accepts null body.

store: drop chatHistory/conversations/currentConversationId/gua from
per-chart persistence; add lazy-load actions (loadConversations,
loadMessages, selectConversation, newConversationOnServer,
renameConversationOnServer, deleteConversationOnServer).
currentConversationId persists in sessionStorage per-chart for tab-scope
restore. _serverMsgToUiMsg adapter maps server message shape to
existing UI shape so JSX/CSS stays unchanged.

persistence: bump SESSION_VERSION to 4 with v3→v4 migration that drops
chat fields silently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Frontend Chat.jsx + ConversationSwitcher.jsx + App.jsx wiring

**Files:**
- Modify: `frontend/src/components/Chat.jsx`
- Modify: `frontend/src/components/ConversationSwitcher.jsx`
- Modify: `frontend/src/App.jsx` (call loadConversations on chart change)
- Test: `frontend/tests/Chat.test.jsx`
- Test: `frontend/tests/ConversationSwitcher.test.jsx`

JSX/className/CSS unchanged — only handler bodies.

- [ ] **Step 13.1: Modify Chat.jsx send/cast/analyze handlers**

Replace the import at the top:
```js
import { streamMessage, streamGua, fetchChips } from '../lib/api';
```
(Drop `streamSSE` if not used elsewhere in this file.)

Replace `send(text, options)` body — keep the same signature, change the
network calls:

```js
async function send(text, options = {}) {
  const retry = options.retry === true;
  const q = (text ?? input).trim();
  if (!q || chatStreaming) return;
  setChatError(null);
  if (retry) {
    replaceLastAssistant('');
  } else {
    setInput('');
    pushChat({ role: 'user', content: q });
    pushChat({ role: 'assistant', content: '' });
  }

  if (!llmEnabled) {
    replaceLastAssistant('（未配置 LLM，当前回到预设回复）');
    return;
  }

  const convId = useAppStore.getState().currentConversationId;
  if (!convId) {
    replaceLastAssistant('（请先创建一个对话）');
    return;
  }

  setChatStreaming(true);
  try {
    await streamMessage(convId, { message: q, bypass_divination: false }, {
      onDelta: (_t, running) => replaceLastAssistant(running),
      onIntent: (intent, reason, source) =>
        console.log(`[chat] intent=${intent} reason=${reason} source=${source}`),
      onRedirect: (to, redirQ) => {
        if (to === 'gua') replacePlaceholderWithCta(redirQ || q, false);
      },
      onModel: (m) => console.log('[chat] modelUsed=' + m),
      onRetrieval: (src) => console.log('[chat] retrieval=' + src),
    });
  } catch (e) {
    console.error('[chat] failed:', e);
    const uiError = friendlyError(e, 'chat');
    replaceLastAssistant(uiError.title);
    setChatError({ error: e, question: q });
  } finally {
    setChatStreaming(false);
    refreshChips(true);
  }
}
```

Note `pushChat` no longer exists in the new store. The store added
`appendMessage` instead. Either:
- Update Chat.jsx to use `appendMessage` (rename calls), or
- Add an alias in store: `pushChat: (m) => set(s => ({ chatHistory: [...s.chatHistory, m] }))`

Choose the alias path for minimal Chat.jsx churn. Add to store:

```js
  // Plan 6 alias for legacy callsites
  pushChat: (msg) => set(s => ({ chatHistory: [...s.chatHistory, msg] })),
```

Replace `castGuaInline(question)` body:

```js
async function castGuaInline(question) {
  if (!question?.trim() || guaStreaming) return;
  const convId = useAppStore.getState().currentConversationId;
  if (!convId) return;
  setGuaStreaming(true);

  let guaData = null;
  let runningBody = '';
  try {
    const final = await streamGua(convId, { question: question.trim() }, {
      onGua: (g) => {
        guaData = g;
        pushGuaCard({ ...g, question: question.trim(), body: '' });
      },
      onDelta: (_t, running) => {
        runningBody = running;
        updateLastGuaCard(running, false);
      },
      onModel: (m) => console.log('[gua] model=' + m),
    });
    const finalBody = final || runningBody;
    updateLastGuaCard(finalBody, true);
    // Keep ephemeral guaCurrent for backward compat with other UI bits
    setGuaCurrent({ ...(guaData || {}), question: question.trim(), body: finalBody, ts: Date.now() });
  } catch (e) {
    console.error('[gua inline] failed:', e);
    updateLastGuaCard('（起卦失败：' + (e.message || String(e)) + '）', true);
  } finally {
    setGuaStreaming(false);
  }
}
```

Note: `pushGuaHistory` no longer exists; gua history now lives on the
server (each gua becomes a `role='gua'` message). Drop the
`pushGuaHistory` call.

Replace `analyzeDirectly(question)` body:

```js
async function analyzeDirectly(question) {
  if (!question?.trim() || chatStreaming) return;
  setChatError(null);
  replaceLastCtaWithAssistant();
  setChatStreaming(true);
  const convId = useAppStore.getState().currentConversationId;
  if (!convId) { setChatStreaming(false); return; }
  try {
    await streamMessage(convId, { message: question, bypass_divination: true }, {
      onDelta: (_t, running) => replaceLastAssistant(running),
      onModel: (m) => console.log('[chat] analyze model=' + m),
      onRetrieval: (src) => console.log('[chat] retrieval=' + src),
    });
  } catch (e) {
    console.error('[analyze] failed:', e);
    const uiError = friendlyError(e, 'chat');
    replaceLastAssistant(uiError.title);
    setChatError({ error: e, question });
  } finally {
    setChatStreaming(false);
  }
}
```

Replace `refreshChips(withHistory)` body:

```js
async function refreshChips() {
  const state = useAppStore.getState();
  if (!state.currentId) return;
  const convId = state.currentConversationId;
  try {
    const chipsList = await fetchChips(state.currentId, convId);
    if (chipsList && chipsList.length >= 2) setChips(chipsList);
  } catch {
    // Best-effort — keep prior chips
  }
}
```

Note: server-side chips loads its own history from convId, so the client
doesn't need to send any chart payload. The `withHistory` arg becomes
unused; drop it.

Replace the `useEffect` that triggers chips refresh:

```js
useEffect(() => {
  if (!meta) return;
  refreshChips();
}, [meta, currentConversationId]);
```

Update `clearChat` callsite (the "清空" button) — local clear no longer
makes sense with server persistence; replace with "新建对话" semantics:

```js
const newConversationOnServer = useAppStore(s => s.newConversationOnServer);
// ...
<button
  className="muted"
  style={{ fontSize: 11 }}
  onClick={async () => {
    const chartId = useAppStore.getState().currentId;
    if (!chartId) return;
    const count = (useAppStore.getState().conversations || []).length;
    if (confirm('开一个新对话？')) {
      await newConversationOnServer(chartId, `对话 ${count + 1}`);
    }
  }}
  disabled={chatStreaming || guaStreaming}
  title="新建对话"
>清空</button>
```

The button label stays "清空" (UI frozen) but clicking it now creates a
fresh conversation on the server (the prior conversation is preserved
on the server and accessible via the switcher).

- [ ] **Step 13.2: Modify ConversationSwitcher.jsx**

Replace store imports:
```js
const conversations = useAppStore(s => s.conversations) || [];
const currentId = useAppStore(s => s.currentConversationId);
const currentChartId = useAppStore(s => s.currentId);
const newConversationOnServer = useAppStore(s => s.newConversationOnServer);
const selectConversation = useAppStore(s => s.selectConversation);
const deleteConversationOnServer = useAppStore(s => s.deleteConversationOnServer);
const renameConversationOnServer = useAppStore(s => s.renameConversationOnServer);
```

Update `onNew`, `onSwitch`, `onDelete`, `commitRename`:

```js
async function onNew(e) {
  e?.stopPropagation?.();
  if (!currentChartId) return;
  const count = conversations.length;
  await newConversationOnServer(currentChartId, `对话 ${count + 1}`);
  setOpen(false);
}

async function onSwitch(id) {
  if (id === currentId) { setOpen(false); return; }
  await selectConversation(id);
  setOpen(false);
}

async function onDelete(e, id) {
  e.stopPropagation();
  if (!currentChartId) return;
  if (conversations.length <= 1) {
    if (!confirm('这是最后一个对话，删除后会开一个新的，确定吗？')) return;
  } else {
    if (!confirm('删除这个对话？30 天内可在「已删除」里恢复。')) return;
  }
  await deleteConversationOnServer(currentChartId, id);
}

async function commitRename() {
  if (editingId && editingLabel.trim()) {
    await renameConversationOnServer(editingId, editingLabel.trim());
  }
  setEditingId(null);
  setEditingLabel('');
}
```

The `c.messages` preview line (line 86) won't work anymore since server
items don't carry messages. Replace with empty preview or fetch on hover:

```js
const preview = '';   // server items don't ship preview; leaving empty for v1
```

(Future enhancement: server adds `last_user_message` to ConversationDetail.
Out of scope for Plan 6.)

- [ ] **Step 13.3: Modify App.jsx**

After `restoreFromSession` and on chart change, call `loadConversations`
+ ensure a conversation exists. Find the chart-switch effect (or
`switchChart` callsite) and add:

```js
import { useAppStore } from './store/useAppStore';

const currentId = useAppStore(s => s.currentId);
const meta = useAppStore(s => s.meta);
const conversations = useAppStore(s => s.conversations);
const currentConversationId = useAppStore(s => s.currentConversationId);
const loadConversations = useAppStore(s => s.loadConversations);
const newConversationOnServer = useAppStore(s => s.newConversationOnServer);
const loadMessages = useAppStore(s => s.loadMessages);

// On chart load: pull conversations, ensure one exists
useEffect(() => {
  if (!currentId || !meta) return;
  (async () => {
    const list = await loadConversations(currentId);
    if (!list.length) {
      await newConversationOnServer(currentId, '对话 1');
    } else {
      const cid = useAppStore.getState().currentConversationId;
      if (cid) await loadMessages(cid);
    }
  })().catch(e => console.error('[App] load conversations failed', e));
}, [currentId, meta]);
```

Place this near the existing session-restore effect.

- [ ] **Step 13.4: Update Chat.test.jsx and ConversationSwitcher.test.jsx**

Read the existing tests; rewrite expectations to mock the new server
actions. Sketch:

```js
// Chat.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import Chat from '../src/components/Chat.jsx';
import { useAppStore } from '../src/store/useAppStore';

vi.mock('../src/lib/api.js', () => ({
  streamMessage: vi.fn(),
  streamGua: vi.fn(),
  fetchChips: vi.fn().mockResolvedValue([]),
  // re-export others used by the file
  streamSSE: vi.fn(),
}));

beforeEach(() => {
  useAppStore.setState({
    chatHistory: [],
    currentConversationId: 'c-test',
    currentId: 'chart-test',
    meta: { rizhu: '丙', today: { ymd: '2026-04-18' } },
    paipan: {}, force: [], guards: [], dayun: [],
    chatStreaming: false, guaStreaming: false,
    llmEnabled: true,
  });
});

describe('Chat send', () => {
  it('calls streamMessage with current convId + message body', async () => {
    const { streamMessage } = await import('../src/lib/api.js');
    streamMessage.mockResolvedValue('done');
    const { getByPlaceholderText, getByText } = render(<Chat />);
    fireEvent.change(getByPlaceholderText('你想知道什么？'), { target: { value: '你好' } });
    fireEvent.click(getByText('发送'));
    await waitFor(() => expect(streamMessage).toHaveBeenCalled());
    const [convId, body] = streamMessage.mock.calls[0];
    expect(convId).toBe('c-test');
    expect(body.message).toBe('你好');
    expect(body.bypass_divination).toBe(false);
  });
});
```

(Adjust to match the existing test framework + render helpers used in
the project. Read `frontend/tests/Chat.test.jsx` first if it exists.)

ConversationSwitcher tests: stub `newConversationOnServer`,
`selectConversation`, `deleteConversationOnServer`,
`renameConversationOnServer`, then drive the dropdown UI and assert calls.

- [ ] **Step 13.5: Run frontend tests + dev server smoke**

```bash
cd frontend && npm test
```
Expected: all tests green.

Smoke-test in browser:

```bash
# Terminal A — server
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/silly-ptolemy-2e9b10
uv run --package server uvicorn app.main:app --reload --port 8000

# Terminal B — frontend
cd frontend && npm run dev
```

Then in browser:
1. Register/login, create a chart.
2. Send a chat message → assistant streams in.
3. Reload page → chat history reappears (loaded from server).
4. Switch conversation tabs → messages swap.
5. Send "我能不能换工作" → CTA bubble appears, click "起一卦" → gua card streams in.
6. Reload → CTA bubble (or gua) still there.
7. Click "清空" → fresh conversation tab.
8. Open browser DevTools → Network → confirm `/api/conversations/...` calls.

Capture any UI regressions; fix them in this task before committing.

- [ ] **Step 13.6: Commit**

```bash
git add frontend/src/components/Chat.jsx \
        frontend/src/components/ConversationSwitcher.jsx \
        frontend/src/App.jsx \
        frontend/src/store/useAppStore.js \
        frontend/tests/Chat.test.jsx \
        frontend/tests/ConversationSwitcher.test.jsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(frontend): Plan 6 wire Chat + Switcher to server-backed conversations

Chat.jsx: send → POST /api/conversations/:id/messages SSE; castGuaInline
→ POST .../gua; analyzeDirectly → POST .../messages with
bypass_divination=true; refreshChips → POST /api/charts/:cid/chips with
conversation_id query.

ConversationSwitcher.jsx: new/switch/delete/rename actions hit server
endpoints via store. JSX/className unchanged.

App.jsx: on chart load, loadConversations + ensure one exists +
loadMessages. localStorage cleanup of legacy keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: ACCEPTANCE.md Plan 6 section + wheel smoke + README release note

**Files:**
- Modify: `server/ACCEPTANCE.md` (append Plan 6 section + Route Inventory rows)
- Modify: `README.md` (1-line release note about server-backed conversations)
- Verify: full test suite green; wheel installs + boots

- [ ] **Step 14.1: Run full server test suite**

```bash
uv run --package server pytest -n auto --no-header -q
uv run --package server pytest --cov=app --cov-config=/dev/null \
    --cov-report=term-missing server/tests/ 2>&1 | tail -20
```

Expected:
- `passed` count ≥ 309 baseline + ≈40 new = 349+
- coverage on `app/` ≥ 85%
- wall time < 60s with `-n auto`

If any pre-existing test fails, debug and fix root cause before
proceeding.

- [ ] **Step 14.2: Run frontend test suite**

```bash
cd frontend && npm test -- --run
```
Expected: all green.

- [ ] **Step 14.3: Build the wheel + boot smoke**

```bash
uv build --package server
# new wheel under server/dist/
ls -la server/dist/

# Smoke install in throwaway venv
python3 -m venv /tmp/p6-smoke && source /tmp/p6-smoke/bin/activate
pip install server/dist/server-*.whl
# Verify gua64.json shipped
python -c "from app.services.gua_cast import GUA64; print('GUA64 entries:', len(GUA64))"
deactivate
rm -rf /tmp/p6-smoke
```

Expected: `GUA64 entries: 64`. If fails (not 64), the JSON wasn't packaged
— revisit Task 2 Step 2.6 and add the `[tool.hatch.build.targets.wheel.force-include]`
section.

- [ ] **Step 14.4: Verify OpenAPI route inventory**

```bash
uv run --package server python -c "
from app.main import app
paths = sorted(app.openapi()['paths'].keys())
plan6 = [p for p in paths if 'conversation' in p or 'gua' in p
         or '/messages' in p]
for p in plan6: print(p)
print('---total:', len(paths), 'paths')
"
```
Expected output:
```
/api/charts/{chart_id}/conversations
/api/conversations/{conv_id}
/api/conversations/{conv_id}/gua
/api/conversations/{conv_id}/messages
/api/conversations/{conv_id}/restore
---total: 31 paths
```
(Total = 24 from Plan 5 + 7 new.)

- [ ] **Step 14.5: Append Plan 6 section to `server/ACCEPTANCE.md`**

Append at the end of the file (don't replace existing sections):

```markdown

## Plan 6 — Conversation Layer (added)

**State**: Plan 6 merged on top of Plan 2+3+4+5. No schema changes
(Conversation/Message tables already existed from Plan 4 migration 0002).

### Hard Gates

- [x] **All tests parallel-green**: `uv run --package server pytest -n auto`
      — Result: NNN passed → ✅ (fill in actual count post-merge)
- [x] **Source coverage ≥ 85%** — Result: NN% → ✅
- [x] **Parallel CI wall time < 60s** — Wall time: NN.Ns → ✅
- [x] **Wheel installs + boots**: `uv build --package server`; gua64.json
      packaged (`len(GUA64) == 64`) → ✅
- [x] **Alembic clean** — no new migration; existing 0001+0002 unchanged → ✅
- [x] **9 contract assertions covered** (cross-user 404 / soft-delete 404 /
      chat_message 429 + race / gua 429 / divination redirect / bypass
      consume cta / chat LLM error keeps user / gua LLM error writes nothing
      / chips ?conversation_id loads history) → ✅

### New Route Inventory

| Method | Path | Auth | Plan |
|---|---|---|---|
| GET | `/api/charts/{chart_id}/conversations` | user | **Plan 6** |
| POST | `/api/charts/{chart_id}/conversations` | user | **Plan 6** |
| GET | `/api/conversations/{conv_id}` | user | **Plan 6** |
| PATCH | `/api/conversations/{conv_id}` | user | **Plan 6** |
| DELETE | `/api/conversations/{conv_id}` | user | **Plan 6** |
| POST | `/api/conversations/{conv_id}/restore` | user | **Plan 6** |
| GET | `/api/conversations/{conv_id}/messages` | user | **Plan 6** |
| POST | `/api/conversations/{conv_id}/messages` | user SSE | **Plan 6** |
| POST | `/api/conversations/{conv_id}/gua` | user SSE | **Plan 6** |

`POST /api/charts/{chart_id}/chips` — Plan 5 route extended in Plan 6
to accept `?conversation_id=<uuid>` for history injection.

### Handoff to Plan 7

Plan 7 (deploy / admin / guest) inherits these stable contracts:

- `app.services.conversation.{list_conversations, create_conversation, get_conversation, patch_label, soft_delete, restore}`
- `app.services.message.{insert, paginate, recent_chat_history, delete_last_cta}`
- `app.services.chat_router.classify`
- `app.services.conversation_chat.stream_message`
- `app.services.conversation_gua.stream_gua`
- `app.services.gua_cast.cast_gua` (pure function)
- `app.prompts.{router, expert, gua}`
- `app.api.conversations.router`

Plan 7 surfaces:
- physical delete cron for `conversations.deleted_at` past 30d (parity
  with chart soft-delete cron)
- admin route to list conversation counts per user (no content access)
- optional `conversation_id` + `message_id` columns on `llm_usage_logs`
  if fine-grained audit becomes needed

### Known non-blocking items (Plan 6)

13. `lib/chatHistory.js` no longer used by the new Chat.jsx — left in
    place to avoid touching tangentially related tests; safe to delete in
    Plan 7 cleanup.
14. ConversationSwitcher preview text shows empty string (server doesn't
    return `last_user_message` snippet). Plan 7 may add a snippet field
    to `ConversationDetail` for richer switcher UX.
15. Chat retry button (Chat.jsx) re-POSTs the same message — server
    accepts duplicates by design. Plan 7 may add a `regenerate` endpoint
    to delete the failed assistant + re-stream without duplicating user.
```

(Replace `NNN`/`NN%`/`NN.Ns` with measured values from Steps 14.1-14.2
before commit.)

- [ ] **Step 14.6: Add release note to `README.md`**

Append a one-line release-note section, OR add to existing changelog:

```markdown
### Plan 6 — Conversation Layer (2026-04-18)

对话历史现已由服务端持久化（之前为 localStorage）。升级后旧浏览器中的本地
对话会自动忽略——重新开一段即可。命盘和大运/流年缓存不受影响。
```

- [ ] **Step 14.7: Final regression sweep**

```bash
# Server
uv run --package server pytest -n auto --no-header -q

# Frontend
cd frontend && npm test -- --run

# Lint
cd frontend && npm run lint 2>&1 | tail
```

Expected: all green; lint clean (no new warnings introduced).

- [ ] **Step 14.8: Commit + open PR**

```bash
git add server/ACCEPTANCE.md README.md
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
docs(plan-6): ACCEPTANCE.md + release note for conversation layer

Documents Plan 6 acceptance gates (tests/coverage/wall-time/wheel),
new route inventory, handoff contract for Plan 7, and known
non-blocking items. README release note explains localStorage→server
migration for end-users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# Push and open PR
git push -u origin claude/plan-6-conversations
gh pr create --title "Plan 6: conversation layer (chat/gua/chips on server-backed messages)" \
  --body "$(cat <<'EOF'
## Summary
- Adds 7 new server routes: conversations CRUD + messages pagination + chat SSE (router→expert) + gua SSE
- Wires chips to use real conversation history via ?conversation_id query param
- Frontend Chat.jsx + ConversationSwitcher switched to server endpoints; UI/CSS unchanged
- CTA bubbles persist as role='cta' rows; consumed atomically when user picks an action
- All Plan 5 SSE infrastructure reused (commit-before-done, replay_cached, retrieve_for_chart, QuotaTicket)
- No schema changes (Conversation + Message tables existed from Plan 4 migration 0002)

## Test plan
- [ ] `uv run --package server pytest -n auto` — 349+ green, < 60s wall time
- [ ] Coverage `app/` ≥ 85%
- [ ] `cd frontend && npm test` — all green
- [ ] Wheel smoke: `uv build --package server` + install in fresh venv + `len(GUA64) == 64`
- [ ] OpenAPI lists 7 new conversation/message/gua routes
- [ ] Manual smoke: chat happy path, divination → CTA → 起一卦 → gua card, switcher new/rename/delete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes (for the executing engineer)

If you find any of these post-merge, file a Plan 7 follow-up:

1. **Test counts vs. plan estimates** — plan estimates ≈40 new tests; actual
   may differ by ±5. As long as the 9 contract assertions are covered and
   coverage stays ≥85%, that's fine.

2. **fake_llm helper API divergence** — Plan 5's helper may expose different
   names than `set_stream` / `capture_messages` / `set_double_failure`.
   Adapt tests to match; if no helper exists, add one to
   `server/tests/integration/conftest.py` mirroring Plan 5's pattern (look
   at how chart_llm SSE tests fake the LLM).

3. **`pushChat` alias** — added to keep Chat.jsx churn small. Mark for
   Plan 7 cleanup: rename callsites to `appendMessage`, drop the alias.

4. **CTA "consume" race** — if a user double-clicks "起一卦" before the
   first gua stream completes, two gua POSTs may both DELETE the cta row
   (the second sees null). This is benign — the second cast still INSERTs
   its gua message. Documented as "race acceptable" in spec §11.

5. **`conversations.position` collision** — concurrent POSTs to
   `/api/charts/:cid/conversations` could both compute the same `next_pos`.
   Not a functional bug (no UNIQUE constraint), but the ordering may briefly
   show ties. Plan 7 can add a UNIQUE(chart_id, position) WHERE
   deleted_at IS NULL constraint if it becomes a problem.
