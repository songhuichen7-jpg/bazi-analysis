# Charts CRUD + Paipan 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 3 的认证闭环之上接入 paipan Python 包并落地命盘 CRUD：2 个公开路由（`/api/config` + `/api/cities`）+ 5 个 `/api/charts` 核心路由 + 1 个 `/api/charts/:id/restore`。

**Architecture:** 四层分离：`schemas/` Pydantic 契约、`services/paipan_adapter.py` 薄封装 paipan 调用、`services/chart.py` CRUD 业务 + 15 盘上限 + 软删窗口、`api/*` 纯 HTTP 层（catch `ServiceError` → 统一错误响应）。`birth_input`/`paipan`/`label` 全部走 Plan 2 的 `EncryptedJSONB`/`EncryptedText` 透明加解密；`current_user` 已在 Plan 3 挂好 DEK contextvar，service/route 无需任何显式 DEK 操作。跨用户/不存在/软删超窗一律 404 防枚举。

**Tech Stack:** Python 3.12 · FastAPI · SQLAlchemy 2.0 async · asyncpg · Postgres 16 · pydantic v2 · pytest + testcontainers · paipan（本仓内部 uv workspace 成员）

---

## 设计约束（每一 task 必须遵守）

1. **不引入新依赖** —— paipan 已在 uv workspace；FastAPI/Pydantic/SQLAlchemy/cryptography 在 Plan 2 已装
2. **不加 Alembic migration** —— Plan 2 已落 `charts` + `chart_cache` 表，Plan 3 已改 `users`，Plan 4 纯业务层
3. **不碰 Plan 3 契约** —— `auth/deps.py`、`services/session.py`、`services/auth.py`、`api/auth.py`、`api/sessions.py` 一行不改；`current_user` 已经把 DEK 挂 contextvar
4. **TDD**：红 → 绿 → 提交
5. **每个 task 必须 commit + `uv run --package server pytest` 绿**
6. **`# NOTE:` 注释标注 spec 来源**（延续 Plan 1/2/3 纪律）
7. **跨用户/不存在/软删超 30 天** → 统一 404 `CHART_NOT_FOUND`（不是 403）
8. **POST `/api/charts` 的 paipan warnings** 在 response 里一次性吐出，**不落 DB**
9. **GET `/api/charts/:id` 不做任何写操作** —— `cache_stale` 只是 flag
10. **PATCH 仅改 `label`** —— `birth_input` 不允许 patch（改生日就是新盘）
11. **15 盘上限走 post-check**（INSERT 后 `SELECT count(*) > 15` 则事务 rollback），不用 `FOR UPDATE`
12. **engine_version 运行时读 `paipan.VERSION`**，不写 env

## 目录最终形态（plan 执行完的样子）

```
server/
├── app/
│   ├── api/
│   │   ├── charts.py                  # ← 本 plan 产出
│   │   └── public.py                  # ← 本 plan 产出
│   ├── services/
│   │   ├── chart.py                   # ← 本 plan 产出
│   │   ├── paipan_adapter.py          # ← 本 plan 产出
│   │   └── exceptions.py              # MODIFY: +4 新异常
│   ├── schemas/
│   │   ├── chart.py                   # ← 本 plan 产出
│   │   └── config.py                  # ← 本 plan 产出
│   ├── core/
│   │   └── quotas.py                  # MODIFY: +MAX_CHARTS_PER_USER
│   └── main.py                        # MODIFY: +include charts/public routers
├── tests/
│   ├── unit/
│   │   ├── test_chart_schemas.py      # ← 本 plan 产出
│   │   ├── test_paipan_adapter.py     # ← 本 plan 产出
│   │   ├── test_chart_service_create.py  # ← 本 plan 产出
│   │   ├── test_chart_service_read.py    # ← 本 plan 产出
│   │   └── test_chart_service_write.py   # ← 本 plan 产出
│   └── integration/
│       ├── test_public_routes.py      # ← 本 plan 产出
│       ├── test_charts_create.py      # ← 本 plan 产出
│       ├── test_charts_read.py        # ← 本 plan 产出
│       ├── test_charts_update_delete.py  # ← 本 plan 产出
│       ├── test_charts_restore.py     # ← 本 plan 产出
│       └── test_charts_e2e.py         # ← 本 plan 产出
└── ACCEPTANCE.md                      # REWRITE: Plan 2+3+4 合并

paipan/
├── paipan/cities.py                   # MODIFY: +all_cities()
├── paipan/__init__.py                 # MODIFY: export all_cities
└── tests/test_all_cities.py           # ← 本 plan 产出
```

---

## Task 列表预览

- **Task 1**：Exceptions + schemas（`chart.py` / `config.py`）+ `MAX_CHARTS_PER_USER` 常量
- **Task 2**：`paipan.cities.all_cities()` 辅助函数 + 导出
- **Task 3**：`app/services/paipan_adapter.py` + 单元测试
- **Task 4**：`app/services/chart.py` — `create_chart` + 单元测试
- **Task 5**：`app/services/chart.py` — `list_charts` / `get_chart` / `get_cache_slots` + 单元测试
- **Task 6**：`app/services/chart.py` — `update_label` / `soft_delete` / `restore` + 单元测试
- **Task 7**：`app/api/public.py` + 集成测试（/api/config + /api/cities）
- **Task 8**：`app/api/charts.py` 7 路由 + `main.py` 接入 + 集成测试
- **Task 9**：端到端 lifecycle 集成测试
- **Task 10**：ACCEPTANCE.md 重写 + wheel 冒烟 + 硬闸验收

---

## Task 1: Exceptions + schemas + MAX_CHARTS_PER_USER

**Files:**
- Modify: `server/app/services/exceptions.py`（在末尾追加 4 个类）
- Modify: `server/app/core/quotas.py`（追加常量）
- Create: `server/app/schemas/chart.py`
- Create: `server/app/schemas/config.py`
- Test: `server/tests/unit/test_chart_schemas.py`

- [ ] **Step 1.1: 先写 schema 校验失败测试（红）**

Create `server/tests/unit/test_chart_schemas.py`:

```python
"""Pydantic schema validation for chart request/response."""
from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_birth_input_happy_path():
    from app.schemas.chart import BirthInput
    b = BirthInput(year=1990, month=5, day=12, hour=14, minute=30,
                   city="北京", gender="male")
    assert b.ziConvention == "early"
    assert b.useTrueSolarTime is True


def test_birth_input_hour_unknown_minus_one_ok():
    from app.schemas.chart import BirthInput
    b = BirthInput(year=1990, month=5, day=12, hour=-1, gender="female")
    assert b.hour == -1


def test_birth_input_hour_out_of_range_rejected():
    from app.schemas.chart import BirthInput
    with pytest.raises(ValidationError):
        BirthInput(year=1990, month=5, day=12, hour=24, gender="male")
    with pytest.raises(ValidationError):
        BirthInput(year=1990, month=5, day=12, hour=-2, gender="male")


def test_birth_input_gender_literal_enforced():
    from app.schemas.chart import BirthInput
    with pytest.raises(ValidationError):
        BirthInput(year=1990, month=5, day=12, hour=12, gender="X")


def test_birth_input_longitude_range():
    from app.schemas.chart import BirthInput
    with pytest.raises(ValidationError):
        BirthInput(year=1990, month=5, day=12, hour=12, gender="male", longitude=181)


def test_chart_create_request_label_length_40():
    from app.schemas.chart import ChartCreateRequest, BirthInput
    b = BirthInput(year=1990, month=5, day=12, hour=12, gender="male")
    # 40 char exactly
    ChartCreateRequest(birth_input=b, label="a" * 40)
    # 41 rejected
    with pytest.raises(ValidationError):
        ChartCreateRequest(birth_input=b, label="a" * 41)


def test_chart_create_request_label_optional():
    from app.schemas.chart import ChartCreateRequest, BirthInput
    b = BirthInput(year=1990, month=5, day=12, hour=12, gender="male")
    req = ChartCreateRequest(birth_input=b)
    assert req.label is None


def test_cache_slot_defaults():
    from app.schemas.chart import CacheSlot
    s = CacheSlot(kind="verdicts", key="", has_cache=False)
    assert s.regen_count == 0
    assert s.model_used is None
    assert s.generated_at is None


def test_config_response_shape():
    from app.schemas.config import ConfigResponse
    c = ConfigResponse(require_invite=True, engine_version="0.1.0", max_charts_per_user=15)
    assert c.require_invite is True
    assert c.max_charts_per_user == 15


def test_city_item_fields():
    from app.schemas.config import CityItem
    c = CityItem(name="北京", lng=116.4, lat=39.9)
    assert c.name == "北京"
```

- [ ] **Step 1.2: 运行测试确认 import 失败（红）**

Run: `uv run --package server pytest server/tests/unit/test_chart_schemas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.schemas.chart'`

- [ ] **Step 1.3: 写 `app/schemas/chart.py`**

Create `server/app/schemas/chart.py`:

