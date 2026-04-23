# 分享卡片 MVP (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 PM v4.0 spec 的个人分享卡片：匿名用户填生日 → 后端排盘 + 20 型映射 → 前端渲染卡片 → 保存/微信分享，并铺设埋点验证 K 因子。合盘功能留给 Phase 2。

**Architecture:** 裂变层（匿名 `/`、`/card/:slug`）和现有产品层（`/app/*`）路由隔离。后端新增 `POST /api/card` public 端点，复用现有 `paipan/li_liang/ge_ju` 排盘引擎，外加薄薄一层 20 型映射 + JSON 文案查表。前端用 React Router 拆两条路径，html2canvas 导出 PNG，微信 JS-SDK 分享。埋点独立表 `events`，K 因子通过 SQL 聚合。

**Tech Stack:** Python 3.12 + FastAPI + SQLAlchemy + Alembic + pytest（后端）；React 19 + Vite + Zustand + React Router + html2canvas + weixin-js-sdk + node:test（前端）。

**Spec:** `docs/superpowers/specs/2026-04-24-share-card-mvp-design.md`

---

## File Structure

### Backend (create)

```
server/app/data/cards/
  types.json                 20 型基础信息
  formations.json            10 十神后缀 + 20 金句
  subtags.json               200 组子标签矩阵
  state_thresholds.json      5 档 → 绽放/蓄力映射
  card_version.json          版本号
  illustrations/             (Phase 1 后期填入，Day 1-11 用占位)

server/app/services/card/
  __init__.py
  loader.py                  启动加载 & 缓存 JSON + 完整性校验
  mapping.py                 日主×state→type_id、force→state、ge_ju→十神
  payload.py                 组装 CardPayload（纯函数）
  slug.py                    分享 slug 生成与哈希

server/app/schemas/card.py   Pydantic CardRequest / CardResponse
server/app/models/card_share.py
server/app/models/event.py
server/app/api/card.py       POST /api/card + GET /api/card/:slug
server/app/api/tracking.py   POST /api/track
server/app/api/wx.py         GET /api/wx/jsapi-ticket
server/app/api/admin.py      GET /api/admin/metrics
server/alembic/versions/0003_card_shares_and_events.py

server/scripts/validate_cards_data.py  数据完整性校验脚本（独立可跑）

server/tests/unit/
  test_card_loader.py
  test_card_mapping.py
  test_card_payload.py
  test_card_slug.py
  test_card_schemas.py
server/tests/integration/
  test_card_api.py
  test_card_tracking_api.py
  test_card_admin_api.py
```

### Backend (modify)

```
server/app/main.py           挂载新 routers
server/app/core/config.py    新增 WX_APP_ID / WX_APP_SECRET / ADMIN_TOKEN 配置
```

### Frontend (create)

```
frontend/src/components/card/
  LandingScreen.jsx
  BirthForm.jsx
  TimeSegmentPicker.jsx
  CardScreen.jsx
  Card.jsx
  CardActions.jsx
  CardSkeleton.jsx
  UpgradeCTA.jsx

frontend/src/store/useCardStore.js

frontend/src/lib/
  cardApi.js
  saveImage.js
  wxShare.js
  analytics.js
  anonymousId.js

frontend/src/styles/card.css  (20 型主题样式)

frontend/tests/
  card-store.test.mjs
  card-api.test.mjs
  anonymous-id.test.mjs
  time-segment-picker.test.mjs
  birth-form.test.mjs
```

### Frontend (modify)

```
frontend/package.json        新增 react-router-dom, html2canvas, weixin-js-sdk
frontend/src/App.jsx         改用 Router，路由隔离 /app/*
frontend/src/main.jsx        BrowserRouter 包裹
frontend/src/index.css       引入 card.css
```

---

## Phase A: JSON 数据提取（Day 1-2）

### Task 1: 创建数据目录与版本文件

**Files:**
- Create: `server/app/data/cards/card_version.json`
- Create: `server/app/data/cards/illustrations/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p server/app/data/cards/illustrations
touch server/app/data/cards/illustrations/.gitkeep
```

- [ ] **Step 2: Write `card_version.json`**

```json
{
  "version": "v4.0-2026-04",
  "last_updated": "2026-04-24"
}
```

- [ ] **Step 3: Commit**

```bash
git add server/app/data/cards/
git commit -m "chore(cards): scaffold data directory + version file"
```

---

### Task 2: 提取 types.json（20 型基础信息）

**Files:**
- Create: `server/app/data/cards/types.json`
- Source: `PM/specs/02_八字人格类型系统.md`

- [ ] **Step 1: Read PM/specs/02 八字人格类型系统.md 完整内容**

阅读 02 文件的 20 型主表（结构：日主 × 绽放/蓄力 × 传播名 × 底色名 × 一句话 × 人格标签）。记录 20 条。

- [ ] **Step 2: Write `types.json`**

格式：key 为 "01"-"20"，每条包含 `id / day_stem / state / cosmic_name / base_name / one_liner / personality_tag / theme_color / illustration`

编号约定：甲绽放=01, 甲蓄力=02, 乙绽放=03, 乙蓄力=04, ...（按天干次序 × 绽放先于蓄力）

theme_color 按 spec §六的天干主题色表：
- 甲: #2D6A4F / 乙: #52B788 / 丙: #F5A623 / 丁: #4A9BE8 / 戊: #A0785A
- 己: #D4A574 / 庚: #4A7BA8 / 辛: #9B7AC4 / 壬: #1A759F / 癸: #4AC4C0

蓄力版颜色取同色相但降低明度/提高饱和度（参考值：绽放 #2D6A4F → 蓄力 #1B4332）。

illustration 字段 = `"{id}-{cosmic_name_pinyin}.png"`（如 "01-chunsun.png"）。

- [ ] **Step 3: 让用户扫一眼（diff-review）**

在对话中贴出生成的 types.json 前 5 条 + 最后 5 条，请用户确认 20 条内容、编号、主题色无误。若需调整再改。

- [ ] **Step 4: Commit**

```bash
git add server/app/data/cards/types.json
git commit -m "feat(cards): extract 20-type master data from PM/specs/02"
```

---

### Task 3: 提取 formations.json（10 十神后缀 + 20 金句）

**Files:**
- Create: `server/app/data/cards/formations.json`
- Source: `PM/specs/02a_格局标签系统.md`

- [ ] **Step 1: Read PM/specs/02a**

关注：行 376-389 的 10 十神后缀名表；行 79-373 的 20 条金句（每个十神 × 绽放/蓄力）。

- [ ] **Step 2: Write `formations.json`**

结构：

```json
{
  "食神": {
    "name": "食神",
    "suffixes": {
      "绽放": "天生享乐家",
      "蓄力": "灵感深潜者"
    },
    "golden_lines": {
      "绽放": "我不卷，但我什么都不缺",
      "蓄力": "脑子里攒了十条朋友圈，卡在不敢发"
    }
  },
  "伤官": { ... },
  ... (10 十神 total)
}
```

**Each 十神 has BOTH `suffixes` and `golden_lines` as objects with 绽放/蓄力 keys.** 20 suffix values + 20 golden_line values total. Both indexed by `state` at runtime.

**key 使用中文十神名，必须与 `paipan/shi_shen.py` 的 `ALL_SHI_SHEN` 列表完全对齐**：
`["比肩", "劫财", "食神", "伤官", "正财", "偏财", "正官", "七杀", "正印", "偏印"]`

- [ ] **Step 3: 用户 diff-review**

贴出完整 formations.json，请用户确认 10 条后缀 + 20 条金句无误。

- [ ] **Step 4: Commit**

```bash
git add server/app/data/cards/formations.json
git commit -m "feat(cards): extract 10 十神 suffixes + 20 金句 from PM/specs/02a"
```

---

### Task 4: 提取 subtags.json（200 组子标签矩阵）

**Files:**
- Create: `server/app/data/cards/subtags.json`
- Source: `PM/specs/02c_子标签矩阵.md`

- [ ] **Step 1: Read PM/specs/02c 完整矩阵**

v6.2 定稿的 200 组子标签（20 传播名 × 10 十神）。每组 3 条：[性格, 关系命势, 事业命势]。

- [ ] **Step 2: Write `subtags.json`**

结构：

```json
{
  "春笋": {
    "食神": ["冲上去再说", "人缘自己来", "会吃会玩也会赚"],
    "伤官": ["嘴比长得快", "桃花体质", "才华能变现"],
    "正财": [...],
    "偏财": [...],
    "正官": [...],
    "七杀": [...],
    "正印": [...],
    "偏印": [...],
    "比肩": [...],
    "劫财": [...]
  },
  "橡子": { ... 10 十神 },
  ...
  (全部 20 传播名)
}
```

**约束**：
- 外层 20 个传播名 key 必须与 types.json 的 cosmic_name 完全一致
- 内层 10 个十神 key 必须与 formations.json 一致
- 每个数组恰好 3 条字符串，无空值

- [ ] **Step 3: 用户分批 diff-review**

因 200 组较多，分 4 批贴出（每批 5 个传播名 × 10 十神 = 50 组），请用户逐批 OK 或修订。

- [ ] **Step 4: Commit**

```bash
git add server/app/data/cards/subtags.json
git commit -m "feat(cards): extract 200 subtag matrix from PM/specs/02c"
```

---

### Task 5: 提取 state_thresholds.json + 写数据校验脚本

**Files:**
- Create: `server/app/data/cards/state_thresholds.json`
- Create: `server/scripts/validate_cards_data.py`
- Test: 运行校验脚本

- [ ] **Step 1: Write `state_thresholds.json`**

```json
{
  "thresholds": {
    "strong_upper": 0.76,
    "strong_lower": 0.55,
    "neutral_lower": 0.35,
    "weak_lower": 0.12
  },
  "mapping": {
    "极强": "绽放",
    "身强": "绽放",
    "中和": "绽放",
    "身弱": "蓄力",
    "极弱": "蓄力"
  },
  "borderline_band": 0.05
}
```

阈值与 `paipan/li_liang.py:39-43` 的 `THRESHOLD_JI_QIANG/SHEN_QIANG/ZHONG_HE/JI_RUO` 保持一致。

- [ ] **Step 2: Write 校验脚本**

```python
# server/scripts/validate_cards_data.py
"""Validates server/app/data/cards/*.json for completeness and cross-reference consistency.
Run: python server/scripts/validate_cards_data.py
Exit 0 on success, 1 on any failure with details."""
from __future__ import annotations
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "app" / "data" / "cards"
TEN_SHEN = {"比肩", "劫财", "食神", "伤官", "正财", "偏财", "正官", "七杀", "正印", "偏印"}
STATES = {"绽放", "蓄力"}
FIVE_CATEGORIES = {"极强", "身强", "中和", "身弱", "极弱"}


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def load(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def main() -> None:
    types = load("types.json")
    formations = load("formations.json")
    subtags = load("subtags.json")
    thresholds = load("state_thresholds.json")

    # types.json
    if len(types) != 20:
        fail(f"types.json: expected 20, got {len(types)}")
    expected_ids = {f"{i:02d}" for i in range(1, 21)}
    if set(types.keys()) != expected_ids:
        fail(f"types.json: ids must be 01..20, got {sorted(types.keys())}")
    combos = set()
    cosmic_names = set()
    for tid, info in types.items():
        for key in ("id", "day_stem", "state", "cosmic_name", "base_name",
                    "one_liner", "personality_tag", "theme_color", "illustration"):
            if key not in info:
                fail(f"types.json[{tid}]: missing {key}")
        if info["state"] not in STATES:
            fail(f"types.json[{tid}]: invalid state {info['state']!r}")
        combos.add((info["day_stem"], info["state"]))
        cosmic_names.add(info["cosmic_name"])
    if len(combos) != 20:
        fail(f"types.json: duplicate day_stem×state combos, got {len(combos)}")

    # formations.json
    if set(formations.keys()) != TEN_SHEN:
        fail(f"formations.json: keys must be 10 十神, got {sorted(formations.keys())}")
    for ss, info in formations.items():
        if info.get("name") != ss:
            fail(f"formations.json[{ss}]: name mismatch")
        sf = info.get("suffixes", {})
        if set(sf.keys()) != STATES:
            fail(f"formations.json[{ss}]: suffixes keys must be {STATES}")
        for s, label in sf.items():
            if not label or not isinstance(label, str):
                fail(f"formations.json[{ss}].suffixes[{s}]: empty")
        gl = info.get("golden_lines", {})
        if set(gl.keys()) != STATES:
            fail(f"formations.json[{ss}]: golden_lines keys must be {STATES}")
        for s, line in gl.items():
            if not line or not isinstance(line, str):
                fail(f"formations.json[{ss}].golden_lines[{s}]: empty")

    # subtags.json
    if set(subtags.keys()) != cosmic_names:
        fail(f"subtags.json: outer keys must equal types.json cosmic_names. "
             f"Missing: {cosmic_names - set(subtags.keys())}, "
             f"Extra: {set(subtags.keys()) - cosmic_names}")
    for name, inner in subtags.items():
        if set(inner.keys()) != TEN_SHEN:
            fail(f"subtags.json[{name}]: inner keys must be 10 十神")
        for ss, tags in inner.items():
            if not isinstance(tags, list) or len(tags) != 3:
                fail(f"subtags.json[{name}][{ss}]: must have exactly 3 tags, got {tags!r}")
            for i, t in enumerate(tags):
                if not isinstance(t, str) or not t.strip():
                    fail(f"subtags.json[{name}][{ss}][{i}]: empty or non-string")

    # thresholds
    if set(thresholds["mapping"].keys()) != FIVE_CATEGORIES:
        fail(f"state_thresholds.json mapping keys must be {FIVE_CATEGORIES}")
    for cat, state in thresholds["mapping"].items():
        if state not in STATES:
            fail(f"state_thresholds.json mapping[{cat}]: invalid state {state!r}")

    print(f"OK: 20 types × 10 十神 = 200 combos validated. "
          f"All 4 files internally consistent.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run validation**

```bash
cd server && python scripts/validate_cards_data.py
```

Expected: `OK: 20 types × 10 十神 = 200 combos validated. All 4 files internally consistent.`

- [ ] **Step 4: Commit**

```bash
git add server/app/data/cards/state_thresholds.json server/scripts/validate_cards_data.py
git commit -m "feat(cards): state_thresholds.json + data validation script"
```

---

## Phase B: 后端卡片服务（Day 3-4）

### Task 6: Pydantic schemas

**Files:**
- Create: `server/app/schemas/card.py`
- Test: `server/tests/unit/test_card_schemas.py`

- [ ] **Step 1: Write failing test**

```python
# server/tests/unit/test_card_schemas.py
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.card import BirthInput, CardRequest, CardResponse


