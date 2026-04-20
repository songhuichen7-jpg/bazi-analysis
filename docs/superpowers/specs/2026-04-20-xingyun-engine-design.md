# Plan 7.4 — 行运 Engine Design

**Status:** Draft for implementation
**Date:** 2026-04-20
**Depends on:** Plan 7.3 (用神 engine v1, shipped)
**Defers to:** Plan 7.5 (用神变化 — ZPZQ ch10 strict reading, reserved)

---

## 1. Goal

给每条大运（8 条）和流年（8 × 10 = 80 条）对照 **命局用神** 打一个 **5-bin 喜忌评分**，配 1 行 note + 机制标签，注入 `compact_chart_context` 供 LLM 在回答"我未来十年怎么样""今年/某年运势"这类问题时直接引用。

命局用神**不变**（由 Plan 7.3 确定），7.4 只算"行运干支对命局用神的作用"。用神本身的动态变化（大运带三合三会改月令）留给 Plan 7.5。

## 2. Non-goals

- **不改前端**：`chartUi.js` 和 chart panel 布局零改动。评分只进 LLM context。
- **不重算用神**：Plan 7.3 的 `yongshenDetail.primary` 即是比对锚点，不因大运改变。
- **不做流月评分**：粒度止于流年。流月让 LLM 自己推。
- **不做反激/通关/调候 modifier**：这些需要完整 ZPZQ 规则系统，留给 7.5/7.6。
- **不实施格局变化检测**：ZPZQ ch10 的"用神变化"doctrine 整体留给 7.5。

## 3. Architecture

### 3.1 模块划分

```
paipan/paipan/xingyun_data.py   — 纯数据（4 个查找表 + 5-bin 阈值）
paipan/paipan/xingyun.py         — 评分逻辑（public: score_yun, build_xingyun）
paipan/paipan/compute.py         — 集成层（调用 build_xingyun，surface chart.paipan.xingyun）
paipan/paipan/analyzer.py        — 不改（保持单一职责）
server/app/prompts/context.py    — 新增 _render_xingyun_block
```

### 3.2 数据流

```
birth_input
  → compute() 算出 bazi + dayun + yongshenDetail (Plan 7.3)
  → build_xingyun(dayun, yongshenDetail, mingju_gans, mingju_zhis, current_year)
      → 对每条大运: score_yun(...) → {label, score, note, mechanisms}
      → 对每条大运下的 10 个流年: score_yun(...) → 同上
      → 定位 currentDayunIndex（now_year 落在哪条大运的 [startYear, endYear]）
      → 返回 {dayun: [...], liunian: {idx: [...]}, currentDayunIndex, yongshenSnapshot}
  → result["xingyun"] = 这个 dict
  → compact_chart_context(result) 渲染 行运块（8 大运 + 当前大运 10 流年）
```

### 3.3 评分机制（Layer 2）

单次 `score_yun(yun_ganzhi, yongshen_primary, mingju_gans, mingju_zhis)` 的内部流程：

1. **拆解 用神五行**：从 `yongshen_primary` 字符串提取 1-N 个五行（支持多元素如 "甲木 / 戊土 / 庚金"）。
2. **对每个用神五行独立计算一个 sub_score**：
   - **干 effect**（基础 ±2）：
     - 干五行 == 用神五行 → +1（比助）
     - 干生用神 → +2（如 癸生甲木）
     - 用神生干 → -1（如 甲木生丁火，木被泄）
     - 克用神 → -2（如 庚克甲木）
     - 用神克干 → 0（中性，用神得用）
   - **干合化 modifier**：
     - 检测 `yun_gan` 与 `mingju_gans` 中任意干构成合化（5 对中的哪一对）
     - 合化出的五行与用神关系决定 modifier：
       - 合化五行 == 用神 → 干 effect +1（合化反向补益）
       - 合化五行 生 用神 → 干 effect +1
       - 合化五行 克 用神 → 干 effect 归零或 -1（合化转凶）
   - **支 effect**（基础 ±2）：以支本气藏干（`ZHI_BENQI_GAN`）的五行与用神比较，规则同干 effect
   - **支六合 modifier**：
     - 检测 `yun_zhi` 与 `mingju_zhis` 中任意支构成六合（6 对中的哪一对）
     - 合化出的五行与用神关系决定 modifier（同干合化逻辑）
