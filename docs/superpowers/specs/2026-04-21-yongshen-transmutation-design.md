# Plan 7.5a — 用神变化（命局合局触发）Design

**Status:** Draft for implementation
**Date:** 2026-04-21
**Depends on:** Plan 7.3 (用神 engine v1, shipped) + Plan 7.4 (行运 engine, shipped)
**Reserved follow-ups:**
- Plan 7.5b — 动态大运/流年触发的用神变化（time-axis 用神 transmutation）
- Plan 7.5c — ZPZQ ch10 透藏机制完整覆盖（如果 audit 发现 ge_ju.py 漏）

---

## 1. Goal

修复 Plan 7.3 用神 engine 的一个 classical 盲点：**命局自带三合 / 三会** 时，月令性质质变 → 格局应当随之变化。

ch10 strict reading：
> 「丁生亥月，本为正官，支全卯未，则化为印」  
> 「癸生寅月，月令伤官秉令，藏甲透丙，会午会戌，则寅午戌三合，伤化为财」

Plan 7.3 的 `geju_yongshen` 只看 `(月令 + force.scores + ganHe)`，不检测命局支自带的合局关系。这种盘当前 Plan 7.3 输出的格局是错的。

7.5a 在 Plan 7.3 之上**附加**一个 transmutation 检测层：
- 当命局支自带 三合或三会 + 月令参与时，计算虚拟格局
- 通过新 optional 字段 `yongshenDetail.transmuted` 暴露给 LLM
- 不破坏 Plan 7.3 candidates 契约

## 2. Non-goals

- **不做动态变化**（大运/流年带支触发的 transmutation） — 留给 Plan 7.5b
- **不做透藏机制变化**（月令藏干透出选谁）— Plan 7.3 的 ge_ju.py 部分覆盖；如果 audit 发现真漏再起 Plan 7.5c
- **不做半合**（中气支 + 中气邻支）— 古籍说"半合力弱"，触发条件不强；v1 不收
- **不重算调候/扶抑**：决策 §4 锁定，只重算格局法
- **不影响 yongshenDetail.primary 选择**：决策 §3.3 锁定，primary 仍按 Plan 7.3 投票规则
- **不改前端**：chartUi.js 零改动

## 3. Architecture

### 3.1 模块划分

```
paipan/paipan/
├── yongshen.py                # MODIFY — 加 _detect_transmutation + _compute_virtual_geju_name；
│                                            build_yongshen 加 mingju_zhis 参数
├── analyzer.py                # MODIFY — 调 build_yongshen 时多传 mingju_zhis
├── he_ke.py                   # 不动 — SAN_HE_JU + SAN_HUI 复用
├── yongshen_data.py           # 不动 — 不需要新数据表
└── tests/test_yongshen.py     # MODIFY — 加 ~23 个新测试

server/app/prompts/context.py  # MODIFY — _render_yongshen_block 加 transmuted 段渲染
server/tests/unit/test_prompts_context_yongshen.py  # MODIFY — 加 2 个 transmuted 渲染测试
```

无新数据表，无新文件，无新依赖。整个 7.5a 是 Plan 7.3 之上的 ~150 行新代码 + 25 个新测试。

### 3.2 数据流

```
analyzer.py
  ↓ 调 build_yongshen(...) 多传 mingju_zhis=[y.zhi, m.zhi, d.zhi, h.zhi]
build_yongshen
  ↓ 跑 Plan 7.3 三法 (调候 / 格局 / 扶抑) → composed dict
  ↓ 调 _detect_transmutation(month_zhi, mingju_zhis, rizhu_gan, force, gan_he)
_detect_transmutation
  ↓ 用 SAN_HE_JU / SAN_HUI 找包含 month_zhi 的完整合局
  ↓ 按优先级取一个
  ↓ _compute_virtual_geju_name → 'X格' (10 种之一)
  ↓ 调 geju_yongshen(virtual_geju_name, force, gan_he) → new candidate
  ↓ 组装 transmuted dict
build_yongshen
  ↓ composed['transmuted'] = transmuted (if not None)
  ↓ composed['primaryReason'] += '（注：月令合局触发格局质变…）' (if transmuted)
context.py compact_chart_context
  ↓ _render_yongshen_block 见 transmuted 字段时多渲染 2-3 行
LLM
  ↓ 看到 transmuted 块 → 用 ch10 风格"由X变Y"叙事回答
```

### 3.3 触发与命名算法

**触发条件**：

