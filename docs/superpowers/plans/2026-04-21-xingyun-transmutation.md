# Plan 7.5b — 行运用神变化 (大运/流年触发) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-entry transmutation 检测 on 大运/流年 entries (8 + 80 = 88 evaluations)。复用 Plan 7.5a `_detect_transmutation` 引擎核心，加 dedup 层避免重复 echo Plan 7.5a 静态 + 大运 transmuted。前端零改动。

**Architecture:** 全部新增逻辑在 `paipan/paipan/xingyun.py` 内部 (~150 行：2 helpers + build_xingyun extension)。`compute.py` 调用时构造 `chart_context` 参数（含 month_zhi/rizhu_gan/force/gan_he/original_geju_name）。`server/app/prompts/context.py` `_render_xingyun_block` 加 transmuted 段渲染。无新模块，无新数据表。

**Tech Stack:** Python 3.12 · pytest. 无新依赖。

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-21-xingyun-transmutation-design.md`. plan 与 spec 不符 inline 修 plan + commit 标注 catch.
2. **Plan 7.4 contract 不破**: `score_yun` / `build_xingyun` 输出字段 shape 仍同 (label/score/note/mechanisms/isCurrent/index/...)，只**新增** `transmuted` 字段。33 个 score golden case 仍绿。
3. **Plan 7.5a 静态 transmutation 不重复**: 命局自带合局的盘 (e.g. 1980-02-12)，`yongshenDetail.transmuted` 仍触发，但 `xingyun.dayun[*].transmuted` 都 None (dedup 保证)。
4. **Backward compat**: 调 `build_xingyun(...)` 不传 `chart_context=` 时，行为 = Plan 7.4 ship (无 transmuted 字段)。
5. **前端零改动**: chartUi.js / Shell.jsx / 任何 frontend/src/ 不动。
6. **Tests stay green baseline**: 589 paipan + 437 server + 51 frontend。

## 目录最终形态

```
paipan/
├── paipan/
│   ├── xingyun.py                  # MODIFY (~150 行新代码)
│   │     + _is_same_combo(a, b)
│   │     + _detect_xingyun_transmutation(...)
│   │     + build_xingyun() 加 chart_context kwarg + per-entry transmuted
│   ├── compute.py                  # MODIFY (~5 行)
│   │     + 构造 chart_context dict from analysis 输出
│   ├── yongshen.py                 # 不动 — _detect_transmutation + _compute_virtual_geju_name 复用
│   └── (其他不动)
└── tests/
    └── test_xingyun.py             # MODIFY (+19 tests)

server/
├── app/prompts/context.py          # MODIFY — _render_xingyun_block 加 transmuted 段
└── tests/unit/
    └── test_prompts_context_xingyun.py  # MODIFY (+2 render tests)
```

无新文件，无新依赖，无前端 / DB / route 改动。

## Task 列表预览

- **Task 1** — Skeleton: stub helpers + `build_xingyun` 加 chart_context 参数 + compute.py wire + 1 skeleton test
- **Task 2** — `_is_same_combo` + 3 unit tests
- **Task 3** — `_detect_xingyun_transmutation` (大运 + 流年 dedup) + 8 unit tests
- **Task 4** — `build_xingyun` 集成 (per-entry transmutation) + 3 集成 + 5 verified golden tests
- **Task 5** — `context.py` render + 2 render tests + browser smoke

每 task 独立 commit + push。Task 4 含 verification-first workflow (codex 必须先验证 5 个 golden inputs 真触发)。

---

## Task 1: Skeleton + chart_context wire

**Files:**
- Modify: `paipan/paipan/xingyun.py` (加 stub 函数 + build_xingyun 参数)
- Modify: `paipan/paipan/compute.py` (构造 chart_context)
- Modify: `paipan/tests/test_xingyun.py` (1 skeleton test)

- [ ] **Step 1.1: Add stub functions to `paipan/paipan/xingyun.py`**

After the existing imports section, add the new helpers as stubs:

```python
from paipan.yongshen import _detect_transmutation


def _is_same_combo(a: dict | None, b: dict | None) -> bool:
    """Plan 7.5b §3.3 — Compare two transmuted dicts for same trigger combo.
    
    Returns True iff both non-None and trigger.type + zhi_list (set) match.
    Filled in Task 2.
    """
    return False   # stub


def _detect_xingyun_transmutation(
    month_zhi: str,
    base_mingju_zhis: list[str],
    dayun_zhi: str,
    liunian_zhi: str | None,
    *,
    rizhu_gan: str,
    force: dict,
    gan_he: dict,
    original_geju_name: str,
    baseline_transmuted: dict | None = None,
) -> dict | None:
    """Plan 7.5b §3.3 — 检测大运/流年 transmutation, 含 dedup logic.
    
    Filled in Task 3.
    """
    return None   # stub
```

- [ ] **Step 1.2: Modify `build_xingyun` signature to accept `chart_context`**

Find the existing `build_xingyun` definition (Plan 7.4 ship). Update signature with new keyword-only param (default None preserves backward compat):

```python
def build_xingyun(
    dayun: dict,
    yongshen_detail: dict,
    mingju_gans: list[str],
    mingju_zhis: list[str],
    current_year: int,
    *,
    chart_context: dict | None = None,    # NEW (Plan 7.5b)
) -> dict:
    """Batch entry. Spec §5.2.
    
    chart_context (optional dict, keys: month_zhi, rizhu_gan, force, gan_he,
    original_geju_name) enables per-entry transmutation detection. None →
    Plan 7.4 行为 (无 transmuted 字段)。
    """
    # 原有 Plan 7.4 body 不变
    ...