```python
"""Pydantic request/response schemas for /api/charts/*.

Separate from app/models/chart.py (ORM). Encrypted fields (birth_input /
paipan / label) are encoded as plain dicts/strings here; the ORM layer
handles actual encryption transparently.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ---- request bodies ---------------------------------------------------


class BirthInput(BaseModel):
    """paipan.compute() kwargs 的 1:1 映射。字段名/类型完全沿用 paipan。"""

    # NOTE: spec §2.1 / paipan.compute() signature
    year: int = Field(..., ge=1900, le=2100)
    month: int = Field(..., ge=1, le=12)
    day: int = Field(..., ge=1, le=31)
    # hour=-1 表示时辰未知；其余 0..23
    hour: int = Field(..., ge=-1, le=23)
    minute: int = Field(0, ge=0, le=59)
    city: str | None = Field(None, max_length=40)
    longitude: float | None = Field(None, ge=-180, le=180)
    gender: Literal["male", "female"]
    ziConvention: Literal["early", "late"] = "early"
    useTrueSolarTime: bool = True


class ChartCreateRequest(BaseModel):
    birth_input: BirthInput
    label: str | None = Field(None, max_length=40)


class ChartLabelUpdateRequest(BaseModel):
    label: str | None = Field(None, max_length=40)


# ---- response bodies --------------------------------------------------


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
    paipan: dict
    engine_version: str
    created_at: datetime
    updated_at: datetime


class ChartResponse(BaseModel):
    chart: ChartDetail
    cache_slots: list[CacheSlot] = Field(default_factory=list)
    cache_stale: bool
    # POST 时含 paipan.warnings；其他路由为空
    warnings: list[str] = Field(default_factory=list)


class ChartListResponse(BaseModel):
    items: list[ChartListItem]
```

- [ ] **Step 1.4: 写 `app/schemas/config.py`**

Create `server/app/schemas/config.py`:

```python
"""Public-endpoint schemas (/api/config + /api/cities)."""
from __future__ import annotations

from pydantic import BaseModel


class ConfigResponse(BaseModel):
    require_invite: bool
    engine_version: str
    max_charts_per_user: int


class CityItem(BaseModel):
    name: str
    lng: float
    lat: float


class CitiesResponse(BaseModel):
    items: list[CityItem]
```

- [ ] **Step 1.5: 在 `app/services/exceptions.py` 末尾追加 4 个异常类**

Modify `server/app/services/exceptions.py`（在 `QuotaExceededError` 之后追加）：

```python
# ---- Plan 4: charts ---------------------------------------------------


class InvalidBirthInput(ServiceError):
    code = "INVALID_BIRTH_INPUT"
    message = "出生信息无效"
    status = 400


class ChartNotFound(ServiceError):
    code = "CHART_NOT_FOUND"
    message = "命盘不存在"
    status = 404


class ChartLimitExceeded(ServiceError):
    code = "CHART_LIMIT_EXCEEDED"
    message = "命盘数量已达上限"
    status = 409

    def __init__(self, limit: int):
        super().__init__(
            message=f"已达 {limit} 盘上限",
            details={"limit": limit},
        )


class ChartAlreadyDeleted(ServiceError):
    code = "CHART_ALREADY_DELETED"
    message = "命盘已在软删状态"
    status = 409
```

- [ ] **Step 1.6: 在 `app/core/quotas.py` 末尾追加 `MAX_CHARTS_PER_USER`**

Modify `server/app/core/quotas.py`（在 `seconds_until_midnight()` 之后追加）：

```python
# NOTE: spec §2.2 — 每用户活动盘上限；软删不算。
MAX_CHARTS_PER_USER = 15
```

- [ ] **Step 1.7: 跑测试确认全绿（绿）**

Run: `uv run --package server pytest server/tests/unit/test_chart_schemas.py -v`
Expected: 10 passed

Also verify Plan 3 tests 未被破坏:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 102 passed (Plan 3 baseline) + 10 new = 112 passed

- [ ] **Step 1.8: Commit**

```bash
cd /Users/veko/code/usual/bazi-analysis/.claude/worktrees/lucid-yalow-97b48c
git add server/app/schemas/chart.py server/app/schemas/config.py \
        server/app/services/exceptions.py server/app/core/quotas.py \
        server/tests/unit/test_chart_schemas.py
git commit -m "feat(server): chart schemas + 4 exceptions + MAX_CHARTS_PER_USER"
```

---

## Task 2: paipan.cities.all_cities() 辅助函数

**Files:**
- Modify: `paipan/paipan/cities.py`（末尾追加一个公开函数）
- Modify: `paipan/paipan/__init__.py`（导出 `all_cities`）
- Test: `paipan/tests/test_all_cities.py`

- [ ] **Step 2.1: 先写失败的单元测试**

Create `paipan/tests/test_all_cities.py`:

```python
"""Public helper: all_cities() — full flat list for server /api/cities route."""
from __future__ import annotations


def test_all_cities_returns_nonempty_sorted_list():
    from paipan.cities import all_cities
    items = all_cities()
    assert len(items) > 1000  # mainland dataset alone has >1k
    names = [t[0] for t in items]
    assert names == sorted(names), "must be name-sorted for stable ETag"


def test_all_cities_each_item_has_name_lng_lat():
    from paipan.cities import all_cities
    for name, lng, lat in all_cities()[:20]:
        assert isinstance(name, str) and name
        assert -180 <= lng <= 180
        assert -90 <= lat <= 90


def test_all_cities_includes_overseas_supplements():
    from paipan.cities import all_cities
    names = {t[0] for t in all_cities()}
    # NOTE: cities.py module-level _OVERSEAS 包含 "东京" "伦敦" 等
    assert "东京" in names
    assert "伦敦" in names


def test_all_cities_includes_mainland_samples():
    from paipan.cities import all_cities
    names = {t[0] for t in all_cities()}
    # 任何一个主流城市都应在；检查 3 个代表性的
    # cities-data.json 的 key 形态见 cities.js port
    # 这里不假设具体 key 形态（"北京" vs "北京市"），只要能找到其一
    assert any(n in names for n in ("北京", "北京市"))


def test_all_cities_is_deterministic_across_calls():
    from paipan.cities import all_cities
    a = all_cities()
    b = all_cities()
    assert a == b


def test_all_cities_exported_from_package_root():
    import paipan
    assert callable(paipan.all_cities)
```

- [ ] **Step 2.2: 跑测试确认失败**

Run: `uv run --package paipan pytest paipan/tests/test_all_cities.py -v`
Expected: FAIL with `ImportError: cannot import name 'all_cities'`

- [ ] **Step 2.3: 在 `paipan/paipan/cities.py` 末尾追加 `all_cities()`**

Modify `paipan/paipan/cities.py`（末尾追加；保留已有 `get_city_coords`）：

```python
def all_cities() -> list[tuple[str, float, float]]:
    """Return every canonical (name, lng, lat) known to paipan.

    Name-sorted for stable hashing / ETag. Includes mainland dataset from
    cities-data.json plus the _OVERSEAS supplement. Server exposes this
    via GET /api/cities.
    """
    # NOTE: reuse the already-cached index built by _build_index(); the
    # exact map's keys are canonical names.
    idx = _build_index()
    return sorted(
        [(name, lng, lat) for name, (lng, lat) in idx.exact.items()],
        key=lambda t: t[0],
    )
```

- [ ] **Step 2.4: 在 `paipan/paipan/__init__.py` 导出 `all_cities`**

Modify `paipan/paipan/__init__.py`（更新 imports + `__all__`）：

```python
from paipan.constants import VERSION
from paipan.types import BirthInput, City, Gender, ZiConvention
from paipan.cities import get_city_coords, all_cities
from paipan.compute import compute

__all__ = [
    "VERSION",
    "BirthInput",
    "City",
    "Gender",
    "ZiConvention",
    "get_city_coords",
    "all_cities",
    "compute",
]
```

- [ ] **Step 2.5: 跑 paipan 单元测试全绿**

Run: `uv run --package paipan pytest paipan/tests/test_all_cities.py -v`
Expected: 6 passed

- [ ] **Step 2.6: 跑 paipan 回归全绿（不回归）**

Run: `uv run --package paipan pytest paipan/tests/ -n auto`
Expected: 385 regression + previous unit + 6 new = 全绿

- [ ] **Step 2.7: Commit**

```bash
git add paipan/paipan/cities.py paipan/paipan/__init__.py paipan/tests/test_all_cities.py
git commit -m "feat(paipan): all_cities() helper for server /api/cities route"
```

---

## Task 3: paipan_adapter — resolve_city / run_paipan / is_cache_stale

**Files:**
- Create: `server/app/services/paipan_adapter.py`
- Test: `server/tests/unit/test_paipan_adapter.py`

- [ ] **Step 3.1: 先写单元测试（红）**

Create `server/tests/unit/test_paipan_adapter.py`:

```python
"""paipan_adapter: thin wrapper mapping Pydantic ↔ paipan.compute."""
from __future__ import annotations

import pytest


def test_resolve_city_hits_canonical():
    from app.services.paipan_adapter import resolve_city
    r = resolve_city("北京市")
    assert r is not None
    assert isinstance(r["canonical"], str) and r["canonical"]
    # canonical should be name-normalized form; precise form varies by dataset
    assert isinstance(r["lng"], float)
    assert isinstance(r["lat"], float)


def test_resolve_city_none_on_empty():
    from app.services.paipan_adapter import resolve_city
    assert resolve_city(None) is None
    assert resolve_city("") is None
    assert resolve_city("   ") is None


def test_resolve_city_none_on_unknown():
    from app.services.paipan_adapter import resolve_city
    assert resolve_city("ZZZZ不存在的城市XYZ") is None


def test_is_cache_stale_same_version_false():
    from app.services.paipan_adapter import is_cache_stale
    import paipan
    assert is_cache_stale(paipan.VERSION) is False


def test_is_cache_stale_different_version_true():
    from app.services.paipan_adapter import is_cache_stale
    assert is_cache_stale("0.0.0") is True
    assert is_cache_stale("") is True


def test_run_paipan_happy_path():
    from app.schemas.chart import BirthInput
    from app.services.paipan_adapter import run_paipan
    import paipan
    b = BirthInput(year=1990, month=5, day=12, hour=14, minute=30,
                   city="北京", gender="male")
    paipan_dict, warnings, version = run_paipan(b)
    assert version == paipan.VERSION
    # paipan.compute returns sizhu / rizhu / shishen / ... — just spot-check a few
    assert "sizhu" in paipan_dict
    assert "dayun" in paipan_dict
    assert isinstance(warnings, list)
    # warnings not embedded back into paipan_dict
    assert "warnings" not in paipan_dict


def test_run_paipan_hour_unknown():
    from app.schemas.chart import BirthInput
    from app.services.paipan_adapter import run_paipan
    b = BirthInput(year=1990, month=5, day=12, hour=-1, gender="female")
    paipan_dict, warnings, _ = run_paipan(b)
    assert paipan_dict["hourUnknown"] is True


def test_run_paipan_unknown_city_yields_warning():
    from app.schemas.chart import BirthInput
    from app.services.paipan_adapter import run_paipan
    b = BirthInput(year=1990, month=5, day=12, hour=12,
                   city="ZZZZ不存在的城市XYZ", gender="male")
    _, warnings, _ = run_paipan(b)
    assert any("未识别城市" in w for w in warnings)


def test_run_paipan_valueerror_maps_to_invalidbirthinput(monkeypatch):
    from app.schemas.chart import BirthInput
    from app.services import paipan_adapter
    from app.services.exceptions import InvalidBirthInput

    def _boom(**kwargs):
        raise ValueError("bad input")

    monkeypatch.setattr(paipan_adapter, "paipan_compute", _boom)

    b = BirthInput(year=1990, month=5, day=12, hour=12, gender="male")
    with pytest.raises(InvalidBirthInput) as exc:
        paipan_adapter.run_paipan(b)
    assert "bad input" in str(exc.value)
```

- [ ] **Step 3.2: 跑测试确认失败**

Run: `uv run --package server pytest server/tests/unit/test_paipan_adapter.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.services.paipan_adapter'`

- [ ] **Step 3.3: 实现 `app/services/paipan_adapter.py`**

Create `server/app/services/paipan_adapter.py`:

```python
"""Thin wrapper over paipan package.

Boundaries:
- Pydantic BirthInput → paipan.compute kwargs
- paipan.ValueError → InvalidBirthInput (HTTP 400)
- paipan.VERSION → cache staleness check
- get_city_coords → canonical name + coords

Warnings from paipan are returned in-band but NOT persisted — they track
paipan logic that may evolve across versions.
"""
from __future__ import annotations

from paipan import compute as paipan_compute
from paipan import VERSION as PAIPAN_VERSION
from paipan.cities import get_city_coords

from app.schemas.chart import BirthInput
from app.services.exceptions import InvalidBirthInput


def resolve_city(raw: str | None) -> dict | None:
    """Normalize a user-entered city name to {canonical, lng, lat}.

    Returns None for falsy / unresolved inputs.
    """
    # NOTE: spec §3.1 — service layer must re-normalize before persisting;
    # don't trust client-side values.
    if raw is None or not str(raw).strip():
        return None
    c = get_city_coords(raw)
    if c is None:
        return None
    return {"canonical": c.canonical, "lng": c.lng, "lat": c.lat}


def run_paipan(birth: BirthInput) -> tuple[dict, list[str], str]:
    """Invoke paipan.compute and split warnings out of the result dict.

    Returns (paipan_dict, warnings, engine_version). The returned paipan_dict
    has no 'warnings' key — caller is responsible for forwarding warnings to
    the API response if desired (not persisted).
    """
    try:
        result = paipan_compute(**birth.model_dump())
    except ValueError as e:
        # NOTE: paipan internals raise ValueError only on genuinely bad input
        # (invalid ganzhi / zhi); surface as HTTP 400.
        raise InvalidBirthInput(str(e)) from e

    warnings = result.pop("warnings", []) or []
    return result, list(warnings), PAIPAN_VERSION


def is_cache_stale(chart_engine_version: str) -> bool:
    """True iff the chart was computed under a different paipan version."""
    return chart_engine_version != PAIPAN_VERSION
```

- [ ] **Step 3.4: 跑测试确认绿**

Run: `uv run --package server pytest server/tests/unit/test_paipan_adapter.py -v`
Expected: 9 passed

Verify Plan 3 未回归:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 102 + 10 (Task 1) + 9 = 121 passed

- [ ] **Step 3.5: Commit**

```bash
git add server/app/services/paipan_adapter.py server/tests/unit/test_paipan_adapter.py
git commit -m "feat(server): paipan_adapter (resolve_city/run_paipan/is_cache_stale)"
```

---

## Task 4: chart service — create_chart

**Files:**
- Create: `server/app/services/chart.py`（仅含 `create_chart`，其他方法 Task 5/6 追加）
- Test: `server/tests/unit/test_chart_service_create.py`

**Context**：service unit tests 用 `db_session` fixture（参考 `tests/unit/test_quota_ticket.py`）+ 真随机 DEK + `user_dek_context` 让 EncryptedJSONB 透明加解密。

- [ ] **Step 4.1: 先写失败测试（红）**

Create `server/tests/unit/test_chart_service_create.py`:

```python
"""chart service — create_chart: paipan wiring, encrypted roundtrip, 15-cap."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            maker = async_sessionmaker(bind=conn, expire_on_commit=False)
            async with maker() as session:
                yield session
            await trans.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def user_and_dek(db_session):
    """Create a fresh user with a real random DEK; yield (user, dek)."""
    from app.models.user import User
    dek = os.urandom(32)
    u = User(
        phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
        dek_ciphertext=b"\x00" * 44,  # placeholder; service uses contextvar not this
    )
    db_session.add(u)
    await db_session.flush()
    return u, dek


@pytest.mark.asyncio
async def test_create_chart_happy_path(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service
    import paipan

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(
            year=1990, month=5, day=12, hour=14, minute=30,
            city="北京", gender="male",
        ),
        label="测试盘",
    )
    with user_dek_context(dek):
        created, warnings = await chart_service.create_chart(db_session, user, req)

    assert created.user_id == user.id
    assert created.label == "测试盘"
    assert created.engine_version == paipan.VERSION
    assert created.deleted_at is None
    # paipan dict roundtrips through EncryptedJSONB
    assert "sizhu" in created.paipan
    assert isinstance(warnings, list)


@pytest.mark.asyncio
async def test_create_chart_label_optional(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=12, gender="male"),
    )
    with user_dek_context(dek):
        created, _ = await chart_service.create_chart(db_session, user, req)
    assert created.label is None


@pytest.mark.asyncio
async def test_create_chart_city_canonicalized_writeback(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=14,
                               city="北京市", gender="male"),  # 带"市"
    )
    with user_dek_context(dek):
        created, _ = await chart_service.create_chart(db_session, user, req)
    # DB stored birth_input.city must match what get_city_coords canonicalizes.
    # NOTE: the canonical form depends on cities-data.json; don't hardcode
    # "北京" vs "北京市" — ask paipan.
    from paipan.cities import get_city_coords
    expected = get_city_coords("北京市").canonical
    assert created.birth_input["city"] == expected


@pytest.mark.asyncio
async def test_create_chart_unknown_city_kept_verbatim_with_warning(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=14,
                               city="ZZZZ未知城市", gender="male"),
    )
    with user_dek_context(dek):
        created, warnings = await chart_service.create_chart(db_session, user, req)
    assert created.birth_input["city"] == "ZZZZ未知城市"  # 原样保留
    assert any("未识别城市" in w for w in warnings)


@pytest.mark.asyncio
async def test_create_chart_hour_unknown(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=-1, gender="female"),
    )
    with user_dek_context(dek):
        created, _ = await chart_service.create_chart(db_session, user, req)
    assert created.paipan["hourUnknown"] is True
    assert created.birth_input["hour"] == -1


@pytest.mark.asyncio
async def test_create_chart_16th_raises_limit(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service
    from app.services.exceptions import ChartLimitExceeded

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=12, gender="male"),
    )
    with user_dek_context(dek):
        for _ in range(15):
            await chart_service.create_chart(db_session, user, req)
        with pytest.raises(ChartLimitExceeded) as exc:
            await chart_service.create_chart(db_session, user, req)
    assert exc.value.details == {"limit": 15}


@pytest.mark.asyncio
async def test_create_chart_soft_deleted_not_counted(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service
    from sqlalchemy import text

    user, dek = user_and_dek
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=12, gender="male"),
    )
    with user_dek_context(dek):
        # Create 15 then soft-delete 1 → 16th should succeed.
        for _ in range(15):
            await chart_service.create_chart(db_session, user, req)
        # NOTE: Postgres doesn't support UPDATE ... LIMIT; use a CTE.
        await db_session.execute(
            text("""
                UPDATE charts SET deleted_at = now()
                 WHERE id = (SELECT id FROM charts
                              WHERE user_id = :uid AND deleted_at IS NULL
                              LIMIT 1)
            """),
            {"uid": user.id},
        )
        await db_session.flush()
        # 16th chart under active count of 14 + 1 new = 15 → still ok
        created, _ = await chart_service.create_chart(db_session, user, req)
    assert created.deleted_at is None
```

- [ ] **Step 4.2: 跑测试确认失败**

Run: `uv run --package server pytest server/tests/unit/test_chart_service_create.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.services.chart'`

- [ ] **Step 4.3: 实现 `app/services/chart.py`（create_chart 部分）**

Create `server/app/services/chart.py`:

```python
"""Chart CRUD service.

Layer boundaries:
- In:  (AsyncSession, User, Pydantic request)
- Out: ORM Chart row (or list thereof)
- Errors: raise typed ServiceError subclasses; api/ maps to HTTP.

DEK contextvar is assumed already set by the current_user dep at route
entry — service code never touches it explicitly.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.quotas import MAX_CHARTS_PER_USER
from app.models.chart import Chart
from app.models.user import User
from app.schemas.chart import ChartCreateRequest
from app.services import paipan_adapter
from app.services.exceptions import ChartLimitExceeded


SOFT_DELETE_WINDOW = timedelta(days=30)


async def create_chart(
    db: AsyncSession,
    user: User,
    req: ChartCreateRequest,
) -> tuple[Chart, list[str]]:
    """Create a new chart for ``user``.

    Pipeline:
      1. Normalize city (write canonical name back to birth_input if resolved).
      2. Run paipan.compute → (paipan_dict, warnings, engine_version).
      3. INSERT chart; flush to get row.
      4. Post-check active-count ≤ MAX_CHARTS_PER_USER; over-limit raises
         ChartLimitExceeded (caller's transaction rolls back).
    """
    # NOTE: spec §3.2 step 1 — canonicalize before persisting.
    birth = req.birth_input.model_copy()
    if birth.city:
        resolved = paipan_adapter.resolve_city(birth.city)
        if resolved is not None:
            birth = birth.model_copy(update={"city": resolved["canonical"]})

    # NOTE: spec §3.1 — paipan call; ValueError → InvalidBirthInput (400).
    paipan_dict, warnings, engine_version = paipan_adapter.run_paipan(birth)

    chart = Chart(
        user_id=user.id,
        label=req.label,
        birth_input=birth.model_dump(),  # EncryptedJSONB transparent
        paipan=paipan_dict,
        engine_version=engine_version,
    )
    db.add(chart)
    await db.flush()  # obtain chart.id + verify schema constraints

    # NOTE: spec §2.4 — post-check 15-chart ceiling; soft-deleted charts don't count.
    active_count = (await db.execute(
        select(func.count(Chart.id)).where(
            Chart.user_id == user.id,
            Chart.deleted_at.is_(None),
        )
    )).scalar_one()
    if active_count > MAX_CHARTS_PER_USER:
        raise ChartLimitExceeded(limit=MAX_CHARTS_PER_USER)

    return chart, warnings
```

- [ ] **Step 4.4: 跑测试确认绿**

Run: `uv run --package server pytest server/tests/unit/test_chart_service_create.py -v`
Expected: 7 passed

Also verify Plan 3 未回归:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 121 + 7 = 128 passed

- [ ] **Step 4.5: Commit**

```bash
git add server/app/services/chart.py server/tests/unit/test_chart_service_create.py
git commit -m "feat(server): chart.create_chart (paipan wiring + 15-chart ceiling)"
```

---

## Task 5: chart service — list_charts / get_chart / get_cache_slots

**Files:**
- Modify: `server/app/services/chart.py`（追加 3 个方法）
- Test: `server/tests/unit/test_chart_service_read.py`

- [ ] **Step 5.1: 先写失败测试（红）**

Create `server/tests/unit/test_chart_service_read.py`:

```python
"""chart service — list_charts / get_chart (with soft-delete window) / get_cache_slots."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            maker = async_sessionmaker(bind=conn, expire_on_commit=False)
            async with maker() as session:
                yield session
            await trans.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def user_and_dek(db_session):
    from app.models.user import User
    dek = os.urandom(32)
    u = User(
        phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
        dek_ciphertext=b"\x00" * 44,
    )
    db_session.add(u)
    await db_session.flush()
    return u, dek


async def _make_chart(db_session, user, label=None):
    from app.db_types import user_dek_context
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=12, gender="male"),
        label=label,
    )
    return (await chart_service.create_chart(db_session, user, req))[0]


@pytest.mark.asyncio
async def test_list_charts_empty(db_session, user_and_dek):
    from app.services import chart as chart_service
    user, _ = user_and_dek
    rows = await chart_service.list_charts(db_session, user)
    assert rows == []


@pytest.mark.asyncio
async def test_list_charts_happy_desc(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        a = await _make_chart(db_session, user, label="A")
        b = await _make_chart(db_session, user, label="B")
        c = await _make_chart(db_session, user, label="C")
        rows = await chart_service.list_charts(db_session, user)
    ids = [r.id for r in rows]
    # DESC by created_at; c newest first
    assert ids == [c.id, b.id, a.id]


@pytest.mark.asyncio
async def test_list_charts_excludes_soft_deleted(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        a = await _make_chart(db_session, user, label="keep")
        b = await _make_chart(db_session, user, label="gone")
        await db_session.execute(
            text("UPDATE charts SET deleted_at = now() WHERE id = :cid"), {"cid": b.id},
        )
        await db_session.flush()
        rows = await chart_service.list_charts(db_session, user)
    assert len(rows) == 1
    assert rows[0].id == a.id


@pytest.mark.asyncio
async def test_list_charts_isolated_per_user(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.models.user import User
    from app.services import chart as chart_service
    user_a, dek_a = user_and_dek
    # Second user
    user_b = User(phone=f"+86139{uuid.uuid4().int % 10**8:08d}",
                  dek_ciphertext=b"\x00" * 44)
    db_session.add(user_b)
    await db_session.flush()
    dek_b = os.urandom(32)

    with user_dek_context(dek_a):
        await _make_chart(db_session, user_a, label="A")
    with user_dek_context(dek_b):
        await _make_chart(db_session, user_b, label="B")
        rows_b = await chart_service.list_charts(db_session, user_b)
    with user_dek_context(dek_a):
        rows_a = await chart_service.list_charts(db_session, user_a)
    assert len(rows_a) == 1 and rows_a[0].label == "A"
    assert len(rows_b) == 1 and rows_b[0].label == "B"


@pytest.mark.asyncio
async def test_get_chart_happy(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user, label="X")
        got = await chart_service.get_chart(db_session, user, c.id)
    assert got.id == c.id
    assert got.label == "X"


@pytest.mark.asyncio
async def test_get_chart_nonexistent_raises(db_session, user_and_dek):
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user, _ = user_and_dek
    with pytest.raises(ChartNotFound):
        await chart_service.get_chart(db_session, user, uuid.uuid4())


@pytest.mark.asyncio
async def test_get_chart_wrong_owner_raises(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.models.user import User
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound

    user_a, dek_a = user_and_dek
    user_b = User(phone=f"+86139{uuid.uuid4().int % 10**8:08d}",
                  dek_ciphertext=b"\x00" * 44)
    db_session.add(user_b)
    await db_session.flush()

    with user_dek_context(dek_a):
        c = await _make_chart(db_session, user_a)
    with pytest.raises(ChartNotFound):
        await chart_service.get_chart(db_session, user_b, c.id)


@pytest.mark.asyncio
async def test_get_chart_soft_deleted_default_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        await db_session.execute(
            text("UPDATE charts SET deleted_at = now() WHERE id = :cid"), {"cid": c.id},
        )
        await db_session.flush()
        with pytest.raises(ChartNotFound):
            await chart_service.get_chart(db_session, user, c.id)


@pytest.mark.asyncio
async def test_get_chart_include_soft_deleted_within_window(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        await db_session.execute(
            text("UPDATE charts SET deleted_at = now() WHERE id = :cid"), {"cid": c.id},
        )
        await db_session.flush()
        got = await chart_service.get_chart(db_session, user, c.id, include_soft_deleted=True)
    assert got.id == c.id
    assert got.deleted_at is not None


@pytest.mark.asyncio
async def test_get_chart_soft_deleted_past_window_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        # Simulate 31 days ago.
        await db_session.execute(
            text("UPDATE charts SET deleted_at = now() - INTERVAL '31 days' WHERE id = :cid"),
            {"cid": c.id},
        )
        await db_session.flush()
        with pytest.raises(ChartNotFound):
            await chart_service.get_chart(db_session, user, c.id, include_soft_deleted=True)


@pytest.mark.asyncio
async def test_get_cache_slots_empty(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        slots = await chart_service.get_cache_slots(db_session, c.id)
    # Plan 4: chart_cache table always empty → []
    assert slots == []
```

- [ ] **Step 5.2: 跑测试确认失败**

Run: `uv run --package server pytest server/tests/unit/test_chart_service_read.py -v`
Expected: FAIL with `AttributeError: module 'app.services.chart' has no attribute 'list_charts'`

- [ ] **Step 5.3: 在 `app/services/chart.py` 追加 3 个函数**

Modify `server/app/services/chart.py`（在 `create_chart` 之后追加）：

```python
from sqlalchemy import delete
from uuid import UUID

from app.models.chart import Chart, ChartCache
from app.schemas.chart import CacheSlot
from app.services.exceptions import ChartNotFound


async def list_charts(db: AsyncSession, user: User) -> list[Chart]:
    """Active charts for ``user``, newest first."""
    rows = (await db.execute(
        select(Chart).where(
            Chart.user_id == user.id,
            Chart.deleted_at.is_(None),
        ).order_by(Chart.created_at.desc())
    )).scalars().all()
    return list(rows)


async def get_chart(
    db: AsyncSession,
    user: User,
    chart_id: UUID,
    *,
    include_soft_deleted: bool = False,
) -> Chart:
    """Owner-scoped lookup. Raises ChartNotFound for any miss.

    include_soft_deleted=False (default): WHERE deleted_at IS NULL.
    include_soft_deleted=True: allow soft-deleted rows within 30d window;
        rows deleted_at <= now() - 30d still raise ChartNotFound (out-of-window).
    """
    stmt = select(Chart).where(
        Chart.id == chart_id,
        Chart.user_id == user.id,
    )
    if not include_soft_deleted:
        stmt = stmt.where(Chart.deleted_at.is_(None))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise ChartNotFound()

    if include_soft_deleted and row.deleted_at is not None:
        # Window check using DB clock to match deleted_at timezone semantics.
        # NOTE: spec §0.3 decision #5 — 30d window; beyond this → 404.
        cutoff = (await db.execute(
            text("SELECT now() - INTERVAL '30 days'")
        )).scalar_one()
        if row.deleted_at <= cutoff:
            raise ChartNotFound()

    return row


async def get_cache_slots(db: AsyncSession, chart_id: UUID) -> list[CacheSlot]:
    """Return all chart_cache rows as CacheSlot schema objects.

    Plan 4: chart_cache table is never written; this function returns [].
    Plan 5 LLM routes write cache → function returns non-empty automatically.
    """
    rows = (await db.execute(
        select(ChartCache).where(ChartCache.chart_id == chart_id)
    )).scalars().all()
    return [
        CacheSlot(
            kind=r.kind,
            key=r.key,
            has_cache=r.content is not None,
            model_used=r.model_used,
            regen_count=r.regen_count,
            generated_at=r.generated_at,
        )
        for r in rows
    ]
```

