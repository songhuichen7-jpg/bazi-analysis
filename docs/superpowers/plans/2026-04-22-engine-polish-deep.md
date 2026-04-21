# Plan 7.6 — Engine Polish Deep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3 deep polish items ship — 合化 adjacency 严格化 (命局内部 only) + 多元素用神 weighted avg (0.5/0.3/0.2) + li_liang 5-bin 升级激活 Plan 7.3 FUYI_CASES 的 极弱/极强 dead branches。Task 0 用 sampling 定经验阈值。前端零改动。

**Architecture:** 都是 internal algorithm tweaks。`_detect_ganhe/_detect_liuhe` 加 `source_idx` kwarg；`score_yun` 多元素 reduction 改 weighted avg；`li_liang.py` 加 2 个 threshold constants 扩 dayStrength 值集。Plan 7.3 FUYI_CASES 已 ship 5-entry (极弱/身弱/中和/身强/极强)，直接激活。Plan 7.7 reserved: #3 cross interaction。

**Tech Stack:** Python 3.12 · pytest. 无新依赖。

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-22-engine-polish-deep-design.md`. 发现与实际代码不符 inline 修 plan + commit 标注 catch.
2. **All field shapes unchanged** — Plan 7.3/7.4/7.5a/7.5b 的 yongshenDetail / xingyun / force 字段 shape 不变，仅**值**可能变
3. **前端零改动**
4. **Expected behavior changes**：
   - 多元素 primary 盘 score 可能从 喜→平 / 忌→大忌（max → weighted avg 下移）
   - 极端 dayStrength 盘 fuyi.name 从 "印 / 比劫" 变成 "印 + 比劫（同扶）" 类 compound
   - 这些是**明文 expected**，不是 regression — 但需要 per-case verify 新值合理
5. **No silent assertion loosening** — update 老测试的 expected 值时，每个变化手算 verify + commit 注明
6. **Tests baseline**: 609 paipan + 439 server + 51 frontend

## 目录最终形态

```
paipan/
├── paipan/
│   ├── xingyun.py              # MODIFY (~25 行)
│   │     - _detect_ganhe / _detect_liuhe 加 source_idx kwarg
│   │     - score_yun 多元素 reduction 改 weighted avg
│   ├── xingyun_data.py         # MODIFY (+3 行)
│   │     + YONGSHEN_WEIGHTS = [0.5, 0.3, 0.2]
│   ├── li_liang.py             # MODIFY (~10 行)
│   │     + 2 新 threshold constants (from Task 0 sampling)
│   │     + dayStrength 5-branch logic
│   ├── yongshen.py             # 不动
│   └── (其他不动)
├── scripts/
│   └── sample_day_strength.py  # NEW (Task 0 pre-task)
└── tests/
    ├── test_xingyun.py         # MODIFY (+9 + update ~5 existing)
    ├── test_xingyun_data.py    # MODIFY (+1)
    ├── test_force.py or test_li_liang.py  # MODIFY (+5)
    └── test_yongshen.py        # MODIFY (+2)
```

## Task 列表预览

- **Task 0** — Sampling pre-task: run script, output thresholds, commit to li_liang.py as constants
- **Task 1** — li_liang 5-bin: constants + dayStrength branch + 5 boundary tests
- **Task 2** — #1 adjacency: `_detect_ganhe`/`_detect_liuhe` 加 source_idx + 4 tests + audit call sites
- **Task 3** — #2 weighted avg: YONGSHEN_WEIGHTS + score_yun change + 5 tests + 1 data validity
- **Task 4** — FUYI_CASES 激活 tests: 2 新 tests for 极弱/极强 rule fires (Plan 7.3 dead code now alive)
- **Task 5** — Integration + update existing golden: run full suite, identify shifted label cases, hand-verify + update expected

---

## Task 0: Sampling pre-task (数据驱动阈值)

**Files:**
- Create: `paipan/scripts/sample_day_strength.py`
- Run once, capture output
- Will update `paipan/paipan/li_liang.py` thresholds in Task 1

- [ ] **Step 0.1: Audit actual field name for day_score**

Read `paipan/paipan/li_liang.py` to find the actual output field name. Plan 7.6 spec §4.3 has `day_score = force.get('dayScore')` but that might not be accurate.

```
grep -n "dayScore\|day_score\|dayStrength" paipan/paipan/li_liang.py | head -10
```

Note the actual field name used to expose the score. If field name differs, update script accordingly.

- [ ] **Step 0.2: Create `paipan/scripts/sample_day_strength.py`**

```python
"""Sample day_score distribution from N random birth_inputs (Plan 7.6 Task 0).

Used to determine empirical thresholds for 极弱 / 极强 bins.
Run once; commit the resulting threshold constants to li_liang.py.
"""
from __future__ import annotations

