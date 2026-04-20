# Plan 7.5a — 用神变化（命局合局触发）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect 命局自带 三合 / 三会 + 月令参与 时月令性质质变，输出虚拟格局 + 古籍引证到 `yongshenDetail.transmuted`。Plan 7.3 candidates 契约不破，前端零改动。

**Architecture:** Pure additive layer above Plan 7.3。新增 2 个 internal helpers in `paipan/paipan/yongshen.py`（`_detect_transmutation` + `_compute_virtual_geju_name`），`build_yongshen` 加 optional `mingju_zhis` 参数。复用 `paipan.he_ke.SAN_HE_JU/SAN_HUI` + `paipan.cang_gan.get_ben_qi` + `paipan.ganzhi.GAN_WUXING/GAN_YINYANG/WUXING_SHENG/WUXING_KE` + Plan 7.3 的 `geju_yongshen`。`server/app/prompts/context.py` 渲染层增加 transmuted 段。

**Tech Stack:** Python 3.12 · pytest. 无新依赖。无新数据表。

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-21-yongshen-transmutation-design.md`. 如果 spec 与实际 code 不符（typo/wrong API），inline 修 spec + 在 commit 标注 catch。
2. **Plan 7.3 contract 不破**：
   - `yongshenDetail.candidates` 长度仍是 3
   - `yongshenDetail.primary` 字符串值不变（不重算）
   - `chart.paipan.yongshen` (string) 不变
3. **前端零改动**：`chartUi.js` / `Shell.jsx` / 任何 `frontend/src/` 不动
4. **重算边界**：只重算格局法。调候/扶抑/force/li_liang 不动
5. **Backward compat**：`build_yongshen` 加新参数 `mingju_zhis: list[str] | None = None`，默认 None 让 Plan 7.3 老调用方完全不变
6. **Tests stay green**: 559 paipan + 435 server + 51 frontend baseline。新增 23 paipan + 2 server

## 目录最终形态

```
paipan/
├── paipan/
│   ├── yongshen.py             # MODIFY (~120 行新代码)
│   │     + _detect_transmutation(...)
│   │     + _compute_virtual_geju_name(...)
│   │     + _GEJU_NAME_TABLE  (10 entries 硬编码)
│   │     + build_yongshen(...)  签名 加 mingju_zhis 参数
│   ├── analyzer.py             # MODIFY (1 行)
│   │     + 调 build_yongshen 时多传 mingju_zhis
│   ├── he_ke.py                # 不动 (SAN_HE_JU + SAN_HUI 复用)
│   ├── cang_gan.py             # 不动 (get_ben_qi 复用)
│   ├── ganzhi.py               # 不动 (GAN_WUXING/GAN_YINYANG/WUXING_SHENG/WUXING_KE 复用)
│   └── yongshen_data.py        # 不动 (无新表)
└── tests/
    └── test_yongshen.py        # MODIFY (+23 tests)

server/
├── app/prompts/context.py      # MODIFY (~15 行新代码 in _render_yongshen_block)
└── tests/unit/
    └── test_prompts_context_yongshen.py  # MODIFY (+2 tests)
```

无新文件。无新依赖。无前端 / DB / route 改动。

## Task 列表预览

- **Task 1** — Skeleton：`_detect_transmutation` + `_compute_virtual_geju_name` stubs + `build_yongshen` 加 `mingju_zhis` 参数 + `analyzer.py` 调用更新 + 1 skeleton test
- **Task 2** — `_compute_virtual_geju_name` 实现 + `_GEJU_NAME_TABLE` 数据 + 10 命名 unit tests
- **Task 3** — `_detect_transmutation` 实现 + 5 detection tests + 3 build_yongshen 集成 tests
- **Task 4** — 5 个 Golden 集成 tests（先验证每个 birth_input 真触发，再写断言）
- **Task 5** — `context.py` _render_yongshen_block 加 transmuted 段 + 2 render tests + browser smoke

---

## Task 1: Skeleton + analyzer wire

**Files:**
- Modify: `paipan/paipan/yongshen.py` (加 stub 函数 + build_yongshen 参数)
- Modify: `paipan/paipan/analyzer.py` (build_yongshen call 多传一个 arg)
- Modify: `paipan/tests/test_yongshen.py` (1 个 skeleton test)

- [ ] **Step 1.1: Add stub functions to `paipan/paipan/yongshen.py`**

In `yongshen.py`, after the existing imports and before `tiaohou_yongshen`, add:

```python
from paipan.he_ke import SAN_HE_JU, SAN_HUI
from paipan.cang_gan import get_ben_qi
from paipan.ganzhi import GAN_WUXING, GAN_YINYANG, WUXING_SHENG, WUXING_KE


# Plan 7.5a §3.3 _GEJU_NAME_TABLE — filled in Task 2
_GEJU_NAME_TABLE: dict[tuple[str, str], str] = {}


def _compute_virtual_geju_name(
    new_wuxing: str,
    rizhu_gan: str,
    main_zhi: str,
) -> str | None:
    """Plan 7.5a §3.3 — 五行 + 日主 + main支 → 格局名 (10种之一).
    
    Filled in Task 2.
    """
    return None   # stub