```python
candidate_combos = []

# 三合 (4 种)
for ju in SAN_HE_JU:                    # SAN_HE_JU 已在 he_ke.py
    matched = [z for z in ju["zhi"] if z in mingju_zhis]
    if month_zhi in matched and len(matched) == 3:
        candidate_combos.append({
            "type": "sanHe",
            "wuxing": ju["wx"],
            "main": ju["main"],          # 三合 main 支已在 SAN_HE_JU 表里
            "zhi_list": list(ju["zhi"]),
            "source": f"三合{''.join(ju['zhi'])}局",
        })

# 三会 (4 种)
for hui in SAN_HUI:
    matched = [z for z in hui["zhi"] if z in mingju_zhis]
    if month_zhi in matched and len(matched) == 3:
        candidate_combos.append({
            "type": "sanHui",
            "wuxing": hui["wx"],
            "main": hui["zhi"][1],       # 三会主气支 = 中位
            "zhi_list": list(hui["zhi"]),
            "source": f"三会{hui['dir']}方",
        })

if not candidate_combos:
    return None
```

**关键约束**：`month_zhi in matched` —— ZPZQ ch10 strict 要求月令必须参与合局。命局其他三支自合（年/日/时三支构成 三合）不算月令质变。

**多合局优先级**（罕见但可能）：

1. 三合 优先于 三会（古籍通论"三合力强"）
2. 同型多个 → 取首先扫到的（因 4 个 SAN_HE_JU / 4 个 SAN_HUI 互斥，理论上同型只能命中 1 个；保留这条规则只是兜底防御）
3. 实际触发上限：命局 4 支只能凑出 1 个完整 三合 OR 1 个完整 三会（不能两个都完整，因为 1 个三合需要 3 支，2 个三合需要 ≥5 支不重叠）；唯一可能并发情况：月令支同时在某 三合 和某 三会 里（如月令 子 + 命局 申辰 = 申子辰三合；同时 + 亥丑 = 亥子丑三会，两个组合**共享月令 子**但 各占 命局其余 2 支） — 这要求命局 4 支严格匹配 5 个不同支，物理不可能

剩余未取的合局放 `transmuted.alternateTriggers: list[trigger]` 留 audit 用，v1 不渲染。

**虚拟格局命名** (`_compute_virtual_geju_name`)：

```python
def _compute_virtual_geju_name(
    new_wuxing: str,        # '木' (合局五行)
    rizhu_gan: str,         # '丁'
    main_zhi: str,          # '卯'
) -> str:
    rizhu_wx = GAN_WUXING[rizhu_gan]                    # '火'
    rizhu_yy = GAN_YINYANG[rizhu_gan]                   # '阴'
    main_gan = get_ben_qi(main_zhi)                     # '乙' (from paipan.cang_gan)
    main_yy  = GAN_YINYANG[main_gan]                    # '阴'

    # 1. 算 十神类
    if new_wuxing == rizhu_wx:
        ten_god_class = '比劫'
    elif WUXING_SHENG[new_wuxing] == rizhu_wx:
        ten_god_class = '印'
    elif WUXING_SHENG[rizhu_wx] == new_wuxing:
        ten_god_class = '食伤'
    elif WUXING_KE[rizhu_wx] == new_wuxing:
        ten_god_class = '财'
    elif WUXING_KE[new_wuxing] == rizhu_wx:
        ten_god_class = '官杀'
    else:
        return None  # 不应触发，但兜底

    polarity = 'same' if main_yy == rizhu_yy else 'opposite'

    return _GEJU_NAME_TABLE[(ten_god_class, polarity)]


_GEJU_NAME_TABLE = {
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

**示例校验**：丁火（阴）+ 亥卯未三合木局，main=卯（阴乙）  
- new_wuxing='木', rizhu_wx='火'  
- 木生火 → ten_god_class='印'  
- main_yy='阴', rizhu_yy='阴' → polarity='same' → **偏印格** ✓

ch10 例子核对："丁生亥月，支全卯未，则化为印" — 古籍只说"印"不区分正偏。我们按 main 支决定 = 偏印。古籍标准读法。

**`ZHI_BENQI_GAN` lookup**：地支本气藏干。验证：`paipan/paipan/cang_gan.py` 已有 `get_ben_qi(zhi: str) -> str` 公开函数（基于内部 `_CANG_GAN_RAW`，每个 zhi 第 0 项是本气）。直接 import 复用：

```python
from paipan.cang_gan import get_ben_qi
main_gan = get_ben_qi(main_zhi)
```

不需新增数据表。

### 3.4 触发后格局重算

```python
# 已有的 Plan 7.3 函数，复用
new_geju_candidate = geju_yongshen(
    geju=virtual_geju_name,    # '偏印格' (10 种之一)
    force=force,                # 力量分布不变
    gan_he=gan_he,              # 干合 不变
)
```

GEJU_RULES (Plan 7.3 task 3 ship) 已包含全部 10 个虚拟格局名 + 杂气月 + 格局不清。10/10 命名都能查到 rules → 不会出现 transmuted.candidate 是空 dict 的情况。

## 4. Output shape

`yongshenDetail.transmuted` 是 optional dict，仅在合局触发时存在：

```python
yongshenDetail.transmuted = {
    'trigger': {
        'type':     'sanHe' | 'sanHui',
        'wuxing':   '木',
        'main':     '卯',
        'zhi_list': ['亥', '卯', '未'],
        'source':   '亥卯未三合木局',
    },
    'from':      '正官格',                          # 原本 Plan 7.3 算出的格局
    'to':        '偏印格',                          # 虚拟格局
    'candidate': {                                  # 新格局对应用神 (geju_yongshen 输出)
        'method':       '格局',
        'name':         '官（官印相生）',
        'sub_pattern':  '官印相生',
        'note':         '偏印得官杀生',
        'source':       '子平真诠·论印绶',
    },
    'warning':            '月令合局后格局质变…' | None,
    'alternateTriggers':  [],   # 罕见多合局时其他备选；v1 不渲染但留 seed
}
```

### 4.1 warning 触发规则

```python
if transmuted.candidate.name == tiaohou.name:
    warning = None  # 调候 + 转化后格局 一致 → 三派对齐