```

**Body 不动** — Task 4 才在 entry 字典里挂 transmuted 字段。Task 1 只改签名。

- [ ] **Step 1.3: Update `paipan/paipan/compute.py`**

Find the existing `build_xingyun(...)` call (Plan 7.4 ship + Plan 7.5a 改后)。在 build_xingyun 调用前构造 chart_context：

```python
# Plan 7.5b: 构造 chart_context for transmutation detection
chart_context = None
sizhu = result.get("sizhu") or {}
month_str = sizhu.get("month")
day_str = sizhu.get("day")
if month_str and day_str:
    # analysis was already computed earlier in compute.py for Plan 7.3 yongshen
    # find the existing analysis variable name (likely 'analysis')
    chart_context = {
        'month_zhi': month_str[1],
        'rizhu_gan': day_str[0],
        'force': analysis.get("force") or {},
        'gan_he': analysis.get("ganHe") or {},
        'original_geju_name': (analysis.get("geJu") or {}).get("mainCandidate", {}).get("name", '') or '',
    }

result["xingyun"] = build_xingyun(
    dayun=result["dayun"],
    yongshen_detail=result["yongshenDetail"],
    mingju_gans=mingju_gans,
    mingju_zhis=mingju_zhis,
    current_year=now.year,
    chart_context=chart_context,    # NEW
)
```

**Verify first**: Read compute.py to find the actual variable name for the `analysis` result (Plan 7.3 work introduced it). If named differently (e.g. `analyzed`, `analysis_result`), use the correct name.

- [ ] **Step 1.4: Write 1 skeleton test in `paipan/tests/test_xingyun.py`**

Append:

```python
def test_xingyun_dayun_transmuted_field_present_default_none():
    """Plan 7.5b §3.4: each xingyun.dayun entry has 'transmuted' field; 标准 1993 chart 全 None.
    
    Stubs return None → no transmutation触发 → all entries 'transmuted': None.
    """
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    for d in xy['dayun']:
        assert 'transmuted' in d, f"dayun[{d['index']}] missing 'transmuted' field"
        assert d['transmuted'] is None
    for k, ln_list in xy['liunian'].items():
        for ly in ln_list:
            assert 'transmuted' in ly, f"liunian[{k}] entry missing 'transmuted'"
            assert ly['transmuted'] is None
```

> **NOTE**: This test will FAIL after Task 1 because Task 1 only adds chart_context param + stubs; `build_xingyun` body still doesn't add 'transmuted' field. The test will pass after Task 4. Mark this test with `pytest.mark.skip(reason="Awaits Task 4")` for now, OR write a more limited version that only verifies chart_context plumbing reached build_xingyun (e.g. via debug log / monkeypatch).

**Simpler version for Task 1** (verifies plumbing only):

```python
def test_xingyun_chart_context_plumbing():
    """Plan 7.5b §5.2: compute.py constructs chart_context and passes to build_xingyun.
    
    Verify by patching build_xingyun and capturing the call args.
    """
    import paipan.compute as compute_mod
    captured = {}
    original_build = compute_mod.build_xingyun
    def spy(**kwargs):
        captured.update(kwargs)
        return original_build(**kwargs)
    compute_mod.build_xingyun = spy
    try:
        compute_mod.compute(year=1993, month=7, day=15, hour=14, minute=30,
                             gender='male', city='长沙')
    finally:
        compute_mod.build_xingyun = original_build
    
    assert 'chart_context' in captured, 'compute.py should pass chart_context kwarg'
    cc = captured['chart_context']
    assert cc is not None
    assert cc['month_zhi'] == '未'   # 1993-07-15 month柱己未 → 月支未
    assert cc['rizhu_gan'] == '丁'    # 1993-07-15 丁酉日
    assert 'force' in cc
    assert 'gan_he' in cc
    assert 'original_geju_name' in cc
```

- [ ] **Step 1.5: Run skeleton test + full regression**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py::test_xingyun_chart_context_plumbing -v
```
Expected: 1 passed.

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 589 + 1 = 590 passed (no Plan 7.3/7.4/7.5a regressions).

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 437 passed (server unchanged).

- [ ] **Step 1.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/paipan/compute.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5b skeleton — chart_context wire + stub helpers

Add _is_same_combo + _detect_xingyun_transmutation stubs in xingyun.py
(filled in Tasks 2-3). build_xingyun() signature gains optional
chart_context kwarg (default None preserves Plan 7.4 contract).
compute.py constructs chart_context from existing analysis dict and
passes it.

1 skeleton test verifies compute.py plumbing reaches build_xingyun
with the expected dict keys (month_zhi/rizhu_gan/force/gan_he/
original_geju_name).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `_is_same_combo` + 3 unit tests

**Files:**
- Modify: `paipan/paipan/xingyun.py` (replace stub with implementation)
- Modify: `paipan/tests/test_xingyun.py` (3 unit tests)

- [ ] **Step 2.1: Implement `_is_same_combo`**

Replace the stub:

```python
def _is_same_combo(a: dict | None, b: dict | None) -> bool:
    """Plan 7.5b §3.3 — Compare two transmuted dicts for same trigger combo.
    
    True iff both non-None AND trigger.type + zhi_list (as set) match.
    Used for dedup: 大运 transmuted vs 命局-only baseline; 流年 vs 大运.
    """
    if not a or not b:
        return False
    if a['trigger']['type'] != b['trigger']['type']:
        return False
    return set(a['trigger']['zhi_list']) == set(b['trigger']['zhi_list'])
```

- [ ] **Step 2.2: Write 3 unit tests**

