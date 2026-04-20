# Plan 7.5a.1 — Engine Polish Quick Wins Design

**Status:** Draft for implementation
**Date:** 2026-04-21
**Depends on:** Plan 7.3 + 7.4 + 7.5a (all shipped)
**Sibling:** Plan 7.6 (engine polish deep — adjacency/weighted-multi-element/cross-interaction/li_liang-5-bin) reserved

---

## 1. Goal

清理 4 个 Plan 7.4 + 7.5a release notes 里 reserved 的 quick-win polish 项，每项小且边界清晰、不破契约。

## 2. Items in scope

| # | 来源 | 项 | 改动量 |
|---|---|---|---|
| 1 | 7.5a release notes | `transmuted.from` 用 GEJU_RULES key 而非 candidate name | ~3 行 |
| 2 | 7.4 + 7.5a Task review | SMS 测试 flake (`test_send_sms_code_does_not_charge_when_user_none` order-dependent) | debug + fixture 修 |
| 3 | 7.4 release notes | mechanism tag 中心化（常量 + builder 函数；非 Enum） | 新 module + xingyun.py 重构 |
| 4 | 7.4 release notes | `note` 中文标点边界截断 | 替换 `note[:30]` 为 `_trim_note` |

## 3. Non-goals

- **不动算法行为**：所有 4 项都是 surface-level 改动，不变 score 或 transmutation 决策
- **不破现有 test 数值**：所有 7.3/7.4/7.5a golden case 必须仍绿
- **不引入 mechanism tag 字符串变化**：#3 是重构，输出 byte-for-byte 不变
- **不动 LLM prompt**：context.py 渲染逻辑不动
- **不做 Plan 7.6 范围**：合化 adjacency / weighted multi-element / cross interaction / li_liang 5-bin 留 7.6

## 4. Architecture

4 个项相互独立，无 dep 顺序，可并行实施。建议 task 顺序：

```
Task 1: #1 transmuted.from fix          (5 min, low risk)
Task 2: #4 _trim_note utility           (15 min, low risk)
Task 3: #3 mechanism_tags.py centralize (30 min, refactor — verify byte-for-byte 输出不变)
Task 4: #2 SMS flake debug + fix         (open-ended, depends on root cause)
```

## 5. Per-item design

### 5.1 `#1 transmuted.from` fix

**File:** `paipan/paipan/yongshen.py` (修改 `_detect_transmutation`)

**Current logic** (Plan 7.5a Task 3 ship):
```python
original_geju_candidate = next(
    (c for c in composed['candidates'] if c.get('method') == '格局'),
    None,
)
original_geju_name = (original_geju_candidate or {}).get('name', '')
# ... 后传给 _detect_transmutation 做 transmuted['from']
```

`composed.candidates[格局].name` 是 candidate name (e.g. "劫财（自立）" — GEJU_RULES rule 的 name field), 不是格局名。

**Fix**: 用 `_GEJU_ALIASES.get(geju, geju) if geju else ''` 拿真格局名 (post-alias)。

```python
# build_yongshen 里:
original_geju_name = _GEJU_ALIASES.get(geju, geju) if geju else ''
transmuted = _detect_transmutation(
    month_zhi,
    mingju_zhis,
    rizhu_gan,
    force,
    gan_he,
    original_geju_name=original_geju_name,
    tiaohou_candidate=...,
)
```

`_GEJU_ALIASES` 把 `'建禄格' → '比肩格'`、`'月刃格'/'阳刃格' → '劫财格'`，跟 GEJU_RULES key + virtual_geju_name 同命名空间，`from → to` 视觉平行。

**Output 验证**: 1980-02-12 乙木寅月 案例的渲染：
```
旧: ⟳ 月令变化  劫财（自立） → 比肩格
新: ⟳ 月令变化  劫财格 → 比肩格
```

### 5.2 `#2 SMS test flake` fix

**File:** `server/tests/unit/test_sms_service.py`（debug 后定）

**Symptom:** `test_send_sms_code_does_not_charge_when_user_none` 全量跑偶尔红、隔离跑绿。Plan 7.4 + 7.5a Task 2 都看到过。

**Debug strategy:**
1. 用 `pytest-randomly` 或 `pytest --random-order` 强制重现
2. 找出最小复现序列（哪个测试在它前面跑会触发）
3. 检查共享 state：env vars / 全局 mock / DB session / module-level singletons
4. 修复手段（按改动幅度升序）：
   a. 加 `autouse=True` fixture 在测试方法 setUp 阶段 reset 相关 state
   b. 改 mock 为函数级 scope (`@pytest.fixture(scope='function')`)
   c. 显式 `monkeypatch.setenv` 覆盖 SMS-related env vars
   d. 重构涉及的 SMS service module 让 state 不再共享

**No predetermined fix** — debug 后定具体方案。

### 5.3 `#3 mechanism tags 中心化`

**Files:**
- Create `paipan/paipan/mechanism_tags.py` (~30 行)
- Modify `paipan/paipan/xingyun.py` (替换所有 tag f-string 构造)

**新 module 内容** (per design §3 brainstorm):