def _detect_transmutation(
    month_zhi: str,
    mingju_zhis: list[str],
    rizhu_gan: str,
    force: dict,
    gan_he: dict,
    *,
    original_geju_name: str = '',
    tiaohou_candidate: dict | None = None,
) -> dict | None:
    """Plan 7.5a §3.3 — 检测命局自带合局是否质变月令.
    
    Filled in Task 3.
    """
    return None   # stub
```

- [ ] **Step 1.2: Modify `build_yongshen` signature and body in `paipan/paipan/yongshen.py`**

Find existing `build_yongshen` definition (Plan 7.3 ship). Update signature + add transmutation hook:

```python
def build_yongshen(
    rizhu_gan: str,
    month_zhi: str | None,
    force: dict,
    geju: str | None,
    gan_he: dict,
    day_strength: str | None,
    mingju_zhis: list[str] | None = None,    # NEW (Plan 7.5a)
) -> dict:
    """Top-level 用神 engine entry point. Composes 3 methods + optional transmutation."""
    tiaohou = tiaohou_yongshen(rizhu_gan, month_zhi) if month_zhi else None
    geju_res = geju_yongshen(geju, force, gan_he)
    fuyi_res = fuyi_yongshen(force, day_strength)
    composed = compose_yongshen(tiaohou, geju_res, fuyi_res)

    # Plan 7.5a: detect 命局自带合局 transmutation
    if mingju_zhis and month_zhi:
        original_geju_candidate = next(
            (c for c in composed['candidates'] if c.get('method') == '格局'),
            None,
        )
        original_geju_name = (original_geju_candidate or {}).get('name', '')
        tiaohou_candidate = next(
            (c for c in composed['candidates'] if c.get('method') == '调候'),
            None,
        )
        transmuted = _detect_transmutation(
            month_zhi,
            mingju_zhis,
            rizhu_gan,
            force,
            gan_he,
            original_geju_name=original_geju_name,
            tiaohou_candidate=tiaohou_candidate,
        )
        if transmuted:
            composed['transmuted'] = transmuted
            composed['primaryReason'] += \
                '（注：月令合局触发格局质变，详见 transmuted 字段）'

    return composed
```

- [ ] **Step 1.3: Update `paipan/paipan/analyzer.py`**

Find the existing `build_yongshen(...)` call (Plan 7.3 ship; should be near line ~93). Add the `mingju_zhis` keyword argument:

```python
yongshen_dict = build_yongshen(
    rizhu_gan=d["gan"],
    month_zhi=m["zhi"],
    force=force,
    geju=ge_ju_main,
    gan_he=gan_he,
    day_strength=force.get('dayStrength'),
    mingju_zhis=[y["zhi"], m["zhi"], d["zhi"], h["zhi"]],   # NEW (Plan 7.5a)
)
```

`y/m/d/h` are existing local variables in analyzer.py (the bazi pillars). Verify they are dicts with `"zhi"` key. If `h` (hour) is None due to unknown-hour input, you may need a guard like `[y["zhi"], m["zhi"], d["zhi"]] + ([h["zhi"]] if h else [])`. Read analyzer.py first to confirm.

- [ ] **Step 1.4: Write skeleton test in `paipan/tests/test_yongshen.py`**

Append to existing test file:

```python
def test_chart_yongshen_transmuted_absent_when_no_combo():
    """Plan 7.5a §1: charts without 命局自带合局 should NOT have transmuted field.
    
    Standard 1993 chart (癸酉/己未/丁酉/丁未) has no 三合/三会 with 月令未:
      - 月令 未 → SAN_HE_JU 中 亥卯未 (需 命局含 亥+卯, 命局支只有酉/未/酉/未, 无)
      - 月令 未 → SAN_HUI 中 巳午未 (需 命局含 巳+午, 命局支无)
    所以应当无 transmutation.
    """
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    detail = out['yongshenDetail']
    assert 'transmuted' not in detail or detail['transmuted'] is None
```

- [ ] **Step 1.5: Run skeleton test + full regression**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py::test_chart_yongshen_transmuted_absent_when_no_combo -v
```
Expected: PASS (stubs return None, so transmuted never set).

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 559 + 1 = 560 passed (no regressions; Plan 7.3/7.4 contracts intact).

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 435 passed (server unchanged).

- [ ] **Step 1.6: Commit**

