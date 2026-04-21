# Plan 7.6 — Engine Polish Deep Design

**Status:** Draft for implementation
**Date:** 2026-04-22
**Depends on:** Plan 7.3 + 7.4 + 7.5a + 7.5a.1 + 7.5b (all shipped)
**Reserved follow-up:** Plan 7.7 (大运-流年 cross interaction 评分)
**Cancelled:** Plan 7.5c (ZPZQ ch10 ② 透藏机制) — see §0 preamble

---

## 0. Preamble — Plan 7.5c 取消说明

Plan 7.5a release notes 里 reserved Plan 7.5c 的条件是"audit 发现 ge_ju.py 真漏了 ch10 ② 透藏机制"。

2026-04-22 audit 结论：**无实质分歧，cancel reserved**。

6 个 ch10 ② 透藏 case 逐一对比 ge_ju.py 行为：

| ch10 case | ge_ju.py 行为 | 分歧 |
|---|---|---|
| 寅月不透甲透丙 | 四孟月 primary=[丙(中气)] → 丙主格 | 无 |
| 己生申月藏庚透壬 | primary=[壬(中气)] → 正财格 | 无 |
| 辛生寅月甲丙俱透 | 正财格 main + 正官格 candidates[1]（兼格） | 无 |
| 壬生戌月逢辛 | 四库月 tou=[辛] → 正印格 | 无 |
| 丙生申月壬戊俱透 | 七杀格 main + 食神格次要 | ⚠️ frame name 分歧 |
| 丙生寅月透甲仍为印 | 四孟月 primary=[甲(本气)] → 偏印格 | 无 |

唯一 gap：丙生申月+壬+戊俱透，ch10 说"食神能制煞生财，仍为财格"，ge_ju.py 输出"七杀格"。但：

- Plan 7.3 的 GEJU_RULES 在"七杀格"下已经有 `食神 > 3 → 食神（制杀）` 规则
- 用户最终看到的 **用神结论 = 食神制杀**，跟 ch10 "食神能制煞" 实质一致
- 分歧只在 frame name layer，不在 用神 layer

修这个 frame naming gap 需要扩 ge_ju.py 做"格局级救应推理"（相当于 Plan 7.5a 量级 重构），frame name 改了还会破坏 Plan 7.3 GEJU_RULES 的 key 匹配。性价比低，cancel。

Plan 7.6 取代 Plan 7.5c 作为下一站 engine polish。

---

## 1. Goal

清理 Plan 7.4 + 7.5a.1 release notes reserved 的 3 个 deep polish 项：
- **#1** 合化 adjacency 严格化（命局内部相邻才算合化，大运/流年 vs 命局 保持任意位置）
- **#2** 多元素用神 `max` → weighted average (0.5/0.3/0.2)
- **#4** li_liang 5-bin 升级（数据驱动阈值定 极弱/极强）

Plan 7.7 reserved: **#3 大运-流年 cross interaction 评分**（独立维度，单独立项）。

## 2. Non-goals

- **不改 Plan 7.4 score_yun 接口**（仅内部算法调整）
- **不改 Plan 7.3 yongshenDetail 字段**（仅 primary/candidate/warning 的**值**可能变）
- **不改前端**：chartUi.js 零改动
- **不激活新 mechanism tags**：GAN_HAO / ZHI_HAO 继续 unused
- **不做 #3 cross interaction**：留 Plan 7.7

## 3. Architecture

### 3.1 模块划分

```
paipan/paipan/
├── xingyun.py              # MODIFY
│     - _detect_ganhe / _detect_liuhe 加 mingju_idx kwarg (命局内部相邻才算)
│     - score_yun 多元素 primary 改用 weighted average (from xingyun_data.YONGSHEN_WEIGHTS)
│     - winning element 仍按 max sub_score
├── xingyun_data.py         # MODIFY
│     + YONGSHEN_WEIGHTS: list[float] = [0.5, 0.3, 0.2]
├── li_liang.py             # MODIFY
│     + 5-bin thresholds constants (from sampling)
│     + dayStrength 值集从 3 扩到 5 (加 '极弱' / '极强')
├── yongshen.py             # 不动 — FUYI_CASES 已 ship 5 bin rules
└── (其他不动)

paipan/scripts/
└── sample_day_strength.py  # NEW (Task 0 pre-task) — 跑 1000 random charts, 采集 day_score 分布, 输出 p5/p95 阈值

server/app/prompts/context.py   # 不动（新 dayStrength 值通过 FUYI_CASES 自然渲染）

paipan/tests/
├── test_xingyun.py         # MODIFY (+9 new + 几个更新)
├── test_xingyun_data.py    # MODIFY (+1 YONGSHEN_WEIGHTS validity test)
├── test_force.py / test_li_liang.py    # MODIFY (+5 5-bin boundary tests)
├── test_yongshen.py        # MODIFY (+2 极弱/极强 fuyi 触发 tests)
└── regression/test_regression.py       # 不变 (ANALYZER_KEYS strip-list 已包含 force/dayStrength)
```

