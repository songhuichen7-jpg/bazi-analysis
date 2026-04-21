# Plan 7.5b — 行运用神变化（大运/流年触发）Design

**Status:** Draft for implementation
**Date:** 2026-04-21
**Depends on:** Plan 7.3 (用神 engine v1) + Plan 7.4 (行运 engine) + Plan 7.5a (静态用神变化)
**Reserved follow-ups:** Plan 7.5c (透藏机制); Plan 7.6 (engine polish deep)

---

## 1. Goal

补完 Plan 7.5a 的 time-axis counterpart：当**大运/流年支** + 命局支 + 月令 凑成完整 三合 / 三会 时，月令性质质变 → 重算格局 → 在该大运/流年 entry 上挂 transmuted 信号。Plan 7.4 行运评分契约保持，命局用神 anchor 不变，前端零改动。

ZPZQ ch10 strict reading 的动态半边：
> 「丁生亥月，本为正官，支全卯未，则化为印」  

如果**大运卯**带支与**命局亥未**完整三合木局，月令亥变印 → 那段大运 effective 格局变。Plan 7.5a 处理"命局自带"的静态情形；Plan 7.5b 处理"大运/流年带支才完成"的动态情形。

## 2. Non-goals

- **不重算 Plan 7.4 行运评分**：评分仍 measure against 命局用神（决策 §3）。Transmutation 是补充信号
- **不重算调候/扶抑**（继承 Plan 7.5a 决策）
- **不做透藏机制**（继承 Plan 7.5a 决策；留 Plan 7.5c）
- **不做半合**（继承 Plan 7.5a 决策）
- **不做流月 transmutation**（粒度过头）
- **不改前端**：chartUi.js 零改动

## 3. Architecture

### 3.1 模块划分

```
paipan/paipan/
├── xingyun.py              # MODIFY (build_xingyun 内部 per-entry 加 transmutation 检测;
│                                       新增 _detect_xingyun_transmutation helper)
├── yongshen.py             # 不动 — _detect_transmutation + _compute_virtual_geju_name 复用
└── (其他不动)

server/app/prompts/context.py   # MODIFY — _render_xingyun_block 在 transmuted 触发的大运/流年 entry 多渲染 1-2 行
server/tests/unit/test_prompts_context_xingyun.py   # MODIFY — 加 2 render tests
paipan/tests/test_xingyun.py    # MODIFY — 加 ~16 个 dynamic transmutation tests
```

无新模块。完全复用 Plan 7.5a 引擎核心 (`_detect_transmutation`, `_compute_virtual_geju_name`)。

### 3.2 数据流

```
compute.py
  ↓ analyze() 算 yongshenDetail (含 Plan 7.5a 静态 transmuted 如有)
  ↓ build_xingyun(dayun, yongshenDetail, mingju_gans, mingju_zhis, current_year, 
       chart_context={month_zhi, rizhu_gan, force, gan_he, original_geju_name})
build_xingyun
  ↓ for each 大运 entry:
  ↓   score_yun(...) → label/score/note  (Plan 7.4 不变)
  ↓   _detect_xingyun_transmutation(month_zhi, mingju_zhis, dayun_zhi=X, liunian_zhi=None)
  ↓     → 内部:
  ↓       命局-only baseline = _detect_transmutation(month_zhi, mingju_zhis, ...)
  ↓       with-大运 = _detect_transmutation(month_zhi, mingju_zhis+[X], ...)
  ↓       if with > baseline (大运支贡献第三支): 
  ↓         return with-大运
  ↓       else: return None
  ↓   entry['transmuted'] = ...
  ↓   for each 流年 entry within:
  ↓     score_yun(...) → label/score/note
  ↓     _detect_xingyun_transmutation(month_zhi, mingju_zhis, dayun_zhi=X, liunian_zhi=Y,
  ↓       baseline_transmuted=dayun_transmuted)
  ↓       → 内部:
  ↓         with-流年 = _detect_transmutation(month_zhi, mingju_zhis+[X,Y], ...)
  ↓         if dedup_check(with-流年, baseline_transmuted, Y): 
  ↓           return with-流年
  ↓         else: return None
  ↓     entry['transmuted'] = ...
```

### 3.3 检测算法 (with dedup)

**新 helper `_detect_xingyun_transmutation`**：

