# Plan 7.7 — 大运/流年 Cross Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 流年评分时 mingju 扩展含大运干支 → 流年-大运 cross 干合 / 六合 modifier 自动激活。3 行代码改动 + 4 个测试。Plan 7.x 系列收官。

**Architecture:** 单点改动 `xingyun.py` build_xingyun() 流年 loop 内的 score_yun 调用。score_yun 接口不变，只是 mingju 上下文扩了 1 干 1 支。无新模块，无新数据，无新依赖。

**Tech Stack:** Python 3.12 · pytest. 无新依赖。

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-22-cross-interaction-design.md`. plan 与 spec 不符 inline 修 plan + commit 标注 catch.
2. **score_yun 接口不变** —— 仅外部调用方扩 mingju 列表
3. **Plan 7.4 33 score golden 不破契约** — label shift < 5 个属预期；hand-verify + update 不算 regression
4. **前端零改动**
5. **Plan 7.6 mechanism_tags 重用** —— 不加新 tag namespace
6. **Tests baseline**: 628 paipan + 439 server + 51 frontend

## 目录最终形态

```
paipan/
├── paipan/
│   └── xingyun.py              # MODIFY (~3 行) — build_xingyun 流年 loop 内 mingju 扩展
└── tests/
    └── test_xingyun.py         # MODIFY (+4 tests + 0-5 updated existing)
```

无新文件。无新依赖。

## Task 列表预览

- **Task 1** — Single-point change: extend流年 mingju + 3 unit tests
- **Task 2** — Golden integration test + browser smoke + handle Plan 7.4 case shifts (if any)

每 task 独立 commit + push。Task 2 含 verification + browser smoke。

---

## Task 1: Single-point modification + 3 unit tests

**Files:**
- Modify: `paipan/paipan/xingyun.py` (流年 loop, ~3 行)
- Modify: `paipan/tests/test_xingyun.py` (+3 unit tests)

- [ ] **Step 1.1: Read current build_xingyun 流年 loop**

Read `paipan/paipan/xingyun.py` around line 478-509. Find the existing structure:

```python
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
            ...
        )
    
    ln_entries.append({...})
```

Confirm the outer-loop variable `ganzhi` (current 大运 ganzhi) is in scope for the 流年 inner loop.

- [ ] **Step 1.2: Extend mingju context in score_yun call**

Modify the 流年 score_yun call:

```python
# 流年 evaluations within this 大运
ln_entries = []
for ly in entry.get('liunian', []):
    # Plan 7.7: extend mingju with 大运 干支 for cross-interaction modifier detection
    extended_gans = mingju_gans + [ganzhi[0]]
    extended_zhis = mingju_zhis + [ganzhi[1]]
    ly_score = score_yun(
        ly['ganzhi'], yongshen_primary, extended_gans, extended_zhis
    )

    # Plan 7.5b: liunian-level transmutation detection (with dedup against dayun)
    # NOTE: transmutation 仍用 base mingju_zhis (不含大运), 因为 transmutation
    # 的 dedup logic 已经在 _detect_xingyun_transmutation 内部处理大运参与。
    liunian_transmuted = None
    if chart_context:
        liunian_transmuted = _detect_xingyun_transmutation(
            month_zhi=chart_context['month_zhi'],
            base_mingju_zhis=mingju_zhis,   # NOT extended_zhis — Plan 7.5b layer separate
            dayun_zhi=ganzhi[1],
            liunian_zhi=ly['ganzhi'][1],
            ...
        )
    
    ln_entries.append({...})