import random
from paipan import compute


N = 1000
SEED = 42
scores: list[int] = []
random.seed(SEED)

for i in range(N):
    year = random.randint(1900, 2030)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    hour = random.randint(0, 23)
    minute = random.randint(0, 59)
    gender = random.choice(['male', 'female'])
    city = '北京'
    try:
        result = compute(
            year=year, month=month, day=day,
            hour=hour, minute=minute,
            gender=gender, city=city,
        )
        force = result.get('force') or {}
        # TODO Step 0.1: confirm field name
        day_score = force.get('dayScore')
        if day_score is not None:
            scores.append(day_score)
    except Exception:
        continue

scores.sort()
n = len(scores)

def pct(p: float) -> int:
    return scores[min(int(n * p), n - 1)]

print(f"N (valid): {n}")
print(f"range: [{scores[0]}, {scores[-1]}]")
print(f"p5 = {pct(0.05)}")
print(f"p10 = {pct(0.10)}")
print(f"p25 = {pct(0.25)}")
print(f"p50 (median) = {pct(0.50)}")
print(f"p75 = {pct(0.75)}")
print(f"p90 = {pct(0.90)}")
print(f"p95 = {pct(0.95)}")
print()
print(f"Suggested BIN_JI_QIANG_THRESHOLD = {pct(0.95)}")
print(f"Suggested BIN_JI_RUO_THRESHOLD = {pct(0.05)}")
```

- [ ] **Step 0.3: Run sampling script**

```
uv run --package paipan python paipan/scripts/sample_day_strength.py
```

**Save output** — you'll need:
- `BIN_JI_QIANG_THRESHOLD = <p95 value>`
- `BIN_JI_RUO_THRESHOLD = <p5 value>`

Also sanity check:
- p5 should be a negative or small number
- p95 should be a positive larger number
- If they're unreasonable (e.g. both positive), the scoring function might be biased — investigate before proceeding.

- [ ] **Step 0.4: Commit the script**

```bash
git add paipan/scripts/sample_day_strength.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
chore(paipan): Plan 7.6 Task 0 day_score sampling script

Runs compute() on 1000 random birth_inputs (seed=42, city=北京)
and outputs day_score percentiles (p5/p10/p25/p50/p75/p90/p95)
for empirical threshold selection.

p5 → BIN_JI_RUO_THRESHOLD (身弱 vs 极弱 boundary)
p95 → BIN_JI_QIANG_THRESHOLD (身强 vs 极强 boundary)

Output locked in Plan 7.6 Task 1 commit (li_liang.py constants).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Record sampling output values in the subsequent Task 1 commit message for traceability.

---

## Task 1: li_liang 5-bin upgrade

**Files:**
- Modify: `paipan/paipan/li_liang.py` (add thresholds + extend branch)
- Modify: `paipan/tests/test_force.py` (or test_li_liang.py) — 5 boundary tests

- [ ] **Step 1.1: Read current li_liang.py dayStrength block**

Find the existing 3-branch block (Plan 7.3 ship, around line 191):

```python
if day_score >= SHEN_QIANG_THRESHOLD:
    day_strength = "身强"
elif day_score >= ZHONG_HE_THRESHOLD:
    day_strength = "中和"
else:
    day_strength = "身弱"
```

Note actual constant names + existing threshold values.

- [ ] **Step 1.2: Add 2 new threshold constants**

In `paipan/paipan/li_liang.py` near the existing thresholds:

```python
# Plan 7.6 §4.3 — data-driven 5-bin thresholds
# Values from Task 0 sampling (seed=42, N=1000)
# p95 → BIN_JI_QIANG_THRESHOLD; p5 → BIN_JI_RUO_THRESHOLD
BIN_JI_QIANG_THRESHOLD = <from Task 0 output>   # replace literal
BIN_JI_RUO_THRESHOLD = <from Task 0 output>      # replace literal
```

**Important**: use literal int/float from Task 0 output, NOT placeholders. Spec §4.3 has example values (60 / -25) but real values come from sampling.

- [ ] **Step 1.3: Extend dayStrength branch**

Replace the existing 3-branch logic:

```python
if day_score >= BIN_JI_QIANG_THRESHOLD:
    day_strength = "极强"
elif day_score >= SHEN_QIANG_THRESHOLD:    # existing constant
    day_strength = "身强"
elif day_score >= ZHONG_HE_THRESHOLD:      # existing constant
    day_strength = "中和"
elif day_score >= BIN_JI_RUO_THRESHOLD:
    day_strength = "身弱"
else:
    day_strength = "极弱"
```