```python
def _detect_xingyun_transmutation(
    month_zhi: str,
    base_mingju_zhis: list[str],         # 命局 4 支
    dayun_zhi: str,
    liunian_zhi: str | None,
    *,
    rizhu_gan: str,
    force: dict,
    gan_he: dict,
    original_geju_name: str,
    baseline_transmuted: dict | None = None,   # 大运 entry's already-computed transmuted
) -> dict | None:
    """检测大运/流年 transmutation, 含 dedup logic.
    
    Dedup rules:
      - 大运 entry: with-大运 vs 命局-only baseline。同 source → None (命局已自带)
      - 流年 entry: with-流年 vs baseline_transmuted (大运 transmuted)。同 source → None (大运 echo)
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
        # baseline = 命局-only
        baseline = _detect_transmutation(
            month_zhi, base_mingju_zhis,
            rizhu_gan, force, gan_he,
            original_geju_name=original_geju_name,
        )
        if _is_same_combo(with_dayun, baseline):
            return None  # 命局已自带 (Plan 7.5a 处理)
        return with_dayun
    else:
        # 流年 entry: dedup against 大运 transmuted (passed in)
        with_liunian = _detect_transmutation(
            month_zhi,
            base_mingju_zhis + [dayun_zhi, liunian_zhi],
            rizhu_gan, force, gan_he,
            original_geju_name=original_geju_name,
        )
        if not with_liunian:
            return None
        if _is_same_combo(with_liunian, baseline_transmuted):
            return None  # 大运 echo (没新意义)
        return with_liunian


def _is_same_combo(a: dict | None, b: dict | None) -> bool:
    """Compare two transmuted dicts; True iff same trigger combo (type + zhi_list)."""
    if not a or not b:
        return False
    return (
        a['trigger']['type'] == b['trigger']['type']
        and set(a['trigger']['zhi_list']) == set(b['trigger']['zhi_list'])
    )
```