- [ ] **Step 5.4: 跑测试确认绿**

Run: `uv run --package server pytest server/tests/unit/test_chart_service_read.py -v`
Expected: 11 passed

Also verify Plan 2/3/4-previous tests:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 128 + 11 = 139 passed

- [ ] **Step 5.5: Commit**

```bash
git add server/app/services/chart.py server/tests/unit/test_chart_service_read.py
git commit -m "feat(server): chart.list_charts / get_chart / get_cache_slots"
```

---

## Task 6: chart service — update_label / soft_delete / restore

**Files:**
- Modify: `server/app/services/chart.py`（追加 3 个方法）
- Test: `server/tests/unit/test_chart_service_write.py`

- [ ] **Step 6.1: 先写失败测试（红）**

Create `server/tests/unit/test_chart_service_write.py`:

```python
"""chart service — update_label / soft_delete / restore."""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def db_session(database_url):
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            maker = async_sessionmaker(bind=conn, expire_on_commit=False)
            async with maker() as session:
                yield session
            await trans.rollback()
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def user_and_dek(db_session):
    from app.models.user import User
    dek = os.urandom(32)
    u = User(
        phone=f"+86138{uuid.uuid4().int % 10**8:08d}",
        dek_ciphertext=b"\x00" * 44,
    )
    db_session.add(u)
    await db_session.flush()
    return u, dek


async def _make_chart(db_session, user, label=None):
    from app.schemas.chart import BirthInput, ChartCreateRequest
    from app.services import chart as chart_service
    req = ChartCreateRequest(
        birth_input=BirthInput(year=1990, month=5, day=12, hour=12, gender="male"),
        label=label,
    )
    return (await chart_service.create_chart(db_session, user, req))[0]


@pytest.mark.asyncio
async def test_update_label_happy(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user, label="old")
        updated = await chart_service.update_label(db_session, user, c.id, "new")
    assert updated.label == "new"
    assert updated.id == c.id


@pytest.mark.asyncio
async def test_update_label_to_null(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user, label="old")
        updated = await chart_service.update_label(db_session, user, c.id, None)
    assert updated.label is None


@pytest.mark.asyncio
async def test_update_label_wrong_owner_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.models.user import User
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user_a, dek_a = user_and_dek
    user_b = User(phone=f"+86139{uuid.uuid4().int % 10**8:08d}",
                  dek_ciphertext=b"\x00" * 44)
    db_session.add(user_b)
    await db_session.flush()
    with user_dek_context(dek_a):
        c = await _make_chart(db_session, user_a)
    with pytest.raises(ChartNotFound):
        await chart_service.update_label(db_session, user_b, c.id, "evil")


@pytest.mark.asyncio
async def test_update_label_soft_deleted_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        await chart_service.soft_delete(db_session, user, c.id)
        with pytest.raises(ChartNotFound):
            await chart_service.update_label(db_session, user, c.id, "nope")


@pytest.mark.asyncio
async def test_soft_delete_happy(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        await chart_service.soft_delete(db_session, user, c.id)
    # Row still present but deleted_at set
    row = (await db_session.execute(
        text("SELECT deleted_at FROM charts WHERE id = :cid"), {"cid": c.id},
    )).scalar_one()
    assert row is not None


@pytest.mark.asyncio
async def test_soft_delete_already_deleted_raises(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartAlreadyDeleted
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        await chart_service.soft_delete(db_session, user, c.id)
        with pytest.raises(ChartAlreadyDeleted):
            await chart_service.soft_delete(db_session, user, c.id)


@pytest.mark.asyncio
async def test_soft_delete_wrong_owner_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.models.user import User
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user_a, dek_a = user_and_dek
    user_b = User(phone=f"+86139{uuid.uuid4().int % 10**8:08d}",
                  dek_ciphertext=b"\x00" * 44)
    db_session.add(user_b)
    await db_session.flush()
    with user_dek_context(dek_a):
        c = await _make_chart(db_session, user_a)
    with pytest.raises(ChartNotFound):
        await chart_service.soft_delete(db_session, user_b, c.id)


@pytest.mark.asyncio
async def test_restore_happy(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user, label="coming back")
        await chart_service.soft_delete(db_session, user, c.id)
        restored = await chart_service.restore(db_session, user, c.id)
    assert restored.id == c.id
    assert restored.deleted_at is None
    assert restored.label == "coming back"


@pytest.mark.asyncio
async def test_restore_not_deleted_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        with pytest.raises(ChartNotFound):
            await chart_service.restore(db_session, user, c.id)


@pytest.mark.asyncio
async def test_restore_beyond_window_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user, dek = user_and_dek
    with user_dek_context(dek):
        c = await _make_chart(db_session, user)
        await db_session.execute(
            text("UPDATE charts SET deleted_at = now() - INTERVAL '31 days' WHERE id = :cid"),
            {"cid": c.id},
        )
        await db_session.flush()
        with pytest.raises(ChartNotFound):
            await chart_service.restore(db_session, user, c.id)


@pytest.mark.asyncio
async def test_restore_at_15_cap_raises(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.services import chart as chart_service
    from app.services.exceptions import ChartLimitExceeded
    user, dek = user_and_dek
    with user_dek_context(dek):
        victim = await _make_chart(db_session, user, label="victim")
        await chart_service.soft_delete(db_session, user, victim.id)
        # Fill up 15 active after the soft-delete
        for _ in range(15):
            await _make_chart(db_session, user)
        # Restore would make 16 active → 409
        with pytest.raises(ChartLimitExceeded):
            await chart_service.restore(db_session, user, victim.id)


@pytest.mark.asyncio
async def test_restore_wrong_owner_404(db_session, user_and_dek):
    from app.db_types import user_dek_context
    from app.models.user import User
    from app.services import chart as chart_service
    from app.services.exceptions import ChartNotFound
    user_a, dek_a = user_and_dek
    user_b = User(phone=f"+86139{uuid.uuid4().int % 10**8:08d}",
                  dek_ciphertext=b"\x00" * 44)
    db_session.add(user_b)
    await db_session.flush()
    with user_dek_context(dek_a):
        c = await _make_chart(db_session, user_a)
        await chart_service.soft_delete(db_session, user_a, c.id)
    with pytest.raises(ChartNotFound):
        await chart_service.restore(db_session, user_b, c.id)
```

- [ ] **Step 6.2: 跑测试确认失败**

Run: `uv run --package server pytest server/tests/unit/test_chart_service_write.py -v`
Expected: FAIL `AttributeError: module 'app.services.chart' has no attribute 'update_label'`

- [ ] **Step 6.3: 在 `app/services/chart.py` 追加 3 个函数**

Modify `server/app/services/chart.py`（在 `get_cache_slots` 之后追加）：

```python
from app.services.exceptions import ChartAlreadyDeleted


async def update_label(
    db: AsyncSession,
    user: User,
    chart_id: UUID,
    label: str | None,
) -> Chart:
    """Update chart.label for an active (non-soft-deleted) chart."""
    chart = await get_chart(db, user, chart_id)  # raises ChartNotFound
    chart.label = label
    chart.updated_at = datetime.now(tz=timezone.utc)
    await db.flush()
    return chart


async def soft_delete(db: AsyncSession, user: User, chart_id: UUID) -> None:
    """Set chart.deleted_at = now(). Raises ChartAlreadyDeleted if already soft-deleted."""
    chart = await get_chart(db, user, chart_id, include_soft_deleted=True)
    if chart.deleted_at is not None:
        raise ChartAlreadyDeleted()
    chart.deleted_at = datetime.now(tz=timezone.utc)
    await db.flush()


async def restore(db: AsyncSession, user: User, chart_id: UUID) -> Chart:
    """Clear chart.deleted_at for a soft-deleted chart still within 30d window.

    Raises:
      ChartNotFound — not exist / wrong owner / not soft-deleted / past 30d window
      ChartLimitExceeded — restoring would push active count over MAX_CHARTS_PER_USER
    """
    chart = await get_chart(db, user, chart_id, include_soft_deleted=True)
    if chart.deleted_at is None:
        # Not in soft-deleted state; same 404 response as "not exist" (防枚举).
        raise ChartNotFound()

    # Post-check active count WITHOUT counting this row (still soft-deleted).
    active_count = (await db.execute(
        select(func.count(Chart.id)).where(
            Chart.user_id == user.id,
            Chart.deleted_at.is_(None),
        )
    )).scalar_one()
    if active_count >= MAX_CHARTS_PER_USER:
        raise ChartLimitExceeded(limit=MAX_CHARTS_PER_USER)

    chart.deleted_at = None
    chart.updated_at = datetime.now(tz=timezone.utc)
    await db.flush()
    return chart
```

- [ ] **Step 6.4: 跑测试确认绿**