```bash
git add paipan/paipan/yongshen.py paipan/paipan/analyzer.py paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5a 用神变化 skeleton + analyzer wire

Add _detect_transmutation + _compute_virtual_geju_name stubs in
yongshen.py (filled in Tasks 2-3). build_yongshen() signature gains
optional mingju_zhis param (default None preserves Plan 7.3 contract).
analyzer.py passes [y.zhi, m.zhi, d.zhi, h.zhi] when calling.

Stubs return None → transmutation never fires yet → 1 skeleton test
verifies standard 1993 chart still has no transmuted field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `_compute_virtual_geju_name` + `_GEJU_NAME_TABLE`

**Files:**
- Modify: `paipan/paipan/yongshen.py` (replace 2 stubs with real implementations)
- Modify: `paipan/tests/test_yongshen.py` (10 命名 unit tests)

- [ ] **Step 2.1: Populate `_GEJU_NAME_TABLE`**

Replace the empty `_GEJU_NAME_TABLE = {}` stub in `paipan/paipan/yongshen.py`:

```python
# Plan 7.5a §3.3 — 10 entries; 5 十神类 × 2 阴阳 polarity
_GEJU_NAME_TABLE: dict[tuple[str, str], str] = {
    ('印', 'same'):     '偏印格',
    ('印', 'opposite'): '正印格',
    ('比劫', 'same'):     '比肩格',
    ('比劫', 'opposite'): '劫财格',
    ('食伤', 'same'):     '食神格',
    ('食伤', 'opposite'): '伤官格',
    ('财', 'same'):     '偏财格',
    ('财', 'opposite'): '正财格',
    ('官杀', 'same'):     '七杀格',
    ('官杀', 'opposite'): '正官格',
}
```

- [ ] **Step 2.2: Implement `_compute_virtual_geju_name`**

Replace the stub with the real implementation per spec §3.3:

```python
def _compute_virtual_geju_name(
    new_wuxing: str,
    rizhu_gan: str,
    main_zhi: str,
) -> str | None:
    """五行 + 日主 + main支 → 格局名 (10种之一)。
    
    Algorithm (spec §3.3):
      1. 算 ten_god_class (印/比劫/食伤/财/官杀) by new_wuxing vs rizhu_wx
      2. 算 polarity (same/opposite) by main_zhi 本气阴阳 vs rizhu_gan 阴阳
      3. lookup _GEJU_NAME_TABLE[(ten_god_class, polarity)]
    """
    rizhu_wx = GAN_WUXING.get(rizhu_gan)
    rizhu_yy = GAN_YINYANG.get(rizhu_gan)
    if not rizhu_wx or not rizhu_yy:
        return None

    main_gan = get_ben_qi(main_zhi)
    main_yy = GAN_YINYANG.get(main_gan)
    if not main_yy:
        return None

    if new_wuxing == rizhu_wx:
        ten_god_class = '比劫'
    elif WUXING_SHENG.get(new_wuxing) == rizhu_wx:
        ten_god_class = '印'
    elif WUXING_SHENG.get(rizhu_wx) == new_wuxing:
        ten_god_class = '食伤'
    elif WUXING_KE.get(rizhu_wx) == new_wuxing:
        ten_god_class = '财'
    elif WUXING_KE.get(new_wuxing) == rizhu_wx:
        ten_god_class = '官杀'
    else:
        return None  # 不应触发，但兜底

    polarity = 'same' if main_yy == rizhu_yy else 'opposite'
    return _GEJU_NAME_TABLE.get((ten_god_class, polarity))
```

- [ ] **Step 2.3: Write 10 命名 unit tests**

Append to `paipan/tests/test_yongshen.py`:

```python
from paipan.yongshen import _compute_virtual_geju_name


# 5 五行 × 2 polarity = 10 entries.
# Day master 锚定 丁火 (阴), 配 12 月支主气支覆盖全部 10 个 (十神类, polarity) 组合.
@pytest.mark.parametrize('new_wuxing,rizhu_gan,main_zhi,expected', [
    # 印 (生我者): 木生火
    ('木', '丁', '卯', '偏印格'),    # 丁(阴) + 卯(阴乙) → 印 + same → 偏印
    ('木', '丁', '寅', '正印格'),    # 丁(阴) + 寅(阳甲) → 印 + opposite → 正印
    # 比劫 (同我者): 火
    ('火', '丁', '午', '比肩格'),    # 丁(阴) + 午(阴丁) → 比劫 + same → 比肩
    ('火', '丁', '巳', '劫财格'),    # 丁(阴) + 巳(阳丙) → 比劫 + opposite → 劫财
    # 食伤 (我生者): 火生土
    ('土', '丁', '未', '食神格'),    # 丁(阴) + 未(阴己) → 食伤 + same → 食神
    ('土', '丁', '辰', '伤官格'),    # 丁(阴) + 辰(阳戊) → 食伤 + opposite → 伤官
    # 财 (我克者): 火克金
    ('金', '丁', '酉', '偏财格'),    # 丁(阴) + 酉(阴辛) → 财 + same → 偏财
    ('金', '丁', '申', '正财格'),    # 丁(阴) + 申(阳庚) → 财 + opposite → 正财
    # 官杀 (克我者): 水克火
    ('水', '丁', '亥', '正官格'),    # 丁(阴) + 亥(阳壬) → 官杀 + opposite → 正官
    ('水', '丁', '子', '七杀格'),    # 丁(阴) + 子(阴癸) → 官杀 + same → 七杀
])
def test_compute_virtual_geju_name_covers_10_entries(
    new_wuxing, rizhu_gan, main_zhi, expected
):
    assert _compute_virtual_geju_name(new_wuxing, rizhu_gan, main_zhi) == expected