**关键**: dedup 用结构化字段 (`type` + `zhi_list` 集合) 而非 source string，对未来 source 命名变化 robust (risk §8 #2)。

### 3.4 输出形状

**xingyun.dayun[i]** (Plan 7.4 ship + 1 new field):
```python
{
    'index': i, 'ganzhi': '...', 'startAge': ..., 'startYear': ..., 'endYear': ...,
    'label': '喜', 'score': 2, 'note': '...', 'mechanisms': [...],
    'isCurrent': bool,
    'transmuted': None | {                          # NEW (Plan 7.5b)
        'trigger': {
            'type': 'sanHe' | 'sanHui',
            'wuxing': '木',
            'main': '卯',
            'zhi_list': ['亥', '卯', '未'],
            'source': '三合亥卯未局',
        },
        'from': '正官格',                             # 原本 Plan 7.4 命局格局名
        'to': '偏印格',                               # 虚拟格局名
        'candidate': {
            'method': '格局',
            'name': '官（官印相生）',
            'sub_pattern': '官印相生',
            'note': '偏印得官杀生',
            'source': '子平真诠·论印绶',
        },
        'warning': str | None,
        'alternateTriggers': [],
    },
}
```

**xingyun.liunian[k][j]** (Plan 7.4 ship + 1 new field):
```python
{
    'year': 2030, 'ganzhi': '庚戌', 'age': 38,
    'label': '大忌', 'score': -4, 'note': '...', 'mechanisms': [...],
    'transmuted': None | { ... 同上 shape ... },     # NEW (Plan 7.5b)，dedup'd
}
```

字段 shape 跟 Plan 7.5a `yongshenDetail.transmuted` byte-for-byte 一致 → LLM 看到任何 transmuted 块都能用同一套语义解读。

## 4. 行运评分契约不破

Plan 7.4 的 `score_yun` 输出（label / score / note / mechanisms）**不变**。即使该大运/流年 transmutation 触发，评分仍 measure against 命局用神 (`yongshenDetail.primary`)。

理由（决策 §3）：
- 命局用神 = 稳定 baseline anchor，不能跟 transmutation 一起漂
- 评分语义"行运对本命的影响"清晰可对照
- LLM 看到 transmuted + 评分时自己合成 second-order 解读
- Plan 7.4 ship 33 个 golden case 全部 backward compat

## 5. Integration points

### 5.1 `paipan/paipan/xingyun.py`

**新增 helpers** (per §3.3):
- `_detect_xingyun_transmutation(...)` 
- `_is_same_combo(a, b)`

**修改 `build_xingyun` 签名**：

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
    """chart_context optional dict with keys:
       'month_zhi', 'rizhu_gan', 'force', 'gan_he', 'original_geju_name'
    
    When None, transmutation 检测跳过 → 行为 = Plan 7.4 ship。
    """
```

**修改 `build_xingyun` body**：在每个大运 entry 算完 score_yun 后，调 `_detect_xingyun_transmutation` 算 transmuted；在每个流年 entry 算完 score_yun 后，同样调，传入 `baseline_transmuted=dayun_transmuted` 实现 dedup。详见 §3.2 数据流。

### 5.2 `paipan/paipan/compute.py`

调用 `build_xingyun` 时构造 `chart_context` 参数：

```python
# 现状 (Plan 7.4):
result["xingyun"] = build_xingyun(
    dayun=result["dayun"],
    yongshen_detail=result["yongshenDetail"],
    mingju_gans=mingju_gans,
    mingju_zhis=mingju_zhis,
    current_year=now.year,
)

# Plan 7.5b 改后:
month_zhi = sizhu["month"][1] if sizhu.get("month") else None
analysis = ...   # 已有的 analyzer.analyze() 输出 (含 force, ge_ju, ganHe)
chart_context = None
if month_zhi:
    chart_context = {
        'month_zhi': month_zhi,
        'rizhu_gan': sizhu["day"][0],
        'force': analysis.get("force") or {},
        'gan_he': analysis.get("ganHe") or {},
        'original_geju_name': (analysis.get("geJu") or {}).get("mainCandidate", {}).get("name", ''),
    }

result["xingyun"] = build_xingyun(
    dayun=result["dayun"],
    yongshen_detail=result["yongshenDetail"],
    mingju_gans=mingju_gans,
    mingju_zhis=mingju_zhis,
    current_year=now.year,
    chart_context=chart_context,
)
```

`analysis` 已经在 compute.py 现有数据流里有（Plan 7.3 + 7.5a 都用过）。`original_geju_name` 走跟 Plan 7.5a 一样的 `analysis.geJu.mainCandidate.name` 取法。

### 5.3 `server/app/prompts/context.py`

**修改 `_render_xingyun_block`**：在每个大运/流年行下检查 `entry.get('transmuted')`，触发时多渲染 1-2 行。

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
        lines.append(
            f"        格局新候选：{cand.get('name', '?')}（{cand.get('note', '')}）  "
            f"{cand.get('source', '')}"
        )
```

流年同样处理。`⟳` glyph + 视觉风格跟 Plan 7.5a `_render_yongshen_block` 一致。

### 5.4 Regression strip-list

`paipan/tests/regression/test_regression.py` 的 `ANALYZER_KEYS` 不需改 — `xingyun` 字段整个已在 strip-list (Plan 7.4 ship)。`xingyun.dayun[*].transmuted` 和 `xingyun.liunian[*][*].transmuted` 是嵌套字段，自动一并 strip。

## 6. Tests

### 6.1 `paipan/tests/test_xingyun.py` — ~16 新测试

**`_is_same_combo` 单元 (3 tests)**:
- 两个 None → False
- 同 type + 同 zhi_list (顺序无关) → True
- 同 type + 不同 zhi_list → False

**`_detect_xingyun_transmutation` 大运层 (4 tests)**:
- 大运支贡献第三支 → fire
- 命局已自带合局 (Plan 7.5a 静态) → 大运层 dedup 不 fire
- 大运支不在任何合局 → None
- 大运支 + 命局支 凑了多个 combo → 优先级取 三合

**`_detect_xingyun_transmutation` 流年层 dedup (4 tests)**:
- 大运无合局 + 流年支贡献 → fire
- 大运已合局 + 流年同 combo (echo) → 不 fire (dedup)
- 大运已合局 + 流年触发不同 combo → fire
- 流年支不贡献 + 大运也无合局 → None

**`build_xingyun` 集成 (3 tests)**:
- All-None chart (verified at codex Task 4 实施时；e.g. 1989-08-15 北京)：所有 88 transmuted 都 None。⚠️ 1993-07-15 长沙 chart (Plan 7.3/7.4 standard) **不适合做 all-None oracle** — 它的流年在 Plan 7.5b 下会真触发 (巳午未 / 亥卯未 via 月令未 + 流年带巳/午/亥/卯)。
- 1980-02-12 chart (命局自带，Plan 7.5a 触发)：xingyun.dayun[*].transmuted 都 None (被 yongshenDetail.transmuted 处理)
- 一个 dynamic 触发的真盘：至少 1 个 dayun 或 liunian entry 有 transmuted

**Golden 集成 (5 tests)**:
- 5 个 verified 真盘命局 (实施时 Task 4 codex verify)，每个验证 dynamic transmutation 触发位置 + dedup 正确

### 6.2 `server/tests/unit/test_prompts_context_xingyun.py` — 2 新测试

- `test_renders_xingyun_dayun_transmuted_block`
- `test_renders_xingyun_liunian_transmuted_block`

### 6.3 预期测试总数

| Suite | Before 7.5b | After 7.5b | Delta |
|---|---|---|---|
| paipan | 589 | ≥ 608 | +19 (3 _is_same_combo + 4 大运 detect + 4 流年 dedup + 3 build_xingyun + 5 golden) |
| server | 437 | 439 | +2 |
| frontend | 51 | 51 | 0 |

## 7. Acceptance gates

1. **所有测试绿** (paipan ≥ 608, server ≥ 439, frontend 51)
2. **Plan 7.4 行运评分契约不破**: 33 个 score golden case 仍绿（label/score/note/mechanisms 字段不变）
3. **Plan 7.5a 静态 transmutation 不重复**: 1980-02-12 chart 跑后 `yongshenDetail.transmuted` 仍触发，但 `xingyun.dayun[*].transmuted` 都 None (dedup 验证)
4. **Backward compat**: 调 `build_xingyun(...)` 不传 `chart_context=` 时，行为 = Plan 7.4 (无 transmuted 字段)
5. **Browser smoke**:
   - All-none chart (e.g. 1989-08-15 北京 — Task 4 verified): chart panel 无新视觉, chat 答 "未来十年格局会变吗" → LLM 答 "不会变" 引用 transmutation 检测全 None。⚠️ 注意 1993 standard chart 不能做 all-None smoke 因为流年会真触发 (Task 4 codex catch)。
   - dynamic 触发的 chart (Task 4 verify 之一): chat 答 "我大运里某段格局会变吗" → LLM 引用 ⟳ 月令变化 + 解释

## 8. Risks

1. **静态/动态 transmutation 双触发** — 命局自带合局 + 月令参与时，Plan 7.5a 的静态触发会让 `yongshenDetail.transmuted` 不为空。Plan 7.5b 大运层 detection (含命局支 + 大运支) 会同样命中合局。**Mitigation**: 大运层 dedup against "命局-only baseline" (§3.3) — 同 source/combo 不重复 fire.
2. **dedup 用结构化比较而非 source string** — `_is_same_combo` 比 `trigger.type` + `set(zhi_list)`，对未来 source 命名变化 robust.
3. **流年支贡献 dedup 漏 case** — 三合主气支 + 命局2支 凑半合，流年第三支补全 → 应该 fire。验证 dedup 不误杀这种情况：with-流年 produces a non-None transmuted; baseline (without 流年) was None → fire (not echo).
4. **chart_context 参数 backward compat** — 当前 compute.py 调 build_xingyun 不传 chart_context 时，默认 None，所有 transmutation 检测跳过，输出退回 Plan 7.4 shape (entry 无 transmuted 字段)。Test coverage 验证。
5. **流年 transmuted 渲染信息 overload** — 8 大运 + 当前大运 10 流年的 hybrid 渲染策略下，如果某段大运 dynamic transmute 了 + 内部 4-5 流年也 dedup 后仍各自 fire，context 多 8-10 行。**Mitigation**: 实测发现 dedup 过后流年 transmuted 触发率 < 5%, 真实盘多数 0-1 个流年触发。如不可接受，加 truncation 渲染最多 3 个流年 transmuted。
6. **GEJU_RULES coverage 复用** — Plan 7.5a 已验证 `_compute_virtual_geju_name` 输出 10 格局名都在 GEJU_RULES 里。Plan 7.5b 完全复用，同样安全。

## 9. Alternatives considered

### 9.1 流年层不做 dedup
- 缺点：大运 transmuted 后 10 流年都 echo 同一 transmutation，context 冗余
- 拒绝。

### 9.2 把 transmutation 检测放到 score_yun 内部
- score_yun 当前只关心 评分，加 transmutation 让函数职责膨胀
- 拒绝；放在 build_xingyun batch 层更合适。

### 9.3 大运层不做 dedup
- 命局自带合局的盘，大运 transmuted 会 echo Plan 7.5a 静态信号，造成"命局静态 + 8 大运全 transmute" overload
- 拒绝；大运 dedup against 命局-only baseline 是必要的。

### 9.4 用 source string 比较 dedup
- 脆弱（source 字符串改了 dedup 失效）
- 拒绝；用结构化字段比较 (§3.3 `_is_same_combo`).

## 10. Rollout

1. 5-task 实施计划逐步推进 (即将写)
2. Backward compat: chart_context=None 时退回 Plan 7.4 行为
3. 合并到 main 后 browser smoke 验证 dynamic transmutation chart + chat 引用
4. **发布标记**: 同前 plan 做法，直接 push main，不开独立 branch
5. **Plan 7.5c hook**: 7.5b ship 后开 ZPZQ ch10 ② 透藏机制 (如果 audit 发现 ge_ju.py 漏)
6. **Plan 7.6 hook**: deep polish (合化 adjacency / weighted multi-element / cross-interaction / li_liang 5-bin) 独立立项

---

## Appendix A: 与 Plan 7.3/7.4/7.5a 的接口契约

| 7.3/7.4/7.5a 提供 | 7.5b 消费 |
|---|---|
| `_detect_transmutation` (yongshen.py) | 复用，不改 |
| `_compute_virtual_geju_name` (yongshen.py) | 复用，不改 |
| `geju_yongshen` (yongshen.py) | 复用，不改 |
| `chart.paipan.xingyun.dayun[i]` shape | 加 `transmuted` 字段 |
| `chart.paipan.xingyun.liunian[k][j]` shape | 加 `transmuted` 字段 |
| `score_yun` 输出 | 不消费，不改 |
| `chart.paipan.yongshenDetail.transmuted` (Plan 7.5a) | 不消费 (静态独立处理) |

## Appendix B: 算法 worked example

**输入**: 丁火亥月，命局支 [酉,亥,卯,未]（已含完整亥卯未三合）。  
**Plan 7.5a static**: `yongshenDetail.transmuted` = 偏印格 (亥卯未三合木局触发)  
**Plan 7.5b 大运 #5 (癸丑)**: 检测 with-大运 mingju_zhis = [酉,亥,卯,未,丑]
- with-大运 transmuted = 亥卯未三合木局 (只 3 支匹配)
- baseline (命局-only) transmuted = 亥卯未三合木局 (同样 3 支)
- `_is_same_combo` → True → **dedup, return None**

**Plan 7.5b 大运 #2 (丁巳)**: with-大运 mingju_zhis = [酉,亥,卯,未,巳]
- 检测：亥卯未仍是唯一三合 (巳不参与)
- baseline: 亥卯未
- 同 combo → dedup, return None

**结论**: 对 1980-02-12 类命局自带合局的盘，所有 8 大运的 `transmuted` 都是 None。Plan 7.5a 静态信号已处理，Plan 7.5b dedup 防止重复 echo。

**反例**: 假设另一个盘 命局支 [子,寅,午,辰] (月令子, 命局有寅午, 缺戌)
- Plan 7.5a static: 寅午戌不完整 → no transmuted
- Plan 7.5b 大运戌带支: with-大运 = [子,寅,午,辰,戌]
  - 寅午戌完整 + 月令子? 月令子不在寅午戌 → 不 fire
  - 申子辰? mingju 含 子+辰, 缺 申 → 不完整
  - 月令子也没参与寅午戌 → 仍不 fire
- 大运辰带支: with-大运 = [子,寅,午,辰,辰]
  - 申子辰? 子+辰但缺 申 → 不完整
  - 寅午戌? 寅+午但缺戌 + 月令子也不参与 → 不 fire
- 大运申带支: with-大运 = [子,寅,午,辰,申]
  - 申子辰? 申+子+辰完整 + 月令子参与 → **fire 三合水局**
  - baseline (without 申) 没合局 → 不同 combo → return with-大运
  - **大运层 transmuted 触发** for 大运申

这就是 dynamic transmutation 真正的 use case。