elif transmuted.candidate.name != original_geju_candidate.name:
    warning = (
        f"月令合局后格局质变，原本\"{transmuted['from']}\"的取用法不再适用"
    )
else:
    warning = None  # 转化前后取用法相同 → 没必要警告
```

### 4.2 不影响 primary 选择

primary 仍按 Plan 7.3 的 `compose_yongshen` 投票规则（调候 + 原格局 + 扶抑 三法投票），transmuted 是**附加信息层**，不替换 candidates[1]。

理由：
- 决策 §4：调候/扶抑 不重算
- 如果 transmuted 影响 primary，Plan 7.3 老盘的 yongshen 字符串会变 → 破坏 backward compat
- LLM 看到 transmuted 块时，能写"原本格局取财，但合局后变印 —— 调候和印同方向，反而印才是真用神"这种叙事

但加一个 hint 在 primaryReason：

```python
if transmuted is not None:
    yongshenDetail.primaryReason += '（注：月令合局触发格局质变，详见 transmuted 字段）'
```

chartUi.js 渲染的 primary 字符串本身不变（仍是 "甲木" 之类），但 LLM 在 prompt 里能看到提示。

## 5. Integration points

### 5.1 `paipan/paipan/yongshen.py`

新增 `_detect_transmutation` + `_compute_virtual_geju_name` (per §3.3 algorithms)。

修改 `build_yongshen` 签名（加一个 param，向后默认 None 保持兼容）：

```python
def build_yongshen(
    rizhu_gan: str,
    month_zhi: str | None,
    force: dict,
    geju: str | None,
    gan_he: dict,
    day_strength: str | None,
    mingju_zhis: list[str] | None = None,    # NEW (default None)
) -> dict:
    composed = compose_yongshen(...)   # Plan 7.3 unchanged

    if mingju_zhis and month_zhi:
        original_geju_candidate = next(
            (c for c in composed['candidates'] if c.get('method') == '格局'),
            None,
        )
        original_geju_name = (original_geju_candidate or {}).get('name', '')
        transmuted = _detect_transmutation(
            month_zhi, mingju_zhis, rizhu_gan, force, gan_he,
            original_geju_name=original_geju_name,
            tiaohou_candidate=next(
                (c for c in composed['candidates'] if c.get('method') == '调候'),
                None,
            ),
            original_geju_main_name=geju,   # 顶层格局 string
        )
        if transmuted:
            composed['transmuted'] = transmuted
            composed['primaryReason'] += \
                '（注：月令合局触发格局质变，详见 transmuted 字段）'

    return composed