```

确认每行注释方向：**same = 阴阴 / 阳阳**（同性），**opposite = 阴阳 / 阳阴**（异性）。表见 spec §3.3 的 `_GEJU_NAME_TABLE`。

- [ ] **Step 2.4: Run命名 tests**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py::test_compute_virtual_geju_name_covers_10_entries -v
```
Expected: 10 passed (parametrize generates 10 cases).

- [ ] **Step 2.5: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 560 + 10 = 570 passed.

- [ ] **Step 2.6: Commit**

```bash
git add paipan/paipan/yongshen.py paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5a _compute_virtual_geju_name + _GEJU_NAME_TABLE

10-entry table mapping (十神类, polarity) → 格局名. Algorithm computes
ten-god class from (new_wuxing vs rizhu_wx) and polarity from
(main_zhi 本气阴阳 vs rizhu_gan 阴阳). 10 parametrized tests cover all
5 十神类 × 2 polarity combinations using 丁火 as canonical day master
across 12 月支 main支.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `_detect_transmutation` + 集成 tests

**Files:**
- Modify: `paipan/paipan/yongshen.py` (replace stub with real implementation)
- Modify: `paipan/tests/test_yongshen.py` (5 detection + 3 build_yongshen 集成)

- [ ] **Step 3.1: Implement `_detect_transmutation`**

Replace the stub:

```python
def _detect_transmutation(
    month_zhi: str,
    mingju_zhis: list[str],
    rizhu_gan: str,
    force: dict,
    gan_he: dict,
    *,
    original_geju_name: str = '',
    tiaohou_candidate: dict | None = None,
) -> dict | None:
    """Detect 命局自带 三合/三会 + 月令参与, return transmuted dict or None.
    
    See spec §3.3 for trigger algorithm + §3.4 for warning rules + §4 for output shape.
    """
    candidate_combos: list[dict] = []

    # 三合 (4 种)
    for ju in SAN_HE_JU:
        matched = [z for z in ju["zhi"] if z in mingju_zhis]
        if month_zhi in matched and len(matched) == 3:
            candidate_combos.append({
                'type': 'sanHe',
                'wuxing': ju["wx"],
                'main': ju["main"],
                'zhi_list': list(ju["zhi"]),
                'source': f"三合{''.join(ju['zhi'])}局",
            })

    # 三会 (4 种)
    for hui in SAN_HUI:
        matched = [z for z in hui["zhi"] if z in mingju_zhis]
        if month_zhi in matched and len(matched) == 3:
            candidate_combos.append({
                'type': 'sanHui',
                'wuxing': hui["wx"],
                'main': hui["zhi"][1],
                'zhi_list': list(hui["zhi"]),
                'source': f"三会{hui['dir']}方",
            })

    if not candidate_combos:
        return None

    # 优先级 (spec §3.3): 三合 > 三会; 同型按出现顺序
    candidate_combos.sort(key=lambda c: 0 if c['type'] == 'sanHe' else 1)
    chosen = candidate_combos[0]
    alternates = candidate_combos[1:]

    # 计算虚拟格局名
    virtual_geju_name = _compute_virtual_geju_name(
        chosen['wuxing'], rizhu_gan, chosen['main']
    )
    if not virtual_geju_name:
        return None

    # 重算格局法 用神 (复用 Plan 7.3 geju_yongshen)
    new_candidate = geju_yongshen(virtual_geju_name, force, gan_he)
    if new_candidate is None:
        # GEJU_RULES 应该全覆盖 10 个格局名 (spec §3.4 risk #1 已 frozen)
        # 但兜底防御
        return None

    # warning (spec §4.1)
    warning: str | None = None
    tiaohou_name = (tiaohou_candidate or {}).get('name', '') if tiaohou_candidate else ''
    new_cand_name = new_candidate.get('name', '')
    if tiaohou_name and new_cand_name and tiaohou_name == new_cand_name:
        warning = None  # 调候 + 转化后格局 一致
    elif new_cand_name != original_geju_name:
        warning = f"月令合局后格局质变，原本\"{original_geju_name or '?'}\"的取用法不再适用"

    return {
        'trigger': chosen,
        'from': original_geju_name or '?',
        'to': virtual_geju_name,
        'candidate': new_candidate,
        'warning': warning,
        'alternateTriggers': alternates,
    }
```

- [ ] **Step 3.2: Write 5 detection unit tests**

Append to `paipan/tests/test_yongshen.py`:

```python
from paipan.yongshen import _detect_transmutation


def test_detect_transmutation_sanhe_when_month_in_combo():
    """月令亥 + 命局含卯+未 → 亥卯未三合木局触发。"""
    result = _detect_transmutation(
        month_zhi='亥',
        mingju_zhis=['酉', '亥', '卯', '未'],
        rizhu_gan='丁',
        force={'scores': {}},
        gan_he={},
    )
    assert result is not None
    assert result['trigger']['type'] == 'sanHe'
    assert result['trigger']['wuxing'] == '木'
    assert result['to'] == '偏印格'   # 丁(阴)+卯(阴) → 印 + same