```

**Important**: transmutation detection uses base `mingju_zhis` (not extended), because Plan 7.5b's `_detect_xingyun_transmutation` 已经按 Plan 7.5b §3.3 自己做 dedup logic（with-大运 vs baseline）。两层不混。Plan 7.7 的 extension 只影响 score_yun 评分层。

- [ ] **Step 1.3: Write 3 unit tests**

Append to `paipan/tests/test_xingyun.py`:

```python
def test_cross_interaction_dayun_gan_extends_mingju_for_liunian_score():
    """Plan 7.7: 大运庚 + 流年乙 → 乙庚合化金 modifier 应在流年 mechanisms 里."""
    # 构造一个命局: 月柱含庚, 流年是乙年, 大运是庚X (X is some 支)
    # 简单方式: 用 build_xingyun 直接调，构造 mock dayun
    from paipan.xingyun import build_xingyun
    
    # Mock dayun with 庚X 大运 + 乙Y 流年
    mock_dayun = {
        'list': [
            {
                'index': 1, 'ganzhi': '庚午',
                'startAge': 5, 'startYear': 2000, 'endYear': 2009,
                'liunian': [
                    {'year': 2005, 'ganzhi': '乙酉', 'age': 10},
                ],
            },
        ],
    }
    # 命局没甲 (避免命局自带合化干扰), 用 yongshen_primary='火' 让 metal 影响有信号
    # 实际上对 yongshen='水' 来说乙庚合金 是 modifier (金生水转助)
    out = build_xingyun(
        dayun=mock_dayun,
        yongshen_detail={'primary': '癸水'},
        mingju_gans=['丁', '丙', '己', '辛'],   # 注意 不含 乙 庚, 避免命局自带乙庚合
        mingju_zhis=['未', '寅', '卯', '亥'],
        current_year=2010,
        chart_context=None,    # transmutation skip, 只测 cross interaction modifier
    )
    
    # 流年 2005 (乙酉) 在大运 1 (庚午) 内
    liunian_entries = out['liunian']['1']
    assert len(liunian_entries) == 1
    ly_2005 = liunian_entries[0]
    assert ly_2005['year'] == 2005
    
    # mechanisms 应该包含合化金 modifier (乙庚合化金, 金生水→转助)
    assert any('合化' in m and '金' in m for m in ly_2005['mechanisms']), \
        f"expected 干合化金 modifier in mechanisms, got: {ly_2005['mechanisms']}"


def test_cross_interaction_dayun_zhi_extends_mingju_for_liunian_score():
    """Plan 7.7: 大运卯 + 流年戌 → 卯戌合化火 modifier 应在流年 mechanisms 里."""
    from paipan.xingyun import build_xingyun
    
    mock_dayun = {
        'list': [
            {
                'index': 1, 'ganzhi': '丁卯',
                'startAge': 5, 'startYear': 2000, 'endYear': 2009,
                'liunian': [
                    {'year': 2006, 'ganzhi': '丙戌', 'age': 11},
                ],
            },
        ],
    }
    out = build_xingyun(
        dayun=mock_dayun,
        yongshen_detail={'primary': '甲木'},
        mingju_gans=['庚', '己', '癸', '辛'],
        mingju_zhis=['申', '丑', '巳', '酉'],   # 不含 卯 戌, 避免命局自带卯戌合
        current_year=2010,
        chart_context=None,
    )
    
    liunian_entries = out['liunian']['1']
    ly_2006 = liunian_entries[0]
    assert ly_2006['year'] == 2006
    
    # mechanisms 应该包含 六合化火 modifier (卯戌合化火, 木生火→泄, 反克 etc)
    assert any('六合' in m and '火' in m for m in ly_2006['mechanisms']), \
        f"expected 支六合化火 modifier in mechanisms, got: {ly_2006['mechanisms']}"


def test_cross_interaction_no_overlap_behavior_matches_plan74():
    """Plan 7.7: 当大运干支跟流年干支不形成合化, score 跟 Plan 7.4 行为一致.
    
    用旧 score_yun 直接调 (passing only mingju_gans/zhis 不含大运) 的输出
    跟 build_xingyun 流年 entry score 比对, 应该完全一致 (因为 cross 没触发).
    """
    from paipan.xingyun import build_xingyun, score_yun
    
    # 构造一个明确不 cross 的 case: 大运甲寅 + 流年甲寅 (重复, 没合)
    mock_dayun = {
        'list': [
            {
                'index': 1, 'ganzhi': '甲寅',
                'startAge': 5, 'startYear': 2000, 'endYear': 2009,
                'liunian': [
                    {'year': 2004, 'ganzhi': '甲申', 'age': 9},   # 流年甲申
                ],
            },
        ],
    }
    # 命局没和 甲/申/寅 五合的干支
    out = build_xingyun(
        dayun=mock_dayun,
        yongshen_detail={'primary': '丙火'},
        mingju_gans=['丁', '丙', '戊', '辛'],
        mingju_zhis=['未', '午', '辰', '酉'],
        current_year=2010,
        chart_context=None,
    )
    liunian_score = out['liunian']['1'][0]['score']
    
    # 直接调 score_yun, 不传大运 → Plan 7.4 行为
    plan74_result = score_yun(
        '甲申', '丙火',
        ['丁', '丙', '戊', '辛'],   # mingju only, no extension
        ['未', '午', '辰', '酉'],
    )
    
    # 验证: 两边 score 一致 (cross 没新触发任何 modifier)
    assert liunian_score == plan74_result['score'], \
        f"cross interaction should not affect score when no overlap; " \
        f"got Plan 7.7 {liunian_score} vs Plan 7.4 {plan74_result['score']}"