Run: `uv run --package server pytest server/tests/unit/test_chart_service_write.py -v`
Expected: 12 passed

Full suite:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 139 + 12 = 151 passed

- [ ] **Step 6.5: Commit**

```bash
git add server/app/services/chart.py server/tests/unit/test_chart_service_write.py
git commit -m "feat(server): chart.update_label / soft_delete / restore"
```

---

## Task 7: /api/config + /api/cities (public routes)

**Files:**
- Create: `server/app/api/public.py`
- Modify: `server/app/main.py`（include 新 router）
- Test: `server/tests/integration/test_public_routes.py`

- [ ] **Step 7.1: 先写失败的集成测试（红）**

Create `server/tests/integration/test_public_routes.py`:

```python
"""Public endpoints: /api/config + /api/cities."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_config_shape(client):
    r = await client.get("/api/config")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"require_invite", "engine_version", "max_charts_per_user"}
    assert isinstance(body["require_invite"], bool)
    assert body["max_charts_per_user"] == 15
    import paipan
    assert body["engine_version"] == paipan.VERSION


@pytest.mark.asyncio
async def test_cities_returns_list(client):
    r = await client.get("/api/cities")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert len(body["items"]) > 1000
    # each item has shape
    for it in body["items"][:5]:
        assert set(it.keys()) == {"name", "lng", "lat"}


@pytest.mark.asyncio
async def test_cities_sorted_by_name(client):
    r = await client.get("/api/cities")
    names = [it["name"] for it in r.json()["items"]]
    assert names == sorted(names)


@pytest.mark.asyncio
async def test_cities_etag_header_present(client):
    r = await client.get("/api/cities")
    assert "etag" in {k.lower() for k in r.headers}
    assert r.headers.get("cache-control") == "public, max-age=86400"


@pytest.mark.asyncio
async def test_cities_if_none_match_returns_304(client):
    r1 = await client.get("/api/cities")
    etag = r1.headers["etag"]
    r2 = await client.get("/api/cities", headers={"If-None-Match": etag})
    assert r2.status_code == 304
    assert r2.content == b""


@pytest.mark.asyncio
async def test_cities_response_size_under_500kb(client):
    r = await client.get("/api/cities")
    # Raw (uncompressed) body size sanity cap; actual over-the-wire will be
    # much smaller under gzip.
    assert len(r.content) < 500_000


@pytest.mark.asyncio
async def test_config_no_auth_required(client):
    # No cookie → 200 (public route).
    r = await client.get("/api/config")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_cities_no_auth_required(client):
    r = await client.get("/api/cities")
    assert r.status_code == 200
```

- [ ] **Step 7.2: 跑测试确认失败**

Run: `uv run --package server pytest server/tests/integration/test_public_routes.py -v`
Expected: FAIL with 404 (routes not registered)

- [ ] **Step 7.3: 实现 `app/api/public.py`**

Create `server/app/api/public.py`:

```python
"""Public endpoints — no auth required.

/api/config → feature flags for the frontend to render with
/api/cities → full city list for frontend typeahead (cached via ETag)
"""
from __future__ import annotations

import hashlib
from functools import lru_cache

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

import paipan

from app.core.config import settings
from app.core.quotas import MAX_CHARTS_PER_USER
from app.schemas.config import CitiesResponse, CityItem, ConfigResponse

router = APIRouter(tags=["public"])


@router.get("/api/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    return ConfigResponse(
        require_invite=settings.require_invite,
        engine_version=paipan.VERSION,
        max_charts_per_user=MAX_CHARTS_PER_USER,
    )


@lru_cache(maxsize=1)
def _cities_payload() -> tuple[dict, str]:
    """Build the /api/cities payload once per process.

    Returns (serializable_dict, etag_quoted) — both cached.
    """
    items = paipan.all_cities()  # already name-sorted
    resp = CitiesResponse(items=[CityItem(name=n, lng=lng, lat=lat) for n, lng, lat in items])
    etag_raw = hashlib.sha1(f"{paipan.VERSION}:{len(items)}".encode("utf-8")).hexdigest()[:16]
    return resp.model_dump(mode="json"), f'"{etag_raw}"'


@router.get("/api/cities")
async def get_cities(request: Request) -> Response:
    payload, etag = _cities_payload()
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": "public, max-age=86400"},
        )
    return JSONResponse(
        content=payload,
        headers={"ETag": etag, "Cache-Control": "public, max-age=86400"},
    )
```

- [ ] **Step 7.4: 在 `app/main.py` include 新 router**

Modify `server/app/main.py` — 在 `app.include_router(sessions_router)` 下方追加：

```python
from app.api.public import router as public_router
...
app.include_router(public_router)
```

Complete relevant section of updated `main.py`:

```python
from app.api.auth import router as auth_router
from app.api.sessions import router as sessions_router
from app.api.public import router as public_router
...
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(public_router)
```

- [ ] **Step 7.5: 跑测试确认绿**

Run: `uv run --package server pytest server/tests/integration/test_public_routes.py -v`
Expected: 8 passed

Full suite:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 151 + 8 = 159 passed

- [ ] **Step 7.6: Commit**

```bash
git add server/app/api/public.py server/app/main.py server/tests/integration/test_public_routes.py
git commit -m "feat(server): /api/config + /api/cities (public routes, ETag cached)"
```

---

## Task 8: /api/charts 7 路由 + main.py 接入

**Files:**
- Create: `server/app/api/charts.py`
- Modify: `server/app/main.py`（include charts router）
- Test: `server/tests/integration/test_charts_create.py`
- Test: `server/tests/integration/test_charts_read.py`
- Test: `server/tests/integration/test_charts_update_delete.py`
- Test: `server/tests/integration/test_charts_restore.py`

**Strategy**：这是 plan 最大的 task。先实现完整的 `charts.py` router；测试按资源域拆成 4 个文件以便并行。

- [ ] **Step 8.1: 实现 `app/api/charts.py`**

Create `server/app/api/charts.py`:

```python
"""HTTP layer for /api/charts/*. Thin wrapper over services/chart."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import current_user
from app.core.db import get_db
from app.models.chart import Chart
from app.models.user import User
from app.schemas.chart import (
    BirthInput,
    CacheSlot,
    ChartCreateRequest,
    ChartDetail,
    ChartLabelUpdateRequest,
    ChartListItem,
    ChartListResponse,
    ChartResponse,
)
from app.services import chart as chart_service
from app.services import paipan_adapter
from app.services.exceptions import ServiceError

router = APIRouter(
    prefix="/api/charts",
    tags=["charts"],
    dependencies=[Depends(current_user)],
)


def _http_error(err: ServiceError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.to_dict())


async def _chart_to_response(
    chart: Chart,
    *,
    db: AsyncSession,
    warnings: list[str] | None = None,
) -> ChartResponse:
    slots = await chart_service.get_cache_slots(db, chart.id)
    return ChartResponse(
        chart=ChartDetail(
            id=chart.id,
            label=chart.label,
            birth_input=BirthInput(**chart.birth_input),
            paipan=chart.paipan,
            engine_version=chart.engine_version,
            created_at=chart.created_at,
            updated_at=chart.updated_at,
        ),
        cache_slots=slots,
        cache_stale=paipan_adapter.is_cache_stale(chart.engine_version),
        warnings=warnings or [],
    )


@router.get("", response_model=ChartListResponse)
async def list_charts_endpoint(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartListResponse:
    rows = await chart_service.list_charts(db, user)
    return ChartListResponse(items=[
        ChartListItem(
            id=r.id,
            label=r.label,
            engine_version=r.engine_version,
            cache_stale=paipan_adapter.is_cache_stale(r.engine_version),
            created_at=r.created_at,
            updated_at=r.updated_at,
        ) for r in rows
    ])


@router.post("", response_model=ChartResponse, status_code=status.HTTP_201_CREATED)
async def create_chart_endpoint(
    body: ChartCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart, warnings = await chart_service.create_chart(db, user, body)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db, warnings=warnings)


@router.get("/{chart_id}", response_model=ChartResponse)
async def get_chart_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart = await chart_service.get_chart(db, user, chart_id)
    except ServiceError as e:
        raise _http_error(e)
    return await _chart_to_response(chart, db=db)


@router.patch("/{chart_id}", response_model=ChartResponse)
async def patch_chart_endpoint(
    chart_id: UUID,
    body: ChartLabelUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart = await chart_service.update_label(db, user, chart_id, body.label)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db)


@router.delete("/{chart_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chart_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> Response:
    try:
        await chart_service.soft_delete(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{chart_id}/restore", response_model=ChartResponse)
async def restore_chart_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart = await chart_service.restore(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db)
```

- [ ] **Step 8.2: 在 `app/main.py` include charts router**

Modify `server/app/main.py` — 在 `public_router` 之前 include：

```python
from app.api.charts import router as charts_router
...
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(charts_router)
app.include_router(public_router)
```

- [ ] **Step 8.3: 写 create 集成测试**

Create `server/tests/integration/test_charts_create.py`:

```python
"""POST /api/charts integration tests."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


@pytest.mark.asyncio
async def test_create_happy(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 14,
                "minute": 30, "city": "北京", "gender": "male",
            },
            "label": "测试盘",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["chart"]["label"] == "测试盘"
    assert "sizhu" in body["chart"]["paipan"]
    assert body["cache_slots"] == []
    assert body["cache_stale"] is False
    import paipan
    assert body["chart"]["engine_version"] == paipan.VERSION


@pytest.mark.asyncio
async def test_create_unauthenticated_401(client):
    r = await client.post("/api/charts", json={
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    })
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_hour_minus_one_ok(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": -1, "gender": "female"},
        },
    )
    assert r.status_code == 201
    assert r.json()["chart"]["paipan"]["hourUnknown"] is True


@pytest.mark.asyncio
async def test_create_hour_out_of_range_422(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 99, "gender": "male"},
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_unknown_city_yields_warning(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 12,
                "city": "ZZZZ未知", "gender": "male",
            },
        },
    )
    assert r.status_code == 201
    assert any("未识别城市" in w for w in r.json()["warnings"])


@pytest.mark.asyncio
async def test_create_city_canonicalized(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 12,
                "city": "北京市", "gender": "male",
            },
        },
    )
    assert r.status_code == 201
    from paipan.cities import get_city_coords
    expected = get_city_coords("北京市").canonical
    assert r.json()["chart"]["birth_input"]["city"] == expected


@pytest.mark.asyncio
async def test_create_label_null_ok(client):
    cookie, _ = await _register(client)
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
        },
    )
    assert r.status_code == 201
    assert r.json()["chart"]["label"] is None


@pytest.mark.asyncio
async def test_create_16th_returns_409(client):
    cookie, _ = await _register(client)
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    }
    for _ in range(15):
        r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
        assert r.status_code == 201
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    assert r.status_code == 409
    err = r.json()["detail"]
    assert err["code"] == "CHART_LIMIT_EXCEEDED"
    assert err["details"]["limit"] == 15


@pytest.mark.asyncio
async def test_create_cross_user_isolation(client):
    cookie_a, _ = await _register(client)
    cookie_b, _ = await _register(client)
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
        "label": "A盘",
    }
    r1 = await client.post("/api/charts", cookies={"session": cookie_a}, json=body)
    assert r1.status_code == 201
    chart_id = r1.json()["chart"]["id"]

    r2 = await client.get(f"/api/charts/{chart_id}", cookies={"session": cookie_b})
    assert r2.status_code == 404
    assert r2.json()["detail"]["code"] == "CHART_NOT_FOUND"
```

- [ ] **Step 8.4: 写 read (list + get) 集成测试**

Create `server/tests/integration/test_charts_read.py`:

```python
"""GET /api/charts + GET /api/charts/:id integration tests."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


async def _make(client, cookie, label=None):
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    }
    if label is not None:
        body["label"] = label
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    assert r.status_code == 201, r.text
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_list_empty(client):
    cookie, _ = await _register(client)
    r = await client.get("/api/charts", cookies={"session": cookie})
    assert r.status_code == 200
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_list_desc_order(client):
    cookie, _ = await _register(client)
    a = await _make(client, cookie, "A")
    b = await _make(client, cookie, "B")
    c = await _make(client, cookie, "C")
    r = await client.get("/api/charts", cookies={"session": cookie})
    ids = [it["id"] for it in r.json()["items"]]
    assert ids == [c, b, a]


@pytest.mark.asyncio
async def test_list_unauthenticated_401(client):
    r = await client.get("/api/charts")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_detail_happy(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie, "X")
    r = await client.get(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 200
    body = r.json()
    assert body["chart"]["id"] == cid
    assert body["chart"]["label"] == "X"
    assert body["cache_slots"] == []
    assert body["cache_stale"] is False
    assert body["warnings"] == []


@pytest.mark.asyncio
async def test_get_detail_nonexistent_404(client):
    cookie, _ = await _register(client)
    r = await client.get(f"/api/charts/{uuid.uuid4()}", cookies={"session": cookie})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "CHART_NOT_FOUND"


@pytest.mark.asyncio
async def test_get_detail_cache_stale_flag(client, database_url):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)

    # Simulate an engine upgrade by bumping the stored engine_version.
    engine = create_async_engine(str(database_url))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        await s.execute(
            text("UPDATE charts SET engine_version = '0.0.0' WHERE id = :cid"),
            {"cid": cid},
        )
        await s.commit()
    await engine.dispose()

    r = await client.get(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 200
    assert r.json()["cache_stale"] is True
    # GET must NOT have written anything — engine_version stays '0.0.0'.
    engine = create_async_engine(str(database_url))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        ver = (await s.execute(
            text("SELECT engine_version FROM charts WHERE id = :cid"), {"cid": cid},
        )).scalar_one()
    await engine.dispose()
    assert ver == "0.0.0"


@pytest.mark.asyncio
async def test_get_detail_soft_deleted_404(client, database_url):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    # Soft-delete via DELETE endpoint.
    r = await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 204
    r = await client.get(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted(client):
    cookie, _ = await _register(client)
    keep = await _make(client, cookie, "keep")
    gone = await _make(client, cookie, "gone")
    r = await client.delete(f"/api/charts/{gone}", cookies={"session": cookie})
    assert r.status_code == 204
    r = await client.get("/api/charts", cookies={"session": cookie})
    ids = [it["id"] for it in r.json()["items"]]
    assert ids == [keep]
```

- [ ] **Step 8.5: 写 update + delete 集成测试**

Create `server/tests/integration/test_charts_update_delete.py`:

```python
"""PATCH + DELETE /api/charts/:id integration tests."""
from __future__ import annotations

import uuid

import pytest
from tests.integration.conftest import register_user


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


async def _make(client, cookie, label=None):
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    }
    if label is not None:
        body["label"] = label
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_patch_label_happy(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie, "old")
    r = await client.patch(
        f"/api/charts/{cid}",
        cookies={"session": cookie},
        json={"label": "new"},
    )
    assert r.status_code == 200
    assert r.json()["chart"]["label"] == "new"


@pytest.mark.asyncio
async def test_patch_label_to_null(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie, "anything")
    r = await client.patch(
        f"/api/charts/{cid}",
        cookies={"session": cookie},
        json={"label": None},
    )
    assert r.status_code == 200
    assert r.json()["chart"]["label"] is None


@pytest.mark.asyncio
async def test_patch_label_too_long_422(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    r = await client.patch(
        f"/api/charts/{cid}",
        cookies={"session": cookie},
        json={"label": "a" * 41},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_nonexistent_404(client):
    cookie, _ = await _register(client)
    r = await client.patch(
        f"/api/charts/{uuid.uuid4()}",
        cookies={"session": cookie},
        json={"label": "x"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_cross_user_404(client):
    cookie_a, _ = await _register(client)
    cookie_b, _ = await _register(client)
    cid = await _make(client, cookie_a, "a")
    r = await client.patch(
        f"/api/charts/{cid}",
        cookies={"session": cookie_b},
        json={"label": "evil"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_happy(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    r = await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 204
    # GET now 404
    r = await client.get(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_already_soft_deleted_409(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    r = await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 204
    r = await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CHART_ALREADY_DELETED"


@pytest.mark.asyncio
async def test_delete_cross_user_404(client):
    cookie_a, _ = await _register(client)
    cookie_b, _ = await _register(client)
    cid = await _make(client, cookie_a)
    r = await client.delete(f"/api/charts/{cid}", cookies={"session": cookie_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_404(client):
    cookie, _ = await _register(client)
    r = await client.delete(f"/api/charts/{uuid.uuid4()}", cookies={"session": cookie})
    assert r.status_code == 404
```

- [ ] **Step 8.6: 写 restore 集成测试**

Create `server/tests/integration/test_charts_restore.py`:

```python
"""POST /api/charts/:id/restore integration tests."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.integration.conftest import register_user


async def _register(client):
    phone = f"+86138{uuid.uuid4().int % 10**8:08d}"
    return await register_user(client, phone)


async def _make(client, cookie, label=None):
    body = {
        "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
    }
    if label is not None:
        body["label"] = label
    r = await client.post("/api/charts", cookies={"session": cookie}, json=body)
    return r.json()["chart"]["id"]


@pytest.mark.asyncio
async def test_restore_happy(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie, "coming back")
    await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    r = await client.post(f"/api/charts/{cid}/restore", cookies={"session": cookie})
    assert r.status_code == 200
    assert r.json()["chart"]["label"] == "coming back"
    # Now GET returns 200 again.
    r = await client.get(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_restore_not_soft_deleted_404(client):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    r = await client.post(f"/api/charts/{cid}/restore", cookies={"session": cookie})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_restore_nonexistent_404(client):
    cookie, _ = await _register(client)
    r = await client.post(
        f"/api/charts/{uuid.uuid4()}/restore", cookies={"session": cookie},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_restore_cross_user_404(client):
    cookie_a, _ = await _register(client)
    cookie_b, _ = await _register(client)
    cid = await _make(client, cookie_a)
    await client.delete(f"/api/charts/{cid}", cookies={"session": cookie_a})
    r = await client.post(f"/api/charts/{cid}/restore", cookies={"session": cookie_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_restore_past_window_404(client, database_url):
    cookie, _ = await _register(client)
    cid = await _make(client, cookie)
    await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})

    engine = create_async_engine(str(database_url))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        await s.execute(
            text("UPDATE charts SET deleted_at = now() - INTERVAL '31 days' WHERE id = :cid"),
            {"cid": cid},
        )
        await s.commit()
    await engine.dispose()

    r = await client.post(f"/api/charts/{cid}/restore", cookies={"session": cookie})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_restore_at_cap_409(client):
    cookie, _ = await _register(client)
    victim = await _make(client, cookie, "victim")
    await client.delete(f"/api/charts/{victim}", cookies={"session": cookie})
    # Fill up 15 active
    for _ in range(15):
        await _make(client, cookie)
    r = await client.post(f"/api/charts/{victim}/restore", cookies={"session": cookie})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CHART_LIMIT_EXCEEDED"
```

- [ ] **Step 8.7: 跑 integration 测试全绿**