def test_detect_transmutation_sanhui_when_month_in_combo():
    """月令寅 + 命局含卯+辰 → 寅卯辰三会木方触发。"""
    result = _detect_transmutation(
        month_zhi='寅',
        mingju_zhis=['酉', '寅', '卯', '辰'],
        rizhu_gan='丙',
        force={'scores': {}},
        gan_he={},
    )
    assert result is not None
    assert result['trigger']['type'] == 'sanHui'
    assert result['trigger']['wuxing'] == '木'


def test_detect_transmutation_no_trigger_when_month_not_in_combo():
    """命局含 卯+未 但月令是 子 → 命局自带亥卯未三合 (没亥), 实际未触发。
    更严的负向测试：月令 子, 命局 卯/未/酉, 没合局.
    """
    result = _detect_transmutation(
        month_zhi='子',
        mingju_zhis=['酉', '子', '卯', '未'],
        rizhu_gan='丁',
        force={'scores': {}},
        gan_he={},
    )
    assert result is None   # 月令子不在亥卯未, 不在申子辰 (缺申/辰), 不在亥子丑 (缺亥/丑)


def test_detect_transmutation_no_trigger_when_partial_combo():
    """月令亥 + 命局只含卯 (缺未) → 不算完整三合，不触发。"""
    result = _detect_transmutation(
        month_zhi='亥',
        mingju_zhis=['酉', '亥', '卯', '酉'],
        rizhu_gan='丁',
        force={'scores': {}},
        gan_he={},
    )
    assert result is None


def test_detect_transmutation_sanhe_priority_over_sanhui():
    """构造同时触发 三合 + 三会 的极端 case (理论物理不可能 4 支同时凑两个)，
    单独单元测试 _detect_transmutation 内部排序逻辑：
    用一个 mock-like input 模拟两个 combo 都通过 (mingju_zhis 含 5 支).
    """
    # 月令子 + 命局含申+辰 → 申子辰 三合
    # 月令子 + 命局含亥+丑 → 亥子丑 三会  (5 支总)
    result = _detect_transmutation(
        month_zhi='子',
        mingju_zhis=['申', '子', '辰', '亥', '丑'],   # 5 支：测试用
        rizhu_gan='丙',
        force={'scores': {}},
        gan_he={},
    )
    assert result is not None
    assert result['trigger']['type'] == 'sanHe'   # 三合优先
    assert len(result['alternateTriggers']) == 1
    assert result['alternateTriggers'][0]['type'] == 'sanHui'
```

- [ ] **Step 3.3: Write 3 build_yongshen 集成 tests**

Append to `paipan/tests/test_yongshen.py`:

```python
def test_build_yongshen_no_mingju_zhis_skips_transmutation():
    """build_yongshen() 不传 mingju_zhis (Plan 7.3 老调用方式) → 不挂 transmuted 字段。"""
    out = build_yongshen(
        rizhu_gan='丁',
        month_zhi='亥',
        force={'scores': {}, 'dayStrength': '中和'},
        geju='正官格',
        gan_he={},
        day_strength='中和',
        # mingju_zhis 不传
    )
    assert 'transmuted' not in out


def test_build_yongshen_with_mingju_zhis_no_combo_skips_transmutation():
    """传 mingju_zhis 但命局支不构成合局 → 也不挂 transmuted。"""
    out = build_yongshen(
        rizhu_gan='丁',
        month_zhi='未',
        force={'scores': {}, 'dayStrength': '中和'},
        geju='食神格',
        gan_he={},
        day_strength='中和',
        mingju_zhis=['酉', '未', '酉', '未'],   # 标准 1993 chart
    )
    assert 'transmuted' not in out


def test_build_yongshen_with_mingju_zhis_combo_attaches_transmuted():
    """命局自带亥卯未 → 挂 transmuted 字段, primaryReason 加 hint。"""
    out = build_yongshen(
        rizhu_gan='丁',
        month_zhi='亥',
        force={'scores': {}, 'dayStrength': '中和'},
        geju='正官格',
        gan_he={},
        day_strength='中和',
        mingju_zhis=['酉', '亥', '卯', '未'],
    )
    assert 'transmuted' in out
    t = out['transmuted']
    assert t['trigger']['type'] == 'sanHe'
    assert t['trigger']['wuxing'] == '木'
    assert t['to'] == '偏印格'
    assert '月令合局触发格局质变' in out['primaryReason']
```

- [ ] **Step 3.4: Run new tests**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py -v -k "transmutation or build_yongshen_no_mingju or build_yongshen_with_mingju"
```
Expected: 5 (detection) + 3 (build_yongshen) = 8 passed.

- [ ] **Step 3.5: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 570 + 8 = 578 passed.

> **If Plan 7.3 / 7.4 tests fail**: that's a contract regression. Most likely cause: `build_yongshen` signature change broke a test that called it positionally instead of kwarg. Fix by passing `mingju_zhis=None` explicitly OR by adding the new param at the end (already done in plan). Don't change the signature back; instead update the offending caller.

- [ ] **Step 3.6: Commit**