### 3.2 数据流（无新层）

所有 3 项都是现有算法内部调整：
- adjacency 在 `_detect_ganhe` / `_detect_liuhe` 内部加条件
- weighted avg 在 `score_yun` 内部改 reduction
- 5-bin 在 `li_liang.py:191-197` 加 2 个 branch

## 4. Per-item design

### 4.1 #1 合化 adjacency 严格化

**触发条件**：
- 命局内部（同在 mingju_gans/mingju_zhis 列表）：indices 差 = 1 才算合化
- 大运/流年 vs 命局（yun_gan 不在 mingju_gans 列表）：任意位置都算

**实现**：
```python
def _detect_ganhe(
    gan: str,
    mingju_gans: list[str],
    *,
    source_idx: int | None = None,   # NEW: if gan is mingju_gans[source_idx], restrict to adjacency
) -> str | None:
    """If source_idx is None, gan is external (大运/流年) — any position counts.
    If source_idx given, gan is mingju_gans[source_idx] — only adjacent pairs count.
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

Plan 7.4 的所有调用点目前都是 "外来干 vs 命局"（大运/流年评分）：
```python
_detect_ganhe(yun_gan, mingju_gans)   # source_idx=None implicit
```
行为不变 ✓。

如果有命局内部合化调用（TODO: audit Plan 7.3 yongshen.py 看有没有），改为 `_detect_ganhe(mingju_gan, mingju_gans, source_idx=i)` 即可激活 strict adjacency。

`_detect_liuhe` 同样模式改。

### 4.2 #2 多元素用神 weighted average

**xingyun_data.py 新增**：
```python
# Plan 7.6 §4.2 — 多元素用神权重 (递减)
YONGSHEN_WEIGHTS: list[float] = [0.5, 0.3, 0.2]
# 4+ 元素：第 4 权重为 0 (截断保护，实际很少见 4 元素 primary)
```

**score_yun 内部改动**：

当前（Plan 7.4）：
```python
best = None
for ys_wx in ys_wuxings:
    ...
    candidate = (total, gan_eff, zhi_eff, ys_wx)
    if best is None or candidate[0] > best[0]:
        best = candidate
final_score, ... = best
```

改为：
```python
sub_results = []
for ys_wx in ys_wuxings:
    ...
    sub_results.append((total, gan_eff, zhi_eff, ys_wx))

n = len(sub_results)
weights = YONGSHEN_WEIGHTS[:n]
if sum(weights) > 0:
    weights = [w / sum(weights) for w in weights]   # 归一化
    final_score_raw = sum(w * r[0] for w, r in zip(weights, sub_results))
    final_score = round(final_score_raw)
else:
    final_score = 0

# winning element 仍按 max(sub_scores) — 用于 note/winningYongshenElement 字段
best_idx = max(range(n), key=lambda i: sub_results[i][0])
winning_wx = sub_results[best_idx][3]
gan_eff = sub_results[best_idx][1]
zhi_eff = sub_results[best_idx][2]
```

**行为对比**：

| 元素数 | Plan 7.4 (max) | Plan 7.6 (weighted avg) |
|---|---|---|
| 1 | sub_score[0] | sub_score[0] (行为不变) |
| 2 | max(sub[0], sub[1]) | 0.625·sub[0] + 0.375·sub[1] |
| 3 | max(all) | 0.5·sub[0] + 0.3·sub[1] + 0.2·sub[2] |
| 4 | max(all) | 0.5·sub[0] + 0.3·sub[1] + 0.2·sub[2] + 0·sub[3] |

### 4.3 #4 li_liang 5-bin + sampling pre-task

**Task 0 (pre-task): sampling script**

新 `paipan/scripts/sample_day_strength.py`:

```python
"""Sample day_score distribution from N random birth_inputs (Plan 7.6 Task 0).

Used to determine empirical thresholds for 极弱 / 极强 bins.
Run once; commit the resulting threshold constants to li_liang.py.
"""
import random
from paipan import compute

N = 1000
SEED = 42
scores: list[int] = []
random.seed(SEED)