- [ ] **Step 1.4: Write 5 boundary tests**

Create or append to `paipan/tests/test_force.py` (or `test_li_liang.py` if that's the existing file):

```python
from paipan.li_liang import (
    BIN_JI_QIANG_THRESHOLD,
    SHEN_QIANG_THRESHOLD,
    ZHONG_HE_THRESHOLD,
    BIN_JI_RUO_THRESHOLD,
)
# You may need to expose the classifier as a function, OR test via compute()


def test_day_strength_极强_at_and_above_ji_qiang_threshold():
    """score >= BIN_JI_QIANG_THRESHOLD → '极强'."""
    # Find a birth_input whose day_score >= threshold, OR directly test classifier
    # If no exposed classifier, use compute + force dict lookup
    ...   # implementation: Task 1 engineer to determine based on li_liang.py API


def test_day_strength_身强_between_shen_qiang_and_ji_qiang():
    """SHEN_QIANG_THRESHOLD <= score < BIN_JI_QIANG_THRESHOLD → '身强'."""
    ...


def test_day_strength_中和_between_zhong_he_and_shen_qiang():
    ...


def test_day_strength_身弱_between_ji_ruo_and_zhong_he():
    ...


def test_day_strength_极弱_below_ji_ruo_threshold():
    ...
```

**NOTE**: the exact implementation depends on how li_liang.py exposes day_score / dayStrength. Two options:
- (a) If there's a standalone classifier function → unit test directly
- (b) Otherwise test via `compute()` with birth_inputs chosen to land in each bin — use Task 0 sampling output to pick representative inputs

Task 1 engineer picks (a) if possible, (b) otherwise. Document choice.

- [ ] **Step 1.5: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_force.py -v -k "day_strength"
```
Expected: 5 passed.

- [ ] **Step 1.6: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected outcome: Plan 7.3/7.4/7.5a/7.5b yongshenDetail-related tests may start failing if some golden-case charts land in the newly-active 极弱/极强 bins. **This is expected**. Do NOT fix them in this task — Task 5 handles golden updates.

If you see failures in test_yongshen_*_golden or test_xingyun_*_golden, record the failing test names + the specific case label so Task 5 can address them. Run full suite anyway so we know the damage surface.

**If no regression**: 609 + 5 = 614 passed. Proceed.

**If regressions** (expected for some charts): report test names + counts. Proceed to Task 2 anyway. Task 5 will update these golden assertions.

- [ ] **Step 1.7: Commit**

```bash
git add paipan/paipan/li_liang.py paipan/tests/test_force.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.6 #4 li_liang 5-bin upgrade

Add BIN_JI_QIANG_THRESHOLD (=<value>, from Task 0 sampling p95) and
BIN_JI_RUO_THRESHOLD (=<value>, from Task 0 sampling p5). Extend
day_strength classifier from 3 bins to 5: 极弱 / 身弱 / 中和 / 身强 / 极强.

Task 0 sampling stats (seed=42, N=1000):
  p5 = <value>, p95 = <value>
  median = <value>

Activates Plan 7.3 FUYI_CASES reserved 极弱/极强 rules
(compound 用神 '印 + 比劫（同扶）' / '官杀 + 食伤（双泄）').

Expected downstream: ~10% boundary charts in 7.3/7.4/7.5a/7.5b golden
suites shift their yongshenDetail.primary string. Updates in Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Fill in `<value>` placeholders with real Task 0 numbers.

---

## Task 2: #1 adjacency 严格化

**Files:**
- Modify: `paipan/paipan/xingyun.py` (`_detect_ganhe` / `_detect_liuhe`)
- Modify: `paipan/tests/test_xingyun.py` (+4 adjacency tests)

- [ ] **Step 2.1: Audit existing call sites**

```
grep -rn "_detect_ganhe\|_detect_liuhe" paipan/paipan/
```

Expected: only `_score_gan_to_yongshen` and `_score_zhi_to_yongshen` in xingyun.py call them, with `yun_gan` (external) as first arg. Plan 7.3/7.5a/7.5b yongshen.py should NOT call them (命局内部合化 is handled by Plan 7.4's xingyun path which always views yun_gan as external).

**If audit confirms external-only usage** → adjacency constraint is **forward-compat** for Plan 7.7 cross interaction; current behavior unchanged. Proceed.

**If audit finds命局内部 call site** → disclose location, discuss with reviewer before Task 2 proceeds.

- [ ] **Step 2.2: Add `source_idx` kwarg to `_detect_ganhe`**

```python
def _detect_ganhe(
    gan: str,
    mingju_gans: list[str],
    *,
    source_idx: int | None = None,
) -> str | None:
    """Detect 干合化.
    
    Plan 7.6 §4.1:
      - source_idx is None (gan is external, 大运/流年) → any-position pair
      - source_idx given (gan is mingju_gans[source_idx]) → only adjacent pair
        (abs(idx - source_idx) == 1) counts
    
    Plan 7.4 default (external) path preserved.
    """
    for idx, mg in enumerate(mingju_gans):
        if mg == gan:
            continue   # self-pair doesn't count
        if source_idx is not None and abs(idx - source_idx) != 1:
            continue   # 命局内部严格相邻
        wx = GAN_HE_TABLE.get(frozenset({gan, mg}))
        if wx:
            return wx
    return None
```

- [ ] **Step 2.3: Add `source_idx` kwarg to `_detect_liuhe`** (同模式)

```python
def _detect_liuhe(
    zhi: str,
    mingju_zhis: list[str],
    *,
    source_idx: int | None = None,
) -> str | None:
    for idx, mz in enumerate(mingju_zhis):
        if mz == zhi:
            continue
        if source_idx is not None and abs(idx - source_idx) != 1:
            continue
        wx = ZHI_LIUHE_TABLE.get(frozenset({zhi, mz}))
        if wx:
            return wx
    return None
```

- [ ] **Step 2.4: Write 4 adjacency tests**

Append to `paipan/tests/test_xingyun.py`:

```python
def test_detect_ganhe_adjacent_命局_fires():
    """命局干 [甲, 己, ...] 年-月相邻 → _detect_ganhe('甲', [甲,己,乙,丙], source_idx=0) → 土."""
    result = _detect_ganhe('甲', ['甲', '己', '乙', '丙'], source_idx=0)
    assert result == '土'


def test_detect_ganhe_non_adjacent_命局_misses():
    """命局干 [甲, 乙, 己, 丙] 年-日 不相邻 (idx 0 and 2) → 严格模式 → None."""
    result = _detect_ganhe('甲', ['甲', '乙', '己', '丙'], source_idx=0)
    # 甲己 at idx 0 vs 2 → diff=2 ≠ 1 → strict reject → None
    assert result is None


def test_detect_ganhe_external_any_position_fires():
    """External (Plan 7.4 default) 大运/流年干 → source_idx=None → 任意位置都合化."""
    result = _detect_ganhe('甲', ['乙', '丙', '丁', '己'])   # source_idx 默认 None
    assert result == '土'   # 甲己 合化土, idx=3 in mingju, 任意位置


def test_detect_liuhe_adjacent_命局_fires():
    """命局支 [寅, 亥, ...] → _detect_liuhe('寅', [寅,亥,子,丑], source_idx=0) → 木."""
    result = _detect_liuhe('寅', ['寅', '亥', '子', '丑'], source_idx=0)
    assert result == '木'   # 寅亥合化木, idx 0-1 相邻


def test_detect_liuhe_non_adjacent_命局_misses():
    """命局支 [寅, 子, 亥, 丑] → 寅亥 at idx 0-2 不相邻 → None."""
    result = _detect_liuhe('寅', ['寅', '子', '亥', '丑'], source_idx=0)
    assert result is None


def test_detect_liuhe_external_any_position_fires():
    """External 大运/流年支 → 任意位置合化."""
    result = _detect_liuhe('寅', ['子', '丑', '未', '亥'])
    assert result == '木'
```

总共 6 tests (original spec 说 4, 实际写出来是 6 —— 6 更全面，接受)。

- [ ] **Step 2.5: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v -k "detect_ganhe or detect_liuhe" 
```

Expected: 2 (Plan 7.4 ship) + 2 (Plan 7.5b ship) + 6 (Plan 7.6 new) = 10 passed.

- [ ] **Step 2.6: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: same count as end of Task 1 + 6. If anything fails that didn't fail at end of Task 1, it's because adjacency behavior **changed for mingju-internal path** — audit revealed this path is currently dead (no callers pass source_idx). So no new regressions expected. Proceed.

- [ ] **Step 2.7: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.6 #1 合化 adjacency 严格化

_detect_ganhe / _detect_liuhe gain source_idx kwarg:
  - source_idx=None (external gan/zhi, 大运/流年) → any-position pair
    (Plan 7.4 default behavior preserved)
  - source_idx=i (internal 命局 gan/zhi at position i) → only adjacent
    pairs (abs(other_idx - i) == 1) count

Audit confirmed current callers are all external-path (xingyun's
yun_gan vs mingju_gans), so current behavior unchanged. Strict
adjacency is forward-compat for Plan 7.7 cross interaction.

6 new tests: adjacent fires, non-adjacent misses, external always fires
(for both 干合 and 六合).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: #2 多元素用神 weighted average

**Files:**
- Modify: `paipan/paipan/xingyun_data.py` (add YONGSHEN_WEIGHTS)
- Modify: `paipan/paipan/xingyun.py` (score_yun reduction)
- Modify: `paipan/tests/test_xingyun.py` (+5 weighted tests)
- Modify: `paipan/tests/test_xingyun_data.py` (+1 YONGSHEN_WEIGHTS validity)

- [ ] **Step 3.1: Add YONGSHEN_WEIGHTS to `xingyun_data.py`**

Append:

```python
# Plan 7.6 §4.2 — 多元素用神 weighted average 权重 (递减)
# 单元素 → weights=[1.0]; 2 元素 → [0.625, 0.375]; 3 元素 → [0.5, 0.3, 0.2];
# 4+ 元素 → 第 4 及以后权重 0 (截断保护)
YONGSHEN_WEIGHTS: list[float] = [0.5, 0.3, 0.2]
```

- [ ] **Step 3.2: Modify `score_yun` reduction**

Find the existing multi-element loop in `score_yun` (Plan 7.4 Task 5 ship):

```python
best = None
for ys_wx in ys_wuxings:
    ...
    candidate = (total, gan_eff, zhi_eff, ys_wx)
    if best is None or candidate[0] > best[0]:
        best = candidate

final_score, gan_eff, zhi_eff, winning_wx = best
```

Replace with:

```python
sub_results = []
for ys_wx in ys_wuxings:
    gan_d, gan_r, gan_m = _score_gan_to_yongshen(yun_gan, ys_wx, mingju_gans)
    zhi_d, zhi_r, zhi_m = _score_zhi_to_yongshen(yun_zhi, ys_wx, mingju_zhis)
    total = gan_d + zhi_d
    sub_results.append((
        total,
        {'delta': gan_d, 'reason': gan_r, 'mech': gan_m},
        {'delta': zhi_d, 'reason': zhi_r, 'mech': zhi_m},
        ys_wx,
    ))

# Plan 7.6 §4.2: weighted average (0.5/0.3/0.2)
n = len(sub_results)
weights = YONGSHEN_WEIGHTS[:n]
if weights and sum(weights) > 0:
    weights = [w / sum(weights) for w in weights]   # 归一化
    final_score_raw = sum(w * r[0] for w, r in zip(weights, sub_results))
    final_score = round(final_score_raw)
else:
    final_score = 0

# winning element: 最大 sub_score 对应的 (for note + winningYongshenElement)
best_idx = max(range(n), key=lambda i: sub_results[i][0]) if n > 0 else 0
if n > 0:
    winning_wx = sub_results[best_idx][3]
    gan_eff = sub_results[best_idx][1]
    zhi_eff = sub_results[best_idx][2]
else:
    # 不应到达但兜底
    winning_wx = ''
    gan_eff = {'delta': 0, 'reason': '', 'mech': []}
    zhi_eff = {'delta': 0, 'reason': '', 'mech': []}
```

Note: add `from paipan.xingyun_data import YONGSHEN_WEIGHTS` to imports if not already there.

- [ ] **Step 3.3: Write 5 weighted tests**

Append:

```python
from paipan.xingyun_data import YONGSHEN_WEIGHTS


def test_score_yun_single_element_unchanged_by_weights():
    """单元素用神: weights=[1.0] → 结果跟 Plan 7.4 max 一致."""
    out = score_yun('癸亥', '甲木', [], [])
    # 癸亥 vs 甲木: 癸生甲 +2, 亥生甲 +2 = +4 → 大喜 (Plan 7.4 same result)
    assert out['label'] == '大喜'
    assert out['score'] == 4


def test_score_yun_multi_element_weighted_avg_applied():
    """多元素用神: weights=[0.5, 0.3, 0.2] → 不再 max(sub_scores)."""
    # 甲木/戊土/庚金 vs 庚申
    # vs 木: 庚克 -2 + 申克 -2 = -4
    # vs 土: 用神生庚 -1 + 用神生申 -1 = -2
    # vs 金: 庚比 +1 + 申比 +1 = +2
    # Plan 7.4 max=+2 (喜); Plan 7.6 weighted: 0.5·-4 + 0.3·-2 + 0.2·2 = -2.2 → round(-2.2) = -2 (忌)
    out = score_yun('庚申', '甲木 / 戊土 / 庚金', [], [])
    assert out['label'] == '忌'
    assert out['score'] == -2


def test_score_yun_winningYongshenElement_still_max_not_weighted():
    """winningYongshenElement 仍是 max sub_score 对应 (for explainability)."""
    out = score_yun('庚申', '甲木 / 戊土 / 庚金', [], [])
    assert out['winningYongshenElement'] == '庚金'   # sub_score max = +2


def test_score_yun_two_element_weights_normalized():
    """2 元素用神: weights = [0.5, 0.3] 归一化 → [0.625, 0.375]."""
    # 用神 '甲木 / 丙火' vs 壬子
    # vs 木: 壬生 +2, 子生 +2 = +4
    # vs 火: 用神(火)生壬 0? wait 水克火 → 壬克 -2; 子克 -2 = -4
    # weighted: 0.625·4 + 0.375·-4 = 2.5 + -1.5 = 1.0 → round(1) = 1 → 平
    out = score_yun('壬子', '甲木 / 丙火', [], [])
    assert out['score'] in {0, 1}   # 边界 rounding tolerance
    assert out['label'] == '平'


def test_score_yun_four_element_weight_truncation():
    """4 元素用神: weights = [0.5, 0.3, 0.2, 0] → 第 4 元素 score 不计入最终.
    
    实际中 4 元素 primary 罕见, 这个 case 主要测 rounding/truncation 不崩.
    """
    # 用神 '甲木 / 丙火 / 戊土 / 庚金' vs 癸亥
    # vs 木: 癸生 +2, 亥生 +2 = +4
    # vs 火: 癸克 -2, 亥克 -2 = -4
    # vs 土: 用神(土)克癸 0, 用神克亥 0 = 0
    # vs 金: 用神(金)被癸泄 -1, 被亥泄 -1 = -2
    # weights = [0.5, 0.3, 0.2, 0] normalized: same (sum=1.0)
    # weighted = 0.5·4 + 0.3·-4 + 0.2·0 + 0·-2 = 2 - 1.2 + 0 + 0 = 0.8 → round(1) = 1 → 平
    out = score_yun('癸亥', '甲木 / 丙火 / 戊土 / 庚金', [], [])
    assert out['score'] in {0, 1}   # 边界 rounding
    assert out['label'] == '平'
```

- [ ] **Step 3.4: Write YONGSHEN_WEIGHTS validity test**

Append to `paipan/tests/test_xingyun_data.py`:

```python
def test_yongshen_weights_valid():
    """Plan 7.6 §4.2: YONGSHEN_WEIGHTS = [0.5, 0.3, 0.2], sum=1.0, decreasing."""
    from paipan.xingyun_data import YONGSHEN_WEIGHTS
    assert YONGSHEN_WEIGHTS == [0.5, 0.3, 0.2]
    assert abs(sum(YONGSHEN_WEIGHTS) - 1.0) < 1e-9
    # 递减
    for i in range(1, len(YONGSHEN_WEIGHTS)):
        assert YONGSHEN_WEIGHTS[i] <= YONGSHEN_WEIGHTS[i-1]
```

- [ ] **Step 3.5: Run new tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py paipan/tests/test_xingyun_data.py -v -k "weighted or yongshen_weights or single_element or winningYongshen"
```
Expected: 6 passed (5 in test_xingyun + 1 in test_xingyun_data).

- [ ] **Step 3.6: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: more failures now surface — specifically Plan 7.4 golden cases with multi-element primary whose label was asserted. Record failing test names. **These will be updated in Task 5**, not this task.

If you see fresh failures in Plan 7.4 tests, record them:
- Case label + Plan 7.4 expected label + new actual label
- Brief note on why the new value is reasonable (e.g. "weighted avg shifted 喜 +2 → 平 +1 because max hid the -4 sub_score for 木 element")

Phase-through to Task 4; Task 5 handles updates.

- [ ] **Step 3.7: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/paipan/xingyun_data.py paipan/tests/test_xingyun.py paipan/tests/test_xingyun_data.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.6 #2 多元素用神 weighted average

Replace score_yun's multi-element reduction from max(sub_scores) to
weighted-average with YONGSHEN_WEIGHTS = [0.5, 0.3, 0.2] (normalized).
winningYongshenElement still picks max sub_score (for explainability).

Per-case impact:
  - Single element: unchanged (weights=[1.0])
  - 2 element: weights normalized to [0.625, 0.375]
  - 3 element: [0.5, 0.3, 0.2]
  - 4+ element: 4th权重=0 truncation (rare)

Fixes Plan 7.4 偏乐观 bug: max hid cases where 1 element was heavily
生扶 while others were heavily 克耗. Expected downstream: ~3-5 Plan 7.4
multi-element golden cases need label updates (Task 5).

6 new tests (5 weighted behavior + 1 data validity).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: FUYI_CASES 极弱/极强 激活 tests

**Files:**
- Modify: `paipan/tests/test_yongshen.py` (+2 tests)

**Background**: Plan 7.3 shipped 5-entry FUYI_CASES (yongshen_data.py); 极弱/极强 rules were dead code because li_liang only emit 3 bins. After Task 1 shipped 5-bin, these rules start firing on ~10% edge charts. This Task adds explicit tests verifying the FUYI rules execute correctly on compound dayStrength values.

- [ ] **Step 4.1: Write 极弱/极强 fuyi 触发 tests**

Append to `paipan/tests/test_yongshen.py`:

```python
def test_fuyi_yongshen_极弱_returns_compound_扶身():
    """Plan 7.6: 极弱 dayStrength → FUYI_CASES '印 + 比劫（同扶）' rule fires."""
    from paipan.yongshen import fuyi_yongshen
    res = fuyi_yongshen({'scores': {}}, '极弱')
    assert res is not None
    assert res['method'] == '扶抑'
    assert '印' in res['name'] and '比劫' in res['name']   # compound form
    assert '+' in res['name']   # compound marker (同扶)
    assert '滴天髓' in res['source']


def test_fuyi_yongshen_极强_returns_compound_双泄():
    """Plan 7.6: 极强 dayStrength → FUYI_CASES '官杀 + 食伤（双泄）' rule fires."""
    from paipan.yongshen import fuyi_yongshen
    res = fuyi_yongshen({'scores': {}}, '极强')
    assert res is not None
    assert res['method'] == '扶抑'
    assert '官杀' in res['name'] and '食伤' in res['name']
    assert '+' in res['name']
    assert '滴天髓' in res['source']
```

- [ ] **Step 4.2: Run new tests**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py -v -k "极弱 or 极强"
```
Expected: 2 passed (FUYI_CASES has always had these rules; they just never fired before).

- [ ] **Step 4.3: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: previous failures persist (from Task 1 + Task 3); these 2 new tests add to green count. Track failure list for Task 5.

- [ ] **Step 4.4: Commit**

```bash
git add paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(paipan): Plan 7.6 #4 FUYI_CASES 极弱/极强 rule activation tests

Plan 7.3 shipped 5-entry FUYI_CASES including '极弱 → 印 + 比劫（同扶）'
and '极强 → 官杀 + 食伤（双泄）', but these rules were dead code because
li_liang only emitted 3-bin dayStrength. Plan 7.6 Task 1 activated 5-bin
dayStrength. These 2 tests verify the compound 用神 rules fire with the
correct dayStrength values passed in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Integration + update existing golden cases

**Files:**
- Modify: `paipan/tests/test_xingyun.py` (update Plan 7.4 multi-element golden case expected labels)
- Modify: `paipan/tests/test_yongshen.py` (update Plan 7.3/7.5a/7.5b golden case expected primary, if any shifted)
- Modify: `paipan/tests/test_prompts_context_xingyun.py` (update if any render tests break)
- Optional other test files as needed

This is a hand-verify-and-update task. No new test logic, just updating `expected` values to reflect Plan 7.6's expected behavior changes.

- [ ] **Step 5.1: Run full suite and list all failures**

```
uv run --package paipan pytest -n auto -q paipan/tests/ 2>&1 | tee /tmp/plan76_failures.log
uv run --package server pytest -n auto -q server/tests/ 2>&1 | tee -a /tmp/plan76_failures.log
```

Expected failures (approximate from spec §6.1):
- Plan 7.4 multi-element golden cases: ~3-5 label shifts
- Plan 7.3/7.5a/7.5b edge-bin charts: ~几个 yongshenDetail.primary 字符串变
- Plan 7.5b xingyun dayun/liunian transmuted downstream changes: possibly几个

Record each failing test name + the exception message showing `expected != actual`.

- [ ] **Step 5.2: Hand-verify each failure**

For each failing case:
1. Read the test assertion and Plan 7.4/5a/5b before vs Plan 7.6 after values
2. Manual math:
   - If multi-element weighted avg: compute sub_scores, weighted avg, verify new label boundary
   - If 5-bin activation: check what dayStrength the chart now lands in, verify FUYI rule produces expected compound primary
   - If downstream (7.5a/5b transmuted.candidate.name shifted via geju_yongshen rules): verify GEJU_RULES still produces a valid candidate
3. If new value is mathematically correct: update expected
4. If new value looks WRONG: STOP, investigate — might be a Task 1-4 bug

- [ ] **Step 5.3: Update expected values**

Edit the test assertions. For each change:
```python
# OLD (Plan 7.4 ship):
# assert case['expected_label'] == '喜'
# NEW (Plan 7.6):
# assert case['expected_label'] == '平'   # Plan 7.6 weighted avg: max +2 → weighted +1, see commit <SHA>
```

Prefer inline comments vs block comments for `# Plan 7.6: ...` explanation.

For Plan 7.4 golden cases (`GOLDEN_XINGYUN_CASES` parametrize), update the expectation dicts.

For Plan 7.3/7.5a/7.5b golden cases, if some chart's yongshenDetail.primary changed, update the assertion's expected substring (most tests check substring `'甲木' in primary` rather than full equality).

- [ ] **Step 5.4: Run full suite, confirm all green**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
cd frontend && node --test tests/*.mjs
```

Expected:
- paipan: ≥ 626 (Task 0-4 new + updates land in the same test count, +17 new minus any net churn)
- server: 439
- frontend: 51

- [ ] **Step 5.5: Browser smoke**

Pick one chart from each category:
1. A multi-element primary chart (Plan 7.4 verified golden with 3+ element primary, e.g. 丙亥 type)
2. An edge-bin chart (Task 0 sampling's p95 or p5 range)

Boot dev servers, log in, submit each, chat "未来十年怎么样？" and "我的用神是什么？" for each. Verify:
- Render block structure unchanged
- LLM reply cites reasonable 用神/评分 values
- No visible frontend regression

Screenshot save: `.claire/plan76-engine-polish-smoke.png`

- [ ] **Step 5.6: Commit**

```bash
git add paipan/tests/ server/tests/
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(paipan/server): Plan 7.6 update existing goldens for expected shifts

Plan 7.6 Task 1-3 changes cascaded to existing golden cases:

Plan 7.4 multi-element primary cases (weighted avg vs max):
  - <case 1>: score X → Y (label A → B) — <1-line reason>
  - <case 2>: ...
  (list all updated cases)

Plan 7.3/7.5a/7.5b edge-bin dayStrength cases (5-bin activation):
  - <case 1>: yongshenDetail.primary "<old>" → "<new>" — <reason>
  (list all updated cases)

All changes hand-verified: 新 expected 值 mathematically correct AND
semantically reasonable (compound 用神 rules fire on 极弱/极强; weighted
avg reflects multi-element influence honestly).

Browser smoke: <describe what you verified>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes (for the executing engineer)

If any of these surface post-implementation, file a Plan 7.6.1 follow-up:

1. **Task 0 sampling p95/p5 不合理** (e.g., both positive, or unreasonably extreme) — 可能 li_liang scoring algorithm 有 bias. 修它 out of Plan 7.6 scope; disclose finding, use spec §4.3 的 60/-25 placeholder 值 continuation, Plan 7.6.1 调 algorithm.

2. **Task 2 adjacency audit 发现有命局内部调用** — 不在 xingyun.py 之外，而在 yongshen.py 的 Plan 7.3 逻辑里。如果真有，那 Plan 7.6 的 adjacency change 不是 forward-compat 了，是 breaking change — disclose location + 跟 reviewer 讨论 before 改.

3. **Task 3 weighted avg 让太多 case 变 label** — 如果 update 的 case 数量超 20，spec §9 risk #1 触发，需要考虑是否 adjusting 权重 (e.g. [0.6, 0.25, 0.15]) 减少 disruption.

4. **Task 5 更新 case 后 LLM smoke 感觉奇怪** — 例如某个盘 Plan 7.4 觉得"大喜"被改成"平"，LLM 把原来的"运势非常好"叙事变成"中性" - 如果这感觉反直觉，重读那一 case 的 sub_scores，可能 weighted avg 公式 tweak needed.

5. **5-bin activation 导致 Plan 7.5a/5b transmutation 下游 cascade** — transmuted.candidate.name 原本取自 geju_yongshen，新 dayStrength 可能让那里也变（force 变→scores 变→GEJU rules 条件触发不同）。Task 5 hand-verify 时注意 chart.paipan.yongshenDetail.transmuted 的 before/after.

6. **Task 0 sampling field name 'dayScore' 不对** — Spec §4.3 + Task 0 Step 0.1 已警告. Fix script 再跑, 不要把错 field 的输出当真实分布.