3. **sub_score 合并**：多元素用神取 **max**（"任一用神被生扶都算喜"），单元素用神即 sub_score 本身。
4. **5-bin 分类**：`_classify_score(final_score)` 落 `大喜/喜/平/忌/大忌`。
5. **note 构造**：描述 2 个 mechanism —— 干层最强 1 个 + 支层最强 1 个（按 `abs(delta)` 取最大；并列时取出现顺序在前者）。每个 mechanism 用 ≤15 字短语，合起来 ≤30 字。如果两层都是中性（delta=0），note 用 "无显著作用"。
6. **mechanisms list**：结构化字符串列表，格式 `{干|支}·{相生|相克|比助|合化转X|六合化Y|相泄|相耗}`，供后续分析用。

**特殊情形：中和命局**
当 `yongshen_primary` 等于 `'中和（无明显偏枯）'` 或拆解后没有可识别五行时，`score_yun` 直接返回 `{label: '平', score: 0, note: '命局中和，行运无明显偏向', mechanisms: []}`。`build_xingyun` 仍正常 batch 8 大运 × 10 流年，全部输出 `平` —— 上层 `_render_xingyun_block` 看到全部 `平` 时**整段折叠不渲染**（避免 LLM context 充斥无效信息）。

### 3.4 5-bin 阈值

```python
SCORE_THRESHOLDS = {
    '大喜': 4,    # >=  4
    '喜':   2,    # 2 or 3
    '平':   0,    # -1 to 1
    '忌':  -2,    # -3 to -2
    '大忌': -4,   # <= -4
}
```

单维（干/支）取值 `{+2 生, +1 同, 0 中, -1 泄/耗, -2 克}`，合化/六合可 ±1 modifier。理论 final_score ∈ [-5, +5]，实际多落 [-4, +4]。

## 4. Data tables

### 4.1 `GAN_HE_TABLE`

```python
GAN_HE_TABLE: dict[frozenset[str], str] = {
    frozenset({'甲', '己'}): '土',
    frozenset({'乙', '庚'}): '金',
    frozenset({'丙', '辛'}): '水',
    frozenset({'丁', '壬'}): '木',
    frozenset({'戊', '癸'}): '火',
}
```

简化：不判断"相邻"，任意位置的两干都算合化。准确度损失约 5-10%，可在 Plan 7.4.1 严格化。

### 4.2 `ZHI_LIUHE_TABLE`

```python
ZHI_LIUHE_TABLE: dict[frozenset[str], str] = {
    frozenset({'子', '丑'}): '土',
    frozenset({'寅', '亥'}): '木',
    frozenset({'卯', '戌'}): '火',
    frozenset({'辰', '酉'}): '金',
    frozenset({'巳', '申'}): '水',
    frozenset({'午', '未'}): '土',   # 午未合化"无气"，传统标"火土"，简化标土
}
```

### 4.3 `WUXING_GENERATE` / `WUXING_RESTRICT`

```python
WUXING_GENERATE: dict[str, str] = {
    '木': '火', '火': '土', '土': '金', '金': '水', '水': '木',
}
WUXING_RESTRICT: dict[str, str] = {
    '木': '土', '土': '水', '水': '火', '火': '金', '金': '木',
}
```

辅助函数：
- `wuxing_generated_by(x)` → 反查：什么五行生 x
- `wuxing_restricted_by(x)` → 反查：什么五行克 x

### 4.4 现有 utility 复用（非新表）

- `GAN_TO_WUXING['甲'] == '木'`（paipan 既有，定义在 `paipan/wuxing.py` 或类似）
- `ZHI_BENQI_GAN['寅'] == '甲'`（地支本气藏干）—— 实施 Task 1 前先 grep 确认；若 paipan 没有此 mapping 直接定义，就在 `xingyun_data.py` 里新增 `ZHI_BENQI_GAN` 12 项查找表（这是**确定要做的**，不是条件性）

## 5. Public API

### 5.1 `score_yun`

```python
def score_yun(
    yun_ganzhi: str,                # "庚申"
    yongshen_primary: str,          # "甲木" 或 "甲木 / 戊土 / 庚金"
    mingju_gans: list[str],         # ["癸", "己", "丁", "丁"]
    mingju_zhis: list[str],         # ["酉", "未", "酉", "未"]
) -> dict:
    """返回:
       {
         'label': str,              # '大喜'|'喜'|'平'|'忌'|'大忌'
         'score': int,              # 最终分数 (通常 -4 到 +4)
         'note': str,               # ≤30 字人可读描述
         'mechanisms': list[str],   # 结构化机制标签
         'gan_effect':  {'delta': int, 'reason': str},
         'zhi_effect':  {'delta': int, 'reason': str},
         'winningYongshenElement': str | None,  # 多元素用神时记录哪个元素被打最高分
       }
    """
```