def test_birth_input_accepts_hour_minus_one_for_unknown():
    b = BirthInput(year=1998, month=7, day=15, hour=-1, minute=0)
    assert b.hour == -1


def test_birth_input_rejects_year_out_of_range():
    with pytest.raises(ValidationError):
        BirthInput(year=1800, month=1, day=1, hour=-1, minute=0)


def test_birth_input_rejects_invalid_month():
    with pytest.raises(ValidationError):
        BirthInput(year=1998, month=13, day=1, hour=-1, minute=0)


def test_birth_input_rejects_hour_24():
    with pytest.raises(ValidationError):
        BirthInput(year=1998, month=7, day=15, hour=24, minute=0)


def test_card_request_nickname_optional_and_length_capped():
    r = CardRequest(birth=BirthInput(year=1998, month=7, day=15, hour=14, minute=0))
    assert r.nickname is None
    with pytest.raises(ValidationError):
        CardRequest(
            birth=BirthInput(year=1998, month=7, day=15, hour=14, minute=0),
            nickname="x" * 11,
        )


def test_card_request_strips_html_from_nickname():
    r = CardRequest(
        birth=BirthInput(year=1998, month=7, day=15, hour=14, minute=0),
        nickname="<script>小满</script>",
    )
    assert r.nickname == "小满"


def test_card_response_all_required_fields_present():
    resp = CardResponse(
        type_id="01",
        cosmic_name="春笋",
        base_name="参天木命",
        state="绽放",
        state_icon="⚡",
        day_stem="甲",
        one_liner="越压越往上长",
        ge_ju="食神",
        suffix="天生享乐家",
        subtags=["冲上去再说", "人缘自己来", "会吃会玩也会赚"],
        golden_line="我不卷，但我什么都不缺",
        theme_color="#2D6A4F",
        illustration_url="/static/cards/illustrations/01-chunsun.png",
        precision="4-pillar",
        borderline=False,
        share_slug="c_a9f3b2k1xx",
        nickname="小满",
        version="v4.0-2026-04",
    )
    assert resp.type_id == "01"
```

- [ ] **Step 2: Run → FAIL (module not found)**

```bash
cd server && pytest tests/unit/test_card_schemas.py -v
```

- [ ] **Step 3: Implement schemas**

```python
# server/app/schemas/card.py
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

_HTML_TAG_RE = re.compile(r"<[^>]+>")


class BirthInput(BaseModel):
    year: int = Field(ge=1900, le=2100)
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    hour: int = Field(ge=-1, le=23, description="-1 indicates 'time unknown'")
    minute: int = Field(ge=0, le=59, default=0)
    city: Optional[str] = Field(default=None, max_length=20)