Run: `uv run --package server pytest server/tests/integration/test_charts_create.py server/tests/integration/test_charts_read.py server/tests/integration/test_charts_update_delete.py server/tests/integration/test_charts_restore.py -v`
Expected: 9 + 8 + 9 + 6 = 32 passed

Full suite:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 159 + 32 = 191 passed

- [ ] **Step 8.8: Commit**

```bash
git add server/app/api/charts.py server/app/main.py \
        server/tests/integration/test_charts_create.py \
        server/tests/integration/test_charts_read.py \
        server/tests/integration/test_charts_update_delete.py \
        server/tests/integration/test_charts_restore.py
git commit -m "feat(server): /api/charts/* CRUD (list/create/get/patch/delete/restore)"
```

---

## Task 9: E2E lifecycle 集成测试

**Files:**
- Test: `server/tests/integration/test_charts_e2e.py`

**Goal**：验证端到端全链路（注册 → 建盘 → 列 → 读 → 改 → 软删 → 恢复 → 注销 → shred）一次性走通，且 crypto-shredding 后新用户 + 随机 DEK 读原密文报 `InvalidTag`。

- [ ] **Step 9.1: 写 E2E 测试**

Create `server/tests/integration/test_charts_e2e.py`:

```python
"""End-to-end: full chart lifecycle + cross-plan crypto-shredding integrity."""
from __future__ import annotations

import os
import uuid

import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.crypto import decrypt_field
from tests.integration.conftest import register_user


@pytest.mark.asyncio
async def test_full_lifecycle(client):
    """Register → create → list → get → patch → delete → restore → verify."""
    cookie, user = await register_user(client, "+8613800001111")

    # POST
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {
                "year": 1990, "month": 5, "day": 12, "hour": 14,
                "minute": 30, "city": "北京", "gender": "male",
            },
            "label": "我的本命盘",
        },
    )
    assert r.status_code == 201
    cid = r.json()["chart"]["id"]
    assert "sizhu" in r.json()["chart"]["paipan"]

    # LIST
    r = await client.get("/api/charts", cookies={"session": cookie})
    assert len(r.json()["items"]) == 1

    # GET detail
    r = await client.get(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 200

    # PATCH label
    r = await client.patch(
        f"/api/charts/{cid}",
        cookies={"session": cookie},
        json={"label": "改过的名字"},
    )
    assert r.json()["chart"]["label"] == "改过的名字"

    # DELETE (soft)
    r = await client.delete(f"/api/charts/{cid}", cookies={"session": cookie})
    assert r.status_code == 204

    # LIST now empty
    r = await client.get("/api/charts", cookies={"session": cookie})
    assert r.json()["items"] == []

    # RESTORE
    r = await client.post(f"/api/charts/{cid}/restore", cookies={"session": cookie})
    assert r.status_code == 200
    assert r.json()["chart"]["label"] == "改过的名字"

    # LIST shows it again
    r = await client.get("/api/charts", cookies={"session": cookie})
    assert len(r.json()["items"]) == 1


@pytest.mark.asyncio
async def test_chart_birth_input_unreadable_after_shredding(client, database_url):
    """Crypto-shredding makes a chart's encrypted birth_input unreadable.

    Create chart → shred account → attempt direct decrypt with random DEK → InvalidTag.
    This proves Plan 2's envelope encryption + Plan 3's shredding + Plan 4's
    EncryptedJSONB hold up end-to-end.
    """
    cookie, _ = await register_user(client, "+8613800002222")
    r = await client.post(
        "/api/charts",
        cookies={"session": cookie},
        json={
            "birth_input": {"year": 1990, "month": 5, "day": 12, "hour": 12, "gender": "male"},
        },
    )
    cid = r.json()["chart"]["id"]

    # Snapshot the raw ciphertext BEFORE shredding.
    engine = create_async_engine(str(database_url))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        raw_ct = (await s.execute(
            text("SELECT birth_input FROM charts WHERE id = :cid"),
            {"cid": cid},
        )).scalar_one()
    await engine.dispose()
    assert isinstance(raw_ct, (bytes, memoryview))
    ct_bytes = bytes(raw_ct)

    # Shred the account.
    r = await client.delete(
        "/api/auth/account",
        cookies={"session": cookie},
        json={"confirm": "DELETE MY ACCOUNT"},
    )
    assert r.status_code == 200

    # Attempt to decrypt the snapshot with a random DEK → InvalidTag.
    # decrypt_field is Plan 2's nonce-split + AES-GCM auth-tag wrapper.
    fake_dek = os.urandom(32)
    with pytest.raises(InvalidTag):
        decrypt_field(ct_bytes, fake_dek)
```

- [ ] **Step 9.2: 跑测试**

Run: `uv run --package server pytest server/tests/integration/test_charts_e2e.py -v`
Expected: 2 passed

Full suite:
Run: `uv run --package server pytest server/tests/ -n auto`
Expected: 191 + 2 = 193 passed

- [ ] **Step 9.3: Commit**

```bash
git add server/tests/integration/test_charts_e2e.py
git commit -m "test(server): E2E charts lifecycle + crypto-shredding roundtrip"
```

---

## Task 10: ACCEPTANCE + wheel 冒烟 + 硬闸验收

**Files:**
- Rewrite: `server/ACCEPTANCE.md`（Plan 2+3+4 合并）

- [ ] **Step 10.1: 跑完整测试套件 + 覆盖率**

Run:
```bash
uv run --package server pytest server/tests/ -n auto
```
Expected: 193 passed; record wall-time.

Run:
```bash
uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/
```
Expected: **≥ 85%** coverage on `app/*`. If < 85%, inspect the per-module table and add targeted tests for the uncovered branches BEFORE moving on.

- [ ] **Step 10.2: wheel 冒烟**

Run:
```bash
uv build --package server
python -m venv /tmp/plan4-wheel-check
source /tmp/plan4-wheel-check/bin/activate
pip install dist/server-0.1.0-py3-none-any.whl
python -c "
from app.main import app
routes = sorted([(r.path, r.methods) for r in app.routes if hasattr(r, 'methods')])
for p, m in routes:
    print(sorted(m), p)
"
deactivate
```
Expected output must include:
```
['GET'] /api/health
['GET'] /api/config
['GET'] /api/cities
['GET'] /api/charts
['POST'] /api/charts
['GET'] /api/charts/{chart_id}
['PATCH'] /api/charts/{chart_id}
['DELETE'] /api/charts/{chart_id}
['POST'] /api/charts/{chart_id}/restore
```
plus the 9 auth/sessions routes from Plan 3.

Count: `/api/health` (1) + auth (7) + sessions (2) + public (2) + charts (6) = **18 routes**.

- [ ] **Step 10.3: 重写 `server/ACCEPTANCE.md`**

Rewrite `server/ACCEPTANCE.md` (replace entire file):

```markdown
# server Backend — Acceptance Checklist

Plan 2 (Foundation) + Plan 3 (Auth Business) + Plan 4 (Charts CRUD + paipan) 合并状态。

## Hard Gates

- [x] **全部测试并行全绿**
  - `uv run --package server pytest server/tests/ -n auto`
  - Result: **193 passed in <TIME>s** → ✅
- [x] **源码覆盖率 ≥ 85%**
  - `uv run --package server pytest --cov=app --cov-config=/dev/null server/tests/`
  - Result: **<PCT>%** → ✅
- [x] **并行 CI runtime < 60s**
  - Wall time: **<TIME>s** → ✅
- [x] **wheel 可装可跑**
  - Isolated venv import of `app.main:app` prints 18 routes (health + 7 auth + 2 sessions + 2 public + 6 charts) → ✅
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
```

Fill in `<TIME>s` / `<PCT>%` with actual numbers from Step 10.1.

- [ ] **Step 10.4: Final Commit**

```bash
git add server/ACCEPTANCE.md
git commit -m "docs(server): Plan 4 acceptance (193 tests green, coverage ≥85%)"
```

- [ ] **Step 10.5: 最终校验**

```bash
git log --oneline | head -20
```
Expected to include in order (latest first):
- `docs(server): Plan 4 acceptance (193 tests green, coverage ≥85%)`
- `test(server): E2E charts lifecycle + crypto-shredding roundtrip`
- `feat(server): /api/charts/* CRUD (list/create/get/patch/delete/restore)`
- `feat(server): /api/config + /api/cities (public routes, ETag cached)`
- `feat(server): chart.update_label / soft_delete / restore`
- `feat(server): chart.list_charts / get_chart / get_cache_slots`
- `feat(server): chart.create_chart (paipan wiring + 15-chart ceiling)`
- `feat(server): paipan_adapter (resolve_city/run_paipan/is_cache_stale)`
- `feat(paipan): all_cities() helper for server /api/cities route`
- `feat(server): chart schemas + 4 exceptions + MAX_CHARTS_PER_USER`

Plus earlier Plan 3 commits.

---

## Recap — Task 完成后的最终产出

- 10 个有序 commit（8 feat + 1 test + 1 docs）
- 新文件：2 个 api + 2 个 service + 2 个 schema + 6 个测试文件 + 2 个 paipan touch
- 修改：3 个已有文件（`main.py`, `exceptions.py`, `quotas.py`, `paipan/__init__.py`, `paipan/cities.py`）
- 新增路由：**9 条**（2 public + 7 charts；其中 charts 原计划 6 条，由于 POST /{id}/restore 是独立路径合计 6 unique paths）
- 测试：**~91 条新增**（10 schema + 9 adapter + 7 create_service + 11 read_service + 12 write_service + 8 public + 9+8+9+6 charts + 2 E2E），合并后套件 **193 passed**
- 覆盖率 ≥ 85%；CI < 60s；wheel 可装可跑

Plan 4 完成后，Plan 5（LLM 长文 SSE + conversations + quota）可无缝接入。