Append to `paipan/tests/test_xingyun.py`:

```python
from paipan.xingyun import _is_same_combo


def test_is_same_combo_both_none_returns_false():
    assert _is_same_combo(None, None) is False
    assert _is_same_combo({'trigger': {}}, None) is False
    assert _is_same_combo(None, {'trigger': {}}) is False


def test_is_same_combo_same_type_same_zhi_returns_true():
    a = {'trigger': {'type': 'sanHe', 'zhi_list': ['亥', '卯', '未']}}
    b = {'trigger': {'type': 'sanHe', 'zhi_list': ['未', '亥', '卯']}}   # 顺序无关
    assert _is_same_combo(a, b) is True


def test_is_same_combo_different_type_or_zhi_returns_false():
    a = {'trigger': {'type': 'sanHe', 'zhi_list': ['亥', '卯', '未']}}
    b = {'trigger': {'type': 'sanHui', 'zhi_list': ['亥', '卯', '未']}}   # 不同 type
    assert _is_same_combo(a, b) is False
    
    c = {'trigger': {'type': 'sanHe', 'zhi_list': ['申', '子', '辰']}}   # 不同 zhi
    assert _is_same_combo(a, c) is False
```

- [ ] **Step 2.3: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v -k "is_same_combo"
```
Expected: 3 passed.

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 590 + 3 = 593 passed.

- [ ] **Step 2.4: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5b _is_same_combo dedup helper + 3 tests

Implementation per spec §3.3: compares two transmuted dicts; True iff
both non-None AND trigger.type + zhi_list (as set, order-insensitive)
match. Used downstream by _detect_xingyun_transmutation to dedup against
Plan 7.5a static and 大运-level transmutation echos.

3 tests cover: both-None / same-combo / different-combo branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `_detect_xingyun_transmutation` + 8 unit tests

**Files:**
- Modify: `paipan/paipan/xingyun.py` (replace stub with implementation)
- Modify: `paipan/tests/test_xingyun.py` (8 unit tests: 4 大运 + 4 流年 dedup)

- [ ] **Step 3.1: Implement `_detect_xingyun_transmutation`**

Replace the stub with the canonical implementation per spec §3.3:

```python
def _detect_xingyun_transmutation(
    month_zhi: str,
    base_mingju_zhis: list[str],
    dayun_zhi: str,
    liunian_zhi: str | None,
    *,
    rizhu_gan: str,
    force: dict,
    gan_he: dict,
    original_geju_name: str,
    baseline_transmuted: dict | None = None,
) -> dict | None:
    """Detect 大运/流年 transmutation with dedup. Spec §3.3.
    
    Args:
        month_zhi: 月令地支
        base_mingju_zhis: 命局 4 支
        dayun_zhi: 大运地支
        liunian_zhi: 流年地支 (None for 大运 entry detection)
        rizhu_gan/force/gan_he/original_geju_name: passed through to _detect_transmutation
        baseline_transmuted: 大运 entry's already-computed transmuted (for 流年 dedup)
    
    Returns transmuted dict or None.
    """
    if liunian_zhi is None:
        # 大运 entry: dedup against 命局-only baseline
        with_dayun = _detect_transmutation(
            month_zhi,
            base_mingju_zhis + [dayun_zhi],
            rizhu_gan, force, gan_he,
            original_geju_name=original_geju_name,
        )
        if not with_dayun:
            return None
        baseline = _detect_transmutation(
            month_zhi, base_mingju_zhis,
            rizhu_gan, force, gan_he,
            original_geju_name=original_geju_name,
        )
        if _is_same_combo(with_dayun, baseline):
            return None
        return with_dayun
    else:
        # 流年 entry: dedup against 大运 transmuted
        with_liunian = _detect_transmutation(
            month_zhi,
            base_mingju_zhis + [dayun_zhi, liunian_zhi],
            rizhu_gan, force, gan_he,
            original_geju_name=original_geju_name,
        )
        if not with_liunian:
            return None
        if _is_same_combo(with_liunian, baseline_transmuted):
            return None
        return with_liunian
```

- [ ] **Step 3.2: Write 4 大运层 detection tests**

Append:

```python
from paipan.xingyun import _detect_xingyun_transmutation


# === 大运层 detection ===

def test_detect_xingyun_dayun_fires_when_dayun_zhi_completes_combo():
    """命局 [子,寅,午,辰] (月令子) + 大运申 → 申子辰三合 + 月令子参与 → fire."""
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['子', '寅', '午', '辰'],   # 命局 4 支, 月令子在内
        dayun_zhi='申',
        liunian_zhi=None,
        rizhu_gan='丙',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
    )
    assert result is not None
    assert result['trigger']['type'] == 'sanHe'
    assert result['trigger']['wuxing'] == '水'


def test_detect_xingyun_dayun_dedups_when_combo_already_in_命局():
    """命局 [酉,亥,卯,未] (月令亥, 已含完整亥卯未三合) + 大运丑 → 命局-only baseline 已触发 → 大运 dedup → None.
    
    NOTE: dayun_zhi 必须是地支 (e.g. '丑' 取自 大运'癸丑' 的支位).
    """
    result = _detect_xingyun_transmutation(
        month_zhi='亥',
        base_mingju_zhis=['酉', '亥', '卯', '未'],   # 命局已自带亥卯未
        dayun_zhi='丑',   # 癸丑大运 的 zhi 部分
        liunian_zhi=None,
        rizhu_gan='丁',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
    )
    assert result is None   # 命局已自带亥卯未, 大运 dedup