```python
"""中心化 mechanism tag 词汇表（Plan 7.5a.1）。

避免 xingyun.py 内部 f-string 散落；修改 tag 文案只改这一个文件。
所有 tag 字符串保持跟 Plan 7.4 ship 时 byte-for-byte 一致。
"""
from __future__ import annotations


# 干 effect (5 种 base scoring outcomes)
GAN_SHENG = '干·相生'
GAN_KE = '干·相克'
GAN_BIZHU = '干·比助'
GAN_XIE = '干·相泄'
GAN_HAO = '干·相耗'

# 支 effect (5 种 base scoring outcomes)
ZHI_SHENG = '支·相生'
ZHI_KE = '支·相克'
ZHI_BIZHU = '支·比助'
ZHI_XIE = '支·相泄'
ZHI_HAO = '支·相耗'


# 合化 / 六合 modifier — 后缀含 wuxing，用 builder 函数

def gan_hehua_zhuanzhu(wx: str) -> str:
    """e.g. gan_hehua_zhuanzhu('木') → '干·合化转助·木'."""
    return f'干·合化转助·{wx}'


def gan_hehua_fanke(wx: str) -> str:
    """e.g. gan_hehua_fanke('金') → '干·合化反克·金'."""
    return f'干·合化反克·{wx}'


def zhi_liuhe_zhuanzhu(wx: str) -> str:
    """e.g. zhi_liuhe_zhuanzhu('木') → '支·六合化木·转助'."""
    return f'支·六合化{wx}·转助'


def zhi_liuhe_fanke(wx: str) -> str:
    """e.g. zhi_liuhe_fanke('火') → '支·六合化火·反克'."""
    return f'支·六合化{wx}·反克'
```

**xingyun.py 重构点**：
- `_score_gan_to_yongshen` 内 5 个 base case 的 mech.append → 用 `GAN_SHENG` / `GAN_KE` etc 常量
- `_score_gan_to_yongshen` 内 2 个 modifier case 的 mech.append → 用 `gan_hehua_zhuanzhu(he_wx)` / `gan_hehua_fanke(he_wx)`
- `_score_zhi_to_yongshen` 同样替换 5 base + 2 modifier
- 替换共 14 处 f-string

**关键约束**：每个常量/函数的字符串输出**必须**跟 Plan 7.4 ship 的 hard-coded f-string byte-for-byte 一致。否则破坏现有 9 个 mechanism-字符串相关测试 + 5 个 golden case 的 list 等价。

### 5.4 `#4 _trim_note` 标点边界截断

**File:** `paipan/paipan/xingyun.py` (修改 `score_yun` 函数 + 新增 internal `_trim_note`)

**Current logic** (Plan 7.4 Task 5):
```python
note = '，'.join(parts) if parts else '无显著作用'
if len(note) > 30:
    note = note[:30]   # 简单截断
```

**New logic**:
```python
def _trim_note(note: str, limit: int = 30) -> str:
    """在 ≤ limit 字符内优先在中文标点边界截断。
    
    优先级: 句末 (。) > 分句 (；：) > 子句 (，)
    回退: 字符级硬切（如果半截前没找到合适标点）
    """
    if len(note) <= limit:
        return note
    for sep in ['。', '；', '：', '，']:
        idx = note.rfind(sep, 0, limit)
        if idx > limit // 2:
            return note[:idx + 1]
    return note[:limit]


# in score_yun:
note = '，'.join(parts) if parts else '无显著作用'
note = _trim_note(note)
```

**Behavior verification**:
- 短 note（≤30 字）→ 不变
- 超长 note 含 "，" → 切到最后一个 "，"
- 超长 note 无 "，" → fallback 到字符切
- 超长 note 但 "，" 在前半截 → fallback 字符切（避免太短）

**测试 case**：
```python
_trim_note('丙生用神，午比助用神')              # ≤ 30 字 → 不变
_trim_note('丙生用神，午比助用神，但与命局丁壬合化木有反作用使整体偏弱')  # > 30 → 切到最后"，"
_trim_note('一个超长但没标点的字符串占据了很长很长的位置确实超了三十')   # 无标点 → 字符切
```

## 6. Tests

### 6.1 `paipan/tests/test_yongshen.py` — 1 新测试

**`#1` 验证**: 修复后 `transmuted.from` 应该是格局名:

```python
def test_transmuted_from_uses_geju_key_not_candidate_name():
    """Plan 7.5a.1 §5.1 — transmuted.from 用真格局名 (post-alias)."""
    out = compute(year=1980, month=2, day=12, hour=8, minute=0,
                   gender='male', city='北京')
    detail = out['yongshenDetail']
    transmuted = detail['transmuted']
    # from 是格局名 ("比肩格" or "劫财格"), 不是 candidate name ("劫财（自立）")
    assert transmuted['from'].endswith('格')
    assert '（' not in transmuted['from']  # 不是 "劫财（自立）" 这种 candidate 名
```

### 6.2 `paipan/tests/test_xingyun.py` — 4 新测试

**`#4` 验证**:

```python
from paipan.xingyun import _trim_note


def test_trim_note_short_unchanged():
    assert _trim_note('丙生用神，午比助用神') == '丙生用神，午比助用神'

def test_trim_note_long_with_comma_cuts_at_comma():
    long_note = '丙生用神，午比助用神，但与命局丁壬合化木有反作用'
    out = _trim_note(long_note)
    assert len(out) <= 30
    assert out.endswith('，') or out.endswith('用神')

def test_trim_note_long_no_punct_falls_back_to_char_cut():
    long_note = '一个超长但没标点的字符串占据了很长很长的位置确实超了三十'
    out = _trim_note(long_note)
    assert len(out) == 30  # naive char cut

def test_trim_note_punct_in_first_half_falls_back():
    long_note = '一二三，四五六七八九十一二三四五六七八九十一二三四五六七八九十'
    # "，" 在 idx=3 < limit/2=15, 应该忽略, 走字符切
    out = _trim_note(long_note)
    assert len(out) == 30
```

### 6.3 `paipan/tests/test_xingyun.py` — `#3` mechanism 中心化无回归

```python
def test_mechanism_tags_byte_identical_to_plan74_strings():
    """Plan 7.5a.1 §5.3: 重构后 mechanism 字符串跟 Plan 7.4 ship 的字面值一致."""
    from paipan import mechanism_tags as M
    
    # 5 干 base
    assert M.GAN_SHENG == '干·相生'
    assert M.GAN_KE == '干·相克'
    assert M.GAN_BIZHU == '干·比助'
    assert M.GAN_XIE == '干·相泄'
    assert M.GAN_HAO == '干·相耗'
    
    # 5 支 base
    assert M.ZHI_SHENG == '支·相生'
    assert M.ZHI_KE == '支·相克'
    assert M.ZHI_BIZHU == '支·比助'
    assert M.ZHI_XIE == '支·相泄'
    assert M.ZHI_HAO == '支·相耗'
    
    # 4 modifier builder
    assert M.gan_hehua_zhuanzhu('木') == '干·合化转助·木'
    assert M.gan_hehua_fanke('金') == '干·合化反克·金'
    assert M.zhi_liuhe_zhuanzhu('木') == '支·六合化木·转助'
    assert M.zhi_liuhe_fanke('火') == '支·六合化火·反克'
```

**Plus**：所有 Plan 7.4 现有 `test_score_*` / golden 测试必须仍绿（验证重构后行为字符串不变）。

### 6.4 `server/tests/unit/test_sms_service.py` — `#2` 修复

调试后视情况加 1-3 个 fixture / 测试结构改动。**不预设新增测试数**，目标是消除 flake。

### 6.5 预期测试总数

| Suite | Before 7.5a.1 | After 7.5a.1 | Delta |
|---|---|---|---|
| paipan | 583 | 589 | +6 (1 + 4 + 1) |
| server | 437 | 437 (or +1-3 if SMS fix needs new fixture) | 0~3 |
| frontend | 51 | 51 | 0 |

## 7. Acceptance gates

1. **所有测试绿** (paipan ≥ 589, server ≥ 437, frontend 51)
2. **#3 重构 byte-for-byte 验证**：所有 Plan 7.4 / 7.5a 现有 `mechanisms` 列表内容仍跟 ship 时一致
3. **#1 LLM smoke**：lk 重跑 1980-02-12 案例，chat 答 "我格局变了吗" 时引用的 from/to 应该都是格局名（"劫财格 → 比肩格"），不是混合 candidate name 与格局名
4. **#2 SMS flake repro 在 random-order 下消失**：连跑 3-5 次 `pytest --random-order` 都绿
5. **#4 _trim_note edge case 全覆盖**：4 个测试 case 都过

## 8. Risks

1. **#3 重构遗漏一处 f-string** → mechanism 字符串改变 → 现有测试失败。缓解：grep `'干·'` 和 `'支·'` 找全所有 f-string，逐处替换。
2. **#1 fix 暴露 Plan 7.5a 的golden test 期望值** → `test_yongshen_transmutation_golden` 里如果某 case 断言了 `transmuted.from == '劫财（自立）'` 这种 candidate-name 字串，会 fail。**实际**：codex Task 4 ship 的 5 case 只断言了 `to`、`trigger.type`、`trigger.wuxing`，没断言 `from` 字面值（按 plan Step 4.2 模板）。**预期**安全。
3. **#2 SMS flake 是真 race / DB session 残留** → 修复需要更深的 mock 重构 → scope creep。如果发生，把 SMS fix 单拆 7.5a.2，先 ship 其他 3 项。
4. **#4 `_trim_note` 引入新 corner case** → 比如全是分隔符的 note → 缓解：4 个测试 case 覆盖典型情形；edge case 实际触发率低。

## 9. Rollout

1. 4 个 task 按上述顺序执行（独立无 dep，但顺序递增风险）
2. 每个 task 单独 commit，独立 review，独立 push
3. 全部 ship 后写 release notes（可以直接合并到 Plan 7.6 release notes 或独立写）
4. **Plan 7.6 hook**：7.5a.1 ship 后开 Plan 7.6 deep polish (#3 合化 adjacency / #4 weighted multi-element / #7 cross-interaction / #8 li_liang 5-bin)