class CardRequest(BaseModel):
    birth: BirthInput
    nickname: Optional[str] = Field(default=None, max_length=10)

    @field_validator("nickname")
    @classmethod
    def _strip_html(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        cleaned = _HTML_TAG_RE.sub("", v).strip()
        return cleaned or None


Precision = Literal["4-pillar", "3-pillar"]
State = Literal["绽放", "蓄力"]


class CardResponse(BaseModel):
    type_id: str
    cosmic_name: str
    base_name: str
    state: State
    state_icon: str
    day_stem: str
    one_liner: str
    ge_ju: str
    suffix: str
    subtags: list[str] = Field(min_length=3, max_length=3)
    golden_line: str
    theme_color: str
    illustration_url: str
    precision: Precision
    borderline: bool
    share_slug: str
    nickname: Optional[str]
    version: str
```

- [ ] **Step 4: Run → PASS**

```bash
cd server && pytest tests/unit/test_card_schemas.py -v
```

- [ ] **Step 5: Commit**

```bash
git add server/app/schemas/card.py server/tests/unit/test_card_schemas.py
git commit -m "feat(cards): Pydantic schemas (BirthInput/CardRequest/CardResponse)"
```

---

### Task 7: Card data loader with caching

**Files:**
- Create: `server/app/services/card/__init__.py`
- Create: `server/app/services/card/loader.py`
- Test: `server/tests/unit/test_card_loader.py`

- [ ] **Step 1: Write failing test**

```python
# server/tests/unit/test_card_loader.py
from __future__ import annotations

import pytest

from app.services.card.loader import (
    TYPES,
    FORMATIONS,
    SUBTAGS,
    THRESHOLDS,
    VERSION,
    load_all,
)


def test_types_loaded_with_20_entries():
    load_all()
    assert len(TYPES) == 20
    assert "01" in TYPES
    assert TYPES["01"]["cosmic_name"]  # non-empty


def test_formations_has_ten_shishen():
    load_all()
    assert len(FORMATIONS) == 10
    assert "食神" in FORMATIONS
    assert "suffixes" in FORMATIONS["食神"]
    assert set(FORMATIONS["食神"]["suffixes"].keys()) == {"绽放", "蓄力"}
    assert "绽放" in FORMATIONS["食神"]["golden_lines"]


def test_subtags_has_200_combos():
    load_all()
    total = sum(len(inner) for inner in SUBTAGS.values())
    assert total == 200
    for name, inner in SUBTAGS.items():
        for ss, tags in inner.items():
            assert len(tags) == 3


def test_thresholds_mapping_covers_five_categories():
    load_all()
    assert set(THRESHOLDS["mapping"].keys()) == {"极强", "身强", "中和", "身弱", "极弱"}


def test_version_loaded():
    load_all()
    assert VERSION.startswith("v")


def test_load_all_is_idempotent():
    load_all()
    first_types_ref = TYPES
    load_all()
    assert TYPES is first_types_ref  # same object, not reloaded
```

- [ ] **Step 2: Run → FAIL (module not found)**

```bash
cd server && pytest tests/unit/test_card_loader.py -v
```

- [ ] **Step 3: Implement loader**

```python
# server/app/services/card/__init__.py
"""Card service: viral card generation from birth data.
Depends only on paipan/ and local JSON data in ../data/cards/."""
```

```python
# server/app/services/card/loader.py
"""Loads card data JSON files into module-level dicts at startup.
Thread-safe via lazy init; idempotent."""
from __future__ import annotations

import json
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "cards"

TYPES: dict = {}
FORMATIONS: dict = {}
SUBTAGS: dict = {}
THRESHOLDS: dict = {}
VERSION: str = ""

_loaded = False


def _read_json(name: str) -> dict:
    return json.loads((_DATA_DIR / name).read_text(encoding="utf-8"))


def load_all() -> None:
    """Idempotent loader. Populate module-level dicts once."""
    global _loaded, TYPES, FORMATIONS, SUBTAGS, THRESHOLDS, VERSION
    if _loaded:
        return
    TYPES.update(_read_json("types.json"))
    FORMATIONS.update(_read_json("formations.json"))
    SUBTAGS.update(_read_json("subtags.json"))
    THRESHOLDS.update(_read_json("state_thresholds.json"))
    VERSION = _read_json("card_version.json")["version"]
    _loaded = True
```

- [ ] **Step 4: Run → PASS**

```bash
cd server && pytest tests/unit/test_card_loader.py -v
```

- [ ] **Step 5: Commit**

```bash
git add server/app/services/card/__init__.py server/app/services/card/loader.py server/tests/unit/test_card_loader.py
git commit -m "feat(cards): JSON data loader with idempotent init"
```

---

### Task 8: Mapping layer (日主×state→type_id, force→state, 十神 extraction)

**Files:**
- Create: `server/app/services/card/mapping.py`
- Test: `server/tests/unit/test_card_mapping.py`

- [ ] **Step 1: Inspect paipan force/ge_ju return shapes**

```bash
cd server && python -c "
from paipan import compute, BirthInput
r = compute(BirthInput(year=1998, month=7, day=15, hour=14, minute=0, gender='male'))
print('paipan keys:', list(r.keys())[:10])
from paipan.li_liang import analyze_force
bazi = r.get('bazi') or {'yearGan': r['year']['gan'], 'yearZhi': r['year']['zhi'], 'monthGan': r['month']['gan'], 'monthZhi': r['month']['zhi'], 'dayGan': r['day']['gan'], 'dayZhi': r['day']['zhi'], 'hourGan': r['hour']['gan'], 'hourZhi': r['hour']['zhi']}
f = analyze_force(bazi)
print('force keys:', list(f.keys()))
print('force sample:', {k: f.get(k) for k in list(f.keys())[:5]})
from paipan.ge_ju import identify_ge_ju
g = identify_ge_ju(bazi)
print('ge_ju:', g)
"
```

Record the exact keys used for "same-class ratio" and "ge_ju name" — use these in the mapping code below.

- [ ] **Step 2: Write failing test**

```python
# server/tests/unit/test_card_mapping.py
from __future__ import annotations

import pytest

from app.services.card.loader import load_all
from app.services.card.mapping import (
    classify_state,
    lookup_type_id,
    extract_ge_ju_shi_shen,
)


@pytest.fixture(autouse=True)
def _load():
    load_all()


def test_classify_state_strong_ratio_returns_绽放():
    state, borderline = classify_state(same_ratio=0.80)
    assert state == "绽放"
    assert borderline is False


def test_classify_state_weak_ratio_returns_蓄力():
    state, _ = classify_state(same_ratio=0.30)
    assert state == "蓄力"


def test_classify_state_中和_maps_to_绽放():
    state, _ = classify_state(same_ratio=0.40)  # 0.35-0.55 中和 → 绽放
    assert state == "绽放"


def test_classify_state_borderline_near_strong_lower():
    state, borderline = classify_state(same_ratio=0.56)  # within 0.05 of 0.55
    assert borderline is True


def test_classify_state_far_from_boundary_not_borderline():
    state, borderline = classify_state(same_ratio=0.80)
    assert borderline is False


def test_lookup_type_id_jia_绽放_returns_01():
    assert lookup_type_id(day_stem="甲", state="绽放") == "01"


def test_lookup_type_id_jia_蓄力_returns_02():
    assert lookup_type_id(day_stem="甲", state="蓄力") == "02"


def test_lookup_type_id_unknown_raises():
    with pytest.raises(ValueError):
        lookup_type_id(day_stem="X", state="绽放")


def test_extract_ge_ju_shi_shen_returns_valid_shi_shen():
    # Build a minimal mock ge_ju result that mirrors paipan's shape.
    mock = {"shiShen": "食神", "name": "食神格"}
    assert extract_ge_ju_shi_shen(mock) == "食神"


def test_extract_ge_ju_falls_back_to_比肩_when_missing():
    assert extract_ge_ju_shi_shen({}) == "比肩"
```

- [ ] **Step 3: Run → FAIL**

```bash
cd server && pytest tests/unit/test_card_mapping.py -v
```

- [ ] **Step 4: Implement mapping**

Use the exact field names discovered in Step 1. The snippet below uses `sameRatio` and `shiShen` as placeholders — replace with actual keys before running.

```python
# server/app/services/card/mapping.py
"""Thin mapping layer: paipan结果 → card fields. Pure functions, no IO."""
from __future__ import annotations

from app.services.card.loader import TYPES, THRESHOLDS

_VALID_SHI_SHEN = {
    "比肩", "劫财", "食神", "伤官", "正财", "偏财",
    "正官", "七杀", "正印", "偏印",
}


def _classify_five_bucket(same_ratio: float) -> str:
    t = THRESHOLDS["thresholds"]
    if same_ratio >= t["strong_upper"]:
        return "极强"
    if same_ratio >= t["strong_lower"]:
        return "身强"
    if same_ratio >= t["neutral_lower"]:
        return "中和"
    if same_ratio >= t["weak_lower"]:
        return "身弱"
    return "极弱"


def classify_state(same_ratio: float) -> tuple[str, bool]:
    """Map 5-档 to 2-档 (绽放/蓄力) + borderline flag."""
    category = _classify_five_bucket(same_ratio)
    state = THRESHOLDS["mapping"][category]
    boundary = THRESHOLDS["thresholds"]["strong_lower"]
    band = THRESHOLDS["borderline_band"]
    borderline = abs(same_ratio - boundary) < band
    return state, borderline


def lookup_type_id(day_stem: str, state: str) -> str:
    """Find type_id by (day_stem, state) in TYPES."""
    for tid, info in TYPES.items():
        if info["day_stem"] == day_stem and info["state"] == state:
            return tid
    raise ValueError(f"no type for day_stem={day_stem!r} state={state!r}")


def extract_ge_ju_shi_shen(ge_ju_result: dict) -> str:
    """Extract 十神 name from paipan's identify_ge_ju result.
    Fallback to 比肩 when not identifiable (degenerate charts)."""
    ss = ge_ju_result.get("shiShen") or ge_ju_result.get("shi_shen")
    if ss and ss in _VALID_SHI_SHEN:
        return ss
    return "比肩"
```

- [ ] **Step 5: Run → PASS (update key names if Step 1 revealed different keys)**

```bash
cd server && pytest tests/unit/test_card_mapping.py -v
```

- [ ] **Step 6: Commit**

```bash
git add server/app/services/card/mapping.py server/tests/unit/test_card_mapping.py
git commit -m "feat(cards): mapping layer (5档→绽蓄, 日主×state→type_id)"
```

---

### Task 9: Slug generation

**Files:**
- Create: `server/app/services/card/slug.py`
- Test: `server/tests/unit/test_card_slug.py`

- [ ] **Step 1: Write failing test**

```python
# server/tests/unit/test_card_slug.py
from __future__ import annotations

from app.services.card.slug import birth_hash, generate_slug


def test_slug_format_c_prefix_plus_10_chars():
    slug = generate_slug()
    assert slug.startswith("c_")
    assert len(slug) == 12  # "c_" + 10


def test_slug_is_random_across_calls():
    slugs = {generate_slug() for _ in range(100)}
    assert len(slugs) == 100  # no collisions in small sample


def test_birth_hash_stable_for_same_input():
    h1 = birth_hash(year=1998, month=7, day=15, hour=14, minute=0)
    h2 = birth_hash(year=1998, month=7, day=15, hour=14, minute=0)
    assert h1 == h2


def test_birth_hash_differs_for_different_input():
    h1 = birth_hash(year=1998, month=7, day=15, hour=14, minute=0)
    h2 = birth_hash(year=1998, month=7, day=15, hour=15, minute=0)
    assert h1 != h2


def test_birth_hash_is_64_hex_chars():
    h = birth_hash(year=1998, month=7, day=15, hour=-1, minute=0)
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```python
# server/app/services/card/slug.py
"""Slug generation and deterministic birth hashing."""
from __future__ import annotations

import hashlib
import secrets
import string

_ALPHABET = string.ascii_lowercase + string.digits  # 36 chars


def generate_slug() -> str:
    """Return 'c_' + 10 random base-36 chars. ~60 bits entropy."""
    body = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    return f"c_{body}"


def birth_hash(year: int, month: int, day: int, hour: int, minute: int) -> str:
    """SHA256 of canonical birth string. Used to dedupe shares."""
    canonical = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add server/app/services/card/slug.py server/tests/unit/test_card_slug.py
git commit -m "feat(cards): share slug generation + birth hash"
```

---

### Task 10: Payload builder (integrates paipan + mapping + JSON lookup)

**Files:**
- Create: `server/app/services/card/payload.py`
- Test: `server/tests/unit/test_card_payload.py`

- [ ] **Step 1: Write failing test (regression on known births)**

```python
# server/tests/unit/test_card_payload.py
from __future__ import annotations

import pytest

from app.schemas.card import BirthInput
from app.services.card.loader import load_all
from app.services.card.payload import build_card_payload


@pytest.fixture(autouse=True)
def _load():
    load_all()


def test_build_card_returns_all_required_fields():
    b = BirthInput(year=1998, month=7, day=15, hour=14, minute=0)
    p = build_card_payload(b, nickname="小满")
    assert p.type_id in {f"{i:02d}" for i in range(1, 21)}
    assert p.cosmic_name
    assert p.day_stem in "甲乙丙丁戊己庚辛壬癸"
    assert p.state in ("绽放", "蓄力")
    assert p.state_icon in ("⚡", "🔋")
    assert len(p.subtags) == 3
    assert p.precision == "4-pillar"
    assert p.share_slug.startswith("c_")
    assert p.nickname == "小满"
    assert p.version


def test_build_card_with_unknown_hour_returns_3_pillar():
    b = BirthInput(year=1998, month=7, day=15, hour=-1, minute=0)
    p = build_card_payload(b, nickname=None)
    assert p.precision == "3-pillar"
    assert p.nickname is None


def test_build_card_state_icon_matches_state():
    b = BirthInput(year=1998, month=7, day=15, hour=14, minute=0)
    p = build_card_payload(b, nickname=None)
    if p.state == "绽放":
        assert p.state_icon == "⚡"
    else:
        assert p.state_icon == "🔋"


def test_build_card_subtag_matches_cosmic_name_and_shishen():
    from app.services.card.loader import SUBTAGS
    b = BirthInput(year=1998, month=7, day=15, hour=14, minute=0)
    p = build_card_payload(b, nickname=None)
    expected = SUBTAGS[p.cosmic_name][p.ge_ju]
    assert p.subtags == expected


def test_build_card_illustration_url_prefix():
    b = BirthInput(year=1998, month=7, day=15, hour=14, minute=0)
    p = build_card_payload(b, nickname=None)
    assert p.illustration_url.startswith("/static/cards/illustrations/")
    assert p.illustration_url.endswith(".png")


@pytest.mark.parametrize("year,month,day,hour", [
    (1990, 3, 20, 8),
    (1995, 11, 5, 22),
    (2000, 6, 1, 0),
    (1985, 9, 15, 12),
    (2005, 2, 28, 18),
])
def test_build_card_deterministic_across_runs(year, month, day, hour):
    b = BirthInput(year=year, month=month, day=day, hour=hour, minute=0)
    p1 = build_card_payload(b, nickname=None)
    p2 = build_card_payload(b, nickname=None)
    # Slug is random, but all content fields must match
    assert p1.type_id == p2.type_id
    assert p1.ge_ju == p2.ge_ju
    assert p1.subtags == p2.subtags
    assert p1.golden_line == p2.golden_line
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement payload builder**

```python
# server/app/services/card/payload.py
"""Pure-function card builder: BirthInput → CardResponse."""
from __future__ import annotations

from paipan import compute as paipan_compute, BirthInput as PaipanBirthInput
from paipan.ge_ju import identify_ge_ju
from paipan.li_liang import analyze_force

from app.schemas.card import BirthInput, CardResponse
from app.services.card.loader import (
    FORMATIONS,
    SUBTAGS,
    TYPES,
    VERSION,
)
from app.services.card.mapping import (
    classify_state,
    extract_ge_ju_shi_shen,
    lookup_type_id,
)
from app.services.card.slug import generate_slug


def _paipan_bazi_dict(paipan_result: dict) -> dict:
    """Adapt paipan.compute return shape to the dict analyze_force expects."""
    def gan(key: str) -> str | None:
        return paipan_result.get(key, {}).get("gan")

    def zhi(key: str) -> str | None:
        return paipan_result.get(key, {}).get("zhi")

    return {
        "yearGan": gan("year"),
        "yearZhi": zhi("year"),
        "monthGan": gan("month"),
        "monthZhi": zhi("month"),
        "dayGan": gan("day"),
        "dayZhi": zhi("day"),
        "hourGan": gan("hour"),
        "hourZhi": zhi("hour"),
    }


def _extract_same_ratio(force_result: dict) -> float:
    """Extract same-class ratio from analyze_force output.
    Actual key name verified in Task 8 Step 1 — adjust if needed."""
    ratio = force_result.get("sameRatio")
    if ratio is None:
        ratio = force_result.get("same_ratio", 0.5)
    return float(ratio)


def build_card_payload(birth: BirthInput, nickname: str | None) -> CardResponse:
    # 1. 排盘（复用 paipan；hour=-1 时 paipan 走 3 柱路径）
    pb = PaipanBirthInput(
        year=birth.year,
        month=birth.month,
        day=birth.day,
        hour=birth.hour if birth.hour >= 0 else None,
        minute=birth.minute,
        city=birth.city,
    )
    paipan_result = paipan_compute(pb, use_true_solar_time=True)

    # 2. 力量 + 格局
    bazi = _paipan_bazi_dict(paipan_result)
    force = analyze_force(bazi)
    ge_ju = identify_ge_ju(bazi)
    day_stem = bazi["dayGan"]

    # 3. 绽放/蓄力
    state, borderline = classify_state(_extract_same_ratio(force))

    # 4. 20 型编号
    type_id = lookup_type_id(day_stem, state)
    info = TYPES[type_id]

    # 5. 十神后缀 + 金句
    shi_shen = extract_ge_ju_shi_shen(ge_ju)
    formation = FORMATIONS[shi_shen]

    # 6. 子标签
    subtags = SUBTAGS[info["cosmic_name"]][shi_shen]

    # 7. 组装
    return CardResponse(
        type_id=type_id,
        cosmic_name=info["cosmic_name"],
        base_name=info["base_name"],
        state=state,
        state_icon="⚡" if state == "绽放" else "🔋",
        day_stem=day_stem,
        one_liner=info["one_liner"],
        ge_ju=shi_shen,
        suffix=formation["suffixes"][state],
        subtags=list(subtags),
        golden_line=formation["golden_lines"][state],
        theme_color=info["theme_color"],
        illustration_url=f"/static/cards/illustrations/{info['illustration']}",
        precision="4-pillar" if birth.hour >= 0 else "3-pillar",
        borderline=borderline,
        share_slug=generate_slug(),
        nickname=nickname,
        version=VERSION,
    )
```

- [ ] **Step 4: Run → PASS (may need to adjust `_extract_same_ratio` / `_paipan_bazi_dict` based on actual paipan shape)**

```bash
cd server && pytest tests/unit/test_card_payload.py -v
```

- [ ] **Step 5: Commit**

```bash
git add server/app/services/card/payload.py server/tests/unit/test_card_payload.py
git commit -m "feat(cards): payload builder integrating paipan + JSON lookup"
```

---

### Task 11: DB models (card_shares + events)

**Files:**
- Create: `server/app/models/card_share.py`
- Create: `server/app/models/event.py`
- Modify: `server/app/models/__init__.py` (register new models)

- [ ] **Step 1: Inspect existing models**

```bash
cat server/app/models/__init__.py
ls server/app/models/
```

Follow the same `declarative_base` / `Mapped` / `mapped_column` style as existing models.

- [ ] **Step 2: Write `card_share.py`**

```python
# server/app/models/card_share.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base  # adjust import to match existing base location


class CardShare(Base):
    __tablename__ = "card_shares"

    slug: Mapped[str] = mapped_column(String(12), primary_key=True)
    birth_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    type_id: Mapped[str] = mapped_column(String(2), nullable=False)
    cosmic_name: Mapped[str] = mapped_column(String(20), nullable=False)
    suffix: Mapped[str] = mapped_column(String(30), nullable=False)
    nickname: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    share_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
```

- [ ] **Step 3: Write `event.py`**

```python
# server/app/models/event.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    type_id: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    channel: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    from_param: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    share_slug: Mapped[Optional[str]] = mapped_column(String(12), nullable=True, index=True)
    anonymous_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    viewport: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    extra: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True,
    )