def test_detect_xingyun_dayun_no_trigger_when_dayun_zhi_irrelevant():
    """命局 [子,寅,午,辰] + 大运未 → 未不参与任何月令子的合局 → None."""
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['子', '寅', '午', '辰'],
        dayun_zhi='未',
        liunian_zhi=None,
        rizhu_gan='丙',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
    )
    assert result is None


def test_detect_xingyun_dayun_sanhui_priority():
    """命局 [子,寅,午,辰] + 大运卯 → 寅卯辰三会 (月令子不参与) + 申子辰三合 (缺申).
    都不 fire. 所以 None.
    
    设计另一个真触发同时多 combo 的场景比较难找。这个测试改为验证：
    命局 [亥,子,丑,巳] (月令子, 自带亥子丑三会北方水) + 大运辰 → with-大运 [亥,子,丑,巳,辰]:
      - 亥子丑三会水 ✓ (already in baseline)
      - 申子辰三合 缺申
    Baseline: 亥子丑三会水 (同上)
    → dedup, return None
    """
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['亥', '子', '丑', '巳'],
        dayun_zhi='辰',
        liunian_zhi=None,
        rizhu_gan='壬',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
    )
    assert result is None   # baseline 已 fire 三会, dedup
```

- [ ] **Step 3.3: Write 4 流年层 dedup tests**

Append:

```python
# === 流年层 dedup ===

def test_detect_xingyun_liunian_fires_when_dayun_baseline_no_combo():
    """命局 + 大运 baseline 无合局 (dayun_transmuted=None), 流年支贡献第三支 → fire."""
    # 命局 [子,寅,辰,亥] (月令子, 自带申子辰需申, 自带亥子丑需丑)
    # 大运戌 → with-大运 [子,寅,辰,亥,戌]: 申子辰需申 (缺), 亥子丑需丑 (缺), 寅午戌需午 (缺), 亥子丑无完整, 月令子参与亥子丑但缺丑
    # → 大运 transmuted = None
    # 流年丑 → with-流年 [子,寅,辰,亥,戌,丑]: 亥子丑完整 + 月令子参与 → fire
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['子', '寅', '辰', '亥'],
        dayun_zhi='戌',
        liunian_zhi='丑',
        rizhu_gan='壬',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
        baseline_transmuted=None,   # 大运 baseline None
    )
    assert result is not None
    assert result['trigger']['type'] == 'sanHui'   # 亥子丑三会


def test_detect_xingyun_liunian_dedups_when_dayun_already_fired_same_combo():
    """大运 transmuted = 申子辰; 流年带辰 (already in 大运) → 同 combo → dedup."""
    fake_baseline = {
        'trigger': {
            'type': 'sanHe', 'wuxing': '水',
            'zhi_list': ['申', '子', '辰'], 'main': '子',
            'source': '三合申子辰局',
        },
    }
    # 命局 [子,寅,午,丑] + 大运申 → 申子辰已 fire (大运 transmuted = fake_baseline)
    # 流年辰 → with-流年 [子,寅,午,丑,申,辰]: 申子辰仍 fire (同 combo)
    # → dedup, return None
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['子', '寅', '午', '丑'],
        dayun_zhi='申',
        liunian_zhi='辰',
        rizhu_gan='丙',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
        baseline_transmuted=fake_baseline,
    )
    assert result is None


def test_detect_xingyun_liunian_fires_when_different_combo_than_dayun():
    """大运 transmuted = 三合A; 流年带支触发不同三合B (月令同时在两个合局里) → fire."""
    # 月令子 同时在 申子辰 和 亥子丑
    # 命局 [子,申,辰,巳]: 大运甲带支 → no
    # 实际很难构造干净, 用 mock baseline:
    fake_baseline = {
        'trigger': {
            'type': 'sanHe', 'wuxing': '水',
            'zhi_list': ['申', '子', '辰'], 'main': '子',
            'source': '三合申子辰局',
        },
    }
    # 命局 [子,寅,午,亥] + 大运丑 → 亥子丑三会 (子在其中)
    # 流年丑同时也补全亥子丑
    # 但大运已经触发亥子丑? wait, 大运丑 + 命局亥子 → 亥子丑完整, 月令子参与 → 大运也 fire 亥子丑
    # 让 fake_baseline 是 申子辰; 实际 with-流年 触发 亥子丑 → 不同 combo → fire
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['子', '寅', '午', '亥'],
        dayun_zhi='丑',         # 大运丑
        liunian_zhi='丑',        # 流年也丑 (mingju+dayun+liunian = [子,寅,午,亥,丑,丑])
        rizhu_gan='丙',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
        baseline_transmuted=fake_baseline,   # 假装大运是申子辰 (实际此盘 baseline 应是亥子丑)
    )
    assert result is not None
    # 流年触发的应该是亥子丑 (with-流年 result)
    assert result['trigger']['type'] == 'sanHui'
    assert set(result['trigger']['zhi_list']) == {'亥', '子', '丑'}


def test_detect_xingyun_liunian_no_trigger_when_no_combo():
    """命局 + 大运 + 流年 都不构成合局 → None."""
    result = _detect_xingyun_transmutation(
        month_zhi='子',
        base_mingju_zhis=['子', '寅', '午', '辰'],
        dayun_zhi='巳',
        liunian_zhi='未',
        rizhu_gan='丙',
        force={'scores': {}}, gan_he={},
        original_geju_name='正官格',
        baseline_transmuted=None,
    )
    assert result is None
```

- [ ] **Step 3.4: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v -k "detect_xingyun"
```
Expected: 8 passed (4 大运 + 4 流年).

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 593 + 8 = 601 passed.