```bash
git add paipan/paipan/yongshen.py paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5a _detect_transmutation + build_yongshen 集成

_detect_transmutation 扫 SAN_HE_JU + SAN_HUI 找包含 month_zhi 的完整
合局, 按 三合>三会 优先级取一个, 调 _compute_virtual_geju_name 算
虚拟格局名, 调 geju_yongshen 重算格局候选, 组装 transmuted dict.
warning 按 §4.1 规则 (调候 + 转化后格局一致 → None; 与原格局不同
→ 加警告). build_yongshen 在 mingju_zhis 给定时调用并挂 transmuted
字段, primaryReason 加 hint. 5 detection + 3 集成 tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 5 个 Golden 集成 tests

**Files:**
- Modify: `paipan/tests/test_yongshen.py` (5 个 parametrized golden cases)

**Important pre-step**: spec §6.2 列的 5 个 birth_input 是 estimates。Codex 必须**先**用脚本验证每个真触发，再写 assertion。

- [ ] **Step 4.1: Verify each golden case birth_input actually triggers transmutation**

For each of the 5 candidate cases, run a one-liner to see what compute() produces:

```bash
# Case 1: 丁火亥月_亥卯未三合
uv run --package paipan python -c "
from paipan import compute
out = compute(year=1983, month=11, day=4, hour=0, minute=0, gender='male', city='北京')
sizhu = out['sizhu']
print('sizhu:', sizhu)
print('mingju_zhis:', [sizhu[k][1] for k in ['year','month','day','hour'] if sizhu.get(k)])
detail = out['yongshenDetail']
print('transmuted:', detail.get('transmuted'))
"
```

If `transmuted` is None or missing, the input doesn't actually trigger. Choose a different birth_input until you find 5 that DO trigger. Iterate. Once each case verified, lock the inputs.

For each verified case, capture:
- `birth_input` dict (year/month/day/hour/minute/gender/city)
- The actual `mingju_zhis` from compute()
- The expected `trigger.type`, `trigger.wuxing`, `to` (虚拟格局名)

You may need to adjust dates / cities to find triggering charts. The most common合局 触发盘 in real birth dates:
- 寅午戌 三合火 → very common in 夏季出生 + spring/autumn 时柱
- 申子辰 三合水 → common in 冬季 + spring/summer 时柱
- 寅卯辰 三会木 → uncommon (要月支 + 邻支两个组合)
- 巳午未 三会火 → uncommon

Use real-world common dates if convenient (e.g. famous people's bdays for sanity).

- [ ] **Step 4.2: Write parametrized golden tests with verified inputs**

After Step 4.1 yields 5 verified inputs, write the test:

```python
GOLDEN_TRANSMUTATION_CASES = [
    # Each entry: (label, birth_input, expected_trigger_type, expected_wuxing, expected_to)
    {
        'label':         '<verified label>',
        'input':         dict(year=..., month=..., day=..., hour=..., minute=...,
                              gender='...', city='...'),
        'trigger_type':  'sanHe' or 'sanHui',
        'trigger_wuxing': '木|火|土|金|水',
        'expected_to':   '<虚拟格局名>',
    },
    # ... 5 cases total
]


@pytest.mark.parametrize(
    'case',
    GOLDEN_TRANSMUTATION_CASES,
    ids=[c['label'] for c in GOLDEN_TRANSMUTATION_CASES],
)
def test_yongshen_transmutation_golden(case):
    """Plan 7.5a §6.2: real charts trigger transmutation as expected."""
    out = compute(**case['input'])
    detail = out['yongshenDetail']
    transmuted = detail.get('transmuted')
    assert transmuted is not None, f"{case['label']}: expected transmuted, got None"
    assert transmuted['trigger']['type'] == case['trigger_type']
    assert transmuted['trigger']['wuxing'] == case['trigger_wuxing']
    assert transmuted['to'] == case['expected_to']
    # candidate dict shape
    cand = transmuted['candidate']
    assert cand['method'] == '格局'
    assert cand.get('name')
    assert cand.get('source', '').startswith('子平真诠')
    # primaryReason hint added
    assert '月令合局触发格局质变' in detail['primaryReason']
```

- [ ] **Step 4.3: Run golden tests**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py::test_yongshen_transmutation_golden -v
```
Expected: 5 passed (one per case).

- [ ] **Step 4.4: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 578 + 5 = 583 passed.

- [ ] **Step 4.5: Commit**

```bash
git add paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(paipan): Plan 7.5a 5 golden transmutation 集成 cases

5 verified birth_input cases trigger 三合/三会 transmutation. Each
asserts trigger.type/wuxing, expected 虚拟格局 (.to), candidate dict
shape (method='格局' + name + source from 子平真诠), and primaryReason
hint presence. birth_input list locked after manual verification per
plan Step 4.1 (input estimates from spec §6.2 may have been replaced).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: context.py render + browser smoke

**Files:**
- Modify: `server/app/prompts/context.py` (extend `_render_yongshen_block`)
- Modify: `server/tests/unit/test_prompts_context_yongshen.py` (2 render tests)

- [ ] **Step 5.1: Read current `_render_yongshen_block` for insertion point**

Read `server/app/prompts/context.py`. Find Plan 7.3's `_render_yongshen_block` function. Identify where it iterates over `detail.get('candidates')` and where it iterates over `detail.get('warnings')`. The transmuted block goes **between** them.

- [ ] **Step 5.2: Insert transmuted rendering**

In `_render_yongshen_block`, after the `for c in detail.get('candidates') or []:` loop completes and before the `for w in detail.get('warnings') or []:` loop starts, insert:

```python
    # Plan 7.5a: transmutation block
    transmuted = detail.get('transmuted')
    if transmuted:
        trig = transmuted['trigger']
        lines.append(
            f"  ⟳ 月令变化  {transmuted['from']} → {transmuted['to']}  {trig['source']}"
        )
        cand = transmuted['candidate']
        cand_name = cand.get('name', '?')
        cand_note = cand.get('note', '')
        cand_src  = cand.get('source', '')
        line = f"      格局新候选：{cand_name}"
        if cand_note:
            line += f"（{cand_note}）"
        if cand_src:
            line += f"  {cand_src}"
        lines.append(line)
        if transmuted.get('warning'):
            lines.append(f"      ⚠ {transmuted['warning']}")