```

`mingju_zhis=None` 默认 → Plan 7.3 老调用方完全不变。

### 5.2 `paipan/paipan/analyzer.py`

唯一改动：调 `build_yongshen` 时多传一个参数。

```python
yongshen_dict = build_yongshen(
    rizhu_gan=d["gan"],
    month_zhi=m["zhi"],
    force=force,
    geju=ge_ju_main,
    gan_he=gan_he,
    day_strength=force.get('dayStrength'),
    mingju_zhis=[y["zhi"], m["zhi"], d["zhi"], h["zhi"]],   # NEW
)
```

`y/m/d/h` 是 analyzer.py 既有的局部变量，不引入新数据流。

### 5.3 `server/app/prompts/context.py`

修改 Plan 7.3 的 `_render_yongshen_block`，在 candidates 渲染完之后、warnings 渲染前插入 transmuted 段（per §3.5 of brainstorming → §4 中样例）：

```python
def _render_yongshen_block(paipan: dict) -> list[str]:
    detail = paipan.get('yongshenDetail') or {}
    if not detail.get('primary'):
        return []

    lines = [...]   # primary line + 3 candidates  (Plan 7.3 不变)

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
        lines.append(
            f"      格局新候选：{cand_name}（{cand_note}）  {cand_src}"
        )
        if transmuted.get('warning'):
            lines.append(f"      ⚠ {transmuted['warning']}")

    for w in detail.get('warnings') or []:
        lines.append(f"  ⚠ {w}")

    return lines