> **If a test fails**: 检查 mingju_zhis 拼接顺序、month_zhi 是否真在合局支里、_compute_virtual_geju_name 是否正确返回 (不应是 None)。Print 中间值 debug。

- [ ] **Step 3.5: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5b _detect_xingyun_transmutation + dedup logic

_detect_xingyun_transmutation wraps Plan 7.5a's _detect_transmutation
with two-mode dedup:
  - 大运 mode (liunian_zhi=None): dedup against 命局-only baseline (avoid
    repeating Plan 7.5a static transmutation in xingyun output)
  - 流年 mode (liunian_zhi given): dedup against 大运 transmuted (avoid
    每个流年 echoing the same 大运 combo)

Both modes use _is_same_combo for structural comparison (type + zhi_list
set), robust against future source-string renames.

8 unit tests cover all dedup branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `build_xingyun` 集成 + 3 集成 + 5 verified golden tests

**Files:**
- Modify: `paipan/paipan/xingyun.py` (`build_xingyun` body 加 per-entry transmutation)
- Modify: `paipan/tests/test_xingyun.py` (3 集成 + 5 verified golden)

⚠️ **Verification-first workflow** required for golden cases (similar to Plan 7.5a Task 4).

- [ ] **Step 4.1: Modify `build_xingyun` body**

Find the loops that build `out_dayun` and `out_liunian` in `build_xingyun`. For each大运 entry, add transmutation detection after score_yun. For each 流年 entry within, add transmutation detection passing dayun_transmuted as baseline.

```python
def build_xingyun(
    dayun: dict,
    yongshen_detail: dict,
    mingju_gans: list[str],
    mingju_zhis: list[str],
    current_year: int,
    *,
    chart_context: dict | None = None,
) -> dict:
    yongshen_primary = (yongshen_detail or {}).get('primary', '')
    if not _extract_yongshen_wuxings(yongshen_primary):
        return {
            'dayun': [], 'liunian': {},
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
        
        score = score_yun(ganzhi, yongshen_primary, mingju_gans, mingju_zhis)
        
        # Plan 7.5b: dayun-level transmutation detection
        dayun_transmuted = None
        if chart_context:
            dayun_transmuted = _detect_xingyun_transmutation(
                month_zhi=chart_context['month_zhi'],
                base_mingju_zhis=mingju_zhis,
                dayun_zhi=ganzhi[1],
                liunian_zhi=None,
                rizhu_gan=chart_context['rizhu_gan'],
                force=chart_context['force'],
                gan_he=chart_context['gan_he'],
                original_geju_name=chart_context['original_geju_name'],
            )
        
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
            'transmuted': dayun_transmuted,    # NEW (Plan 7.5b)
        })
        
        if start_year <= current_year <= end_year:
            current_idx = idx
        
        # 流年 evaluations within this 大运
        ln_entries = []
        for ly in entry.get('liunian', []):
            ly_score = score_yun(
                ly['ganzhi'], yongshen_primary, mingju_gans, mingju_zhis
            )
            
            # Plan 7.5b: liunian-level transmutation detection (with dedup against dayun)
            liunian_transmuted = None
            if chart_context:
                liunian_transmuted = _detect_xingyun_transmutation(
                    month_zhi=chart_context['month_zhi'],
                    base_mingju_zhis=mingju_zhis,
                    dayun_zhi=ganzhi[1],
                    liunian_zhi=ly['ganzhi'][1],
                    rizhu_gan=chart_context['rizhu_gan'],
                    force=chart_context['force'],
                    gan_he=chart_context['gan_he'],
                    original_geju_name=chart_context['original_geju_name'],
                    baseline_transmuted=dayun_transmuted,
                )
            
            ln_entries.append({
                'year': ly['year'],
                'ganzhi': ly['ganzhi'],
                'age': ly['age'],
                'label': ly_score['label'],
                'score': ly_score['score'],
                'note': ly_score['note'],
                'mechanisms': ly_score['mechanisms'],
                'transmuted': liunian_transmuted,    # NEW (Plan 7.5b)
            })
        out_liunian[str(idx)] = ln_entries
    
    return {
        'dayun': out_dayun,
        'liunian': out_liunian,
        'currentDayunIndex': current_idx,
        'yongshenSnapshot': yongshen_primary,
    }
```

- [ ] **Step 4.2: Write 3 集成 tests**

Append:

```python
def test_build_xingyun_standard_chart_all_transmuted_none():
    """1993 chart 命局/大运/流年 都无合局触发 → 所有 transmuted 都是 None."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    for d in xy['dayun']:
        assert d['transmuted'] is None, f"dayun[{d['index']}] unexpected transmuted: {d['transmuted']}"
    for k, ln_list in xy['liunian'].items():
        for ly in ln_list:
            assert ly['transmuted'] is None, \
                f"liunian[{k}] {ly['year']} unexpected transmuted"


def test_build_xingyun_static_chart_dayun_dedup():
    """1980-02-12 chart 命局自带寅卯辰三会 (Plan 7.5a 静态 fire) → xingyun.dayun 全 dedup → None."""
    out = compute(year=1980, month=2, day=12, hour=8, minute=0,
                   gender='male', city='北京')
    detail = out['yongshenDetail']
    assert detail.get('transmuted') is not None, '1980-02-12 应触发 Plan 7.5a static'
    
    xy = out['xingyun']
    for d in xy['dayun']:
        assert d['transmuted'] is None, \
            f"dayun[{d['index']}] should be dedup'd against 命局 baseline, got: {d['transmuted']}"


def test_build_xingyun_chart_context_none_skips_transmutation():
    """build_xingyun() called without chart_context → transmuted 字段 None (backward compat)."""
    from paipan.xingyun import build_xingyun
    
    # 用一个本应触发 transmutation 的 chart 但不传 chart_context
    out = compute(year=1980, month=2, day=12, hour=8, minute=0,
                   gender='male', city='北京')
    fake_dayun = out['dayun']
    fake_yongshen = out['yongshenDetail']
    
    # 调 build_xingyun 不传 chart_context
    xy_no_ctx = build_xingyun(
        dayun=fake_dayun,
        yongshen_detail=fake_yongshen,
        mingju_gans=['庚', '戊', '乙', '庚'],
        mingju_zhis=['申', '寅', '卯', '辰'],
        current_year=2026,
        # chart_context 不传
    )
    for d in xy_no_ctx['dayun']:
        assert d['transmuted'] is None, 'no chart_context → no transmutation'
```