### 5.2 `build_xingyun`

```python
def build_xingyun(
    dayun: dict,                    # chart.paipan.dayun
    yongshen_detail: dict,          # chart.paipan.yongshenDetail
    mingju_gans: list[str],
    mingju_zhis: list[str],
    current_year: int,              # 用来定位 currentDayunIndex
) -> dict:
    """返回:
       {
         'dayun': [
           {'index': 0, 'ganzhi': '戊午', 'startAge': 4, 'startYear': 1997,
            'endYear': 2006, 'label': '忌', 'score': -2, 'note': '...',
            'mechanisms': [...], 'isCurrent': False},
           ...8 条...
         ],
         'liunian': {
           # str(大运 index) → 该大运下 10 条流年的评分列表
           '0': [{'year': 1997, 'ganzhi': '丁丑', 'age': 5, 'label': '喜',
                  'score': 2, 'note': '...', 'mechanisms': [...]}, ...],
           ...
         },
         'currentDayunIndex': 3,        # 若当前年不在任何大运覆盖范围则为 None
         'yongshenSnapshot': '甲木',
       }
    """
```

### 5.3 多元素 用神 处理规则

当 `yongshen_primary` 含 ` / ` 分隔符（如 "甲木 / 戊土 / 庚金"）：

1. 按 `' / '` 拆，得到 `['甲木', '戊土', '庚金']`
2. 每个元素的五行：`['木', '土', '金']`
3. 对每个五行调 `score_yun` 内部打分逻辑，得 3 个 sub_score
4. 取 `max(sub_scores)` 作为最终 score
5. 记录最高分对应的元素到 `winningYongshenElement`
6. `note` 提及该元素名而不是"用神"：`"庚申生戊土用神"` 而不是 `"庚申生用神"`

**理由**：古籍多用神同辉的盘（如 丙亥），任一用神被生扶即主事；取最大更符合"有一即可"的直觉。取平均或全部报告的方案列在"Alternatives considered"一节。

### 5.4 Internal helpers（不导出）

- `_score_gan_to_yongshen(gan, ys_wuxing, mingju_gans) -> (delta, reason, mech)`
- `_score_zhi_to_yongshen(zhi, ys_wuxing, mingju_zhis) -> (delta, reason, mech)`
- `_detect_ganhe(gan, mingju_gans) -> str | None`（返回合化出的五行）
- `_detect_liuhe(zhi, mingju_zhis) -> str | None`
- `_classify_score(score: int) -> str`
- `_extract_yongshen_wuxings(primary: str) -> list[str]`

## 6. Integration points

### 6.1 `compute.py`

在 `result["yongshenDetail"] = ...` 之后追加：

```python
from paipan.xingyun import build_xingyun

# ... 现有 analyze() + yongshen 处理 ...

now_year = (_now or datetime.now()).year

bazi = result["bazi"]
mingju_gans = [bazi[k][0] for k in ['year', 'month', 'day', 'hour']]
mingju_zhis = [bazi[k][1] for k in ['year', 'month', 'day', 'hour']]

result["xingyun"] = build_xingyun(
    dayun=result["dayun"],
    yongshen_detail=result["yongshenDetail"],
    mingju_gans=mingju_gans,
    mingju_zhis=mingju_zhis,
    current_year=now_year,
)
```

`analyzer.py` 不动（保持单一职责：只分析命局，不涉及运势）。

### 6.2 `server/app/prompts/context.py`

在 `_render_yongshen_block` 调用之后插入：

```python
lines.extend(_render_xingyun_block(p))
```

`_render_xingyun_block` 实现见设计 §5 渲染样例（已讨论）。关键点：
- 空 `xingyun` 或 `dayun == []` 时返回 `[]`（向后兼容老盘）
- 当前大运用 `★` 标记
- 展开当前大运的 10 个流年（其他大运折叠）
- glyph 映射：`{'大喜': '⭐⭐', '喜': '⭐', '平': '·', '忌': '⚠', '大忌': '⚠⚠'}`

### 6.3 Regression test 兼容

