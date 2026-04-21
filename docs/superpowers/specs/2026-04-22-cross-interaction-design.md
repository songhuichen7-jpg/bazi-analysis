# Plan 7.7 — 大运/流年 Cross Interaction Design

**Status:** Draft for implementation
**Date:** 2026-04-22
**Depends on:** Plan 7.3 + 7.4 + 7.5a + 7.5a.1 + 7.5b + 7.6 (all shipped)
**Reserved follow-ups:** None planned

---

## 1. Goal

填 Plan 7.4 行运评分的一个 gap：流年评分时**不算大运干支作为 effective mingju**，导致 流年干 vs 大运干 / 流年支 vs 大运支 的合化 modifier 触发不到。

例：大运庚 + 流年乙 → `乙庚合化金`，金跟用神是什么关系直接影响该流年 score。Plan 7.4 当前不算这个，LLM 在 chat 里要自己补这层（Plan 7.4 smoke 已观察到）。

修复极简：流年评分调 `score_yun(...)` 时把大运干支拼进 `mingju_gans/zhis`，自动激活 cross interaction modifier。

## 2. Non-goals

- **不改 score_yun 接口** —— 仅外部调用方 extend mingju
- **不新增 mechanism tag 命名空间** —— 现有 `'干·合化转助·{wx}'` 等 tag 不分 source（不区分跟命局合还是跟大运合）。LLM 从 entry 上下文（流年位置 + 大运 ganzhi 显示）自然推断。
- **不改 note 文案规则**
- **不做 大运-大运 sequential cross**（古籍弱）
- **不做 流年支藏干 modifier**（信息密度过头）
- **不做 cross-pillar pair-wise 干生干 / 干克干 评分**（scope 失控）
- **前端零改动**

## 3. Architecture

### 3.1 模块划分

```
paipan/paipan/xingyun.py   # MODIFY (~3 行)
  - build_xingyun() 流年 loop 内: 加 extended_gans/zhis 拼接, 调 score_yun
  - 大运 loop 不动 (大运 vs 命局已是 Plan 7.4 行为)

paipan/tests/test_xingyun.py   # MODIFY (+4 tests)
  - 3 unit (cross 干合 / cross 六合 / no-cross 行为不变)
  - 1 golden 集成 (真盘 verify)
```

无新模块，无新数据表，无新依赖。

### 3.2 数据流

```
build_xingyun:
  for each 大运 entry:
    score_yun(大运 ganzhi, primary, mingju_gans, mingju_zhis)   # Plan 7.4 unchanged
    for each 流年 within:
      # Plan 7.7 NEW:
      extended_gans = mingju_gans + [大运干]   # 5 干
      extended_zhis = mingju_zhis + [大运支]   # 5 支
      score_yun(流年 ganzhi, primary, extended_gans, extended_zhis)
      # → 流年干 vs (命局+大运) 任一干合化 modifier 触发
      # → 流年支 vs (命局+大运) 任一支六合 modifier 触发
```

`score_yun` 内部不变（仍是 Plan 7.6 weighted avg + Plan 7.4 干合/六合 modifier 检测），只是 mingju 上下文范围扩了。

## 4. Implementation

### 4.1 单点修改

`paipan/paipan/xingyun.py` build_xingyun() 流年 loop (现 lines 478-509):

```python
# 原 Plan 7.4 + 7.5b ship:
for ly in entry.get('liunian', []):
    ly_score = score_yun(
        ly['ganzhi'], yongshen_primary, mingju_gans, mingju_zhis
    )
    # ... transmutation detection ...

# Plan 7.7 改后:
for ly in entry.get('liunian', []):
    # Plan 7.7: extend mingju with 大运 干支 for cross interaction modifier detection
    extended_gans = mingju_gans + [ganzhi[0]]
    extended_zhis = mingju_zhis + [ganzhi[1]]
    ly_score = score_yun(
        ly['ganzhi'], yongshen_primary, extended_gans, extended_zhis
    )
    # ... transmutation detection (unchanged, uses base_mingju_zhis only) ...
```

`ganzhi` 是 outer loop 的当前大运 ganzhi（已存在变量）。`ganzhi[0]` 是干，`ganzhi[1]` 是支。

### 4.2 现有 mechanism tag 复用

Plan 7.4 + 7.6 ship 的 mechanism builder（`mechanism_tags.py`）：
- `gan_hehua_zhuanzhu(wx)` → `'干·合化转助·{wx}'`
- `gan_hehua_fanke(wx)` → `'干·合化反克·{wx}'`
- `zhi_liuhe_zhuanzhu(wx)` / `zhi_liuhe_fanke(wx)` 同模式

Plan 7.7 不加新 tag。流年触发的 cross 合化用同样 tag。LLM 看到 `'干·合化转助·金'` 在某流年 entry 时，从 entry 是流年 + 当前大运 ganzhi 渲染在大运行 上下文，自然推断"这是流年干跟命局或大运干合化"。具体跟哪一干合化 现有 system 不报告（这是 Plan 7.4 既有的 abstraction 取舍）。

## 5. Tests

### 5.1 4 新测试