- [ ] **Step 4.3: Verification-first for golden cases**

⚠️ Spec §6 lists 5 golden case slots but doesn't pre-specify birth_inputs (because dynamic transmutation requires very specific 命局 + 大运/流年 alignment). YOU MUST find 5 inputs that ACTUALLY trigger.

For each candidate input, run this sanity script:

```python
uv run --package paipan python -c "
from paipan import compute
out = compute(year=YYYY, month=M, day=D, hour=H, minute=MIN, gender='male'|'female', city='CITY')
xy = out['xingyun']
detail = out['yongshenDetail']
print('---')
print('birth:', YYYY, M, D, H)
print('sizhu:', out['sizhu'])
print('static transmuted:', detail.get('transmuted', {}).get('to', 'None'))
print('dayun transmutations:')
for d in xy['dayun']:
    if d.get('transmuted'):
        t = d['transmuted']
        print(f\"  dayun {d['index']} ({d['ganzhi']}, ages {d['startAge']}-): {t['from']} → {t['to']} ({t['trigger']['source']})\")
print('liunian transmutations:')
for k, ln_list in xy['liunian'].items():
    for ly in ln_list:
        if ly.get('transmuted'):
            t = ly['transmuted']
            print(f\"  liunian {k}/{ly['year']}({ly['ganzhi']}): {t['from']} → {t['to']} ({t['trigger']['source']})\")
"
```

Find 5 birth_inputs that produce at least 1 dayun OR liunian transmutation (after dedup). Diversity goals:
- ≥ 2 cases with dayun-level transmutation
- ≥ 2 cases with liunian-level transmutation
- Diverse trigger types (sanHe + sanHui)
- Diverse trigger wuxings (at least 3 different)

Suggestions for finding triggering charts:
- Charts where 命局 has 2 of 3 zhi for a 三合, missing the third → 大运 / 流年 might bring it
- 月令 in 仲气 (子午卯酉) is most likely to participate in 三会 (these are the 中位 of 三会)
- Search broadly: try (year=Y, month=M, day=15, hour=12) for Y in 1970-2010, M in 1-12, gender='male', city='北京' until you find 5 that trigger dynamic transmutation

If after good-faith effort (~30 min) you can't find 5, try harder grid OR settle for fewer but diverse cases. Disclose what you found.

- [ ] **Step 4.4: Write 5 verified golden tests**

After Step 4.3 yields 5 verified inputs:

```python
GOLDEN_DYNAMIC_TRANSMUTATION_CASES = [
    {
        'label': '<descriptive label>',
        'input': dict(year=..., month=..., day=..., hour=..., minute=...,
                       gender='...', city='...'),
        # at least one of the following expected:
        'expect_dayun_transmutations': N,        # how many dayun entries should have transmuted
        'expect_liunian_transmutations': M,      # how many liunian entries (across all大运) should have transmuted
        'expected_trigger_types': {'sanHe', 'sanHui'},   # subset of these may appear
    },
    # ... 5 cases total
]


@pytest.mark.parametrize('case', GOLDEN_DYNAMIC_TRANSMUTATION_CASES,
                          ids=[c['label'] for c in GOLDEN_DYNAMIC_TRANSMUTATION_CASES])
def test_xingyun_dynamic_transmutation_golden(case):
    """Plan 7.5b §6.1 golden: real charts trigger dynamic transmutation as expected."""
    out = compute(**case['input'])
    xy = out['xingyun']
    
    dayun_transmuted_count = sum(1 for d in xy['dayun'] if d.get('transmuted'))
    liunian_transmuted_count = sum(
        1 for ln_list in xy['liunian'].values()
        for ly in ln_list if ly.get('transmuted')
    )
    
    if 'expect_dayun_transmutations' in case:
        assert dayun_transmuted_count >= case['expect_dayun_transmutations'], \
            f"{case['label']}: expected ≥{case['expect_dayun_transmutations']} dayun transmutations, got {dayun_transmuted_count}"
    
    if 'expect_liunian_transmutations' in case:
        assert liunian_transmuted_count >= case['expect_liunian_transmutations'], \
            f"{case['label']}: expected ≥{case['expect_liunian_transmutations']} liunian transmutations, got {liunian_transmuted_count}"
    
    # 验证 trigger.type 在预期集合内
    if 'expected_trigger_types' in case:
        all_types = set()
        for d in xy['dayun']:
            if d.get('transmuted'):
                all_types.add(d['transmuted']['trigger']['type'])
        for ln_list in xy['liunian'].values():
            for ly in ln_list:
                if ly.get('transmuted'):
                    all_types.add(ly['transmuted']['trigger']['type'])
        assert all_types.issubset(case['expected_trigger_types']), \
            f"{case['label']}: actual types {all_types} not subset of expected {case['expected_trigger_types']}"
```