```

- [ ] **Step 5.3: Write 2 render tests**

Append to `server/tests/unit/test_prompts_context_yongshen.py` (the file Plan 7.3 created):

```python
def test_renders_transmuted_block_when_present():
    """Plan 7.5a §5.3: transmuted block renders with ⟳ glyph + new candidate line."""
    detail = {
        'primary': '甲木',
        'primaryReason': '以调候为主（注：月令合局触发格局质变，详见 transmuted 字段）',
        'candidates': [
            {'method': '调候', 'name': '甲木', 'note': '...', 'source': '穷通宝鉴·论丁火·六月'},
            {'method': '格局', 'name': '财（食神生财）', 'note': '...', 'source': '子平真诠·论食神'},
            {'method': '扶抑', 'name': '印 / 比劫', 'note': '...', 'source': '滴天髓·衰旺'},
        ],
        'warnings': [],
        'transmuted': {
            'trigger': {
                'type': 'sanHe', 'wuxing': '木', 'main': '卯',
                'zhi_list': ['亥', '卯', '未'], 'source': '三合亥卯未局',
            },
            'from': '正官格',
            'to': '偏印格',
            'candidate': {
                'method': '格局', 'name': '官（官印相生）',
                'sub_pattern': '官印相生', 'note': '偏印得官杀生',
                'source': '子平真诠·论印绶',
            },
            'warning': None,
            'alternateTriggers': [],
        },
    }
    paipan = {
        'sizhu': {'year': '癸酉', 'month': '己未', 'day': '丁酉', 'hour': '丁未'},
        'rizhu': '丁',
        'yongshen': '甲木',
        'yongshenDetail': detail,
    }
    text = compact_chart_context(paipan)
    assert '⟳ 月令变化' in text
    assert '正官格 → 偏印格' in text
    assert '三合亥卯未局' in text
    assert '格局新候选：官（官印相生）' in text
    assert '偏印得官杀生' in text
    assert '子平真诠·论印绶' in text


def test_renders_transmuted_warning_line():
    """Plan 7.5a §4.1: when warning present, ⚠ line appears under transmuted block."""
    detail = {
        'primary': '甲木',
        'primaryReason': '以调候为主（注：月令合局触发格局质变…）',
        'candidates': [
            {'method': '调候', 'name': '甲木', 'note': '', 'source': ''},
            {'method': '格局', 'name': '正官', 'note': '', 'source': ''},
            {'method': '扶抑', 'name': '印', 'note': '', 'source': ''},
        ],
        'warnings': [],
        'transmuted': {
            'trigger': {
                'type': 'sanHe', 'wuxing': '木', 'main': '卯',
                'zhi_list': ['亥', '卯', '未'], 'source': '三合亥卯未局',
            },
            'from': '正官格',
            'to': '偏印格',
            'candidate': {
                'method': '格局', 'name': '官（官印相生）',
                'note': '', 'source': '子平真诠·论印绶',
            },
            'warning': '月令合局后格局质变，原本"正官格"的取用法不再适用',
            'alternateTriggers': [],
        },
    }
    paipan = {
        'sizhu': {'year': '癸酉', 'month': '己未', 'day': '丁酉', 'hour': '丁未'},
        'rizhu': '丁',
        'yongshen': '甲木',
        'yongshenDetail': detail,
    }
    text = compact_chart_context(paipan)
    assert '月令合局后格局质变' in text
    assert '⚠' in text   # warning line glyph
```

- [ ] **Step 5.4: Run render tests**

```
uv run --package server pytest -q server/tests/unit/test_prompts_context_yongshen.py -v
```
Expected: 6 (Plan 7.3 baseline 4 + Plan 7.5a 2) passed.

- [ ] **Step 5.5: Run all 3 test suites**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
cd frontend && node --test tests/*.mjs
```

Expected:
- paipan: 583 passed (unchanged from Task 4)
- server: 435 + 2 = 437 passed
- frontend: 51 passed (zero touch)

- [ ] **Step 5.6: Boot dev servers**

```bash
# Terminal A
cd /Users/veko/code/usual/bazi-analysis/server && uv run --package server --with 'uvicorn[standard]' python -m uvicorn app.main:app --port 3101 --host 127.0.0.1

# Terminal B
cd /Users/veko/code/usual/bazi-analysis/frontend && npm run dev
```