`paipan/tests/regression/test_regression.py` 的 `ANALYZER_KEYS` strip-list 加 `"xingyun"`，跟 Plan 7.3 `yongshenDetail` 一样的处理。

## 7. Rendering contract（样例）

完整 context 块（1993-07-15 14:30 男 长沙，用神 甲木，当前 2026-04-20）：

```text
行运（对照命局用神 甲木）：
    4-13岁    戊午  ⚠忌      戊癸合化火泄木，午未合化土耗木
    14-23岁   丁巳  ·平      丁火生土泄木气，巳火无合无冲
    24-33岁   丙辰  ·平      丙火泄木，辰土耗气
  ★ 34-43岁   乙卯  ⭐喜      乙木比助甲木，卯木同气增援
    44-53岁   甲寅  ⭐⭐大喜  甲木同气直补用神，寅亥合木更旺
    54-63岁   癸丑  ·平      癸水生木有意，丑未冲伤库根
    64-73岁   壬子  ⭐喜      壬水生甲木有源，子未六害破和
    74-83岁   辛亥  ⭐喜      辛金克木本不宜，但寅亥合木解凶
  ↳ 当前大运 乙卯 内流年明细：
      2025(乙巳,33岁)  ·平    乙木助身，巳火泄气，得失参半
      2026(丙午,34岁)  ⚠忌    丙午火局炽烈，反激泄木过头
      2027(丁未,35岁)  ⚠忌    丁未火土并旺，木气衰微
      2028(戊申,36岁)  ⚠⚠大忌 戊癸合化火、申金冲克卯木根
      2029(己酉,37岁)  ⚠忌    己土甲己合化土失位，酉金克卯
      2030(庚戌,38岁)  ⚠⚠大忌 庚金正克甲木用神，戌土耗木
      2031(辛亥,39岁)  ⭐喜    辛金克木本不宜，寅亥合木解凶
      2032(壬子,40岁)  ⭐喜    壬水生甲木，子卯刑稍损但不破
      2033(癸丑,41岁)  ·平    癸生木有意，丑卯无冲合
      2034(甲寅,42岁)  ⭐⭐大喜 甲寅纯木同气直补用神
```

大运行（现有的 `大运  戊午(@4岁) → 丁巳(@14岁) → ...`）**保留不删** —— 给前端 chart panel 消费。评分块是加，不是替换。

## 8. Tests

### 8.1 `paipan/tests/test_xingyun_data.py` — 5 tests
- `test_gan_he_table_has_5_pairs`
- `test_zhi_liuhe_table_has_6_pairs`
- `test_wuxing_generate_cycle_closes`
- `test_wuxing_restrict_cycle_closes`
- `test_score_thresholds_monotonic`

### 8.2 `paipan/tests/test_xingyun.py` — 25 tests
- 5 × label-bin 单元测试（大喜/喜/平/忌/大忌 各 1）
- 4 × 合化/六合 检测（2 positive + 2 negative）
- 2 × 多元素用神（max score + winning element 记录）
- 3 × `build_xingyun` batch（8 条大运 + currentDayunIndex 定位 + liunian 按 index 分组）
- 1 × currentDayunIndex=None when current_year outside all dayun ranges
- 10 × golden 集成（跑 Plan 7.3 的 10 个 birth_input，断言结构性属性）

### 8.3 `server/tests/unit/test_prompts_context_xingyun.py` — 4 tests
- `test_renders_行运_block_when_xingyun_present`
- `test_renders_star_marker_for_current_dayun`
- `test_renders_glyph_for_each_label_bin`
- `test_skips_block_when_xingyun_absent`

### 8.4 Regression
- `ANALYZER_KEYS` strip-list 加 `"xingyun"`。

### 8.5 预期测试总数

| Suite | Before | After | Delta |
|---|---|---|---|
| paipan | 521 | ≥ 551 | +30 |
| server | 430 | 434 | +4 |
| frontend | 51 | 51 | 0 |

## 9. Acceptance gates

1. **所有测试绿**（paipan ≥ 551, server ≥ 434, frontend 51）。
2. **Browser smoke**：
   - 跑 1993-07-15 chart，chart panel 左侧显示不变（前端零改动验证）
   - 问 "我未来十年怎么样" → LLM 引用大运评分
   - 问 "2026 年怎么样" → LLM 引用流年 2026 评分
   - 问 "2030 年呢" → LLM 引用流年 2030 评分