- [ ] **Step 4.5: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v -k "build_xingyun_standard or build_xingyun_static or build_xingyun_chart_context_none or dynamic_transmutation_golden"
```
Expected: 3 + 5 = 8 passed.

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 601 + 8 = 609 passed.

> **If a golden case fails**: don't loosen assertion silently. Report which case + what you found vs expected. Possible: input doesn't fire as many transmutations as expected → find a better input.

- [ ] **Step 4.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5b build_xingyun integrates per-entry transmutation

build_xingyun loops now invoke _detect_xingyun_transmutation per dayun
and per liunian entry (when chart_context provided). Each entry gets a
'transmuted' field (None when no trigger or dedup'd).

3 integration tests + 5 verified golden cases (verification-first
workflow per Plan 7.5a model). 标准 1993 chart all-None; 1980-02-12
(Plan 7.5a static) dedup'd at dayun level; backward compat verified
(no chart_context → no transmutation).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: context.py render + 2 render tests + browser smoke

**Files:**
- Modify: `server/app/prompts/context.py` (`_render_xingyun_block` 加 transmuted 段)
- Modify: `server/tests/unit/test_prompts_context_xingyun.py` (2 render tests)

- [ ] **Step 5.1: Read current `_render_xingyun_block`**

Read `server/app/prompts/context.py`. Find Plan 7.4 ship's `_render_xingyun_block`. Identify:
- The dayun loop that iterates `for entry in dayun_list:` and emits `★ ...岁  ganzhi  ⭐喜 note`
- The liunian loop that iterates `for ly in ln_list:` and emits `2026(丙午,34岁)  ⚠忌  note`

Plan 7.5b inserts transmuted block (1-2 lines) AFTER each dayun/liunian line that has `entry['transmuted']` set.

- [ ] **Step 5.2: Insert transmuted rendering for dayun**

Modify the dayun loop in `_render_xingyun_block`. After the existing line append, add:

```python
for entry in dayun_list:
    marker = '★ ' if entry['index'] == cur_idx else '  '
    end_age = entry['startAge'] + (entry['endYear'] - entry['startYear'])
    glyph = _XINGYUN_GLYPH.get(entry['label'], '?')
    lines.append(
        f"  {marker}{entry['startAge']}-{end_age}岁  "
        f"{entry['ganzhi']}  {glyph}{entry['label']}  {entry['note']}"
    )
    # Plan 7.5b: dayun-level transmutation
    transmuted = entry.get('transmuted')
    if transmuted:
        trig = transmuted['trigger']
        lines.append(
            f"      ⟳ 月令变化  {transmuted['from']} → {transmuted['to']}  {trig['source']}"
        )
        cand = transmuted['candidate']
        cand_name = cand.get('name', '?')
        cand_note = cand.get('note', '')
        cand_src = cand.get('source', '')
        line = f"        格局新候选：{cand_name}"
        if cand_note:
            line += f"（{cand_note}）"
        if cand_src:
            line += f"  {cand_src}"
        lines.append(line)
```

- [ ] **Step 5.3: Insert transmuted rendering for liunian**

Modify the liunian loop similarly:

```python
for ly in ln_list:
    glyph = _XINGYUN_GLYPH.get(ly['label'], '?')
    lines.append(
        f"      {ly['year']}({ly['ganzhi']},{ly['age']}岁)  "
        f"{glyph}{ly['label']}  {ly['note']}"
    )
    # Plan 7.5b: liunian-level transmutation
    transmuted = ly.get('transmuted')
    if transmuted:
        trig = transmuted['trigger']
        lines.append(
            f"        ⟳ 月令变化  {transmuted['from']} → {transmuted['to']}  {trig['source']}"
        )
        cand = transmuted['candidate']
        cand_name = cand.get('name', '?')
        cand_note = cand.get('note', '')
        cand_src = cand.get('source', '')
        line = f"          格局新候选：{cand_name}"
        if cand_note:
            line += f"（{cand_note}）"
        if cand_src:
            line += f"  {cand_src}"
        lines.append(line)
```

Note slight indent difference (流年 已经多缩进 4 空格, 所以 transmuted block 再多 2 空格).

- [ ] **Step 5.4: Write 2 render tests**

Append to `server/tests/unit/test_prompts_context_xingyun.py`:

```python
def test_renders_xingyun_dayun_transmuted_block():
    """Plan 7.5b §5.3: dayun entry with transmuted renders ⟳ block."""
    xy = _make_xingyun_with_label('喜')
    # Inject transmuted into 大运 4 (current)
    xy['dayun'][3]['transmuted'] = {
        'trigger': {
            'type': 'sanHe', 'wuxing': '木', 'main': '卯',
            'zhi_list': ['亥', '卯', '未'], 'source': '三合亥卯未局',
        },
        'from': '正官格',
        'to': '偏印格',
        'candidate': {
            'method': '格局', 'name': '官（官印相生）',
            'note': '偏印得官杀生', 'source': '子平真诠·论印绶',
        },
        'warning': None,
        'alternateTriggers': [],
    }
    paipan = _sample_paipan(xy)
    text = compact_chart_context(paipan)
    assert '⟳ 月令变化' in text
    assert '正官格 → 偏印格' in text
    assert '三合亥卯未局' in text
    assert '格局新候选：官（官印相生）' in text