```

`⟳` glyph 标 transmutation block。老盘没 transmuted 字段 → 整段 skip。

### 5.4 Regression strip-list

不需改 — `yongshenDetail` 整个 dict 已在 Plan 7.3 加进 strip-list。`transmuted` 是其内部字段，自动一起 strip。

## 6. Tests

### 6.1 `paipan/tests/test_yongshen.py` — 23 新测试

| 测试组 | 数量 | 覆盖 |
|---|---|---|
| `_compute_virtual_geju_name` | 10 | 5 五行 × 2 polarity 全覆盖 (印/比劫/食伤/财/官杀 × same/opposite) |
| `_detect_transmutation` | 5 | 月令参与三合 / 月令参与三会 / 月令不参与（不触发） / 命局不足 3 支（不触发） / 三合优于三会优先级 |
| `build_yongshen` 集成 | 3 | 触发时 detail.transmuted dict 存在且 shape 对 / 不触发时 detail.transmuted 不存在 / primaryReason 加 hint |
| Golden 集成 | 5 | 真盘验证 |

### 6.2 Golden case 选材

5 个真触发的命局：

| Label | birth_input 候选 | 期望触发合局 |
|---|---|---|
| `丁火亥月_亥卯未三合` | year=1983 month=11 day=4 hour=0 minute=0 gender=male city=北京 (实施时验证) | 三合木局 → 偏印格 |
| `庚金子月_申子辰三合` | year=1992 month=12 day=15 hour=8 minute=0 gender=female city=上海 | 三合水局 → 食伤格 |
| `戊土午月_寅午戌三合` | year=2014 month=6 day=10 hour=14 minute=0 gender=male city=广州 | 三合火局 → 印格 |
| `丙火寅月_寅卯辰三会` | year=2010 month=2 day=20 hour=12 minute=0 gender=female city=深圳 | 三会木方 → 印格 |
| `己土未月_无合` | Plan 7.3 标准 1993 chart 之一 | 负向：不触发 |

实施时（codex Task 5 Golden）首先用脚本验证每个 birth_input 的命局支确实包含期望合局支。如果某个不触发，更换 input。

### 6.3 `server/tests/unit/test_prompts_context_yongshen.py` — 2 新测试

- `test_renders_transmuted_block_when_present`
- `test_renders_transmuted_warning_line`

### 6.4 预期测试总数

| Suite | Before 7.5a | After 7.5a | Delta |
|---|---|---|---|
| paipan | 559 | ≥ 582 | +23 |
| server | 435 | 437 | +2 |
| frontend | 51 | 51 | 0 |

## 7. Acceptance gates

1. **所有测试绿** (paipan ≥ 582, server ≥ 437, frontend 51)
2. **Plan 7.3 contract 不破**：
   - Plan 7.3 的 33 golden case 全绿（candidates 仍是 3 条，primary 字符串不变）
   - regression test 不动也仍绿
3. **Browser smoke**：
   - 跑标准 1993 chart：无 transmutation 触发（命局癸/己/丁/丁，地支酉/未/酉/未，没合局）→ chart panel 完全等同 Plan 7.4 smoke
   - 跑一个 transmutation case（5 个 golden 之一），chat 问"我格局变了吗" → LLM 引用 transmuted block 解释

## 8. Risks

1. **GEJU_RULES 对虚拟格局的支持度** — 5 五行 × 2 polarity = 10 个虚拟格局名，全部已经在 Plan 7.3 task 3 ship 的 12 个 GEJU_RULES key 范围内（10 主格局 + 杂气月 + 格局不清）。10/10 都能查到 rules → 不会出现 transmuted.candidate 是空 dict 的情况。**已验证安全**。
2. **多合局优先级歧义** — §3.3 已 frozen。极罕见多触发 case 取一个 + 留 alternateTriggers seed。
3. **transmutation 弄反 primary** — §4.2 已锁 transmuted 不影响 primary 选择。primary 仍按 7.3 三法投票。
4. **Plan 7.3 老 chart 测试可能引入 transmuted 字段，破 oracle** — Plan 7.3 的 10 golden case 没有任何盘命局自带 三合/三会（实现细节 + 抽样巧合）。如果有触发的，oracle test 仍通过，因为 ANALYZER_KEYS strip-list 整个 strip yongshenDetail。**已验证安全**。
5. **Golden case 输入未必真触发期望合局** — §6.2 列的 birth_input 是估计；实施时 codex 必须先验证每个真出 transmuted 字段，否则换 input。**实施时收口**。

## 9. Alternatives considered

### 9.1 重算调候/扶抑

理由拒绝：决策 §4 已论证。ch10 strict reading 只讲格局变化；调候 keyed on 真实月令地支位置，跟假设合局发生无关；扶抑 keyed on dayStrength（force 算法用月令本气藏干 wuxing，不是合化 wuxing）。重算调候/扶抑会让 Plan 7.3 contract 完全推翻。

### 9.2 用半合（中气支 + 邻支）做触发

理由拒绝：古籍说"半合力弱"，触发条件不强，误判风险大。如果 v1 跑一段时间发现需要，再加。

### 9.3 把 transmuted 的格局放进 candidates list

理由拒绝：Plan 7.3 candidates list 长度固定 3（调候/格局/扶抑），是已确立的契约。改成 4 会破坏前端和 LLM 现有 prompt 的预期。新增 optional `transmuted` 字段更克制。

### 9.4 把 transmutation 算到 ge_ju.py 里（更上游）

理由拒绝：ge_ju.py 是 Plan 7.1 的命局格局检测，已经 stable，被很多东西消费（包括 yongshenDetail.geju 字符串）。在 ge_ju.py 加合局检测会让 ge_ju 输出从"原本格局"变成"实际生效格局"，破坏所有下游消费方的语义。把 transmutation 放在 yongshen 层是 additive 的、不污染上游。

## 10. Rollout

1. 按 5-task 实施计划逐步推进（即将写的 Plan 7.5a implementation plan）
2. Backward compat：老盘没 transmuted 字段；context.py skip
3. 合并到 main 后跑 browser smoke 确认 transmutation 触发的 chart 在 chat 里能被 LLM 引用
4. **发布标记**：同 Plan 7.3/7.4 做法，直接 push 到 main，不开独立 branch
5. **Plan 7.5b hook**：7.5a ship 后起 Plan 7.5b —— 动态大运/流年触发的 transmutation。架构上 7.5b 复用 `_detect_transmutation` + `_compute_virtual_geju_name`，但 mingju_zhis 在大运/流年 expand 成 5/6 支。

---

## Appendix A: 与 Plan 7.3 + 7.4 的接口契约

| 7.3/7.4 提供 | 7.5a 消费 |
|---|---|
| `yongshenDetail` 全字段 | 加 optional `transmuted` 字段 |
| `yongshenDetail.candidates` 3 entries | 不变 |
| `yongshenDetail.primary` string | 不变（不重算） |
| `chart.paipan.yongshen` string | 不变（chartUi.js 兼容守住） |
| `chart.paipan.xingyun` (Plan 7.4) | 不消费（7.5a 跟 7.4 不交叉） |
| `geju_yongshen(geju, force, gan_he)` | 调用复用，传虚拟格局名 |

## Appendix B: ZPZQ ch10 原文摘要（已读）

```
用神既主月令矣，然月令所藏不一，而用神遂有变化。
...
故若丁生亥月，本为正官，支全卯未，则化为印。
己生申月，本属伤官。藏庚透壬，则化为财。
凡此之类皆用神之变化也。

变之而善，其格愈美；变之不善，其格遂坏...
癸生寅月，月令伤官秉令，藏甲透丙，会午会戌，则寅午戌三合，
伤化为财；加以丙火透出，完全作为财论...
乙生寅月，月劫秉令，会午会戌，则劫化为食伤...

何谓变之而不善？如丙生寅月，本为印绶，甲不透干而会午会戌，
则化为劫。丙生申月，本属偏财，藏庚透壬，会子会辰，则化为煞。
...

是故八字非用神不立，用神非变化不灵，善观命者，必于此细详之。
```

ch10 strict 涵盖两套机制：① 会合（三合/三会）+ ② 透藏。本 plan 7.5a 仅做 ①（会合）。② 透藏由 ge_ju.py 部分覆盖；如果 audit 发现真漏开 7.5c。