for _ in range(N):
    year = random.randint(1900, 2030)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    hour = random.randint(0, 23)
    minute = random.randint(0, 59)
    gender = random.choice(['male', 'female'])
    city = '北京'   # consistent location to isolate 日主 effect
    try:
        result = compute(year=year, month=month, day=day, hour=hour,
                         minute=minute, gender=gender, city=city)
        force = result.get('force') or {}
        day_score = force.get('dayScore')   # ⚠️ actual field name TBD — audit li_liang.py first
        if day_score is not None:
            scores.append(day_score)
    except Exception as e:
        continue

scores.sort()
n = len(scores)
def pct(p):
    return scores[min(int(n * p), n - 1)]

print(f"N={n}")
print(f"range: [{scores[0]}, {scores[-1]}]")
print(f"p5={pct(0.05)}  p10={pct(0.10)}  p25={pct(0.25)}")
print(f"median={pct(0.50)}")
print(f"p75={pct(0.75)}  p90={pct(0.90)}  p95={pct(0.95)}")
```

运行输出会告诉我们具体阈值。**预期**：根据当前 li_liang.py 的 scoring，day_score 典型范围 [-40, +80]，分布偏右（因日主得令位占优势较常见）。预估阈值：
- `BIN_JI_QIANG_THRESHOLD ≈ p95`（约 +55 ~ +70）
- `BIN_JI_RUO_THRESHOLD ≈ p5`（约 -25 ~ -15）

实际值 Task 0 跑完后 commit 到 li_liang.py 作为 constants。

**Task 1 li_liang.py 改动**：

```python
# 从 sampling 得：Task 0 跑完填入
BIN_JI_QIANG_THRESHOLD = 60   # placeholder — Task 0 pre-task 确定
BIN_SHEN_QIANG_THRESHOLD = 10  # existing Plan 7.3 ship
BIN_ZHONG_HE_THRESHOLD = -10   # existing Plan 7.3 ship
BIN_JI_RUO_THRESHOLD = -25    # placeholder — Task 0 pre-task 确定

if day_score >= BIN_JI_QIANG_THRESHOLD:
    day_strength = "极强"
elif day_score >= BIN_SHEN_QIANG_THRESHOLD:
    day_strength = "身强"
elif day_score >= BIN_ZHONG_HE_THRESHOLD:
    day_strength = "中和"
elif day_score >= BIN_JI_RUO_THRESHOLD:
    day_strength = "身弱"
else:
    day_strength = "极弱"
```

### 4.4 FUYI_CASES 激活

Plan 7.3 已 ship 的 `FUYI_CASES` (in yongshen_data.py) 有 5 entries 按 dayStrength 分：
- `ds == '极弱'` → "印 + 比劫（同扶）"
- `ds == '身弱'` → "印 / 比劫"
- `ds == '中和'` → None
- `ds == '身强'` → "官杀 / 财 / 食伤"
- `ds == '极强'` → "官杀 + 食伤（双泄）"

Plan 7.6 #4 ship 后，`极弱` / `极强` rule 开始 fire 在约 10% 盘上 → Plan 7.3 `fuyi_yongshen` 返回 compound 用神 → `yongshenDetail.primary` 文本变。

## 5. Integration points

见 §3.1 已列。

## 6. Migration / backward compat

这是 Plan 7.6 **最 risk** 的部分：3 项改动都会**改变现有盘的 score/primary 值**。需要逐一列出哪些测试会变。

### 6.1 预期变化范围

| Plan | 测试数 | 预期变化 | 影响程度 |
|---|---|---|---|
| 7.3 yongshen golden | 33 | 10% 边界盘 primary 变（FUYI 5-bin 激活） | 低-中 |
| 7.4 行运评分 golden | 33 | 多元素用神盘 score 变（约 3-5 case） | 中 |
| 7.5a transmutation golden | 5 | 下游受 primary 变化影响 | 低 |
| 7.5b dynamic transmutation golden | 5 | 下游受 primary 变化影响 | 低 |

**所有的变化都是 expected behavior change, 不是 regression**。实施时需要：
1. 跑 test 看哪个 case expected label 变了
2. 手算验证新值正确
3. Update expected 值 + 在 commit 注明"这是 Plan 7.6 预期变化"
4. 不允许 silently loosen assertion（跟 Plan 7.5a/b verification-first 同样规矩）

### 6.2 Regression oracle 影响

`paipan/tests/regression/test_regression.py` 的 ANALYZER_KEYS strip-list 已包含 `force, dayStrength, yongshen, yongshenDetail, xingyun` 等（Plan 7.3/7.4/7.5b 时加的）。

5-bin 升级让 force.dayStrength 可能输出 `极弱`/`极强`。因为 dayStrength 已在 strip-list 里，regression oracle 不会因此 fail。

但**需要审**：yongshenDetail.primary 不在 strip-list 吗？它是整个 dict 一起 strip 的。primary 的字符串值变化不会触发 oracle fail。✓ 安全。

## 7. Tests

### 7.1 Task 0 pre-task: sampling + thresholds commit

`paipan/scripts/sample_day_strength.py` 作为 repo 内工具，runs once, commits output thresholds to li_liang.py.

**No new test for sampling script itself** — it's a one-off tool.

### 7.2 Task 1: li_liang 5-bin

`paipan/tests/test_force.py` (或 test_li_liang.py) 加 5 个 boundary tests:
```python
def test_day_strength_bin_极强():
    assert classify_day_strength(BIN_JI_QIANG_THRESHOLD) == '极强'
    assert classify_day_strength(BIN_JI_QIANG_THRESHOLD + 1) == '极强'