```

> **NOTE**: tests use mock dayun + chart_context=None to isolate cross interaction from 命局 compute() noise. This is cleaner than real birth_input + bashing through compute (). Verify mock structure matches what real dayun has (index/ganzhi/startAge/startYear/endYear/liunian).

- [ ] **Step 1.4: Run unit tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v -k "cross_interaction"
```
Expected: 3 passed.

- [ ] **Step 1.5: Run full paipan + server regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
```

Expected:
- paipan: 628 + 3 = 631 passed IF no Plan 7.4 fallout, ELSE record new failures
- server: 439 (unchanged)

> ⚠️ **Possible fallout**: Plan 7.4 `GOLDEN_XINGYUN_CASES` (10 cases) + `test_score_yun_*` tests may shift if cross interaction modifier fires on real birth inputs. **Expected ≤ 5 case shifts**. Record failing test names + Plan 7.4 expected vs new actual values for Task 2.

- [ ] **Step 1.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.7 cross interaction — extend liunian mingju with 大运 ganzhi

build_xingyun() 流年 loop 内: score_yun call 现在传 extended mingju
(命局 4 + 大运 1 = 5 干/支), 自动触发 流年-大运 cross 合化 modifier
detection. Plan 7.4 transmutation detection (Plan 7.5b _detect_xingyun_
transmutation) 仍用 base mingju_zhis, 两层 separate.

3 unit tests (干合 cross fires / 六合 cross fires / no-overlap unchanged).

Plan 7.4 fallout (if any) recorded for Task 2 hand-verification +
expected-value updates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Golden integration + browser smoke + Plan 7.4 case shift updates

**Files:**
- Modify: `paipan/tests/test_xingyun.py` (+1 golden test + update Plan 7.4 case shifts)

- [ ] **Step 2.1: Identify a real chart that fires cross interaction**

Sample search: try a few real birth_inputs and inspect xingyun output for cross-fire mechanisms.

```bash
uv run --package paipan python -c "
from paipan import compute

# 试几个 chart, 找有 cross interaction 触发的 (流年 mechanism 含合化 modifier 但
# 命局/月支没自带 partner)
candidates = [
    (1985, 4, 12, 10, 0, 'male', '北京'),
    (1990, 9, 18, 14, 0, 'female', '上海'),
    (1980, 6, 25, 8, 0, 'male', '广州'),
    (1995, 11, 3, 16, 0, 'male', '深圳'),
    (2000, 2, 14, 12, 0, 'female', '成都'),
]

for inp in candidates:
    year, month, day, hour, minute, gender, city = inp
    out = compute(year=year, month=month, day=day, hour=hour, minute=minute,
                   gender=gender, city=city)
    sizhu = out['sizhu']
    mingju_gans_set = set(g[0] for g in [sizhu['year'], sizhu['month'], sizhu['day'], sizhu['hour']] if g)
    mingju_zhis_set = set(g[1] for g in [sizhu['year'], sizhu['month'], sizhu['day'], sizhu['hour']] if g)
    
    xy = out['xingyun']
    cross_count = 0
    for k, ln_list in xy['liunian'].items():
        dy_idx = int(k)
        dy = next((d for d in xy['dayun'] if d['index'] == dy_idx), None)
        if not dy:
            continue
        dy_gan, dy_zhi = dy['ganzhi'][0], dy['ganzhi'][1]
        for ly in ln_list:
            for m in ly['mechanisms']:
                if '合化' in m or '六合' in m:
                    # 检查 partner 是否在大运 而非命局
                    if dy_gan not in mingju_gans_set or dy_zhi not in mingju_zhis_set:
                        cross_count += 1
                        break
    
    print(f'{inp}: sizhu={sizhu[\"year\"]}/{sizhu[\"month\"]}/{sizhu[\"day\"]}/{sizhu[\"hour\"]}, cross_fires={cross_count}')
"
```

Pick a chart with ≥ 5 cross fires (busy enough to demonstrate the feature).

- [ ] **Step 2.2: Write golden integration test**

Append to `paipan/tests/test_xingyun.py`:

```python
def test_xingyun_cross_interaction_golden():
    """Plan 7.7 §6 acceptance: real chart triggers cross interaction modifier
    in at least 1 流年 entry (mechanism with 合化, partner in 大运 not 命局).
    """
    # Birth_input verified at Task 2 Step 2.1 to fire cross interaction
    out = compute(
        year=<verified year>, month=<>, day=<>, hour=<>, minute=<>,
        gender='<>', city='<>',
    )
    xy = out['xingyun']
    sizhu = out['sizhu']
    mingju_gans = set(g[0] for g in [sizhu['year'], sizhu['month'], sizhu['day'], sizhu['hour']] if g)
    mingju_zhis = set(g[1] for g in [sizhu['year'], sizhu['month'], sizhu['day'], sizhu['hour']] if g)
    
    cross_fires = []
    for k, ln_list in xy['liunian'].items():
        dy_idx = int(k)
        dy = next((d for d in xy['dayun'] if d['index'] == dy_idx), None)
        if not dy:
            continue
        for ly in ln_list:
            has_he_mech = any('合化' in m or '六合' in m for m in ly['mechanisms'])
            if has_he_mech:
                cross_fires.append((k, ly['year'], ly['mechanisms']))
    
    assert len(cross_fires) >= 1, \
        f"expected at least 1 cross interaction fire, got 0 in: {cross_fires}"