- [ ] **Step 5.7: Browser smoke**

In browser at `http://localhost:5173`:

1. Login (live app uses 手机号 + DEV-mode SMS code surfaced in UI)
2. Submit form: use ONE of the 5 verified Task 4 transmutation cases (e.g., the `丁火亥月_亥卯未三合` case, whatever birth_input you locked in Step 4.1)
3. Verify chart panel left side looks IDENTICAL to Plan 7.4 smoke (no new visible frontend elements — frontend zero-touch)
4. Send chat: "**我命局格局有变化吗？请引用古籍说明。**" → assistant should reference the transmuted block and explain "原本X格 → 变成Y格" using ZPZQ-style language

Save screenshot to `.claire/plan75a-transmutation-smoke.png`.

- [ ] **Step 5.8: Sanity check on standard 1993 chart (no transmutation)**

```bash
uv run --package paipan python -c "
from paipan import compute
out = compute(year=1993, month=7, day=15, hour=14, minute=30, gender='male', city='长沙')
detail = out['yongshenDetail']
print('transmuted:', detail.get('transmuted'))
print('candidates length:', len(detail['candidates']))
print('primary:', detail['primary'])
"
```

Expected:
- `transmuted: None`
- `candidates length: 3`
- `primary: 甲木`

Confirms Plan 7.3 contract intact (standard chart unaffected).

- [ ] **Step 5.9: Commit (only if smoke clean)**

```bash
git add server/app/prompts/context.py server/tests/unit/test_prompts_context_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 7.5a render transmuted block in 用神 context

_render_yongshen_block extended: when yongshenDetail.transmuted is
present, append 3 lines (⟳ 月令变化 + 格局新候选 + optional ⚠ warning).
Block sits between candidates and warnings sections. Renders nothing
when transmuted absent (Plan 7.3 老盘向后兼容).

Browser smoke: standard 1993 chart unaffected (no transmutation).
Transmutation case verified: LLM引 transmuted block 解释格局变化.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If smoke reveals frontend regression or LLM ignores transmuted context, do NOT silently fix in this commit — report what you found and we'll triage.

---

## Self-Review Notes (for the executing engineer)

If any of these surface post-implementation, file a Plan 7.5a.1 follow-up rather than fixing inline:

1. **GEJU_RULES 对虚拟格局的覆盖度** — spec §3.4 / risk #1 已 frozen 10/10 覆盖. 但如果某个 trigger 弹出 transmuted.candidate 是 None (即 geju_yongshen 返回 None), 那是 GEJU_RULES 跟 _GEJU_NAME_TABLE 之间的 key 不匹配. 检查 GEJU_RULES.keys() 是否真有 '比肩格'/'劫财格'/'食神格' 等全部 10 个名字.

2. **多合局优先级 alternateTriggers 渲染** — v1 不渲染. 如果 chat 用户问 "我盘是不是同时有两个合局" 而 LLM 答不出, 加 render 在 transmuted 块尾再加一行 "另有备选合局：..."

3. **transmuted.from 是 '?' 的情况** — 当 original_geju_candidate 找不到 (理论上 Plan 7.3 总会产生格局 candidate, 但兜底防御了). 如果 chat 出现 "原本 ? 格" 这种丑陋字符串, 改成 "原本格局未定" 或者干脆不渲染 from.

4. **`_compute_virtual_geju_name` polarity 边界** — 测试用 丁火 做 day master 覆盖 12 月支 main 支 (10 出现). 如果换用 阳干 (甲/丙/戊/庚/壬) 或换用其他 阴干 (乙/己/辛/癸) 出现意外结果, 加一组 cross-day-master tests.

5. **三合 main 支选择** — SAN_HE_JU 表里写死 main 字段 (申子辰→子, 亥卯未→卯, 寅午戌→午, 巳酉丑→酉). 都是中气支. 如果古籍考证发现某些应该按头支或尾支算 polarity, 改 _compute_virtual_geju_name 的 main_zhi 来源.

6. **三会主气支** — 我们用 hui['zhi'][1] (中位) 作为 main. 古籍 (徐乐吾) 多数也是这样. 如果发现应该按 hui['dir'] 对应的"专气支" (北水=子, 东木=卯, 南火=午, 西金=酉) 算, 改成显式映射表.

7. **Plan 7.3 老 chart 跑通后是否真无回归** — Plan 7.3 的 10 golden case 没有任何盘命局自带 三合/三会 (实现细节 + 抽样巧合). 如果后续业务真盘里发现 Plan 7.3 老结果跟 7.5a 后产生的 yongshenDetail.primary 字符串不同 (理论上不该, primary 不重算), 那是 contract 漏洞, 调查 build_yongshen 是否意外改写了 primary.

8. **Browser smoke 找不到 transmutation 案例输入** — Task 4 Step 4.1 让 codex 自己验证. 如果 5 个候选都不触发, 撒网更广: 用 1900-2050 范围的随机日期跑 N=100 个 compute(), 统计 transmutation 触发率 (估计 ~5-15%), 从触发盘里挑 5 个有代表性的.