def test_day_strength_bin_身强():
    assert classify_day_strength(BIN_JI_QIANG_THRESHOLD - 1) == '身强'
    assert classify_day_strength(BIN_SHEN_QIANG_THRESHOLD) == '身强'
# ... 中和 / 身弱 / 极弱 同模式
```

### 7.3 Task 2: adjacency

`paipan/tests/test_xingyun.py` 加 4 adjacency tests:
- 命局 [甲, 己, 乙, 丙]: `_detect_ganhe('甲', [甲, 己, 乙, 丙], source_idx=0)` → 己 at idx=1 is adjacent → fire 土
- 命局 [甲, 乙, 己, 丙]: `_detect_ganhe('甲', [甲, 乙, 己, 丙], source_idx=0)` → 己 at idx=2 NOT adjacent → None
- External 干: `_detect_ganhe('甲', [乙, 丙, 丁, 己])` (source_idx=None) → 任意位置 → fire 土 (跟 Plan 7.4 行为一致)
- `_detect_liuhe` 同模式 4 tests

### 7.4 Task 3: weighted average

`paipan/tests/test_xingyun.py` 加 5 tests + 1 data validity:
- 单元素用神：score unchanged (weights=[1.0])
- 2 元素：sub_scores [+4, -2] → weighted avg round((0.625·4 + 0.375·-2)) = round(1.75) = 2
- 3 元素：sub_scores [+4, -2, +2] → weighted avg round(0.5·4 + 0.3·-2 + 0.2·2) = round(1.8) = 2
- 4 元素：截断 (权重 [0.5, 0.3, 0.2, 0])，第 4 元素 score 不计
- Winning element = max(sub_scores) idx (非 weighted)

`paipan/tests/test_xingyun_data.py` 加 1 validity test:
- YONGSHEN_WEIGHTS == [0.5, 0.3, 0.2]
- sum == 1.0

### 7.5 Task 4: 极弱/极强 fuyi 触发

`paipan/tests/test_yongshen.py` 加 2 tests:
- 构造 mock force with dayStrength='极弱' → fuyi_yongshen 返回 "印 + 比劫（同扶）" candidate
- 构造 mock force with dayStrength='极强' → fuyi_yongshen 返回 "官杀 + 食伤（双泄）" candidate

这些是 Plan 7.3 FUYI_CASES 的直接验证 — 之前 dead code，现在 activated。

### 7.6 Task 5: Integration + Update existing golden

**关键环节**：跑完整 paipan test suite，找出因 Plan 7.6 改动而 expected label 变化的 case。

For each changed case:
1. 打印 before/after sub_scores + final_score + label + primary
2. 手算验证新值正确（数学上必对，但语义上要合理）
3. Update test expected 值，commit 消息注明 "Plan 7.6 changes: case X score +2 → +1 because weighted avg of multi-element 用神"

### 7.7 预期测试总数

| Suite | Before 7.6 | After 7.6 | Delta |
|---|---|---|---|
| paipan | 609 | ≥ 626 | +17 new (4 adjacency + 5 weighted + 1 data + 5 bin + 2 极弱/极强 fuyi) + ~5 updated existing tests (Plan 7.4 multi-element golden case expected labels shifted) |
| server | 439 | 439 | 0 |
| frontend | 51 | 51 | 0 |

Note: existing test count may stay flat or slightly shift if multi-element golden cases get assertion updates rather than added/removed. ≥ 626 conservative bound.

## 8. Acceptance gates

1. Task 0 sampling script runs + outputs threshold values
2. All new tests green (paipan ≥ 625)
3. Updated golden tests reflect Plan 7.6 expected changes; each change手算 verified
4. Plan 7.3 / 7.4 / 7.5a / 7.5b contracts held: chart.paipan.{yongshen, yongshenDetail, xingyun} shape unchanged; only **values** may shift where expected
5. Browser smoke:
   - 一个含多元素 primary 的盘（e.g. 丙亥 前讨论过的 "甲木 / 戊土 / 庚金"）：确认新 weighted avg score 在 chat 里合理
   - 一个触发 极弱 或 极强 的盘（Task 0 sampling 阶段挑出来）：确认 fuyi "印+比劫 同扶" 类 compound 用神正确渲染

## 9. Risks

1. **Update 的 golden case 数量超预期** — 如果 Plan 7.6 导致 20+ case 要 update，task 5 工作量膨胀。Mitigation: Task 0 跑完就抽 10 个随机盘 smoke 测，估算变动规模。
2. **Sampling 阈值让约 10% 盘 fuyi 变 compound primary** — 这个 10% 本来是预期（5+5% 左右），但如果 sampling 结果显示阈值太"宽松"（导致 20%+ 落到极弱/极强），阈值要调严（用 p3/p97 或更严）。
3. **Adjacency 改动无可观察效果** — 因为 Plan 7.4 的所有 `_detect_ganhe/_detect_liuhe` 调用都是 yun_gan vs mingju（外来），命局内部合化路径实际 Plan 7.4/7.5a/7.5b 没使用过。这项改动可能等于**空改动**。Mitigation: audit Plan 7.3 yongshen.py / ge_ju.py 是否有命局内部合化调用。如果没有，spec §4.1 的 strict adjacency 是"forward-compat"改动（Plan 7.7 cross interaction 可能用到），不产生当前行为变化。
4. **Weighted avg round 引入 floor/ceiling 边界** — e.g. sub_scores [+3, -2, +1] → weighted avg = 0.5·3 + 0.3·-2 + 0.2·1 = 1.1 → round(1.1) = 1 → 平。Plan 7.4 max 取 3 → 喜。label 从"喜"变"平"。这是**算法意图**，不是 bug。但要在 update 的 case 里逐一 verify.

## 10. Alternatives considered

### 10.1 #1 adjacency 完全严格（命局 + 大运/流年 都相邻才算）
- 拒绝：大运/流年 modifier 触发率会大幅下降，Plan 7.4 评分丰富度降低，用户感知变"平"。
### 10.2 #2 多元素用神保持 max + 加 warning
- 拒绝：max 的偏乐观 bug 仍在。Warning 是 aspirin 不治本。
### 10.3 #4 li_liang 5-bin 固定阈值（不跑 sampling）
- 拒绝：拍脑袋阈值没论据，spec 不自信。
### 10.4 Plan 7.6 全 4 项做（包括 #3 cross interaction）
- 拒绝：scope creep。#3 是新评分维度，独立立项 Plan 7.7。

## 11. Rollout

1. Task 0 sampling → 2. Task 1 li_liang 5-bin → 3. Task 2 adjacency → 4. Task 3 weighted avg → 5. Task 4 fuyi 激活 → 6. Task 5 integration + golden updates
2. Backward compat: 所有字段 shape 不变
3. 合并 main 后 browser smoke 两个 case（multi-element + 极端 dayStrength）
4. **Plan 7.7 hook**: 7.6 ship 后评估是否值得做 #3 cross interaction（先跑一段时间看 LLM chat smoke 在真实对话下的感受）

---

## Appendix A: 现有调用点 audit needed

Task 2 (adjacency) 实施前必须 grep 所有 `_detect_ganhe` / `_detect_liuhe` 调用点：

```
grep -rn "_detect_ganhe\|_detect_liuhe" paipan/paipan/
```

预期：只在 xingyun.py 内部调用，且都是 external `yun_gan` path。如果 yongshen.py 或其他地方有"命局内部合化"调用，需要加 `source_idx` 参数传位置。

## Appendix B: Plan 7.5c cancelled reason summary

Audit 6 case 从 ZPZQ ch10 ②。唯一分歧 case (丙生申月+壬+戊) 在 frame-name layer，用神 layer 已被 Plan 7.3 GEJU_RULES 覆盖。修这个 gap 需要 Plan 7.5a 量级重构 + 破坏 GEJU_RULES key 契约，性价比低。Cancel reserved status.