```

Replace `<verified ...>` with Step 2.1 outputs.

- [ ] **Step 2.3: Run golden test**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py::test_xingyun_cross_interaction_golden -v
```
Expected: 1 passed.

- [ ] **Step 2.4: Run full paipan suite, identify Plan 7.4 case shifts**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: 631 + 1 = 632 passed IF no Plan 7.4 case shift; ELSE record failures.

For each Plan 7.4 GOLDEN_XINGYUN_CASES failure:
1. Print actual `xy.dayun[i].score` and `.label` for each shifted case
2. Hand-math: identify which 流年(s) gained cross modifier(s); compute new weighted score
3. Verify new label is mathematically correct + semantically reasonable
4. Update test expected value with inline comment "Plan 7.7: cross interaction adds modifier on 流年 X"

- [ ] **Step 2.5: Apply expected-value updates**

Update relevant Plan 7.4 test assertions. Each change:
```python
# OLD (Plan 7.4 ship):
# 'expected_label_at_dayun_3': '喜',
# NEW (Plan 7.7):
'expected_label_at_dayun_3': '大喜',   # Plan 7.7: cross 大运庚+流年乙合化金, 金生用神, +1 modifier 触发 上调
```

- [ ] **Step 2.6: Run full suite green**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
cd frontend && node --test tests/*.mjs
```
Expected:
- paipan: 632 (no failures)
- server: 439
- frontend: 51

- [ ] **Step 2.7: Browser smoke**

Boot dev servers + login (DEV-mode SMS code).

Submit the Step 2.1 verified birth_input.

In chat:
- "**这步大运里某些年份，是不是有干支跟我大运干合化？**"

Expected: assistant references 流年 entries 的 cross interaction modifier (e.g. "2005 流年乙跟大运庚合化金"). Should NOT need to "infer" or "推测" the合化 — engine context已经报告。

Save screenshot to `.claire/plan77-cross-interaction-smoke.png`.

- [ ] **Step 2.8: Commit (if updates done)**

```bash
git add paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(paipan): Plan 7.7 golden + Plan 7.4 case shift updates DONE

Golden integration test verified: birth_input <YYYY-MM-DD> fires N cross
interaction modifiers in 流年 entries (partner gan/zhi in 大运 not 命局).

Plan 7.4 GOLDEN_XINGYUN_CASES updates (if any):
  - <case 1>: <field> X → Y — <math hand-verify>
  - ...
  (or "no case shifts" if no Plan 7.4 fallout)

Browser smoke: chat reply cites cross interaction modifier directly,
no longer needs to "infer" or "推测" the 合化.

Plan 7.x series complete: 6 plans shipped + 1 cancelled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes (for the executing engineer)

If any of these surface post-implementation, file a Plan 7.7.1 follow-up:

1. **Plan 7.4 case shifts > 5** — scope unexpectedly large. Disclose + decide whether to update all in this commit OR split into Task 3.
2. **chat smoke shows LLM 仍 "推测" cross interaction** — mechanism tag 不区分 partner source 可能让 LLM 看不出 "这次是跟大运合，不是跟命局合"。如果 chat 解读差，Plan 7.7.1 加 source-aware tag (e.g. `'干·合化转助·{wx}（大运参与）'`).
3. **Plan 7.5b transmutation 受影响** — Task 1 Step 1.2 显式说 transmutation detection 用 base mingju_zhis 不含大运。如果发现 7.5b transmutation 触发率/案例变了，说明 transmutation 路径意外受 mingju extension 影响，回查代码。
4. **流年支跟大运支重复** — `extended_zhis = mingju_zhis + [ganzhi[1]]` 可能 duplicate 大运支 with 命局支。`_detect_liuhe` 用 set-membership, 重复支不影响判断 partner 存在性，但可能影响 unique partner counting (currently not used). 如发现 anomaly, audit `_detect_liuhe` 实现。