def test_renders_xingyun_liunian_transmuted_block():
    """Plan 7.5b §5.3: liunian entry with transmuted renders ⟳ block (deeper indent)."""
    xy = _make_xingyun_with_label('喜')
    cur_idx = xy['currentDayunIndex']
    # Inject transmuted into liunian[cur_idx][2]
    xy['liunian'][str(cur_idx)][2]['transmuted'] = {
        'trigger': {
            'type': 'sanHui', 'wuxing': '水', 'main': '子',
            'zhi_list': ['亥', '子', '丑'], 'source': '三会北方',
        },
        'from': '正财格',
        'to': '七杀格',
        'candidate': {
            'method': '格局', 'name': '食神（制杀）',
            'note': '...', 'source': '子平真诠·论偏官',
        },
        'warning': '...',
        'alternateTriggers': [],
    }
    paipan = _sample_paipan(xy)
    text = compact_chart_context(paipan)
    assert '三会北方' in text
    assert '正财格 → 七杀格' in text
```

(Use existing `_make_xingyun_with_label` helper from Plan 7.4 ship.)

- [ ] **Step 5.5: Run render tests**

```
uv run --package server pytest -q server/tests/unit/test_prompts_context_xingyun.py -v
```
Expected: existing 5 + 2 new = 7 passed.

- [ ] **Step 5.6: Run all 3 test suites**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
cd frontend && node --test tests/*.mjs
```

Expected:
- paipan: 609 passed
- server: 437 + 2 = 439 passed
- frontend: 51 passed (unchanged)

- [ ] **Step 5.7: Browser smoke**

Boot dev servers + login (live app uses 手机号 + DEV-mode SMS code).

For smoke chart, use ONE of the Task 4 verified golden inputs (the chart with strongest dynamic transmutation signal — ideally one with both dayun + liunian transmutations).

In chat, send: "**我大运里某段格局会变吗？**"

Expected: assistant references the dynamic transmutation block (大运 X 期间 / 流年 Y 那年, 月令变化, 引古籍).

Capture screenshot to `.claire/plan75b-dynamic-transmutation-smoke.png`.

Sanity check on standard 1993 chart (no transmutation expected):
```bash
uv run --package paipan python -c "
from paipan import compute
out = compute(year=1993, month=7, day=15, hour=14, minute=30, gender='male', city='长沙')
xy = out['xingyun']
print('all dayun transmuted None:', all(d['transmuted'] is None for d in xy['dayun']))
print('all liunian transmuted None:', all(
    ly['transmuted'] is None
    for ln_list in xy['liunian'].values()
    for ly in ln_list
))
"
```

Expected: both True (Plan 7.4 contract intact, no surprise transmutation on baseline chart).

- [ ] **Step 5.8: Commit**

```bash
git add server/app/prompts/context.py server/tests/unit/test_prompts_context_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 7.5b render xingyun transmuted blocks

_render_xingyun_block extended: when xingyun.dayun[i].transmuted or
xingyun.liunian[k][j].transmuted is present, append 2 lines (⟳ 月令变化
+ 格局新候选). Renders nothing when transmuted absent (Plan 7.4 老盘
向后兼容).

Browser smoke verified: standard 1993 chart unaffected (no transmutation);
dynamic transmutation chart's chat answer references ⟳ block + cites
ZPZQ-style language.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes (for the executing engineer)

If any of these surface post-implementation, file a Plan 7.5b.1 follow-up:

1. **Task 4 找不到 5 verified golden cases** — dynamic transmutation 实际触发率较低。如果 30 min 撒网找不到 5 个，settle for 3-4 high-quality cases + disclose. Plan 7.5a 的 verification-first 经验：spec 列的 candidate inputs 经常不准。

2. **Plan 7.4 行运评分契约破** — 如果 33 个 score golden case 任一红，说明 build_xingyun body 改动意外影响了 score 字段。检查 Task 4 的代码是否只**追加** transmuted 字段而没改其他字段。

3. **大运 dedup 漏 case** — 命局自带合局 + 大运支恰好是合局支之一 (e.g. 命局 [亥,卯,未,X] + 大运卯)。with-大运 = [亥,卯,未,X,卯] 仍是亥卯未三合; baseline 也是亥卯未三合; 同 combo → dedup ✓ 应该正确。但如果实施时 baseline computation 用错了 mingju_zhis (e.g. 错传 `mingju_zhis + [dayun_zhi]` 给 baseline)，dedup 会漏。Step 3.1 实现严格 baseline = `_detect_transmutation(month_zhi, base_mingju_zhis, ...)` 不含 dayun_zhi。

4. **流年支跟大运支撞 (e.g. 大运卯 + 流年卯)** — `mingju_zhis + [dayun_zhi, liunian_zhi]` 会有重复 卯。`_detect_transmutation` 使用 `if z in mingju_zhis` 这种 set-membership check, 重复支不影响检测结果。但如果未来代码 path 用 list count, 可能需要 dedup。当前 spec 不预防。

5. **Render 嵌套缩进 LLM 易混** — 流年 transmuted 有 8 空格缩进，可能 LLM 看 markdown 时 confused。如果 chat smoke 显示 LLM 解读不准，简化缩进规则 (统一 4 空格)。

6. **chart_context 字段名不稳** — `month_zhi/rizhu_gan/force/gan_he/original_geju_name` 是 internal API。如果后续 plan 加更多字段，可能需要把 chart_context 改成 typed dict 或 dataclass。当前用 plain dict 简洁。

7. **Plan 7.5a static + 7.5b dynamic 的 LLM 解读边界** — LLM 可能混淆"命局已变"vs"大运期间变"。如果 chat smoke 显示这种 confusion, 在 system prompt 加一句 "Plan 7.5a transmutation 是命局先天结构；Plan 7.5b 是某段大运/流年带来的暂时变化"。当前不预防。