3. **Context token budget**：加上 行运块 后 `compact_chart_context()` 输出不超过原本的 1.8×（约 +24 行）。

## 10. Alternatives considered

### 10.1 多元素用神取平均而不是 max

理由拒绝：平均会稀释强信号。用神是"甲木/戊土/庚金"的盘，行运只打中其中一个元素时（如庚申只生戊土），平均后是中性，丢掉"庚金用神得气"这个真实利好。取 max 更贴合"多用神同辉，任一即可"的古籍直觉。

### 10.2 5-bin 改 3-bin（喜/平/忌）

理由拒绝：3-bin 丢失"喜的程度"。`大喜` 和 `喜` 的区分让 LLM 能写出"这一段是这盘最好的十年"这种判断，3-bin 写不出来。

### 10.3 把评分写进 analyzer.py 而不是 compute.py

理由拒绝：`analyzer()` 职责是"分析命局"，不应涉及时间轴（now_year）。compute.py 是合成层，加 xingyun 在这里自然。

### 10.4 前端加 badge

理由拒绝：用户明确过"前端样式必须和原来一样"。评分的消费者是 chat LLM；如 v1 跑一段时间后确实需要 dashboard 可视化，再起 7.4.1 专门做前端。

### 10.5 加"相邻才合化"判断

理由拒绝：增加 15% 代码复杂度换 5-10% 准确度不划算。v1 取简化版，Plan 7.4.1 如果用户抱怨再严格化。

## 11. Risks

1. **合化判断过度触发**：任意位置合化的简化规则可能让某些盘评分偏乐观或偏悲观。缓解：golden test 断言特定案例的 label 范围（如"这盘 34-43 岁应该是 喜 或 大喜"），不断言精确数值。
2. **多元素用神的分数膨胀**：max 策略可能让"甲木/戊土/庚金"这类盘的所有大运都偏 喜。缓解：在 note 里标注 winningYongshenElement 让 LLM 知道是哪个元素被打中。
3. **currentDayunIndex 漂移**：用户的 chart 一旦生成后，每过一年 currentDayunIndex 可能变。缓解：每次 compute() 调用都重新算，不缓存。regression test 的 ORACLE_NOW 保证测试确定性。
4. **LLM 引用错年份**：LLM 可能算错"用户 2026 年几岁"。缓解：context 里每条流年都明确写 `(ganzhi, age)`，LLM 直接引用不用计算。
5. **用神是 "中和（无明显偏枯）" 的盘**：处理规则定义在 §3.3 末尾"特殊情形：中和命局"。简言之：评分仍跑全量但全部 `平`，渲染层整段折叠。

## 12. Rollout

1. 按 7-task 实施计划逐步推进（见即将写的 Plan 7.4 implementation plan）。
2. Backward compat：老盘（Plan 7.3 时代）DB 里没有 xingyun 字段。context.py 遇到缺字段时静默跳过渲染。
3. 合并到 main 后跑 browser smoke 确认三类问题（未来十年/今年/特定年）都有满意回答。
4. **发布标记**：同 Plan 7.3 做法，直接 push 到 main，不开独立 branch。
5. **Plan 7.5 hook**：7.4 交付后起 Plan 7.5 —— 用神变化（ZPZQ ch10 strict），和 7.4 的 行运块并列成完整的时间轴 用神 系统。

---

## Appendix A: 与 Plan 7.3 的接口契约

| 7.3 提供 | 7.4 消费 |
|---|---|
| `yongshenDetail.primary` (string) | 评分锚点 |
| `yongshenDetail.candidates[*].name` | 不消费（7.4 只看 primary） |
| `chart.paipan.yongshen` (string) | 不消费（primary 更结构化） |

## Appendix B: 现有 dayun 数据契约

`paipan.compute_dayun(...)` 的 return shape 已固定：

```python
{
    'startSolar': 'YYYY-MM-DD',
    'startAge': float,
    'startYearsDesc': str,
    'list': [  # 8 entries
        {
            'index': int,
            'ganzhi': str,
            'startAge': int,
            'startYear': int,
            'endYear': int,
            'liunian': [  # 10 entries
                {'year': int, 'ganzhi': str, 'age': int},
                ...
            ],
        },
        ...
    ],
}
```

7.4 不改 dayun 结构，只在 xingyun dict 里**镜像** + 加评分字段。两份数据并存是有意的（dayun 是干支序列，xingyun 是评分视图）。
