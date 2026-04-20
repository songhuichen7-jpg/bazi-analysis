# Plan 7.4 — 行运 Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every 大运 (8) and 流年 (8×10=80) against 命局 用神 (Plan 7.3 anchor) into a 5-bin label (大喜/喜/平/忌/大忌) with 1-line note + mechanism tags. Pure paipan engine; reuses existing `paipan/paipan/ganzhi.py` wuxing tables. Surface the dict via `chart.paipan.xingyun`; render in `compact_chart_context()`. Frontend zero-touch.

**Architecture:** New `paipan/paipan/xingyun_data.py` (only 2 new tables — `GAN_HE_TABLE` + `ZHI_LIUHE_TABLE` — plus thresholds). New `paipan/paipan/xingyun.py` (all scoring logic, reusing `GAN_WUXING`, `ZHI_WUXING`, `WUXING_SHENG`, `WUXING_KE` from ganzhi.py). Wire into `compute.py` (NOT analyzer.py — keep analyzer's命局-only responsibility). Render block in `server/app/prompts/context.py`.

**Tech Stack:** Python 3.12 · pytest. No new deps. Reuses Plan 7.3's `yongshenDetail.primary` as the scoring anchor.

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-20-xingyun-engine-design.md`. If spec contradicts reality (e.g. wrong existing-code reference), fix spec inline + flag in commit.
2. **Backward compat**: 老盘（Plan 7.3 时代）数据库里没有 `xingyun` 字段。`compact_chart_context` 遇到缺字段时静默跳过渲染。
3. **No frontend changes**: chartUi.js / Shell.jsx 等前端文件不动。评分只进 LLM context。
4. **analyzer.py 不动**：xingyun 计算挂在 `compute.py` 上（它需要 `current_year`，违背 analyzer "纯命局分析" 的职责）。
5. **Plan 7.3 接口**：消费 `yongshenDetail.primary` 作为评分锚点，不重算用神。
6. **Tests stay green**: 521 paipan + 430 backend + 51 frontend baseline。新增 30 paipan + 4 backend。

## 目录最终形态

```
paipan/
├── paipan/
│   ├── xingyun_data.py            # NEW — 2 个新表 + 阈值
│   ├── xingyun.py                 # NEW — 评分引擎
│   ├── compute.py                 # MODIFY — 调 build_xingyun，surface chart.paipan.xingyun
│   ├── analyzer.py                # 不动
│   └── ganzhi.py                  # 不动（已有的 GAN_WUXING/ZHI_WUXING/WUXING_SHENG/WUXING_KE 直接复用）
└── tests/
    ├── test_xingyun_data.py       # NEW — 5 个表结构 tests
    ├── test_xingyun.py            # NEW — 25 个引擎 tests（5 label + 4 合化/六合 + 2 多元素 + 3 batch + 1 None + 10 golden）
    └── regression/test_regression.py  # MODIFY — ANALYZER_KEYS 加 "xingyun"

server/
├── app/
│   └── prompts/
│       └── context.py             # MODIFY — _render_xingyun_block + 调用
└── tests/
    └── unit/
        └── test_prompts_context_xingyun.py   # NEW — 4 个渲染 tests
```

无前端改动。无新 deps。无新路由。

## Task 列表预览

- **Task 1** — Skeleton: `xingyun_data.py` + `xingyun.py` 全部 public 函数 stubs + `compute.py` wire + 1 个骨架 test 证明 chart.paipan.xingyun 存在并是 dict。Regression strip-list 加 "xingyun"。
- **Task 2** — 数据表：`GAN_HE_TABLE` (5 对) + `ZHI_LIUHE_TABLE` (6 对) + `SCORE_THRESHOLDS` + 5 个 validity tests。
- **Task 3** — 干 effect 评分：`_score_gan_to_yongshen` + `_detect_ganhe` + 4 个 unit tests。
- **Task 4** — 支 effect 评分：`_score_zhi_to_yongshen` + `_detect_liuhe` + 4 个 unit tests。
- **Task 5** — `score_yun` 顶层组合：5 个 label 分支测试 + 2 个多元素用神测试 + label/note/mechanisms 组装。
- **Task 6** — `build_xingyun` batch + `currentDayunIndex` 定位 + 中和命局 fallback + 3 batch tests + 1 None test + 10 golden 集成。
- **Task 7** — `context.py` 渲染：`_render_xingyun_block` + 4 渲染 tests + 全套回归 + browser smoke。

---

## Task 1: Skeleton + compute.py wire

**Files:**
- Create: `paipan/paipan/xingyun_data.py` (空表 stubs)
- Create: `paipan/paipan/xingyun.py` (函数 stubs)
- Modify: `paipan/paipan/compute.py` (调 build_xingyun)
- Modify: `paipan/tests/regression/test_regression.py` (ANALYZER_KEYS 加 "xingyun")
- Create: `paipan/tests/test_xingyun.py` (1 个 skeleton test)

- [ ] **Step 1.1: Create `paipan/paipan/xingyun_data.py` with empty tables**

```python
"""Plan 7.4 — static lookup tables for 行运 scoring engine.

Tables:
- GAN_HE_TABLE      — 5 对天干合化 (甲己→土,乙庚→金 等)
- ZHI_LIUHE_TABLE   — 6 对地支六合 (子丑→土,寅亥→木 等)
- SCORE_THRESHOLDS  — 5-bin 分类阈值

Existing wuxing tables are imported from paipan.ganzhi (GAN_WUXING /
ZHI_WUXING / WUXING_SHENG / WUXING_KE) — do NOT duplicate.

Spec: docs/superpowers/specs/2026-04-20-xingyun-engine-design.md
"""
from __future__ import annotations

# 5 对天干合化 (filled in Task 2)
GAN_HE_TABLE: dict[frozenset[str], str] = {}

# 6 对地支六合 (filled in Task 2)
ZHI_LIUHE_TABLE: dict[frozenset[str], str] = {}

# 5-bin 分类阈值 (filled in Task 2)
SCORE_THRESHOLDS: dict[str, int] = {}
```

- [ ] **Step 1.2: Create `paipan/paipan/xingyun.py` with public stubs**

```python
"""Plan 7.4 — 行运 scoring engine.

Public API:
  score_yun(yun_ganzhi, yongshen_primary, mingju_gans, mingju_zhis) -> dict
  build_xingyun(dayun, yongshen_detail, mingju_gans, mingju_zhis, current_year) -> dict

Spec: docs/superpowers/specs/2026-04-20-xingyun-engine-design.md
"""
from __future__ import annotations

from paipan.ganzhi import GAN_WUXING, ZHI_WUXING, WUXING_SHENG, WUXING_KE
from paipan.xingyun_data import GAN_HE_TABLE, ZHI_LIUHE_TABLE, SCORE_THRESHOLDS


def _classify_score(score: int) -> str:
    """5-bin classifier (filled in Task 2)."""
    return '平'   # stub


def _extract_yongshen_wuxings(primary: str) -> list[str]:
    """Parse '甲木 / 戊土 / 庚金' → ['木','土','金']. Filled in Task 5."""
    return []   # stub


def _detect_ganhe(gan: str, mingju_gans: list[str]) -> str | None:
    """Filled in Task 3."""
    return None


def _detect_liuhe(zhi: str, mingju_zhis: list[str]) -> str | None:
    """Filled in Task 4."""
    return None


def _score_gan_to_yongshen(
    gan: str, ys_wuxing: str, mingju_gans: list[str]
) -> tuple[int, str, list[str]]:
    """Filled in Task 3. Returns (delta, reason_text, mechanism_tags)."""
    return (0, '', [])


def _score_zhi_to_yongshen(
    zhi: str, ys_wuxing: str, mingju_zhis: list[str]
) -> tuple[int, str, list[str]]:
    """Filled in Task 4."""
    return (0, '', [])


def score_yun(
    yun_ganzhi: str,
    yongshen_primary: str,
    mingju_gans: list[str],
    mingju_zhis: list[str],
) -> dict:
    """Score one 大运/流年 ganzhi against 命局 用神. Filled in Task 5."""
    return {
        'label': '平',
        'score': 0,
        'note': '',
        'mechanisms': [],
        'gan_effect': {'delta': 0, 'reason': ''},
        'zhi_effect': {'delta': 0, 'reason': ''},
        'winningYongshenElement': None,
    }


def build_xingyun(
    dayun: dict,
    yongshen_detail: dict,
    mingju_gans: list[str],
    mingju_zhis: list[str],
    current_year: int,
) -> dict:
    """Batch entry. Filled in Task 6.

    Returns:
        {
          'dayun': [...8 条...],
          'liunian': {str(idx): [...10 条...]},
          'currentDayunIndex': int | None,
          'yongshenSnapshot': str,
        }
    """
    return {
        'dayun': [],
        'liunian': {},
        'currentDayunIndex': None,
        'yongshenSnapshot': (yongshen_detail or {}).get('primary', ''),
    }
```

- [ ] **Step 1.3: Wire `compute.py`**

Read `paipan/paipan/compute.py` first to find:
- The line `now = _now if _now is not None else datetime.now()` (around line 192)
- Where `result["yongshen"]` and `result["yongshenDetail"]` get assigned (Plan 7.3 wired this)

Add at the **top of file** (with other imports):
```python
from paipan.xingyun import build_xingyun
```

Add after the existing `result["yongshenDetail"] = analysis["yongshenDetail"]` line:
```python
# Plan 7.4: 行运 evaluation against 命局 用神 (Plan 7.3 anchor)
bazi = result["sizhu"]   # actual key is "sizhu" not "bazi"
# Guard against hour=None (unknown-hour sentinel; compute.py:163 sets hour to None)
mingju_gans = [bazi[k][0] for k in ['year', 'month', 'day', 'hour'] if bazi.get(k)]
mingju_zhis = [bazi[k][1] for k in ['year', 'month', 'day', 'hour'] if bazi.get(k)]
result["xingyun"] = build_xingyun(
    dayun=result["dayun"],
    yongshen_detail=result["yongshenDetail"],
    mingju_gans=mingju_gans,
    mingju_zhis=mingju_zhis,
    current_year=now.year,
)
```

- [ ] **Step 1.4: Update regression strip-list**

Read `paipan/tests/regression/test_regression.py` (lines 25-35 from Plan 7.3). Add `"xingyun"` to `ANALYZER_KEYS`:

```python
ANALYZER_KEYS = {
    "force",
    "geJu",
    "ganHe",
    "zhiRelations",
    "notes",
    "dayStrength",
    "geju",
    "yongshen",
    "yongshenDetail",
    "xingyun",          # NEW (Plan 7.4)
}
```

- [ ] **Step 1.5: Write skeleton test**

Create `paipan/tests/test_xingyun.py`:

```python
"""Plan 7.4 行运 engine — skeleton & integration."""
from __future__ import annotations

from paipan import compute


def test_chart_xingyun_present_and_is_dict():
    """Plan 7.4 §6.1: chart.paipan.xingyun is a dict."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    assert isinstance(out.get('xingyun'), dict)


def test_chart_xingyun_has_expected_top_keys():
    """Plan 7.4 §5.2: required top-level keys present."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert 'dayun' in xy
    assert 'liunian' in xy
    assert 'currentDayunIndex' in xy
    assert 'yongshenSnapshot' in xy


def test_chart_xingyun_yongshenSnapshot_matches_plan73_primary():
    """xingyun.yongshenSnapshot == yongshenDetail.primary."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    assert out['xingyun']['yongshenSnapshot'] == out['yongshenDetail']['primary']
```

- [ ] **Step 1.6: Run skeleton tests + regression**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v
```
Expected: 3 passed (stubs return shape, not content — that's fine).

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 521 + 3 = 524 passed (no regressions; existing oracle still works because `xingyun` is in ANALYZER_KEYS strip-list).

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 430 passed (server unchanged).

- [ ] **Step 1.7: Commit**

```bash
git add paipan/paipan/xingyun_data.py paipan/paipan/xingyun.py \
        paipan/paipan/compute.py paipan/tests/regression/test_regression.py \
        paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.4 行运 engine skeleton + compute.py wire

Add xingyun.py with public stubs (score_yun, build_xingyun) and
xingyun_data.py with empty tables (filled in Task 2). Wire build_xingyun
into compute.py last step; surfaces:
  - chart.paipan.xingyun  — dict with dayun/liunian/currentDayunIndex/yongshenSnapshot

analyzer.py is intentionally NOT touched (xingyun needs current_year,
violates analyzer's pure-命局-analysis responsibility).

Regression strip-list adds "xingyun" so frozen oracle JSON stays valid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Data tables + 5-bin thresholds

**Files:**
- Modify: `paipan/paipan/xingyun_data.py` (populate 3 constants)
- Create: `paipan/tests/test_xingyun_data.py` (5 validity tests)
- Modify: `paipan/paipan/xingyun.py` (implement `_classify_score`)

- [ ] **Step 2.1: Populate `GAN_HE_TABLE` + `ZHI_LIUHE_TABLE` + `SCORE_THRESHOLDS`**

Replace the empty stubs in `paipan/paipan/xingyun_data.py`:

```python
"""Plan 7.4 — static lookup tables for 行运 scoring engine.

Tables:
- GAN_HE_TABLE      — 5 对天干合化 (甲己→土,乙庚→金 等)
- ZHI_LIUHE_TABLE   — 6 对地支六合 (子丑→土,寅亥→木 等)
- SCORE_THRESHOLDS  — 5-bin 分类阈值

Existing wuxing tables are imported from paipan.ganzhi (GAN_WUXING /
ZHI_WUXING / WUXING_SHENG / WUXING_KE) — do NOT duplicate.

Spec: docs/superpowers/specs/2026-04-20-xingyun-engine-design.md
"""
from __future__ import annotations

# 天干五合 (Plan 7.4 §4.1) — frozenset({a, b}) → 化出五行
GAN_HE_TABLE: dict[frozenset[str], str] = {
    frozenset({'甲', '己'}): '土',
    frozenset({'乙', '庚'}): '金',
    frozenset({'丙', '辛'}): '水',
    frozenset({'丁', '壬'}): '木',
    frozenset({'戊', '癸'}): '火',
}

# 地支六合 (Plan 7.4 §4.2)
ZHI_LIUHE_TABLE: dict[frozenset[str], str] = {
    frozenset({'子', '丑'}): '土',
    frozenset({'寅', '亥'}): '木',
    frozenset({'卯', '戌'}): '火',
    frozenset({'辰', '酉'}): '金',
    frozenset({'巳', '申'}): '水',
    frozenset({'午', '未'}): '土',  # 午未传统标"火土无气"，简化标土
}

# 5-bin 分类下限阈值 (Plan 7.4 §3.4)
# >= 4 大喜; 2-3 喜; -1 to 1 平; -3 to -2 忌; <= -4 大忌
SCORE_THRESHOLDS: dict[str, int] = {
    '大喜': 4,
    '喜':   2,
    '平':   0,
    '忌':  -2,
    '大忌': -4,
}
```

- [ ] **Step 2.2: Implement `_classify_score` in `xingyun.py`**

Replace the stub in `paipan/paipan/xingyun.py`:

```python
def _classify_score(score: int) -> str:
    """5-bin classifier per spec §3.4.

    Bins: >=4 大喜, 2-3 喜, -1..1 平, -3..-2 忌, <=-4 大忌

    NOTE: SCORE_THRESHOLDS values are bin "midpoints/labels" (e.g. '忌':-2),
    NOT lower bounds. The cascade below uses literal lower bounds for the
    middle bins because the table values are misleading there. Reads as:
      >= 4   → 大喜  (uses SCORE_THRESHOLDS['大喜'])
      >= 2   → 喜    (uses SCORE_THRESHOLDS['喜'])
      >= -1  → 平    (literal lower bound)
      >= -3  → 忌    (literal lower bound; SCORE_THRESHOLDS['忌'] is -2 which
                       would silently drop -3 into 大忌 — wrong)
      else   → 大忌
    """
    if score >= SCORE_THRESHOLDS['大喜']:
        return '大喜'
    if score >= SCORE_THRESHOLDS['喜']:
        return '喜'
    if score >= -1:
        return '平'
    if score >= -3:
        return '忌'
    return '大忌'
```

- [ ] **Step 2.3: Write data validity tests**

Create `paipan/tests/test_xingyun_data.py`:

```python
"""Plan 7.4 — xingyun_data table structure validity."""
from __future__ import annotations

from paipan.xingyun_data import (
    GAN_HE_TABLE,
    ZHI_LIUHE_TABLE,
    SCORE_THRESHOLDS,
)
from paipan.xingyun import _classify_score


def test_gan_he_table_has_5_pairs():
    """5 traditional 天干五合."""
    assert len(GAN_HE_TABLE) == 5
    expected = {
        frozenset({'甲', '己'}),
        frozenset({'乙', '庚'}),
        frozenset({'丙', '辛'}),
        frozenset({'丁', '壬'}),
        frozenset({'戊', '癸'}),
    }
    assert set(GAN_HE_TABLE.keys()) == expected


def test_zhi_liuhe_table_has_6_pairs():
    """6 traditional 地支六合."""
    assert len(ZHI_LIUHE_TABLE) == 6
    expected = {
        frozenset({'子', '丑'}),
        frozenset({'寅', '亥'}),
        frozenset({'卯', '戌'}),
        frozenset({'辰', '酉'}),
        frozenset({'巳', '申'}),
        frozenset({'午', '未'}),
    }
    assert set(ZHI_LIUHE_TABLE.keys()) == expected


def test_gan_he_outputs_are_valid_wuxings():
    """Every 化出 五行 must be one of 5 元素."""
    valid = {'木', '火', '土', '金', '水'}
    for pair, wx in GAN_HE_TABLE.items():
        assert wx in valid, f'{pair} 化出 {wx!r} not a wuxing'


def test_zhi_liuhe_outputs_are_valid_wuxings():
    valid = {'木', '火', '土', '金', '水'}
    for pair, wx in ZHI_LIUHE_TABLE.items():
        assert wx in valid, f'{pair} 化出 {wx!r} not a wuxing'


def test_score_thresholds_classify_5_bins():
    """Verify _classify_score covers all 5 bins at boundaries."""
    assert _classify_score(5) == '大喜'
    assert _classify_score(4) == '大喜'
    assert _classify_score(3) == '喜'
    assert _classify_score(2) == '喜'
    assert _classify_score(1) == '平'
    assert _classify_score(0) == '平'
    assert _classify_score(-1) == '平'
    assert _classify_score(-2) == '忌'
    assert _classify_score(-3) == '忌'
    assert _classify_score(-4) == '大忌'
    assert _classify_score(-5) == '大忌'
```

- [ ] **Step 2.4: Run data validity tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun_data.py -v
```
Expected: 5 passed.

- [ ] **Step 2.5: Run full paipan + backend regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 524 + 5 = 529 passed.

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 430 passed (unchanged).

- [ ] **Step 2.6: Commit**

```bash
git add paipan/paipan/xingyun_data.py paipan/paipan/xingyun.py \
        paipan/tests/test_xingyun_data.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.4 GAN_HE + ZHI_LIUHE tables + 5-bin classifier

GAN_HE_TABLE (5 pairs): 甲己→土, 乙庚→金, 丙辛→水, 丁壬→木, 戊癸→火.
ZHI_LIUHE_TABLE (6 pairs): 子丑→土, 寅亥→木, 卯戌→火, 辰酉→金,
巳申→水, 午未→土. SCORE_THRESHOLDS define 5-bin boundaries
(>=4 大喜, 2-3 喜, -1..1 平, -3..-2 忌, <=-4 大忌). _classify_score
implements the bin lookup. 5 validity tests cover table shape +
classifier boundaries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 干 effect scoring + 干合化 detection

**Files:**
- Modify: `paipan/paipan/xingyun.py` (implement `_detect_ganhe` + `_score_gan_to_yongshen`)
- Modify: `paipan/tests/test_xingyun.py` (4 unit tests)

- [ ] **Step 3.1: Implement `_detect_ganhe`**

Replace stub in `paipan/paipan/xingyun.py`:

```python
def _detect_ganhe(gan: str, mingju_gans: list[str]) -> str | None:
    """Detect 干合化 between yun_gan and any mingju gan.

    Returns the 化出 wuxing if any 命局干 forms a 五合 with `gan`, else None.
    Simplified: any-position pair (does NOT require adjacency).
    """
    for mg in mingju_gans:
        if mg == gan:
            continue   # self-pair doesn't count
        wx = GAN_HE_TABLE.get(frozenset({gan, mg}))
        if wx:
            return wx
    return None
```

- [ ] **Step 3.2: Implement `_score_gan_to_yongshen`**

Replace stub:

```python
def _score_gan_to_yongshen(
    gan: str, ys_wuxing: str, mingju_gans: list[str]
) -> tuple[int, str, list[str]]:
    """Score 大运/流年 干 against a single 用神 五行.

    Base scoring (per spec §3.3 step 2):
      - gan_wuxing == ys_wuxing → +1 (比助)
      - gan_wuxing 生 ys_wuxing → +2
      - ys_wuxing 生 gan_wuxing → -1 (用神被泄)
      - gan_wuxing 克 ys_wuxing → -2
      - ys_wuxing 克 gan_wuxing → 0 (中性)
      - else → 0

    干合化 modifier (spec §3.3):
      - 合化 五行 == ys_wuxing → +1
      - 合化 五行 生 ys_wuxing → +1
      - 合化 五行 克 ys_wuxing → -1

    Returns (delta, human-readable reason, list of structured mechanism tags).
    """
    gw = GAN_WUXING.get(gan)
    if gw is None:
        return (0, '未知干', [])

    base_delta = 0
    base_reason = ''
    base_mech: list[str] = []

    if gw == ys_wuxing:
        base_delta = 1
        base_reason = f'{gan}比助用神'
        base_mech.append(f'干·比助')
    elif WUXING_SHENG.get(gw) == ys_wuxing:
        base_delta = 2
        base_reason = f'{gan}生用神'
        base_mech.append(f'干·相生')
    elif WUXING_SHENG.get(ys_wuxing) == gw:
        base_delta = -1
        base_reason = f'用神被{gan}泄'
        base_mech.append(f'干·相泄')
    elif WUXING_KE.get(gw) == ys_wuxing:
        base_delta = -2
        base_reason = f'{gan}克用神'
        base_mech.append(f'干·相克')
    elif WUXING_KE.get(ys_wuxing) == gw:
        base_delta = 0
        base_reason = f'用神克{gan}'
        # No mechanism tag for this — neutral

    # 干合化 modifier
    he_wx = _detect_ganhe(gan, mingju_gans)
    if he_wx:
        if he_wx == ys_wuxing or WUXING_SHENG.get(he_wx) == ys_wuxing:
            base_delta += 1
            base_reason += f'，与命局合化{he_wx}转助'
            base_mech.append(f'干·合化转助·{he_wx}')
        elif WUXING_KE.get(he_wx) == ys_wuxing:
            base_delta -= 1
            base_reason += f'，与命局合化{he_wx}反克'
            base_mech.append(f'干·合化反克·{he_wx}')

    return (base_delta, base_reason, base_mech)
```

- [ ] **Step 3.3: Write unit tests for 干 scoring + 合化**

Append to `paipan/tests/test_xingyun.py`:

```python
from paipan.xingyun import (
    _detect_ganhe,
    _score_gan_to_yongshen,
)


# === 干合化 detection ===

def test_detect_ganhe_甲己合土():
    """命局含 己 + 行运 甲 → 合化 土."""
    assert _detect_ganhe('甲', ['己', '丁', '丁']) == '土'


def test_detect_ganhe_no_match():
    """命局没有可合的 干 → None."""
    assert _detect_ganhe('甲', ['乙', '丙', '丁']) is None


# === 干 score ===

def test_score_gan_pure_sheng():
    """癸 (水) 生 甲木 用神 → +2."""
    delta, reason, mech = _score_gan_to_yongshen('癸', '木', [])
    assert delta == 2
    assert '生用神' in reason
    assert any('相生' in m for m in mech)


def test_score_gan_with_ganhe_modifier():
    """戊 vs 木 用神：基础 0 (用神克 戊)，但 命局 含 癸 → 戊癸合化火，火泄木 → 干 -1 modifier。
    
    最终 delta = 0 + 0 (用神克干 base) + (-1 if 火克木 else +1 if 火生木) 
    五行 火 生 木 (no), 火 克 木 (no, actually 火 不克 木 — 金克木). 火 与 木 关系：木生火，火 是 木的食伤 → spec 规则 "合化五行 生用神→+1"，但这里是 用神 生 合化五行 (木生火) → no rule fires → modifier 0.
    
    Wait — re-reading spec §3.3 干合化 modifier: 只看合化五行 == 用神/生用神/克用神 三种。木生火 不在这三种里 → modifier 0. So delta stays 0.
    """
    delta, reason, mech = _score_gan_to_yongshen('戊', '木', ['癸', '己', '丁'])
    # base: 木 克 戊 → 0
    # 戊+癸 合化 火, 火 不== 木, 火不生木 (金生木 actually no — 水生木), 火不克木 (金克木) → no modifier
    assert delta == 0
```

> NOTE: the third test's intricate logic is real — `戊癸 合化 火` and `木 vs 火` is actually a 用神→合化五行 泄 relation, NOT a 合化五行→用神 关系. Spec §3.3 modifier rules only fire on the latter direction, so modifier doesn't apply. If during implementation you find that "木被泄" should also count as "合化转泄"，that's a spec ambiguity worth flagging — but for v1 keep strict to spec.

- [ ] **Step 3.4: Run unit tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v
```
Expected: 3 (skeleton from Task 1) + 4 (new) = 7 passed.

- [ ] **Step 3.5: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 529 + 4 = 533 passed.

- [ ] **Step 3.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.4 干 effect scoring + 干合化 detection

_score_gan_to_yongshen returns (delta, reason, mechanisms) per spec §3.3
干 effect rules. _detect_ganhe finds 5-合 between yun_gan and any mingju
gan (any-position simplification). 4 unit tests cover sheng base case +
ganhe positive/negative + structured mechanism tag format.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 支 effect scoring + 六合 detection

**Files:**
- Modify: `paipan/paipan/xingyun.py` (implement `_detect_liuhe` + `_score_zhi_to_yongshen`)
- Modify: `paipan/tests/test_xingyun.py` (4 unit tests)

- [ ] **Step 4.1: Implement `_detect_liuhe`**

Replace stub in `paipan/paipan/xingyun.py`:

```python
def _detect_liuhe(zhi: str, mingju_zhis: list[str]) -> str | None:
    """Detect 地支六合 between yun_zhi and any mingju zhi.

    Returns the 化出 wuxing if any 命局支 forms a 六合 with `zhi`, else None.
    Simplified: any-position pair (does NOT require adjacency).
    """
    for mz in mingju_zhis:
        if mz == zhi:
            continue   # self-pair doesn't count
        wx = ZHI_LIUHE_TABLE.get(frozenset({zhi, mz}))
        if wx:
            return wx
    return None
```

- [ ] **Step 4.2: Implement `_score_zhi_to_yongshen`**

Replace stub:

```python
def _score_zhi_to_yongshen(
    zhi: str, ys_wuxing: str, mingju_zhis: list[str]
) -> tuple[int, str, list[str]]:
    """Score 大运/流年 支 (本气五行) against a single 用神 五行.

    Logic mirrors _score_gan_to_yongshen but uses ZHI_WUXING for base 五行
    and ZHI_LIUHE_TABLE for the合化 modifier.

    Returns (delta, reason, mechanisms).
    """
    zw = ZHI_WUXING.get(zhi)
    if zw is None:
        return (0, '未知支', [])

    base_delta = 0
    base_reason = ''
    base_mech: list[str] = []

    if zw == ys_wuxing:
        base_delta = 1
        base_reason = f'{zhi}比助用神'
        base_mech.append(f'支·比助')
    elif WUXING_SHENG.get(zw) == ys_wuxing:
        base_delta = 2
        base_reason = f'{zhi}生用神'
        base_mech.append(f'支·相生')
    elif WUXING_SHENG.get(ys_wuxing) == zw:
        base_delta = -1
        base_reason = f'用神被{zhi}泄'
        base_mech.append(f'支·相泄')
    elif WUXING_KE.get(zw) == ys_wuxing:
        base_delta = -2
        base_reason = f'{zhi}克用神'
        base_mech.append(f'支·相克')
    elif WUXING_KE.get(ys_wuxing) == zw:
        base_delta = 0
        base_reason = f'用神克{zhi}'

    # 六合 modifier
    he_wx = _detect_liuhe(zhi, mingju_zhis)
    if he_wx:
        if he_wx == ys_wuxing or WUXING_SHENG.get(he_wx) == ys_wuxing:
            base_delta += 1
            base_reason += f'，与命局六合化{he_wx}转助'
            base_mech.append(f'支·六合化{he_wx}·转助')
        elif WUXING_KE.get(he_wx) == ys_wuxing:
            base_delta -= 1
            base_reason += f'，与命局六合化{he_wx}反克'
            base_mech.append(f'支·六合化{he_wx}·反克')

    return (base_delta, base_reason, base_mech)
```

- [ ] **Step 4.3: Write unit tests for 支 scoring + 六合**

Append to `paipan/tests/test_xingyun.py`:

```python
from paipan.xingyun import _detect_liuhe, _score_zhi_to_yongshen


# === 六合 detection ===

def test_detect_liuhe_寅亥合木():
    """命局含 亥 + 行运 寅 → 六合 木."""
    assert _detect_liuhe('寅', ['亥', '酉', '酉']) == '木'


def test_detect_liuhe_no_match():
    """命局没有可六合的 支 → None."""
    assert _detect_liuhe('寅', ['酉', '酉', '未']) is None


# === 支 score ===

def test_score_zhi_pure_bizhu():
    """寅 (木) 比助 木 用神 → +1."""
    delta, reason, mech = _score_zhi_to_yongshen('寅', '木', [])
    assert delta == 1
    assert '比助' in reason
    assert any('比助' in m for m in mech)


def test_score_zhi_with_liuhe_modifier():
    """寅 vs 木 用神，命局含 亥 → 寅亥合化木，本气木已比助 +1, 六合化木 转助 +1 → +2."""
    delta, reason, mech = _score_zhi_to_yongshen('寅', '木', ['亥', '酉', '酉'])
    # base: 寅 (木) 比助 木 → +1
    # 寅+亥 合化 木, 木 == 用神木 → modifier +1
    assert delta == 2
    assert '六合' in reason
    assert any('六合化木' in m for m in mech)
```

- [ ] **Step 4.4: Run unit tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v
```
Expected: 7 + 4 = 11 passed.

- [ ] **Step 4.5: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 533 + 4 = 537 passed.

- [ ] **Step 4.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.4 支 effect scoring + 六合 detection

_score_zhi_to_yongshen mirrors 干 logic but uses ZHI_WUXING (本气) for
base scoring and ZHI_LIUHE_TABLE for the modifier. _detect_liuhe finds
6-合 between yun_zhi and any mingju zhi (any-position). 4 unit tests
cover bizhu base + liuhe modifier + structured mechanism tags.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `score_yun` composer + multi-element 用神

**Files:**
- Modify: `paipan/paipan/xingyun.py` (implement `_extract_yongshen_wuxings` + real `score_yun`)
- Modify: `paipan/tests/test_xingyun.py` (5 label-bin + 2 multi-element tests = 7)

- [ ] **Step 5.1: Implement `_extract_yongshen_wuxings`**

Replace stub:

```python
def _extract_yongshen_wuxings(primary: str) -> list[str]:
    """Parse '甲木 / 戊土 / 庚金' → ['木', '土', '金'].

    Rules:
      - Split on ' / ' (with surrounding spaces, matches Plan 7.3 format)
      - For each element, the last char should be a 五行 (木/火/土/金/水)
      - If element is '中和（无明显偏枯）' or has no 五行 char → return []
        (caller treats this as 中和 命局, returns 平/empty per spec §3.3)
    """
    if not primary:
        return []
    if '中和' in primary:
        return []
    valid_wuxings = {'木', '火', '土', '金', '水'}
    parts = [p.strip() for p in primary.split(' / ')]
    out: list[str] = []
    for part in parts:
        if not part:
            continue
        last_char = part[-1]
        if last_char in valid_wuxings:
            out.append(last_char)
        # else skip silently — primary may have unexpected formats
    return out
```

- [ ] **Step 5.2: Implement real `score_yun`**

Replace stub:

```python
from paipan.ganzhi import split_ganzhi


def score_yun(
    yun_ganzhi: str,
    yongshen_primary: str,
    mingju_gans: list[str],
    mingju_zhis: list[str],
) -> dict:
    """Score one 大运/流年 ganzhi against 命局 用神. Spec §5.1.

    Multi-element 用神: take max sub-score across elements (spec §5.3).
    中和 命局: return label='平', score=0, empty mechanisms (spec §3.3).
    """
    ys_wuxings = _extract_yongshen_wuxings(yongshen_primary)
    if not ys_wuxings:
        return {
            'label': '平',
            'score': 0,
            'note': '命局中和，行运无明显偏向',
            'mechanisms': [],
            'gan_effect': {'delta': 0, 'reason': ''},
            'zhi_effect': {'delta': 0, 'reason': ''},
            'winningYongshenElement': None,
        }

    yun_gan, yun_zhi = split_ganzhi(yun_ganzhi)

    # Compute sub-score for each yongshen element; pick max
    best = None  # (final_score, gan_eff, zhi_eff, winning_wuxing)
    for ys_wx in ys_wuxings:
        gan_d, gan_r, gan_m = _score_gan_to_yongshen(yun_gan, ys_wx, mingju_gans)
        zhi_d, zhi_r, zhi_m = _score_zhi_to_yongshen(yun_zhi, ys_wx, mingju_zhis)
        total = gan_d + zhi_d
        candidate = (
            total,
            {'delta': gan_d, 'reason': gan_r, 'mech': gan_m},
            {'delta': zhi_d, 'reason': zhi_r, 'mech': zhi_m},
            ys_wx,
        )
        if best is None or candidate[0] > best[0]:
            best = candidate

    final_score, gan_eff, zhi_eff, winning_wx = best

    # Note: combine gan + zhi reason, comma-separated, ≤30 字
    parts = []
    if gan_eff['reason']:
        parts.append(gan_eff['reason'])
    if zhi_eff['reason']:
        parts.append(zhi_eff['reason'])
    note = '，'.join(parts) if parts else '无显著作用'
    if len(note) > 30:
        # Trim to 30 chars on a 中文 boundary; simple cut
        note = note[:30]

    mechanisms = list(gan_eff['mech']) + list(zhi_eff['mech'])

    # Find which yongshen element name matches winning_wx
    winning_element_name = None
    for elem in (yongshen_primary or '').split(' / '):
        elem = elem.strip()
        if elem and elem.endswith(winning_wx):
            winning_element_name = elem
            break

    return {
        'label': _classify_score(final_score),
        'score': final_score,
        'note': note,
        'mechanisms': mechanisms,
        'gan_effect': {'delta': gan_eff['delta'], 'reason': gan_eff['reason']},
        'zhi_effect': {'delta': zhi_eff['delta'], 'reason': zhi_eff['reason']},
        'winningYongshenElement': winning_element_name,
    }
```

- [ ] **Step 5.3: Write 5-label-bin tests**

Append to `paipan/tests/test_xingyun.py`:

```python
from paipan.xingyun import score_yun


def test_score_yun_label_大喜():
    """甲寅 vs 甲木 用神: 干甲比助 (+1) + 支寅比助 (+1) +
    寅+命局亥 六合化木转助 (+1) + 干甲+命局己 合化土反克 (-1) → +2... 喜 not 大喜 :(
    Need a cleaner case. Try: 甲寅 vs 甲木 用神, 命局支含亥 (寅亥合木) + no 命局己 → 
    干 +1 (比助), 支 +1 + 1 (比助 + 六合化木) = +2 → final +3 喜.
    Still not 大喜. To hit 大喜 we need +4: try 癸卯 vs 木 用神, 命局含亥 (卯亥不合).
    Actually 癸 (水) 生 木 +2; 卯 (木) 比助 +1. Total +3 → 喜.
    Need at least +4: 甲寅 vs 木, 命局亥 (六合木 +1) + 命局戊 (甲戊不合) →
    干 +1 (比助), 支 +1 + 1 = +2 → +3 still 喜.
    Hmm — 大喜 requires 干生 (+2) + 支生 (+2) = +4. That's 癸亥 vs 木 用神.
    癸 生 木 +2; 亥 (水) 生 木 +2. Total +4 → 大喜.
    """
    out = score_yun('癸亥', '甲木', [], [])
    assert out['label'] == '大喜'
    assert out['score'] >= 4


def test_score_yun_label_喜():
    """甲寅 vs 甲木: 比助 +1 + 比助 +1 = +2 → 喜."""
    out = score_yun('甲寅', '甲木', [], [])
    assert out['label'] == '喜'
    assert 2 <= out['score'] <= 3


def test_score_yun_label_平():
    """戊辰 vs 甲木: 用神克 戊 (0) + 用神克 辰 (0) = 0 → 平."""
    out = score_yun('戊辰', '甲木', [], [])
    assert out['label'] == '平'
    assert -1 <= out['score'] <= 1


def test_score_yun_label_忌():
    """丁巳 vs 甲木: 用神生丁 -1 + 用神生巳火 -1 = -2 → 忌."""
    out = score_yun('丁巳', '甲木', [], [])
    assert out['label'] == '忌'
    assert -3 <= out['score'] <= -2


def test_score_yun_label_大忌():
    """庚申 vs 甲木: 庚克木 -2 + 申金克木 -2 = -4 → 大忌."""
    out = score_yun('庚申', '甲木', [], [])
    assert out['label'] == '大忌'
    assert out['score'] <= -4
```

- [ ] **Step 5.4: Write multi-element 用神 tests**

Append:

```python
def test_multi_element_yongshen_takes_max_score():
    """用神 '甲木 / 戊土 / 庚金'，行运 庚申:
       - vs 木: 庚克木 -2, 申克木 -2 → -4
       - vs 土: 庚 not directly act on 土 (土生庚) → 用神土被泄 -1, 申 同 → -1
       - vs 金: 庚比助 +1, 申比助 +1 → +2
       max = +2 → 喜
    """
    out = score_yun('庚申', '甲木 / 戊土 / 庚金', [], [])
    assert out['label'] == '喜'
    assert out['score'] >= 2


def test_multi_element_winning_element_recorded():
    """For the same case, winningYongshenElement should name 庚金."""
    out = score_yun('庚申', '甲木 / 戊土 / 庚金', [], [])
    assert out['winningYongshenElement'] == '庚金'


def test_score_yun_中和_命局_returns_平():
    """用神 = '中和（无明显偏枯）' → 平 with empty mechanisms."""
    out = score_yun('庚申', '中和（无明显偏枯）', [], [])
    assert out['label'] == '平'
    assert out['score'] == 0
    assert out['mechanisms'] == []
    assert '中和' in out['note']
```

- [ ] **Step 5.5: Run unit tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v
```
Expected: 11 + 8 = 19 passed.

> **If any label-bin test fails**: print the actual `score` and re-derive the expected math. The thresholds are at boundaries (e.g. score=2 → 喜) — small math errors slide a case across a boundary. Do NOT silently relax the assertion; either fix the test math or fix the scoring logic.

- [ ] **Step 5.6: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 537 + 8 = 545 passed.

- [ ] **Step 5.7: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.4 score_yun composer + multi-element 用神

_extract_yongshen_wuxings parses 'A / B / C' format. score_yun computes
per-element sub-scores and takes max (spec §5.3). 中和 命局 short-circuits
to '平' with empty mechanisms. note caps at 30 chars; mechanisms is the
union of 干+支 tags. winningYongshenElement records which element won
the multi-element race. 8 tests cover 5 label bins + 2 multi-element +
1 中和 fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `build_xingyun` batch + currentDayunIndex + 10 golden cases

**Files:**
- Modify: `paipan/paipan/xingyun.py` (implement real `build_xingyun`)
- Modify: `paipan/tests/test_xingyun.py` (3 batch + 1 None + 10 golden)

- [ ] **Step 6.1: Implement real `build_xingyun`**

Replace stub:

```python
def build_xingyun(
    dayun: dict,
    yongshen_detail: dict,
    mingju_gans: list[str],
    mingju_zhis: list[str],
    current_year: int,
) -> dict:
    """Batch entry. Spec §5.2.

    Iterates 8 大运 + each大运's 10 流年, scoring each via score_yun.
    Locates currentDayunIndex by which entry's [startYear, endYear]
    contains current_year (None if none match).
    """
    yongshen_primary = (yongshen_detail or {}).get('primary', '')

    # 中和 命局 → empty result (spec §3.3 末尾 + §11 risk #5)
    if not _extract_yongshen_wuxings(yongshen_primary):
        return {
            'dayun': [],
            'liunian': {},
            'currentDayunIndex': None,
            'yongshenSnapshot': yongshen_primary,
        }

    dayun_list = (dayun or {}).get('list', [])
    out_dayun: list[dict] = []
    out_liunian: dict[str, list[dict]] = {}
    current_idx: int | None = None

    for entry in dayun_list:
        idx = entry['index']
        ganzhi = entry['ganzhi']
        start_year = entry['startYear']
        end_year = entry['endYear']

        # Score this 大运
        score = score_yun(ganzhi, yongshen_primary, mingju_gans, mingju_zhis)
        out_dayun.append({
            'index': idx,
            'ganzhi': ganzhi,
            'startAge': entry['startAge'],
            'startYear': start_year,
            'endYear': end_year,
            'label': score['label'],
            'score': score['score'],
            'note': score['note'],
            'mechanisms': score['mechanisms'],
            'isCurrent': start_year <= current_year <= end_year,
        })

        if start_year <= current_year <= end_year:
            current_idx = idx

        # Score 10 流年 in this 大运
        ln_entries = []
        for ly in entry.get('liunian', []):
            ly_score = score_yun(
                ly['ganzhi'], yongshen_primary, mingju_gans, mingju_zhis
            )
            ln_entries.append({
                'year': ly['year'],
                'ganzhi': ly['ganzhi'],
                'age': ly['age'],
                'label': ly_score['label'],
                'score': ly_score['score'],
                'note': ly_score['note'],
                'mechanisms': ly_score['mechanisms'],
            })
        out_liunian[str(idx)] = ln_entries

    return {
        'dayun': out_dayun,
        'liunian': out_liunian,
        'currentDayunIndex': current_idx,
        'yongshenSnapshot': yongshen_primary,
    }
```

- [ ] **Step 6.2: Write batch + None tests**

Append to `paipan/tests/test_xingyun.py`:

```python
from paipan.xingyun import build_xingyun


def test_build_xingyun_returns_8_dayun():
    """The standard chart should produce 8 大运 entries."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert len(xy['dayun']) == 8
    for entry in xy['dayun']:
        assert 'label' in entry
        assert 'score' in entry
        assert 'note' in entry
        assert entry['label'] in {'大喜', '喜', '平', '忌', '大忌'}


def test_build_xingyun_currentDayunIndex_is_set():
    """For 1993 birth + 2026 current_year, current大运 should be in [0,7]."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert xy['currentDayunIndex'] is not None
    assert 0 <= xy['currentDayunIndex'] <= 7


def test_build_xingyun_liunian_keyed_by_dayun_index():
    """liunian dict keys are str(0)..str(7) and each list has 10 entries."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert set(xy['liunian'].keys()) == {str(i) for i in range(8)}
    for k, ln_list in xy['liunian'].items():
        assert len(ln_list) == 10, f'大运 {k} should have 10 流年, got {len(ln_list)}'


def test_build_xingyun_中和_命局_returns_empty():
    """If yongshen_detail.primary contains '中和', dayun and liunian should be empty."""
    fake_yongshen = {'primary': '中和（无明显偏枯）'}
    fake_dayun = {'list': []}   # any shape — should be ignored
    out = build_xingyun(fake_dayun, fake_yongshen, [], [], 2026)
    assert out['dayun'] == []
    assert out['liunian'] == {}
    assert out['currentDayunIndex'] is None
    assert '中和' in out['yongshenSnapshot']
```

- [ ] **Step 6.3: Write 10 golden integration tests**

Append:

```python
import pytest


GOLDEN_XINGYUN_CASES = [
    {
        'label': '丁火六月_身弱_食神格',
        'input': dict(year=1993, month=7, day=15, hour=14, minute=30,
                       gender='male', city='长沙'),
    },
    {
        'label': '丙火五月_身强',
        'input': dict(year=1990, month=5, day=12, hour=12, minute=0,
                       gender='male', city='北京'),
    },
    {
        'label': '甲木八月',
        'input': dict(year=2003, month=8, day=29, hour=8, minute=27,
                       gender='male', city='上海'),
    },
    {
        'label': '癸水正月',
        'input': dict(year=1985, month=1, day=5, hour=23, minute=45,
                       gender='female', city='广州'),
    },
    {
        'label': '辛金腊月',
        'input': dict(year=1976, month=11, day=30, hour=6, minute=15,
                       gender='female', city='成都'),
    },
    {
        'label': '戊土三月',
        'input': dict(year=2000, month=2, day=29, hour=16, minute=0,
                       gender='male', city='深圳'),
    },
    {
        'label': '丁火_寅午戌_三合',
        'input': dict(year=1984, month=10, day=5, hour=14, minute=0,
                       gender='male', city='北京'),
    },
    {
        'label': '乙木_寅卯辰_三会',
        'input': dict(year=1995, month=3, day=21, hour=12, minute=0,
                       gender='female', city='上海'),
    },
    {
        'label': '日主合化',
        'input': dict(year=1988, month=6, day=10, hour=9, minute=0,
                       gender='male', city='北京'),
    },
    {
        'label': '从格疑似',
        'input': dict(year=1974, month=8, day=8, hour=8, minute=0,
                       gender='female', city='昆明'),
    },
]


@pytest.mark.parametrize('case', GOLDEN_XINGYUN_CASES,
                          ids=[c['label'] for c in GOLDEN_XINGYUN_CASES])
def test_xingyun_golden_structural(case):
    """Each golden chart produces a structurally sound xingyun dict.

    Asserts (no specific label values — those are not oracle truths):
      - xingyun is a dict with required top-level keys
      - dayun has 8 entries (or 0 if 中和 命局)
      - if dayun non-empty: liunian has 8 keys × 10 entries each
      - currentDayunIndex is in [0,7] or None
      - every dayun/liunian entry has label in valid set
      - mechanisms list is well-formed (each tag matches expected pattern)
    """
    out = compute(**case['input'])
    xy = out.get('xingyun')
    assert xy is not None, f"{case['label']}: missing xingyun"
    assert 'dayun' in xy
    assert 'liunian' in xy
    assert 'currentDayunIndex' in xy
    assert 'yongshenSnapshot' in xy

    valid_labels = {'大喜', '喜', '平', '忌', '大忌'}

    if xy['dayun']:   # non-中和 case
        assert len(xy['dayun']) == 8, \
            f"{case['label']}: expected 8 dayun, got {len(xy['dayun'])}"
        for d in xy['dayun']:
            assert d['label'] in valid_labels
            assert isinstance(d['mechanisms'], list)
        assert len(xy['liunian']) == 8
        for k, ln_list in xy['liunian'].items():
            assert len(ln_list) == 10
            for ly in ln_list:
                assert ly['label'] in valid_labels

        cur = xy['currentDayunIndex']
        if cur is not None:
            assert 0 <= cur <= 7
    else:
        # 中和 命局 — verify empty consistency
        assert xy['liunian'] == {}
        assert xy['currentDayunIndex'] is None
```

- [ ] **Step 6.4: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v
```
Expected: 19 + 4 (batch) + 10 (golden) = 33 passed.

- [ ] **Step 6.5: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 545 + 14 = 559 passed.

> **If a golden case fails**: inspect actual vs expected. If a chart's primary is unexpectedly "中和" (some 1985 charts with weak day master might fall here), that's a real Plan 7.3 boundary case worth disclosing — accept that case's `dayun=[]` result. Do NOT silently force non-empty.

- [ ] **Step 6.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.4 build_xingyun batch + 10 golden integration

build_xingyun iterates 8 大运 + 80 流年 calling score_yun per entry.
currentDayunIndex located by [startYear, endYear] containing now.year.
中和 命局 short-circuits to empty dayun/liunian (spec §3.3 + §11 #5).
4 batch tests + 10 parametrized golden cases assert structural soundness.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: context.py 渲染 + browser smoke

**Files:**
- Modify: `server/app/prompts/context.py` (add `_render_xingyun_block` + call after _render_yongshen_block)
- Create: `server/tests/unit/test_prompts_context_xingyun.py` (4 tests)

- [ ] **Step 7.1: Read current `context.py` to find Plan 7.3 insertion point**

Read `server/app/prompts/context.py`. Find:
- `_render_yongshen_block` definition (Plan 7.3 added it)
- The line that calls `lines.extend(_render_yongshen_block(p))`

The new `_render_xingyun_block` will be:
- Defined right after `_render_yongshen_block`
- Called via `lines.extend(_render_xingyun_block(p))` immediately after the yongshen block call

- [ ] **Step 7.2: Add `_render_xingyun_block` helper**

After `_render_yongshen_block` in `server/app/prompts/context.py`:

```python
_XINGYUN_GLYPH = {
    '大喜': '⭐⭐',
    '喜':   '⭐',
    '平':   '·',
    '忌':   '⚠',
    '大忌': '⚠⚠',
}


def _render_xingyun_block(paipan: dict) -> list[str]:
    """Plan 7.4 §6.2 — render 行运 评分块.

    Renders 8 大运 (with ★ marker on current) + the 10 流年 within the
    current 大运 (other 大运's 流年 collapsed). Returns [] when xingyun
    is absent or all-平 (中和 命局 fallback).
    """
    xy = paipan.get('xingyun') or {}
    dayun_list = xy.get('dayun') or []
    if not dayun_list:
        return []

    # If every 大运 is '平' AND yongshenSnapshot 含 '中和', collapse entirely
    if (all(d.get('label') == '平' for d in dayun_list)
            and '中和' in (xy.get('yongshenSnapshot') or '')):
        return []

    snapshot = xy.get('yongshenSnapshot', '?')
    lines = [f'行运（对照命局用神 {snapshot}）：']
    cur_idx = xy.get('currentDayunIndex')

    for entry in dayun_list:
        marker = '★ ' if entry['index'] == cur_idx else '  '
        end_age = entry['startAge'] + (entry['endYear'] - entry['startYear'])
        glyph = _XINGYUN_GLYPH.get(entry['label'], '?')
        lines.append(
            f"  {marker}{entry['startAge']}-{end_age}岁  "
            f"{entry['ganzhi']}  {glyph}{entry['label']}  {entry['note']}"
        )

    if cur_idx is not None:
        ln_list = xy.get('liunian', {}).get(str(cur_idx), [])
        if ln_list:
            cur_dy = next(
                (d for d in dayun_list if d['index'] == cur_idx),
                None,
            )
            if cur_dy:
                lines.append(f'  ↳ 当前大运 {cur_dy["ganzhi"]} 内流年明细：')
                for ly in ln_list:
                    glyph = _XINGYUN_GLYPH.get(ly['label'], '?')
                    lines.append(
                        f"      {ly['year']}({ly['ganzhi']},{ly['age']}岁)  "
                        f"{glyph}{ly['label']}  {ly['note']}"
                    )

    return lines
```

- [ ] **Step 7.3: Insert call to `_render_xingyun_block`**

Find the line `lines.extend(_render_yongshen_block(p))` in `compact_chart_context`. Add immediately after:

```python
# Plan 7.4: 行运 evaluation block
lines.extend(_render_xingyun_block(p))
```

- [ ] **Step 7.4: Write 4 render tests**

Create `server/tests/unit/test_prompts_context_xingyun.py`:

```python
"""Plan 7.4 §6.2 — compact_chart_context renders 行运 block."""
from __future__ import annotations

from app.prompts.context import compact_chart_context


def _sample_paipan(xingyun=None):
    return {
        'sizhu': {'year': '癸酉', 'month': '己未', 'day': '丁酉', 'hour': '丁未'},
        'rizhu': '丁',
        'yongshen': '甲木',
        'yongshenDetail': {
            'primary': '甲木',
            'primaryReason': '以调候为主',
            'candidates': [],
            'warnings': [],
        },
        'xingyun': xingyun,
    }


def _make_xingyun_with_label(label='喜'):
    return {
        'yongshenSnapshot': '甲木',
        'currentDayunIndex': 3,
        'dayun': [
            {'index': i, 'ganzhi': f'X{i}', 'startAge': 4 + i*10,
             'startYear': 1997 + i*10, 'endYear': 2006 + i*10,
             'label': label, 'score': 2,
             'note': f'测试note{i}', 'mechanisms': [], 'isCurrent': i == 3}
            for i in range(8)
        ],
        'liunian': {
            str(i): [
                {'year': 1997 + i*10 + j, 'ganzhi': f'L{j}', 'age': 5 + i*10 + j,
                 'label': '平', 'score': 0,
                 'note': f'流年{j}', 'mechanisms': []}
                for j in range(10)
            ]
            for i in range(8)
        },
    }


def test_renders_行运_block_when_xingyun_present():
    xy = _make_xingyun_with_label('喜')
    text = compact_chart_context(_sample_paipan(xy))
    assert '行运（对照命局用神 甲木）' in text
    # All 8 大运 appear
    for i in range(8):
        assert f'X{i}' in text


def test_renders_star_marker_for_current_dayun():
    xy = _make_xingyun_with_label('喜')
    text = compact_chart_context(_sample_paipan(xy))
    # ★ should appear on the current dayun (index 3, ganzhi X3)
    lines = text.splitlines()
    star_lines = [l for l in lines if '★' in l and 'X3' in l]
    assert len(star_lines) == 1, f'expected one star line on X3, found {star_lines}'


def test_renders_glyph_for_each_label_bin():
    """Build xingyun with a different label per dayun and verify each glyph appears."""
    labels_in_order = ['大喜', '喜', '平', '忌', '大忌', '喜', '平', '喜']
    xy = _make_xingyun_with_label('喜')
    for i, lbl in enumerate(labels_in_order):
        xy['dayun'][i]['label'] = lbl
    text = compact_chart_context(_sample_paipan(xy))
    # All 5 distinct glyphs should appear
    for glyph in ['⭐⭐', '⭐', '·', '⚠', '⚠⚠']:
        assert glyph in text, f'glyph {glyph!r} missing from rendered text'


def test_skips_block_when_xingyun_absent():
    """No xingyun → no 行运 line at all."""
    paipan = _sample_paipan(xingyun=None)
    text = compact_chart_context(paipan)
    assert '行运（' not in text


def test_skips_block_when_xingyun_dayun_empty_中和():
    """中和 命局 → all-平 collapse → no 行运 block."""
    xy = {
        'yongshenSnapshot': '中和（无明显偏枯）',
        'currentDayunIndex': None,
        'dayun': [],
        'liunian': {},
    }
    paipan = _sample_paipan(xy)
    text = compact_chart_context(paipan)
    assert '行运（' not in text
```

- [ ] **Step 7.5: Run render tests**

```
uv run --package server pytest -q server/tests/unit/test_prompts_context_xingyun.py -v
```
Expected: 5 passed (4 from spec + 1 中和 fallback bonus).

- [ ] **Step 7.6: Run full backend regression**

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 430 + 5 = 435 passed.

- [ ] **Step 7.7: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 559 passed (unchanged from Task 6 — Task 7 is server-side only).

- [ ] **Step 7.8: Run frontend tests**

```
cd frontend && node --test tests/*.mjs
```
Expected: 51 passed (unchanged — frontend zero-touch).

- [ ] **Step 7.9: Browser smoke**

Boot dev servers (in two terminals or background):

```bash
# Terminal A
cd /Users/veko/code/usual/bazi-analysis/server && \
  uv run --package server --with 'uvicorn[standard]' \
  python -m uvicorn app.main:app --port 3101 --host 127.0.0.1

# Terminal B
cd /Users/veko/code/usual/bazi-analysis/frontend && npm run dev
```

In browser at `http://localhost:5173`:
1. Register or log in (use the live app's actual auth — it's 手机号 + 短信验证码; the surfaced `[DEV] code: NNNN` works for test).
2. Submit form: year=1993 month=7 day=15 hour=14 minute=30 gender=male city=长沙.
3. Land on shell. Verify chart panel **looks identical to Plan 7.3 smoke** (no new visual elements).
4. Send chat: **"我未来十年怎么样？"** → assistant should reference 大运 评分 (e.g. "乙卯 喜 / 甲寅 大喜")
5. Send chat: **"2026 年怎么样？"** → assistant should reference the 2026 流年 评分 line
6. Send chat: **"2030 年呢？"** → assistant should reference the 2030 流年 评分

Save screenshot of shell after step 5 to `.claire/plan74-xingyun-smoke.png`.

- [ ] **Step 7.10: Commit (only if no regressions)**

```bash
git add server/app/prompts/context.py \
        server/tests/unit/test_prompts_context_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 7.4 render 行运 block in compact_chart_context

New _render_xingyun_block helper produces 8 大运 lines (★ marker on
current) + 10 流年 lines for the current 大运 (others collapsed). Each
line has age range + ganzhi + label glyph + ≤30字 note. Renders nothing
when xingyun is absent OR all-平 中和 命局 fallback. 5 tests.

Browser smoke verified: chat answers "未来十年" / "2026年" / "2030年"
with explicit references to 大运/流年 评分.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If smoke reveals a regression (frontend broke, or LLM ignores 行运 context, or render formatting wrong), file a fix as an additional commit on this same task before reporting DONE.

---

## Self-Review Notes (for the executing engineer)

If any of these surface post-implementation, file a Plan 7.4.1 follow-up rather than fixing inline:

1. **任意位置合化的简化**：spec §4.1 / §4.2 已 disclose。如果 golden case 暴露明显的"远距离合化"误判（e.g. 年柱合时柱），考虑加 adjacency 约束。

2. **多元素用神取 max 的偏乐观倾向**：spec §11 risk #2 已 disclose。如果用户反馈"大运评分太松"，可以改成 weighted average 或保留 all-element scores 让 LLM 自己合成。

3. **mechanism tag 命名空间**：v1 用 `干·相生` / `支·六合化木·转助` 等中文 tag。如果以后要做 mechanism-based 的查询/分析，可能需要 normalize 成 enum。

4. **Note 的 30 字 cut**：Step 5.2 的 `note[:30]` 是简单截断。如果出现 truncation 难看（半个汉字 / 句号丢失），可以换"在标点边界截断"。

5. **流月评分**：spec §2 明确不做。但用户可能问"我下个月怎么样"，LLM 现在只能从流年推。如果 v1 一段时间后用户反馈强烈，可以加流月 layer（粒度 ×12 → context 风险大）。

6. **当前大运 currentDayunIndex == None**：理论上 1993 出生 + 2026 应该总在 [0,7] 内。但极幼年（出生未起运）或极高龄（>83 岁）的盘可能 outside range。Step 6.1 的 `if start_year <= current_year <= end_year` 已正确返回 None；render 层在 None 时不展开流年明细，行为正确。