```python
# paipan/tests/test_xingyun.py

def test_cross_interaction_dayun_gan_extends_mingju_for_liunian_score():
    """大运庚 + 流年乙 + 命局无相合 → 乙庚合化金 modifier 应触发."""
    # 构造一个命局没乙也没庚的盘, 大运庚, 流年乙
    # 验证 流年 entry 的 score 包含 '干·合化...金' mechanism
    ...


def test_cross_interaction_dayun_zhi_extends_mingju_for_liunian_score():
    """大运卯 + 流年戌 + 命局无相合 → 卯戌合化火 modifier 应触发."""
    ...


def test_cross_interaction_no_overlap_behavior_unchanged():
    """如果大运干支跟流年干支不形成合化, score 跟 Plan 7.4 行为完全一致."""
    # 用一个明确不合化的 chart, 验证 mechanisms / score 都跟 Plan 7.4 baseline 同
    ...


def test_xingyun_cross_interaction_golden():
    """真盘集成: chart 中至少 1 个流年触发 cross interaction modifier
    (即流年 mechanisms 包含合化 tag, 且对应 partner 在大运 ganzhi 而非命局)."""
    out = compute(...)
    # ... 验证 ...
```

### 5.2 预期 fallout

Plan 7.4 流年 score 在某些盘可能上升（更多合化 modifier fire），label 可能从 平→喜 / 忌→平 等。预期 0-5 case shift。Hand-verify + update。

### 5.3 预期 metrics

| Suite | Before 7.7 | After 7.7 | Delta |
|---|---|---|---|
| paipan | 628 | ≥ 632 | +4 (3 unit + 1 golden) + 0-5 updated |
| server | 439 | 439 | 0 |
| frontend | 51 | 51 | 0 |

## 6. Acceptance gates

1. 4 新测试绿
2. Plan 7.4 33 score golden 不破契约（如果有 label shift，hand-verify + update，注明"Plan 7.7 cross interaction 触发"）
3. Browser smoke：跑一个真触发 cross 的 chart（实施时 codex Task 2 verify），chat 问 "我大运里某个流年怎么样" → LLM 应能引用 cross 合化（不需自己补）

## 7. Risks

1. **Cross interaction shift Plan 7.4 score 太多** — 如果 update 的 case 数量超 10，scope 超预期，停下复盘。Mitigation: 先实施 + run regression，根据数量决定。
2. **Mechanism tag 不区分 cross source** — LLM 可能弄混"跟命局合"vs"跟大运合"。Mitigation: chat smoke 验证 LLM 解读不出错; 如果出错, Plan 7.7.1 加 source-aware tag。
3. **流年支跟大运支重复** (e.g. 大运卯 + 流年卯) — `extended_zhis` 会有重复卯。`_detect_liuhe` 用 set membership, 重复支不影响 (会跟同样 zhi 的 partner 不算 self-pair)。但 `_detect_liuhe('卯', [..., 卯, 卯])` 找 partner 时遍历全部, 自配 skip, others 检测 — 行为正确。✓

## 8. Alternatives considered

### 8.1 加 source-aware mechanism tag (`'干·跨大运合化·{wx}'`)
拒绝：tag 名称膨胀；LLM 从 entry context 已能推断；abstraction tradeoff 跟 Plan 7.4 一致。

### 8.2 只对当前大运的流年做 cross，其他大运的流年不做
拒绝：物理上每个流年都在某个大运内，cross 是普遍机制，不应只对 currentDayun 特殊处理。

### 8.3 更大 scope（含 大运-大运 / 流年-藏干 / cross-pillar 评分）
拒绝：scope creep，留给以后真有需求再开。

## 9. Rollout

1. 1-2 task 实施计划（即将写）
2. Backward compat: score_yun 接口不变，调用方 extension。无需新参数 default
3. 合并 main 后 browser smoke 验证 cross interaction 真在 chat 里被引用
4. **没有 reserved follow-up** —— Plan 7.x 系列至此可以宣告完整收官

---

## Appendix A: 现有 mingju 拼接 vs Plan 7.7 extension

| 调用 | mingju shape | source |
|---|---|---|
| Plan 7.4 大运 score (unchanged) | 4 干 / 4 支 (命局 only) | mingju_gans / mingju_zhis |
| Plan 7.4 流年 score (Plan 7.7 改) | 5 干 / 5 支 (命局 + 大运) | extended_gans / extended_zhis |
| Plan 7.5b transmutation 检测 (unchanged) | 4 / 5 / 6 (mode-dependent, base_mingju_zhis) | base_mingju_zhis + ... |

## Appendix B: 跟 Plan 7.6 的关系

Plan 7.6 加了 `_detect_ganhe(...source_idx)` adjacency 严格化，但留了 source_idx=None 的 external path。Plan 7.7 流年评分的 `_detect_ganhe(liunian_gan, extended_gans)` 仍走 source_idx=None → 任意位置 fire（流年是 external 不是 mingju 内部）。Plan 7.6 严格 adjacency 路径仍未激活。

如果以后 cross interaction 需要 strict adjacency (e.g. "大运干 + 命局月干 才合化"), Plan 7.7.1 可以激活。当前 v1 不做 (古籍 strict reading 上"外来作用力不论位置"，大运 external 同流年 external 都 acceptable)。