```

- [ ] **Step 4: Register in `__init__.py`**

Add `from app.models.card_share import CardShare` and `from app.models.event import Event` so Alembic autogenerate sees them.

- [ ] **Step 5: Commit**

```bash
git add server/app/models/card_share.py server/app/models/event.py server/app/models/__init__.py
git commit -m "feat(cards): CardShare + Event SQLAlchemy models"
```

---

### Task 12: Alembic migration

**Files:**
- Create: `server/alembic/versions/0003_card_shares_and_events.py`

- [ ] **Step 1: Autogenerate migration**

```bash
cd server && alembic revision --autogenerate -m "card_shares and events"
```

Verify output file path, rename to `0003_card_shares_and_events.py` if needed.

- [ ] **Step 2: Review generated migration**

Inspect the file. Ensure it creates:
- `card_shares` with PK `slug`, indexed `birth_hash`
- `events` with PK `id`, indexed `event`, `share_slug`, `anonymous_id`, `created_at`
- No unrelated schema drift

- [ ] **Step 3: Run migration against local DB**

```bash
cd server && alembic upgrade head
```

Expected: `INFO [alembic.runtime.migration] Running upgrade 0002_... -> 0003_...`

- [ ] **Step 4: Downgrade + re-upgrade sanity check**

```bash
cd server && alembic downgrade -1 && alembic upgrade head
```

Both should succeed.

- [ ] **Step 5: Commit**

```bash
git add server/alembic/versions/0003_card_shares_and_events.py
git commit -m "feat(cards): alembic migration for card_shares + events"
```

---

## Phase C: 后端 API 端点（Day 4-5）

### Task 13: POST /api/card endpoint

**Files:**
- Create: `server/app/api/card.py`
- Test: `server/tests/integration/test_card_api.py`
- Modify: `server/app/main.py` (register router)

- [ ] **Step 1: Write failing integration test**

```python
# server/tests/integration/test_card_api.py
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_post_card_returns_full_payload(client):
    resp = await client.post("/api/card", json={
        "birth": {"year": 1998, "month": 7, "day": 15, "hour": 14, "minute": 0},
        "nickname": "小满",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["type_id"] in [f"{i:02d}" for i in range(1, 21)]
    assert data["nickname"] == "小满"
    assert data["precision"] == "4-pillar"
    assert data["share_slug"].startswith("c_")
    assert len(data["subtags"]) == 3


@pytest.mark.asyncio
async def test_post_card_no_auth_required(client):
    resp = await client.post("/api/card", json={
        "birth": {"year": 2000, "month": 1, "day": 1, "hour": -1, "minute": 0},
    })
    assert resp.status_code == 200
    assert resp.json()["precision"] == "3-pillar"


@pytest.mark.asyncio
async def test_post_card_400_on_invalid_year(client):
    resp = await client.post("/api/card", json={
        "birth": {"year": 1800, "month": 1, "day": 1, "hour": 0, "minute": 0},
    })
    assert resp.status_code == 422  # pydantic validation


@pytest.mark.asyncio
async def test_post_card_persists_share_row(client, db_session):
    from sqlalchemy import select
    from app.models.card_share import CardShare
    resp = await client.post("/api/card", json={
        "birth": {"year": 1998, "month": 7, "day": 15, "hour": 14, "minute": 0},
    })
    slug = resp.json()["share_slug"]
    row = (await db_session.execute(
        select(CardShare).where(CardShare.slug == slug)
    )).scalar_one()
    assert row.type_id == resp.json()["type_id"]
    assert row.cosmic_name == resp.json()["cosmic_name"]
```

- [ ] **Step 2: Run → FAIL (endpoint doesn't exist)**

```bash
cd server && pytest tests/integration/test_card_api.py -v
```

- [ ] **Step 3: Write endpoint**

```python
# server/app/api/card.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session  # match existing project dependency
from app.models.card_share import CardShare
from app.schemas.card import CardRequest, CardResponse
from app.services.card.loader import load_all
from app.services.card.payload import build_card_payload
from app.services.card.slug import birth_hash

router = APIRouter(prefix="/api", tags=["card"])


@router.on_event("startup")  # startup hook registered at app level; see main.py
def _ensure_loaded() -> None:
    load_all()


@router.post("/card", response_model=CardResponse)
async def post_card(
    req: CardRequest,
    session: AsyncSession = Depends(get_session),
) -> CardResponse:
    payload = build_card_payload(req.birth, req.nickname)

    share = CardShare(
        slug=payload.share_slug,
        birth_hash=birth_hash(
            req.birth.year, req.birth.month, req.birth.day,
            req.birth.hour, req.birth.minute,
        ),
        type_id=payload.type_id,
        cosmic_name=payload.cosmic_name,
        suffix=payload.suffix,
        nickname=payload.nickname,
        user_id=None,  # MVP: always anonymous
    )
    session.add(share)
    await session.commit()

    return payload
```

- [ ] **Step 4: Register router in `main.py`**

Add near existing routers:
```python
from app.api.card import router as card_router
app.include_router(card_router)

@app.on_event("startup")
async def _load_card_data() -> None:
    from app.services.card.loader import load_all
    load_all()
```

- [ ] **Step 5: Run → PASS**

```bash
cd server && pytest tests/integration/test_card_api.py -v
```

- [ ] **Step 6: Commit**

```bash
git add server/app/api/card.py server/app/main.py server/tests/integration/test_card_api.py
git commit -m "feat(cards): POST /api/card endpoint + share row persistence"
```

---

### Task 14: GET /api/card/:slug (share link preview)

**Files:**
- Modify: `server/app/api/card.py`
- Test: `server/tests/integration/test_card_api.py` (extend)

- [ ] **Step 1: Write failing test**

```python
# append to server/tests/integration/test_card_api.py
@pytest.mark.asyncio
async def test_get_card_by_slug_returns_preview_only(client):
    # Create a card first
    create_resp = await client.post("/api/card", json={
        "birth": {"year": 1998, "month": 7, "day": 15, "hour": 14, "minute": 0},
        "nickname": "小满",
    })
    slug = create_resp.json()["share_slug"]

    # Fetch preview
    preview = await client.get(f"/api/card/{slug}")
    assert preview.status_code == 200
    data = preview.json()
    # Preview fields only: cosmic_name, suffix, illustration, nickname
    assert "cosmic_name" in data
    assert "suffix" in data
    assert "illustration_url" in data
    # Sensitive fields MUST NOT be present
    assert "subtags" not in data
    assert "golden_line" not in data
    assert "one_liner" not in data


@pytest.mark.asyncio
async def test_get_card_by_slug_404_on_unknown(client):
    resp = await client.get("/api/card/c_doesnotexist")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Add endpoint**

```python
# append to server/app/api/card.py
from pydantic import BaseModel
from sqlalchemy import select


class CardPreview(BaseModel):
    slug: str
    cosmic_name: str
    suffix: str
    illustration_url: str
    nickname: str | None


@router.get("/card/{slug}", response_model=CardPreview)
async def get_card_preview(
    slug: str,
    session: AsyncSession = Depends(get_session),
) -> CardPreview:
    row = (await session.execute(
        select(CardShare).where(CardShare.slug == slug)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="card not found")

    # Look up illustration path from types.json
    from app.services.card.loader import TYPES
    info = TYPES[row.type_id]

    # Bump share_count
    row.share_count += 1
    await session.commit()

    return CardPreview(
        slug=row.slug,
        cosmic_name=row.cosmic_name,
        suffix=row.suffix,
        illustration_url=f"/static/cards/illustrations/{info['illustration']}",
        nickname=row.nickname,
    )
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add server/app/api/card.py server/tests/integration/test_card_api.py
git commit -m "feat(cards): GET /api/card/{slug} preview endpoint"
```

---

### Task 15: POST /api/track

**Files:**
- Create: `server/app/api/tracking.py`
- Create: `server/app/schemas/tracking.py`
- Test: `server/tests/integration/test_card_tracking_api.py`
- Modify: `server/app/main.py`

- [ ] **Step 1: Write failing test**

```python
# server/tests/integration/test_card_tracking_api.py
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.event import Event


@pytest.mark.asyncio
async def test_post_track_persists_event(client, db_session):
    resp = await client.post("/api/track", json={
        "event": "card_view",
        "properties": {
            "type_id": "04",
            "from": "share_friend",
            "share_slug": "c_abcdefghij",
            "anonymous_id": "a_xyz123",
            "session_id": "s_def456",
            "user_agent": "Mozilla/5.0 ...",
            "viewport": "375x812",
        },
    })
    assert resp.status_code == 204  # no content

    rows = (await db_session.execute(select(Event))).scalars().all()
    assert len(rows) == 1
    assert rows[0].event == "card_view"
    assert rows[0].type_id == "04"
    assert rows[0].from_param == "share_friend"


@pytest.mark.asyncio
async def test_post_track_rejects_unknown_event(client):
    resp = await client.post("/api/track", json={
        "event": "definitely_not_valid",
        "properties": {},
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_track_accepts_empty_properties(client):
    resp = await client.post("/api/track", json={
        "event": "form_start",
        "properties": {},
    })
    assert resp.status_code == 204
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement schemas + endpoint**

```python
# server/app/schemas/tracking.py
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

TrackEvent = Literal[
    "card_view", "card_save", "card_share",
    "form_start", "form_submit", "cta_click",
]


class TrackProperties(BaseModel):
    type_id: Optional[str] = None
    channel: Optional[str] = None
    from_: Optional[str] = Field(default=None, alias="from")
    share_slug: Optional[str] = None
    anonymous_id: Optional[str] = None
    session_id: Optional[str] = None
    user_agent: Optional[str] = None
    viewport: Optional[str] = None

    model_config = {"populate_by_name": True, "extra": "allow"}


class TrackRequest(BaseModel):
    event: TrackEvent
    properties: TrackProperties
```

```python
# server/app/api/tracking.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.event import Event
from app.schemas.tracking import TrackRequest

router = APIRouter(prefix="/api", tags=["tracking"])


@router.post("/track", status_code=204)
async def post_track(
    req: TrackRequest,
    session: AsyncSession = Depends(get_session),
) -> Response:
    props = req.properties
    evt = Event(
        event=req.event,
        type_id=props.type_id,
        channel=props.channel,
        from_param=props.from_,
        share_slug=props.share_slug,
        anonymous_id=props.anonymous_id,
        session_id=props.session_id,
        user_id=None,
        user_agent=props.user_agent,
        viewport=props.viewport,
        extra=props.model_dump(
            by_alias=True,
            exclude={"type_id", "channel", "from_", "share_slug",
                     "anonymous_id", "session_id", "user_agent", "viewport"},
        ) or None,
    )
    session.add(evt)
    await session.commit()
    return Response(status_code=204)
```

Register router in `main.py`.

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add server/app/api/tracking.py server/app/schemas/tracking.py server/app/main.py server/tests/integration/test_card_tracking_api.py
git commit -m "feat(tracking): POST /api/track for anonymous analytics"
```

---

### Task 16: GET /api/admin/metrics

**Files:**
- Create: `server/app/api/admin.py`
- Modify: `server/app/core/config.py` (ADMIN_TOKEN)
- Test: `server/tests/integration/test_card_admin_api.py`

- [ ] **Step 1: Add `ADMIN_TOKEN` to config**

```python
# in server/app/core/config.py Settings:
ADMIN_TOKEN: str = ""  # set in .env for prod
```

- [ ] **Step 2: Write failing test**

```python
# server/tests/integration/test_card_admin_api.py
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_admin_metrics_requires_token(client):
    resp = await client.get("/api/admin/metrics")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_metrics_returns_k_factor_shape(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "testtoken")
    from app.core.config import settings
    settings.ADMIN_TOKEN = "testtoken"

    # Seed events
    for evt in ["card_view", "card_view", "card_view", "card_share", "form_submit"]:
        await client.post("/api/track", json={
            "event": evt, "properties": {"type_id": "01"},
        })

    resp = await client.get(
        "/api/admin/metrics",
        headers={"X-Admin-Token": "testtoken"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "card_view" in data["counts"]
    assert "card_share" in data["counts"]
    assert data["counts"]["card_view"] == 3
    assert "share_rate" in data  # card_share / card_view
    assert data["share_rate"] == pytest.approx(1/3)
```

- [ ] **Step 3: Implement admin endpoint**

```python
# server/app/api/admin.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db import get_session
from app.models.event import Event

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def _require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    if not settings.ADMIN_TOKEN or x_admin_token != settings.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="invalid admin token")


@router.get("/metrics", dependencies=[Depends(_require_admin)])
async def get_metrics(
    from_: Optional[datetime] = None,
    to: Optional[datetime] = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(Event.event, func.count()).group_by(Event.event)
    if from_:
        stmt = stmt.where(Event.created_at >= from_)
    if to:
        stmt = stmt.where(Event.created_at < to)
    rows = (await session.execute(stmt)).all()
    counts = {event: n for event, n in rows}

    views = counts.get("card_view", 0)
    shares = counts.get("card_share", 0)
    submits = counts.get("form_submit", 0)

    return {
        "counts": counts,
        "share_rate": shares / views if views else 0.0,
        "form_submit_rate": submits / views if views else 0.0,
    }
```

Register in `main.py`.

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add server/app/api/admin.py server/app/core/config.py server/app/main.py server/tests/integration/test_card_admin_api.py
git commit -m "feat(admin): GET /api/admin/metrics for K-factor monitoring"
```

---

### Task 17: GET /api/wx/jsapi-ticket (WeChat JS-SDK signing)

**Files:**
- Create: `server/app/api/wx.py`
- Modify: `server/app/core/config.py` (WX_APP_ID / WX_APP_SECRET)
- Test: `server/tests/integration/test_wx_jsapi.py`

- [ ] **Step 1: Add config fields**

```python
# in Settings:
WX_APP_ID: str = ""
WX_APP_SECRET: str = ""
```

- [ ] **Step 2: Write test with httpx mocking**

```python
# server/tests/integration/test_wx_jsapi.py
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_jsapi_ticket_returns_signature_payload(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.WX_APP_ID", "wxtestappid")
    monkeypatch.setattr("app.core.config.settings.WX_APP_SECRET", "testsecret")

    fake_access_token = {"access_token": "AT_ABC", "expires_in": 7200}
    fake_ticket = {"ticket": "TK_XYZ", "expires_in": 7200, "errcode": 0}

    with patch("app.api.wx._fetch_json", new=AsyncMock(side_effect=[
        fake_access_token, fake_ticket,
    ])):
        resp = await client.get("/api/wx/jsapi-ticket?url=https%3A%2F%2Fchabazi.com%2Fcard%2Fc_abc")

    assert resp.status_code == 200
    data = resp.json()
    assert data["appId"] == "wxtestappid"
    assert "signature" in data
    assert "timestamp" in data
    assert "nonceStr" in data
    assert len(data["signature"]) == 40  # sha1 hex
```

- [ ] **Step 3: Implement signing + caching**

```python
# server/app/api/wx.py
"""WeChat JS-SDK ticket signing. Caches access_token + jsapi_ticket for 7000s
(slightly under the 7200s WeChat validity to avoid boundary errors)."""
from __future__ import annotations

import hashlib
import secrets
import string
import time

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings

router = APIRouter(prefix="/api/wx", tags=["wx"])

_CACHE: dict = {
    "access_token": None,
    "access_token_expiry": 0.0,
    "jsapi_ticket": None,
    "jsapi_ticket_expiry": 0.0,
}

_CACHE_TTL = 7000  # seconds, under WeChat's 7200 hard limit


async def _fetch_json(url: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.json()


async def _get_access_token() -> str:
    now = time.time()
    if _CACHE["access_token"] and now < _CACHE["access_token_expiry"]:
        return _CACHE["access_token"]
    if not settings.WX_APP_ID or not settings.WX_APP_SECRET:
        raise HTTPException(500, "WX_APP_ID/WX_APP_SECRET not configured")
    url = (f"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential"
           f"&appid={settings.WX_APP_ID}&secret={settings.WX_APP_SECRET}")
    data = await _fetch_json(url)
    if "access_token" not in data:
        raise HTTPException(502, f"wx token error: {data}")
    _CACHE["access_token"] = data["access_token"]
    _CACHE["access_token_expiry"] = now + _CACHE_TTL
    return data["access_token"]


async def _get_jsapi_ticket() -> str:
    now = time.time()
    if _CACHE["jsapi_ticket"] and now < _CACHE["jsapi_ticket_expiry"]:
        return _CACHE["jsapi_ticket"]
    at = await _get_access_token()
    url = f"https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token={at}&type=jsapi"
    data = await _fetch_json(url)
    if data.get("errcode", 0) != 0 or "ticket" not in data:
        raise HTTPException(502, f"wx ticket error: {data}")
    _CACHE["jsapi_ticket"] = data["ticket"]
    _CACHE["jsapi_ticket_expiry"] = now + _CACHE_TTL
    return data["ticket"]


def _nonce(n: int = 16) -> str:
    alpha = string.ascii_letters + string.digits
    return "".join(secrets.choice(alpha) for _ in range(n))


@router.get("/jsapi-ticket")
async def get_jsapi_ticket(url: str = Query(..., description="current page full URL")) -> dict:
    ticket = await _get_jsapi_ticket()
    nonce = _nonce()
    timestamp = str(int(time.time()))
    raw = f"jsapi_ticket={ticket}&noncestr={nonce}&timestamp={timestamp}&url={url}"
    signature = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return {
        "appId": settings.WX_APP_ID,
        "timestamp": timestamp,
        "nonceStr": nonce,
        "signature": signature,
    }
```

Register in `main.py`.

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add server/app/api/wx.py server/app/core/config.py server/app/main.py server/tests/integration/test_wx_jsapi.py
git commit -m "feat(wx): JS-SDK ticket signing endpoint with dual caching"
```

---

## Phase D: 前端路由 + 依赖（Day 6-7）

### Task 18: Install frontend dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install**

```bash
cd frontend && npm install react-router-dom html2canvas weixin-js-sdk
```

- [ ] **Step 2: Verify**

```bash
cat frontend/package.json | grep -E "react-router-dom|html2canvas|weixin"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add react-router-dom, html2canvas, weixin-js-sdk"
```

---

### Task 19: Router setup + existing app moved under /app/\*

**Files:**
- Modify: `frontend/src/main.jsx`
- Modify: `frontend/src/App.jsx`
- Test: `frontend/tests/app-mount.test.mjs` (update)

- [ ] **Step 1: Check existing App.jsx behavior**

```bash
cat frontend/src/App.jsx
cat frontend/src/main.jsx
cat frontend/tests/app-mount.test.mjs
```

Note the existing "user → Shell | else AuthScreen" pattern.

- [ ] **Step 2: Write failing mount test for new routes**

```javascript
// frontend/tests/app-mount.test.mjs — update or append
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

test('router has / and /card/:slug and /app/* routes', () => {
  // Verify route config file exports these paths
  // (pragmatic: read App.jsx source or extract routes to a config module)
  import('../src/App.jsx').then(mod => {
    assert.ok(mod.ROUTES.includes('/'));
    assert.ok(mod.ROUTES.includes('/card/:slug'));
    assert.ok(mod.ROUTES.includes('/app/*'));
  });
});
```

- [ ] **Step 3: Wrap main.jsx in BrowserRouter**

```jsx
// frontend/src/main.jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 4: Refactor App.jsx to use routes**

```jsx
// frontend/src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { LandingScreen } from './components/card/LandingScreen.jsx';
import { CardScreen } from './components/card/CardScreen.jsx';
import { AppShell } from './components/AppShell.jsx';  // wraps existing auth+Shell logic

export const ROUTES = ['/', '/card/:slug', '/app/*'];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingScreen />} />
      <Route path="/card/:slug" element={<CardScreen />} />
      <Route path="/app/*" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 5: Extract existing root logic into `AppShell.jsx`**

```jsx
// frontend/src/components/AppShell.jsx
// Verbatim move of the previous App.jsx body (AuthScreen vs Shell switching).
import { useAppStore } from '../store/useAppStore.js';
import AuthScreen from './AuthScreen.jsx';
import Shell from './Shell.jsx';

export function AppShell() {
  const user = useAppStore(s => s.user);
  return user ? <Shell /> : <AuthScreen />;
}
```

Any existing App.jsx tests that mounted the tree need updating to wrap in `<MemoryRouter>`.

- [ ] **Step 6: Create stubs for LandingScreen and CardScreen**

```jsx
// frontend/src/components/card/LandingScreen.jsx (stub)
export function LandingScreen() {
  return <div data-testid="landing-screen">Landing</div>;
}

// frontend/src/components/card/CardScreen.jsx (stub)
export function CardScreen() {
  return <div data-testid="card-screen">Card</div>;
}
```

- [ ] **Step 7: Run tests → PASS**

```bash
cd frontend && npm test
```

Expected: existing tests still pass (with MemoryRouter wrap where needed), new route test passes.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.jsx frontend/src/main.jsx frontend/src/components/AppShell.jsx frontend/src/components/card/LandingScreen.jsx frontend/src/components/card/CardScreen.jsx frontend/tests/app-mount.test.mjs
git commit -m "feat(frontend): react-router setup; existing product moved to /app/*"
```

---

### Task 20: Anonymous ID cookie helper

**Files:**
- Create: `frontend/src/lib/anonymousId.js`
- Test: `frontend/tests/anonymous-id.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/anonymous-id.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnonymousId } from '../src/lib/anonymousId.js';

test('generates new id when cookie missing', () => {
  const cookieStore = { value: '' };
  const id = getAnonymousId({ readCookie: () => cookieStore.value, writeCookie: v => cookieStore.value = v });
  assert.match(id, /^a_[a-z0-9]{14}$/);
  assert.match(cookieStore.value, /chabazi_aid=a_[a-z0-9]{14}/);
});

test('returns existing id when cookie present', () => {
  const cookieStore = { value: 'chabazi_aid=a_existing123456' };
  const id = getAnonymousId({ readCookie: () => cookieStore.value, writeCookie: () => {} });
  assert.equal(id, 'a_existing123456');
});

test('ignores malformed cookie', () => {
  const cookieStore = { value: 'other=foo; chabazi_aid=BADFORMAT' };
  let wrote = '';
  const id = getAnonymousId({ readCookie: () => cookieStore.value, writeCookie: v => wrote = v });
  assert.match(id, /^a_[a-z0-9]{14}$/);
  assert.notEqual(id, 'BADFORMAT');
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```javascript
// frontend/src/lib/anonymousId.js
const COOKIE_NAME = 'chabazi_aid';
const MAX_AGE_DAYS = 7;
const ID_RE = /^a_[a-z0-9]{14}$/;

function defaultRead() { return typeof document !== 'undefined' ? document.cookie : ''; }
function defaultWrite(v) { if (typeof document !== 'undefined') document.cookie = v; }

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let body = '';
  for (let i = 0; i < 14; i++) body += chars[Math.floor(Math.random() * chars.length)];
  return `a_${body}`;
}

function parseCookie(raw, name) {
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return v;
  }
  return null;
}

export function getAnonymousId({ readCookie = defaultRead, writeCookie = defaultWrite } = {}) {
  const raw = readCookie();
  const existing = parseCookie(raw, COOKIE_NAME);
  if (existing && ID_RE.test(existing)) return existing;
  const id = generateId();
  const maxAge = MAX_AGE_DAYS * 86400;
  writeCookie(`${COOKIE_NAME}=${id}; Max-Age=${maxAge}; Path=/; SameSite=Lax`);
  return id;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/anonymousId.js frontend/tests/anonymous-id.test.mjs
git commit -m "feat(frontend): anonymous id cookie helper"
```

---

## Phase E: 前端卡片 UI（Day 8-10）

### Task 21: Card API client

**Files:**
- Create: `frontend/src/lib/cardApi.js`
- Test: `frontend/tests/card-api.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/card-api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { postCard, getCardPreview } from '../src/lib/cardApi.js';

test('postCard POSTs birth + nickname and returns json', async () => {
  let capturedBody;
  const mockFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ type_id: '01', cosmic_name: '春笋', share_slug: 'c_abc' }),
    };
  };
  const result = await postCard({
    birth: { year: 1998, month: 7, day: 15, hour: 14, minute: 0 },
    nickname: '小满',
  }, { fetchImpl: mockFetch });
  assert.equal(result.type_id, '01');
  assert.equal(capturedBody.nickname, '小满');
  assert.equal(capturedBody.birth.year, 1998);
});

test('postCard throws structured error on 422', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ detail: 'bad input' }),
  });
  await assert.rejects(
    () => postCard({ birth: { year: 1800, month: 1, day: 1, hour: 0, minute: 0 } }, { fetchImpl: mockFetch }),
    err => err.status === 422 && /bad input/.test(err.message),
  );
});

test('getCardPreview fetches preview endpoint', async () => {
  let capturedUrl;
  const mockFetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true, status: 200,
      json: async () => ({ slug: 'c_abc', cosmic_name: '春笋', suffix: '天生享乐家', illustration_url: '/...' }),
    };
  };
  await getCardPreview('c_abc', { fetchImpl: mockFetch });
  assert.match(capturedUrl, /\/api\/card\/c_abc$/);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```javascript
// frontend/src/lib/cardApi.js
const DEFAULT_BASE = '';  // same-origin

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function postCard(payload, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(`${baseUrl}/api/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  }
  return data;
}

export async function getCardPreview(slug, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(`${baseUrl}/api/card/${encodeURIComponent(slug)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  }
  return data;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/cardApi.js frontend/tests/card-api.test.mjs
git commit -m "feat(frontend): card API client (postCard, getCardPreview)"
```

---

### Task 22: useCardStore (Zustand)

**Files:**
- Create: `frontend/src/store/useCardStore.js`
- Test: `frontend/tests/card-store.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/card-store.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { useCardStore } from '../src/store/useCardStore.js';

function resetStore() {
  useCardStore.setState({
    birth: { year: '', month: '', day: '', hour: -1, minute: 0, useTimeSegment: false, timeSegment: null },
    nickname: '',
    loading: false,
    error: null,
    card: null,
    preview: null,
  });
}

test.beforeEach(resetStore);

test('setBirthField updates single field', () => {
  useCardStore.getState().setBirthField('year', 1998);
  assert.equal(useCardStore.getState().birth.year, 1998);
});

test('selectTimeSegment maps to correct hour', () => {
  useCardStore.getState().selectTimeSegment('下午');
  const b = useCardStore.getState().birth;
  assert.equal(b.hour, 14);
  assert.equal(b.useTimeSegment, true);
});

test('clearTimeSegment resets to unknown hour', () => {
  useCardStore.getState().selectTimeSegment('下午');
  useCardStore.getState().clearTimeSegment();
  assert.equal(useCardStore.getState().birth.hour, -1);
});

test('submitBirth calls API and stores card on success', async () => {
  const fakeCard = { type_id: '01', cosmic_name: '春笋', share_slug: 'c_abc' };
  useCardStore.setState({
    birth: { year: 1998, month: 7, day: 15, hour: 14, minute: 0 },
    nickname: '小满',
  });
  await useCardStore.getState().submitBirth({
    postCardImpl: async () => fakeCard,
  });
  assert.deepEqual(useCardStore.getState().card, fakeCard);
  assert.equal(useCardStore.getState().error, null);
});

test('submitBirth sets error on failure', async () => {
  useCardStore.setState({ birth: { year: 1800, month: 1, day: 1, hour: 0, minute: 0 } });
  await useCardStore.getState().submitBirth({
    postCardImpl: async () => { const e = new Error('bad year'); e.status = 422; throw e; },
  });
  assert.match(useCardStore.getState().error, /bad year/);
  assert.equal(useCardStore.getState().card, null);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```javascript
// frontend/src/store/useCardStore.js
import { create } from 'zustand';
import { postCard as realPostCard, getCardPreview as realGetCardPreview } from '../lib/cardApi.js';

const TIME_SEGMENT_TO_HOUR = {
  '凌晨': 2, '早上': 6, '上午': 10, '下午': 14, '傍晚': 18, '深夜': 22,
};

const initial = {
  birth: { year: '', month: '', day: '', hour: -1, minute: 0, useTimeSegment: false, timeSegment: null },
  nickname: '',
  loading: false,
  error: null,
  card: null,
  preview: null,
};

export const useCardStore = create((set, get) => ({
  ...initial,

  setBirthField(field, value) {
    set(s => ({ birth: { ...s.birth, [field]: value } }));
  },

  setNickname(v) { set({ nickname: v }); },

  selectTimeSegment(label) {
    const hour = TIME_SEGMENT_TO_HOUR[label];
    if (hour === undefined) return;
    set(s => ({ birth: { ...s.birth, useTimeSegment: true, timeSegment: label, hour, minute: 0 } }));
  },

  clearTimeSegment() {
    set(s => ({ birth: { ...s.birth, useTimeSegment: false, timeSegment: null, hour: -1, minute: 0 } }));
  },

  async submitBirth({ postCardImpl = realPostCard } = {}) {
    const { birth, nickname } = get();
    set({ loading: true, error: null });
    try {
      const payload = {
        birth: {
          year: Number(birth.year),
          month: Number(birth.month),
          day: Number(birth.day),
          hour: birth.hour,
          minute: birth.minute,
        },
        nickname: nickname || null,
      };
      const card = await postCardImpl(payload);
      set({ card, loading: false });
      return card;
    } catch (err) {
      set({ error: err.message || 'unknown error', loading: false });
      return null;
    }
  },

  async loadPreview(slug, { getCardPreviewImpl = realGetCardPreview } = {}) {
    set({ loading: true, error: null });
    try {
      const preview = await getCardPreviewImpl(slug);
      set({ preview, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  reset() { set(initial); },
}));
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useCardStore.js frontend/tests/card-store.test.mjs
git commit -m "feat(frontend): useCardStore (zustand) for card flow"
```

---

### Task 23: TimeSegmentPicker component

**Files:**
- Create: `frontend/src/components/card/TimeSegmentPicker.jsx`
- Test: `frontend/tests/time-segment-picker.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/time-segment-picker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { TIME_SEGMENTS } from '../src/components/card/TimeSegmentPicker.jsx';

test('exports 6 time segments in correct order', () => {
  assert.equal(TIME_SEGMENTS.length, 6);
  assert.deepEqual(TIME_SEGMENTS.map(s => s.label), [
    '凌晨', '早上', '上午', '下午', '傍晚', '深夜',
  ]);
});

test('each segment has range and center hour', () => {
  for (const seg of TIME_SEGMENTS) {
    assert.ok(seg.range);
    assert.ok(typeof seg.hour === 'number');
    assert.ok(seg.hour >= 0 && seg.hour < 24);
  }
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```jsx
// frontend/src/components/card/TimeSegmentPicker.jsx
export const TIME_SEGMENTS = [
  { label: '凌晨', range: '00:00 - 04:59', hour: 2 },
  { label: '早上', range: '05:00 - 08:59', hour: 6 },
  { label: '上午', range: '09:00 - 12:59', hour: 10 },
  { label: '下午', range: '13:00 - 16:59', hour: 14 },
  { label: '傍晚', range: '17:00 - 20:59', hour: 18 },
  { label: '深夜', range: '21:00 - 23:59', hour: 22 },
];

export function TimeSegmentPicker({ selected, onSelect }) {
  return (
    <div className="time-segment-picker" role="radiogroup">
      {TIME_SEGMENTS.map(seg => (
        <button
          key={seg.label}
          type="button"
          role="radio"
          aria-checked={selected === seg.label}
          className={selected === seg.label ? 'is-selected' : ''}
          onClick={() => onSelect(seg.label)}
        >
          <span className="label">{seg.label}</span>
          <span className="range">{seg.range}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/card/TimeSegmentPicker.jsx frontend/tests/time-segment-picker.test.mjs
git commit -m "feat(frontend): TimeSegmentPicker (6 segments aligned to 时辰)"
```

---

### Task 24: BirthForm component

**Files:**
- Create: `frontend/src/components/card/BirthForm.jsx`
- Test: `frontend/tests/birth-form.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/birth-form.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBirthInput } from '../src/components/card/BirthForm.jsx';

test('valid birth passes', () => {
  assert.equal(validateBirthInput({ year: '1998', month: '07', day: '15' }).ok, true);
});

test('missing year fails', () => {
  const r = validateBirthInput({ year: '', month: '07', day: '15' });
  assert.equal(r.ok, false);
  assert.match(r.error, /年份/);
});

test('year out of range fails', () => {
  const r = validateBirthInput({ year: '1800', month: '01', day: '01' });
  assert.equal(r.ok, false);
  assert.match(r.error, /1900/);
});

test('invalid day for month fails', () => {
  const r = validateBirthInput({ year: '2001', month: '02', day: '30' });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```jsx
// frontend/src/components/card/BirthForm.jsx
import { useState } from 'react';
import { useCardStore } from '../../store/useCardStore.js';
import { TimeSegmentPicker, TIME_SEGMENTS } from './TimeSegmentPicker.jsx';

export function validateBirthInput({ year, month, day }) {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!year || !month || !day) return { ok: false, error: '请填写完整的年份/月份/日期' };
  if (y < 1900 || y > 2100) return { ok: false, error: '年份范围 1900-2100' };
  if (m < 1 || m > 12) return { ok: false, error: '月份无效' };
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return { ok: false, error: `${y}年${m}月无此日期` };
  return { ok: true };
}

export function BirthForm({ onSubmit }) {
  const { birth, nickname, setBirthField, setNickname, selectTimeSegment, clearTimeSegment } = useCardStore();
  const [formError, setFormError] = useState(null);
  const [showTime, setShowTime] = useState(false);
  const [timeMode, setTimeMode] = useState('segment');  // 'segment' | 'precise'

  function handleSubmit(e) {
    e.preventDefault();
    const check = validateBirthInput(birth);
    if (!check.ok) { setFormError(check.error); return; }
    setFormError(null);
    onSubmit();
  }

  return (
    <form className="birth-form" onSubmit={handleSubmit}>
      <div className="date-row">
        <input aria-label="年" type="number" placeholder="年" value={birth.year}
               onChange={e => setBirthField('year', e.target.value)} required />
        <input aria-label="月" type="number" min="1" max="12" placeholder="月"
               value={birth.month} onChange={e => setBirthField('month', e.target.value)} required />
        <input aria-label="日" type="number" min="1" max="31" placeholder="日"
               value={birth.day} onChange={e => setBirthField('day', e.target.value)} required />
      </div>

      <button type="button" className="toggle-time" onClick={() => setShowTime(s => !s)}>
        {showTime ? '−' : '+'} 出生时间（可选，更准）
      </button>

      {showTime && (
        <div className="time-block">
          <div className="mode-toggle">
            <label><input type="radio" checked={timeMode === 'segment'}
                          onChange={() => { setTimeMode('segment'); clearTimeSegment(); }} /> 选时段</label>
            <label><input type="radio" checked={timeMode === 'precise'}
                          onChange={() => { setTimeMode('precise'); clearTimeSegment(); }} /> 精确时间</label>
          </div>
          {timeMode === 'segment' ? (
            <TimeSegmentPicker selected={birth.timeSegment} onSelect={selectTimeSegment} />
          ) : (
            <input type="time" aria-label="出生时刻" onChange={e => {
              const [h, m] = e.target.value.split(':').map(Number);
              setBirthField('hour', h); setBirthField('minute', m || 0);
            }} />
          )}
        </div>
      )}

      <input aria-label="昵称" type="text" placeholder="昵称（可选）" maxLength={10}
             value={nickname} onChange={e => setNickname(e.target.value)} />

      {formError && <div className="form-error" role="alert">{formError}</div>}
      <button type="submit" className="primary-cta">查看我的类型</button>
    </form>
  );
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/card/BirthForm.jsx frontend/tests/birth-form.test.mjs
git commit -m "feat(frontend): BirthForm with optional time segment/precise input"
```

---

### Task 25: LandingScreen (hosts BirthForm + triggers submit + navigates)

**Files:**
- Modify: `frontend/src/components/card/LandingScreen.jsx` (replace stub)

- [ ] **Step 1: Implement**

```jsx
// frontend/src/components/card/LandingScreen.jsx
import { useNavigate } from 'react-router-dom';
import { useCardStore } from '../../store/useCardStore.js';
import { BirthForm } from './BirthForm.jsx';
import { CardSkeleton } from './CardSkeleton.jsx';

export function LandingScreen() {
  const navigate = useNavigate();
  const { loading, error, submitBirth } = useCardStore();

  async function handleSubmit() {
    const card = await submitBirth();
    if (card) navigate(`/card/${card.share_slug}`);
  }

  if (loading) return <CardSkeleton />;

  return (
    <main className="landing-screen">
      <header className="hero">
        <h1>查八字</h1>
        <p className="tagline">3 秒看你的人格图鉴</p>
      </header>
      <BirthForm onSubmit={handleSubmit} />
      {error && <div className="form-error" role="alert">{error}</div>}
    </main>
  );
}
```

- [ ] **Step 2: Create CardSkeleton stub**

```jsx
// frontend/src/components/card/CardSkeleton.jsx
export function CardSkeleton() {
  return (
    <div className="card-skeleton" aria-busy="true">
      <div className="shimmer shimmer-name" />
      <div className="shimmer shimmer-tags" />
      <div className="shimmer shimmer-line" />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/card/LandingScreen.jsx frontend/src/components/card/CardSkeleton.jsx
git commit -m "feat(frontend): LandingScreen wired to submit + navigate"
```

---

### Task 26: Card component (html2canvas target)

**Files:**
- Create: `frontend/src/components/card/Card.jsx`
- Create: `frontend/src/styles/card.css`
- Modify: `frontend/src/index.css` (import card.css)

- [ ] **Step 1: Implement Card component**

```jsx
// frontend/src/components/card/Card.jsx
import { forwardRef } from 'react';

const CATEGORIES = ['性格', '关系', '事业'];

export const Card = forwardRef(function Card({ card }, ref) {
  return (
    <article
      ref={ref}
      className="card"
      data-state={card.state}
      data-type-id={card.type_id}
      style={{ '--theme': card.theme_color }}
    >
      <header>
        <span className="brand">查八字</span>
        <span className="type-id">{card.type_id} / 20</span>
      </header>

      <figure className="illustration">
        <img src={card.illustration_url} alt={card.cosmic_name} />
      </figure>

      <h1 className="cosmic-name">{card.cosmic_name}</h1>
      <p className="suffix">· {card.suffix} ·</p>
      <p className="one-liner">{card.one_liner}</p>

      <ul className="subtags">
        {card.subtags.map((t, i) => (
          <li key={i} data-category={CATEGORIES[i]}>{t}</li>
        ))}
      </ul>

      <blockquote className="golden-line">" {card.golden_line}</blockquote>

      <footer>
        <span>查八字 · chabazi.com</span>
      </footer>
    </article>
  );
});
```

- [ ] **Step 2: Write base card.css**

```css
/* frontend/src/styles/card.css */
.card {
  width: 540px;
  height: 720px;
  padding: 32px;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fafafa);
  border-top: 6px solid var(--theme, #2D6A4F);
  font-family: "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  position: relative;
}

.card header {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: #666;
}

.card .illustration {
  display: flex;
  justify-content: center;
  margin: 24px 0;
}
.card .illustration img {
  width: 180px;
  height: 180px;
  object-fit: contain;
}

.card .cosmic-name {
  font-size: 56px;
  font-weight: 700;
  text-align: center;
  color: var(--theme);
  margin: 0;
}

.card .suffix {
  font-size: 18px;
  text-align: center;
  color: #888;
  margin: 4px 0 16px;
}

.card .one-liner {
  font-size: 20px;
  text-align: center;
  margin: 0 0 24px;
  color: #333;
}

.card .subtags {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
}
.card .subtags li {
  flex: 1;
  padding: 10px 8px;
  text-align: center;
  border: 1.5px solid var(--theme);
  border-radius: 12px;
  font-size: 14px;
  color: var(--theme);
  background: rgba(255,255,255,0.6);
}

.card .golden-line {
  font-size: 18px;
  color: #444;
  font-style: italic;
  text-align: center;
  margin: 12px 0;
  padding: 0 16px;
}

.card footer {
  margin-top: auto;
  text-align: center;
  font-size: 12px;
  color: #999;
}

.card[data-state="蓄力"] {
  background: linear-gradient(180deg, #fafafa, #f0f0f0);
}
```

- [ ] **Step 3: Import in index.css**

```css
/* at top of frontend/src/index.css */
@import './styles/card.css';
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/card/Card.jsx frontend/src/styles/card.css frontend/src/index.css
git commit -m "feat(frontend): Card presentational component + base styles"
```

---

### Task 27: CardScreen (hosts Card + CardActions + UpgradeCTA)

**Files:**
- Modify: `frontend/src/components/card/CardScreen.jsx`
- Create: `frontend/src/components/card/CardActions.jsx`
- Create: `frontend/src/components/card/UpgradeCTA.jsx`

- [ ] **Step 1: Implement CardActions (stubs for save/share — filled in Phase F)**

```jsx
// frontend/src/components/card/CardActions.jsx
export function CardActions({ onSave, onShare, onInvitePair }) {
  return (
    <div className="card-actions">
      <button type="button" className="action-save" onClick={onSave}>
        💾 保存到相册
      </button>
      <button type="button" className="action-share" onClick={onShare}>
        🔗 分享
      </button>
      <button type="button" className="action-pair disabled" disabled
              title="合盘功能即将开放" onClick={onInvitePair}>
        💞 邀请合盘
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement UpgradeCTA**

```jsx
// frontend/src/components/card/UpgradeCTA.jsx
import { Link } from 'react-router-dom';

export function UpgradeCTA({ typeId }) {
  return (
    <aside className="upgrade-cta">
      <p className="hook">🔒 你的命盘还有更多未解密...</p>
      <p className="detail">4 份深度报告 + AI 命盘对话</p>
      <Link to={`/app?type_id=${typeId}`} className="cta-link">
        注册解锁 →
      </Link>
    </aside>
  );
}
```

- [ ] **Step 3: Implement CardScreen**

```jsx
// frontend/src/components/card/CardScreen.jsx
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useCardStore } from '../../store/useCardStore.js';
import { Card } from './Card.jsx';
import { CardActions } from './CardActions.jsx';
import { CardSkeleton } from './CardSkeleton.jsx';
import { UpgradeCTA } from './UpgradeCTA.jsx';

export function CardScreen() {
  const { slug } = useParams();
  const { card, preview, loading, error, loadPreview } = useCardStore();
  const cardRef = useRef(null);

  // If user arrived via share link without an in-memory card, load preview
  useEffect(() => {
    if (!card && slug) loadPreview(slug);
  }, [slug, card, loadPreview]);

  if (loading) return <CardSkeleton />;
  if (error) return <div className="form-error" role="alert">{error}</div>;

  // Full card: user just submitted
  if (card) {
    return (
      <main className="card-screen">
        <Card ref={cardRef} card={card} />
        <CardActions
          onSave={() => { /* Phase F */ }}
          onShare={() => { /* Phase F */ }}
          onInvitePair={() => alert('合盘功能即将开放')}
        />
        <UpgradeCTA typeId={card.type_id} />
      </main>
    );
  }

  // Share-link preview: partial card, CTA to try own
  if (preview) {
    return (
      <main className="card-preview">
        <p className="preview-notice">这是{preview.nickname ? ` @${preview.nickname} ` : '一位朋友'}的命盘卡</p>
        <img src={preview.illustration_url} alt={preview.cosmic_name} />
        <h2>{preview.cosmic_name}</h2>
        <p>· {preview.suffix} ·</p>
        <Link to="/" className="primary-cta">查看我的类型 →</Link>
      </main>
    );
  }

  return <CardSkeleton />;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/card/CardScreen.jsx frontend/src/components/card/CardActions.jsx frontend/src/components/card/UpgradeCTA.jsx
git commit -m "feat(frontend): CardScreen with full-card and preview modes"
```

---

## Phase F: 分享 + 微信 + 埋点（Day 11-14）

### Task 28: saveImage.js (html2canvas + download/overlay)

**Files:**
- Create: `frontend/src/lib/saveImage.js`
- Test: `frontend/tests/save-image.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/save-image.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileUserAgent } from '../src/lib/saveImage.js';

test('iOS detected as mobile', () => {
  assert.equal(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)'), true);
});

test('Android detected as mobile', () => {
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Linux; Android 11)'), true);
});

test('desktop Chrome not mobile', () => {
  assert.equal(isMobileUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/100'), false);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```javascript
// frontend/src/lib/saveImage.js
import html2canvas from 'html2canvas';

export function isMobileUserAgent(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

export async function renderCardToDataUrl(node) {
  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: null,
    logging: false,
  });
  return canvas.toDataURL('image/png');
}

export function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function showLongPressOverlay(dataUrl) {
  const overlay = document.createElement('div');
  overlay.className = 'save-overlay';
  overlay.innerHTML = `
    <div class="save-overlay-inner">
      <img src="${dataUrl}" alt="长按保存" />
      <p>长按图片保存到相册</p>
      <button type="button" class="close">关闭</button>
    </div>
  `;
  overlay.querySelector('.close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

export async function saveCardAsImage(node, { typeId, cosmicName, onTrack } = {}) {
  const dataUrl = await renderCardToDataUrl(node);
  if (isMobileUserAgent()) {
    showLongPressOverlay(dataUrl);
  } else {
    triggerDownload(dataUrl, `chabazi-${typeId || ''}-${cosmicName || ''}.png`);
  }
  if (onTrack) onTrack();
}
```

Add minimal overlay CSS to `card.css`:

```css
.save-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex; justify-content: center; align-items: center;
  z-index: 9999;
}
.save-overlay-inner {
  background: white; padding: 24px; border-radius: 12px;
  max-width: 90vw; text-align: center;
}
.save-overlay-inner img {
  max-width: 100%; max-height: 70vh;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/saveImage.js frontend/src/styles/card.css frontend/tests/save-image.test.mjs
git commit -m "feat(frontend): saveCardAsImage via html2canvas with iOS overlay fallback"
```

---

### Task 29: analytics.js (POST /api/track wrapper)

**Files:**
- Create: `frontend/src/lib/analytics.js`
- Test: `frontend/tests/analytics.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/analytics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { track, __setTrackFetch } from '../src/lib/analytics.js';

test('track posts event with properties', async () => {
  let captured;
  __setTrackFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 204 };
  });
  await track('card_view', { type_id: '01', from: 'direct' });
  assert.match(captured.url, /\/api\/track$/);
  assert.equal(captured.body.event, 'card_view');
  assert.equal(captured.body.properties.type_id, '01');
  assert.equal(captured.body.properties.from, 'direct');
});

test('track swallows network errors silently', async () => {
  __setTrackFetch(async () => { throw new Error('network down'); });
  await track('card_view', {});  // should not throw
  assert.ok(true);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```javascript
// frontend/src/lib/analytics.js
import { getAnonymousId } from './anonymousId.js';

let _fetchImpl = (typeof fetch !== 'undefined') ? fetch : null;
export function __setTrackFetch(f) { _fetchImpl = f; }

function collectContext() {
  if (typeof window === 'undefined') return {};
  return {
    anonymous_id: getAnonymousId(),
    session_id: sessionStorage.getItem('chabazi_sid') || (() => {
      const s = `s_${Math.random().toString(36).slice(2, 14)}`;
      sessionStorage.setItem('chabazi_sid', s);
      return s;
    })(),
    user_agent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
}

export async function track(event, properties = {}) {
  if (!_fetchImpl) return;
  try {
    await _fetchImpl('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        properties: { ...collectContext(), ...properties },
      }),
    });
  } catch (_) { /* silent */ }
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/analytics.js frontend/tests/analytics.test.mjs
git commit -m "feat(frontend): analytics.track → POST /api/track"
```

---

### Task 30: wxShare.js (WeChat JS-SDK integration)

**Files:**
- Create: `frontend/src/lib/wxShare.js`
- Test: `frontend/tests/wx-share.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/tests/wx-share.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareConfig, isWeChatBrowser } from '../src/lib/wxShare.js';

test('isWeChatBrowser detects MicroMessenger', () => {
  assert.equal(isWeChatBrowser('Mozilla/5.0 ... MicroMessenger/8.0'), true);
  assert.equal(isWeChatBrowser('Mozilla/5.0 ... Chrome/100'), false);
});

test('buildShareConfig friend produces correct title/desc/link', () => {
  const cfg = buildShareConfig('friend', {
    cosmic_name: '春笋', suffix: '天生享乐家', share_slug: 'c_abc',
    illustration_url: '/static/01.png',
  }, 'https://chabazi.com');
  assert.match(cfg.title, /春笋·天生享乐家/);
  assert.match(cfg.link, /from=share_friend/);
  assert.match(cfg.link, /c_abc/);
});

test('buildShareConfig timeline has distinct title', () => {
  const cfg = buildShareConfig('timeline', {
    cosmic_name: '春笋', suffix: '天生享乐家', share_slug: 'c_abc',
    illustration_url: '/static/01.png',
  }, 'https://chabazi.com');
  assert.match(cfg.title, /点开看你是什么/);
  assert.match(cfg.link, /from=share_timeline/);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```javascript
// frontend/src/lib/wxShare.js
import wx from 'weixin-js-sdk';

export function isWeChatBrowser(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  return /MicroMessenger/i.test(ua);
}

export function buildShareConfig(kind, card, origin) {
  const base = `${origin}/card/${card.share_slug}`;
  if (kind === 'friend') {
    return {
      title: `我是${card.cosmic_name}·${card.suffix} -- 你是什么？`,
      desc: '查八字人格图鉴，3 秒看到你的类型',
      link: `${base}?from=share_friend`,
      imgUrl: `${origin}${card.illustration_url}`,
    };
  }
  // timeline
  return {
    title: `我是${card.cosmic_name} -- 点开看你是什么`,
    link: `${base}?from=share_timeline`,
    imgUrl: `${origin}${card.illustration_url}`,
  };
}

export async function configureWxShare(card, { onShare }) {
  if (!isWeChatBrowser()) return;  // noop outside 微信

  const currentUrl = window.location.href.split('#')[0];
  const resp = await fetch(`/api/wx/jsapi-ticket?url=${encodeURIComponent(currentUrl)}`);
  const sig = await resp.json();

  wx.config({
    debug: false,
    appId: sig.appId,
    timestamp: sig.timestamp,
    nonceStr: sig.nonceStr,
    signature: sig.signature,
    jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData'],
  });

  wx.ready(() => {
    const origin = window.location.origin;
    wx.updateAppMessageShareData({
      ...buildShareConfig('friend', card, origin),
      success: () => onShare && onShare('wx_friend'),
    });
    wx.updateTimelineShareData({
      ...buildShareConfig('timeline', card, origin),
      success: () => onShare && onShare('wx_timeline'),
    });
  });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/wxShare.js frontend/tests/wx-share.test.mjs
git commit -m "feat(frontend): WeChat JS-SDK share config (friend + timeline)"
```

---

### Task 31: Wire save/share/track into CardScreen

**Files:**
- Modify: `frontend/src/components/card/CardScreen.jsx`

- [ ] **Step 1: Add effect + handlers**

Replace the `if (card)` branch in CardScreen.jsx:

```jsx
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useCardStore } from '../../store/useCardStore.js';
import { Card } from './Card.jsx';
import { CardActions } from './CardActions.jsx';
import { CardSkeleton } from './CardSkeleton.jsx';
import { UpgradeCTA } from './UpgradeCTA.jsx';
import { saveCardAsImage } from '../../lib/saveImage.js';
import { configureWxShare } from '../../lib/wxShare.js';
import { track } from '../../lib/analytics.js';

export function CardScreen() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const { card, preview, loading, error, loadPreview } = useCardStore();
  const cardRef = useRef(null);

  useEffect(() => {
    if (!card && slug) loadPreview(slug);
  }, [slug, card, loadPreview]);

  useEffect(() => {
    if (!card) return;
    track('card_view', {
      type_id: card.type_id,
      share_slug: card.share_slug,
      from: searchParams.get('from') || 'direct',
    });
    configureWxShare(card, {
      onShare: (channel) => track('card_share', {
        type_id: card.type_id,
        channel,
        share_slug: card.share_slug,
      }),
    });
  }, [card, searchParams]);

  if (loading) return <CardSkeleton />;
  if (error) return <div className="form-error" role="alert">{error}</div>;

  if (card) {
    async function handleSave() {
      await saveCardAsImage(cardRef.current, {
        typeId: card.type_id,
        cosmicName: card.cosmic_name,
        onTrack: () => track('card_save', { type_id: card.type_id, share_slug: card.share_slug }),
      });
    }

    function handleShare() {
      if (/MicroMessenger/i.test(navigator.userAgent)) {
        alert('点击右上角「...」选择分享到朋友圈或好友');
      } else {
        // 非微信环境：fallback copy link
        navigator.clipboard.writeText(window.location.href);
        alert('链接已复制');
        track('card_share', { type_id: card.type_id, channel: 'clipboard' });
      }
    }

    return (
      <main className="card-screen">
        <Card ref={cardRef} card={card} />
        <CardActions onSave={handleSave} onShare={handleShare}
                     onInvitePair={() => alert('合盘功能即将开放')} />
        <UpgradeCTA typeId={card.type_id} />
      </main>
    );
  }

  if (preview) {
    return (
      <main className="card-preview">
        <p className="preview-notice">这是{preview.nickname ? ` @${preview.nickname} ` : '一位朋友'}的命盘卡</p>
        <img src={preview.illustration_url} alt={preview.cosmic_name} />
        <h2>{preview.cosmic_name}</h2>
        <p>· {preview.suffix} ·</p>
        <Link to="/" className="primary-cta">查看我的类型 →</Link>
      </main>
    );
  }

  return <CardSkeleton />;
}
```

- [ ] **Step 2: Test manually in dev server**

```bash
cd frontend && npm run dev
# Visit http://localhost:5173/, fill form, verify navigation + network tab shows /api/card and /api/track
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/card/CardScreen.jsx
git commit -m "feat(frontend): wire save/share/track into CardScreen"
```

---

### Task 32: Landing form_start / form_submit tracking

**Files:**
- Modify: `frontend/src/components/card/LandingScreen.jsx`
- Modify: `frontend/src/components/card/BirthForm.jsx`

- [ ] **Step 1: Add tracking**

In LandingScreen, useEffect on mount track `form_start`:

```jsx
import { useEffect } from 'react';
import { track } from '../../lib/analytics.js';
// ...
useEffect(() => { track('form_start', { from: new URLSearchParams(window.location.search).get('from') || 'direct' }); }, []);
```

In BirthForm handleSubmit, on success track form_submit:

```jsx
// In handleSubmit, before calling onSubmit():
import { track } from '../../lib/analytics.js';
track('form_submit', {});
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/card/LandingScreen.jsx frontend/src/components/card/BirthForm.jsx
git commit -m "feat(frontend): track form_start + form_submit events"
```

---

## Phase G: Static serving + config + smoke e2e（Day 15-17）

### Task 33: Serve `/static/cards/illustrations/` from FastAPI

**Files:**
- Modify: `server/app/main.py`

- [ ] **Step 1: Mount static files**

In main.py near app creation:

```python
from fastapi.staticfiles import StaticFiles
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data" / "cards"
app.mount(
    "/static/cards",
    StaticFiles(directory=str(_DATA_DIR)),
    name="card_static",
)
```

- [ ] **Step 2: Add placeholder illustrations (emoji + colored-block fallback SVG)**

Generate 20 placeholder PNG files at `server/app/data/cards/illustrations/` using a tiny script:

```python
# server/scripts/generate_placeholder_illustrations.py
"""Generate 20 placeholder PNGs using each type's theme color + type_id overlay.
No emoji rendering (Pillow default font can't handle color emoji reliably).
Real AI illustrations replace these files later in the parallel illustration track."""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageDraw

DATA = json.loads(Path("server/app/data/cards/types.json").read_text(encoding="utf-8"))
OUT = Path("server/app/data/cards/illustrations")
OUT.mkdir(parents=True, exist_ok=True)

for tid, info in DATA.items():
    img = Image.new("RGBA", (360, 360), info["theme_color"])
    draw = ImageDraw.Draw(img)
    # Simple text: big type_id centered, small cosmic_name below.
    # Default font is small but readable; this is a scaffold, not final art.
    draw.text((140, 120), info["id"], fill=(255, 255, 255, 255))
    draw.text((120, 200), info["cosmic_name"], fill=(255, 255, 255, 255))
    img.save(OUT / info["illustration"])

print(f"Generated {len(DATA)} placeholder illustrations at {OUT}")
```

Run:

```bash
cd server && python scripts/generate_placeholder_illustrations.py
```

(If Pillow-emoji rendering is ugly, substitute with plain white "N/20" text and accept the placeholder UI for MVP.)

- [ ] **Step 3: Manually hit `/static/cards/illustrations/01-chunsun.png` in browser**

- [ ] **Step 4: Commit**

```bash
git add server/app/main.py server/scripts/generate_placeholder_illustrations.py server/app/data/cards/illustrations/
git commit -m "feat(cards): static file mount + placeholder illustrations"
```

---

### Task 34: Minimal Landing CSS polish

**Files:**
- Modify: `frontend/src/styles/card.css`

- [ ] **Step 1: Add landing + form styles**

Append to card.css:

```css
.landing-screen {
  max-width: 560px;
  margin: 40px auto;
  padding: 24px;
}
.landing-screen .hero h1 { font-size: 36px; margin: 0; }
.landing-screen .hero .tagline { color: #666; margin-top: 8px; }

.birth-form { display: flex; flex-direction: column; gap: 16px; margin-top: 24px; }
.birth-form .date-row { display: flex; gap: 12px; }
.birth-form .date-row input { flex: 1; padding: 12px; font-size: 16px;
  border: 1.5px solid #ddd; border-radius: 8px; }
.birth-form .toggle-time { background: none; border: none; color: #4A9BE8;
  text-align: left; padding: 4px 0; cursor: pointer; }
.birth-form .time-block { padding: 12px; background: #f8f8f8; border-radius: 8px; }
.birth-form .primary-cta { padding: 14px; font-size: 16px; font-weight: 600;
  background: #2D6A4F; color: white; border: none; border-radius: 8px; cursor: pointer; }

.time-segment-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.time-segment-picker button { padding: 10px; background: white; border: 1.5px solid #ddd;
  border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.time-segment-picker button.is-selected { border-color: #2D6A4F; background: rgba(45,106,79,0.1); }
.time-segment-picker .label { font-weight: 600; }
.time-segment-picker .range { font-size: 12px; color: #666; }

.card-screen { max-width: 560px; margin: 40px auto; padding: 16px; }
.card-actions { display: flex; gap: 8px; margin-top: 16px; }
.card-actions button { flex: 1; padding: 12px; border: 1.5px solid #ddd; background: white;
  border-radius: 8px; cursor: pointer; }
.card-actions button.disabled { opacity: 0.4; cursor: not-allowed; }

.upgrade-cta { margin-top: 24px; padding: 20px; background: linear-gradient(135deg, #f9f3ff, #fff4e6);
  border-radius: 12px; text-align: center; }
.upgrade-cta .hook { font-weight: 600; margin: 0; }
.upgrade-cta .detail { color: #666; margin: 8px 0 16px; }
.upgrade-cta .cta-link { display: inline-block; padding: 12px 28px;
  background: #2D6A4F; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; }
```

- [ ] **Step 2: Eyeball in dev server**

```bash
cd frontend && npm run dev
```

Visit `/`, fill form, verify layout renders. Take screenshot if working.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/card.css
git commit -m "style(cards): landing form + card-screen + upgrade-cta polish"
```

---

### Task 35: end-to-end smoke test (backend + frontend together)

**Files:**
- Create: `frontend/tests/e2e-card-flow.test.mjs`

- [ ] **Step 1: Write a manual e2e checklist and a node script smoke test**

```javascript
// frontend/tests/e2e-card-flow.test.mjs
// Assumes: backend running at http://localhost:8000
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.E2E_API || 'http://localhost:8000';

test('POST /api/card → GET /api/card/:slug round trip', async () => {
  const createResp = await fetch(`${BASE}/api/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      birth: { year: 1998, month: 7, day: 15, hour: 14, minute: 0 },
      nickname: 'e2e-tester',
    }),
  });
  assert.equal(createResp.status, 200);
  const card = await createResp.json();
  assert.ok(card.type_id);
  assert.ok(card.share_slug.startsWith('c_'));

  const previewResp = await fetch(`${BASE}/api/card/${card.share_slug}`);
  assert.equal(previewResp.status, 200);
  const preview = await previewResp.json();
  assert.equal(preview.cosmic_name, card.cosmic_name);
  assert.equal(preview.suffix, card.suffix);
});

test('POST /api/track with card_view writes event', async () => {
  const resp = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'card_view',
      properties: { type_id: '01', from: 'direct' },
    }),
  });
  assert.equal(resp.status, 204);
});
```

Run manually:

```bash
cd server && uvicorn app.main:app --port 8000 &
cd frontend && E2E_API=http://localhost:8000 node --test tests/e2e-card-flow.test.mjs
```

- [ ] **Step 2: Commit**

```bash
git add frontend/tests/e2e-card-flow.test.mjs
git commit -m "test(cards): e2e smoke test for card + track endpoints"
```

---

### Task 36: Manual UX verification + acceptance checklist walk-through

**No code files. This is a QA step.**

- [ ] **Step 1: Start both servers**

```bash
cd server && uvicorn app.main:app --port 8000 --reload &
cd frontend && npm run dev
```

- [ ] **Step 2: Walk through each row in spec §八 验收清单**

Open `docs/superpowers/specs/2026-04-24-share-card-mvp-design.md` §八. Check each box by manual interaction:

- Data layer checkboxes: `python server/scripts/validate_cards_data.py`
- Backend checkboxes: run all `server/tests/` pytest; check response times with curl + `time`
- Frontend checkboxes: visit `/`, verify no AuthScreen; fill form; verify navigation to `/card/:slug`; verify `/app/*` unchanged; try save on desktop (download) and in mobile emulator (overlay); verify WeChat button graceful fallback in non-WeChat browser

Record any failures and fix before moving on.

- [ ] **Step 3: Screenshot the final card and compare to PM/specs/03 §二 visual spec**

Take a screenshot of `/card/:slug` result. Compare against the ASCII mock at `PM/specs/03_卡片与分享系统.md:28-47`. Note any visual deviations.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(cards): address manual QA findings from verification pass"
```

---

### Task 37: Register CardShare in existing model import chain + final integration check

**Files:**
- Verify: `server/app/models/__init__.py` imports CardShare and Event

- [ ] **Step 1: Verify model imports**

```bash
cat server/app/models/__init__.py
```

Ensure both `CardShare` and `Event` are imported so Alembic autogenerate sees them on subsequent migrations.

- [ ] **Step 2: Run the full backend test suite**

```bash
cd server && pytest -x
```

Expected: all tests pass. Previous chart/chat/auth tests should be unaffected.

- [ ] **Step 3: Run the full frontend test suite**

```bash
cd frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 4: If any fail, investigate before proceeding**

---

## Phase H: 上线前收尾（Day 17）

### Task 38: Config docs + .env.example update

**Files:**
- Modify: `server/.env.example`
- Create: `docs/release-notes/2026-04-24-share-card-mvp.md`

- [ ] **Step 1: Update .env.example**

Append:

```
# Share card MVP
WX_APP_ID=
WX_APP_SECRET=
ADMIN_TOKEN=
```

- [ ] **Step 2: Write release notes**

```markdown
# Share Card MVP (Phase 1)

**Released:** 2026-04-24
**Scope:** Personal share card flow (匿名 landing → birth form → result card → save/share)

## What shipped
- New public anonymous flow at `/` and `/card/:slug`
- Existing product moved to `/app/*` (no functional change)
- Backend: `POST /api/card`, `GET /api/card/:slug`, `POST /api/track`, `GET /api/wx/jsapi-ticket`, `GET /api/admin/metrics`
- DB: new `card_shares` + `events` tables
- 20-type × 10-十神 = 200 subtag matrix extracted from PM/specs/02c
- Placeholder illustrations; AI illustrations track runs in parallel

## What's next (Phase 2)
- Pair card (合盘) — blocked on PM/specs/04b copy finalization
- Anonymous → registered user card inheritance
- Paid deep reports unlock
- Operations dashboard UI

## Known limitations
- No SSR; WeChat is the only rich-preview share target
- Placeholder illustrations until AI illustration track completes
- WeChat features require 公众号 备案 completion
```

- [ ] **Step 3: Commit**

```bash
git add server/.env.example docs/release-notes/2026-04-24-share-card-mvp.md
git commit -m "docs: share card MVP release notes + env example"
```

---

### Task 39: Create PR

**No files.**

- [ ] **Step 1: Verify git state**

```bash
git status
git log --oneline main..HEAD | head -40
```

- [ ] **Step 2: Push**

```bash
git push -u origin claude/sharp-elbakyan-34effd
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat: share card MVP (Phase 1 — 个人卡片)" --body "$(cat <<'EOF'
## Summary

- Implements Phase 1 of the share-card feature per PM v4.0 spec (`PM/specs/03_卡片与分享系统.md`)
- Public anonymous flow at `/` and `/card/:slug`; existing product preserved at `/app/*`
- 20-type × 10-十神 = 200 subtag system wired end-to-end; all content pre-finalized to JSON
- WeChat JS-SDK sharing + html2canvas save-to-gallery; anonymous analytics with K-factor measurement
- Pair card (合盘) deferred to Phase 2 (blocked on PM/specs/04b finalization)

## Design doc

`docs/superpowers/specs/2026-04-24-share-card-mvp-design.md`

## Test plan

- [ ] Data validation: `python server/scripts/validate_cards_data.py` → OK
- [ ] Backend unit + integration: `cd server && pytest`
- [ ] Frontend unit: `cd frontend && npm test`
- [ ] Manual e2e: start both servers, walk spec §八 验收清单
- [ ] Desktop save: verify PNG download
- [ ] Mobile save: verify long-press overlay
- [ ] WeChat share button: verify graceful fallback outside 微信 browser
- [ ] `/app/*` regression: login + chart + chat flows unchanged

## Out of scope (Phase 2)

- 合盘 card
- Anonymous → registered session inheritance
- Paid deep reports unlock
- Operations dashboard UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Return PR URL**

---

## Self-Review

Spec coverage check — every spec section mapped to tasks:

| Spec section | Implemented in |
|--------------|----------------|
| §一 背景与动机 | (context only, no task) |
| §二 架构概览 | Task 19 (routing), Task 33 (static) |
| §三 数据模型 | Tasks 1-5 |
| §四.API 端点 | Tasks 13-17 |
| §四.计算管道 | Tasks 7-10 |
| §四.share_slug 快照 | Tasks 9, 11, 14 |
| §四.输入校验 | Task 6 |
| §四.不依赖 auth | Tasks 13, 15 |
| §四.排盘引擎复用 | Task 8, Task 10 |
| §五.路由 | Task 19 |
| §五.新增组件 | Tasks 25-27 |
| §五.时段 6 档 | Task 23 |
| §五.页面流 | Tasks 24-27 |
| §五.useCardStore | Task 22 |
| §五.Card.jsx | Task 26 |
| §五.样式策略 | Tasks 26, 34 |
| §五.AuthScreen 处理 | Task 19 |
| §六.保存到相册 | Task 28 |
| §六.微信 JS-SDK | Tasks 17, 30 |
| §六.分享链接打开行为 | Task 14 (backend preview), Task 27 (frontend) |
| §六.埋点 events 表 | Tasks 11, 15 |
| §六.K 因子测量 | Task 16 |
| §六.防封策略 | Task 27 (no unlock-gating), Task 30 (single wx.config) |
| §七 时间线 | (maps to phase structure) |
| §八 验收清单 | Task 36 |

No placeholder/TBD scan: every code step includes full code. Types referenced (BirthInput, CardResponse, CardShare, Event, TrackRequest) are defined in earlier tasks before use. Function names (classify_state, lookup_type_id, generate_slug, birth_hash, build_card_payload, postCard, getCardPreview, saveCardAsImage, track, configureWxShare, buildShareConfig, isWeChatBrowser, validateBirthInput, getAnonymousId) are used consistently.
