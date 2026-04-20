# Plan 7.5a.1 — Engine Polish Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 small follow-ups from Plan 7.4 + 7.5a release notes — `transmuted.from` 用真格局名 (1-line fix) + `_trim_note` 中文标点边界截断 + mechanism tag 中心化重构 + SMS test flake 修复。无算法行为变化。

**Architecture:** 4 个 task 相互独立、无 dep、可并行。按风险升序执行：1-line fix → utility 新增 → 14-处重构 → debug-driven。每 task 独立 commit。

**Tech Stack:** Python 3.12 · pytest. 无新依赖。

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-21-engine-polish-quickwins-design.md`. Plan 与 spec 不符 inline 修 plan + commit 标注 catch.
2. **行为不变**: 4 项都是 surface-level 改动。所有 Plan 7.3 / 7.4 / 7.5a golden case 必须仍绿。
3. **Mechanism tag byte-for-byte 不变**: Task 3 重构后 `mechanisms` 列表内容跟 Plan 7.4 ship 时字面值一致。否则破坏现有所有 mechanism 相关测试。
4. **Backward compat**: yongshenDetail / xingyun 字段 shape 完全不变。
5. **前端零改动**: chartUi.js / Shell.jsx / 任何 frontend/src/ 不动。
6. **Tests stay green baseline**: 583 paipan + 437 server + 51 frontend。

## 目录最终形态

```
paipan/
├── paipan/
│   ├── yongshen.py             # MODIFY (Task 1: 1 line; Task 4: 4 处 mechanism imports if Task 3 done)
│   │     - Task 1: build_yongshen 调 _detect_transmutation 时, original_geju_name 改用 _GEJU_ALIASES.get
│   ├── xingyun.py              # MODIFY (Task 2: 加 _trim_note + 调用; Task 3: 14 处 f-string 替换)
│   ├── mechanism_tags.py       # NEW (Task 3, ~30 行)
│   └── ... (其他不动)
└── tests/
    ├── test_yongshen.py        # MODIFY (Task 1: 加 1 个 test)
    └── test_xingyun.py         # MODIFY (Task 2: 加 4 个 _trim_note tests; Task 3: 加 1 byte-identity test)

server/
└── tests/unit/
    └── test_sms_service.py     # MODIFY (Task 4: debug 后视情况加 fixture / 重构)
```

无前端 / DB / route 改动。

## Task 列表预览

- **Task 1** — #1: `transmuted.from` 用 GEJU_RULES key（1-line fix + 1 test）
- **Task 2** — #4: `_trim_note` utility + 4 边界 test（pure addition）
- **Task 3** — #3: `mechanism_tags.py` 中心化 + 14 处 xingyun.py f-string 替换 + 1 byte-identity test（重构，必须 byte-for-byte）
- **Task 4** — #2: SMS flake debug + fix（open-ended）

每个 task 完整后独立 commit + push。无顺序 dep，但风险递增建议按 1→4 顺序 review。

---

## Task 1: #1 — `transmuted.from` 用 GEJU_RULES key

**Files:**
- Modify: `paipan/paipan/yongshen.py` (1 line in build_yongshen)
- Modify: `paipan/tests/test_yongshen.py` (1 new test)

- [ ] **Step 1.1: Read current `build_yongshen` implementation**

Read `paipan/paipan/yongshen.py` and find the section in `build_yongshen` (added by Plan 7.5a Task 1) where `original_geju_candidate` is computed and `original_geju_name` is extracted. It should look like:

```python
if mingju_zhis and month_zhi:
    original_geju_candidate = next(
        (c for c in composed['candidates'] if c.get('method') == '格局'),
        None,
    )
    original_geju_name = (original_geju_candidate or {}).get('name', '')
    tiaohou_candidate = ...
    transmuted = _detect_transmutation(
        ...,
        original_geju_name=original_geju_name,
        ...
    )
```

- [ ] **Step 1.2: Replace `original_geju_name` extraction**

Change:
```python
# OLD:
original_geju_candidate = next(
    (c for c in composed['candidates'] if c.get('method') == '格局'),
    None,
)
original_geju_name = (original_geju_candidate or {}).get('name', '')

# NEW (Plan 7.5a.1 §5.1):
original_geju_name = _GEJU_ALIASES.get(geju, geju) if geju else ''
```

The `geju` parameter is the `build_yongshen` arg (passed from analyzer.py as `ge_ju_main`, the actual格局 name like "月刃格" or "正官格"). `_GEJU_ALIASES` is the existing module-level dict from Plan 7.3 (maps "建禄格"→"比肩格", "月刃格"→"劫财格", "阳刃格"→"劫财格"). After alias, `original_geju_name` matches GEJU_RULES key namespace (same as `to`).

The old `original_geju_candidate` is no longer used → can also remove. **But** verify the variable isn't referenced anywhere else in that function before removing. If it is, keep the assignment but rename to `_unused_for_now` to make intent clear.

- [ ] **Step 1.3: Write 1 new test in `paipan/tests/test_yongshen.py`**

Append:

```python
def test_transmuted_from_uses_geju_key_not_candidate_name():
    """Plan 7.5a.1 §5.1 — transmuted.from 用真格局名 (post-alias).

    Before fix: from = '劫财（自立）' (candidate name from GEJU_RULES rule).
    After fix:  from = '劫财格' (GEJU_RULES key, post-alias from analyzer's '月刃格').
    """
    out = compute(year=1980, month=2, day=12, hour=8, minute=0,
                   gender='male', city='北京')
    detail = out['yongshenDetail']
    transmuted = detail.get('transmuted')
    assert transmuted is not None, '1980-02-12 案例应触发 transmutation'
    # from 应是格局名 (e.g. '劫财格' or '比肩格'), 不是 candidate name
    assert transmuted['from'].endswith('格'), \
        f"from='{transmuted['from']}' should end with '格'"
    assert '（' not in transmuted['from'], \
        f"from='{transmuted['from']}' should not contain '（' (candidate name marker)"
    # to 也是格局名 — 验证 from/to 同命名空间
    assert transmuted['to'].endswith('格')
```

- [ ] **Step 1.4: Run test**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py::test_transmuted_from_uses_geju_key_not_candidate_name -v
```
Expected: 1 passed.

- [ ] **Step 1.5: Run full paipan + server regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 583 + 1 = 584 passed (Plan 7.5a `test_yongshen_transmutation_golden` 5 个 case 仍绿 — verified safe per spec §8 risk #2)

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 437 passed (unchanged)

> **If `test_yongshen_transmutation_golden` 失败**: 检查它的 assertion 列表。Plan 7.5a Task 4 ship 的 5 case 应该只断言 `to`, `trigger.type`, `trigger.wuxing`, `candidate.method`, `candidate.source`, `primaryReason` —— 没有 assert `from` 字面值。如果有，把 `from` assertion 改成 `.endswith('格')` 模式（pre-existing assertion 改为不依赖 candidate-name 字符串）。

- [ ] **Step 1.6: Commit**

```bash
git add paipan/paipan/yongshen.py paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(paipan): Plan 7.5a.1 #1 transmuted.from uses GEJU_RULES key

Previously transmuted.from was set to composed.candidates[格局].name
(e.g. '劫财（自立）' — the candidate's name field from GEJU_RULES rule),
which is conceptually different from transmuted.to (which is a
GEJU_RULES key like '比肩格'). Visual/LLM rendering: '劫财（自立） →
比肩格' showed namespace mismatch.

Fix: use _GEJU_ALIASES.get(geju, geju) — the post-alias GEJU_RULES key
that matches transmuted.to namespace. Renders '劫财格 → 比肩格'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: #4 — `_trim_note` 中文标点边界截断

**Files:**
- Modify: `paipan/paipan/xingyun.py` (新增 `_trim_note` + 替换 `score_yun` 内的 `note[:30]`)
- Modify: `paipan/tests/test_xingyun.py` (4 边界 tests)

- [ ] **Step 2.1: Add `_trim_note` helper to `paipan/paipan/xingyun.py`**

Insert after the existing `_classify_score` (or any appropriate location for internal helpers):

```python
def _trim_note(note: str, limit: int = 30) -> str:
    """在 ≤ limit 字符内优先在中文标点边界截断 (Plan 7.5a.1 §5.4).

    优先级: 句末 (。) > 分句 (；：) > 子句 (，)
    回退: 字符级硬切（如果在 limit//2 之前就找到分隔符放弃，避免切得太短）

    Examples:
        _trim_note('丙生用神，午比助用神') → '丙生用神，午比助用神'  (短不变)
        _trim_note('丙生用神，午比助用神，但与命局丁壬合化木') → '丙生用神，午比助用神，'  (切到最后",")
        _trim_note('一二三，四五六七八九十一二三四五六七八九十一二三四五六七八九十') → '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'[:30]  (",":idx=3 < 15, fallback)
    """
    if len(note) <= limit:
        return note
    for sep in ['。', '；', '：', '，']:
        idx = note.rfind(sep, 0, limit)
        if idx > limit // 2:
            return note[:idx + 1]
    return note[:limit]
```

- [ ] **Step 2.2: Replace existing `note[:30]` in `score_yun`**

Find in `xingyun.py` `score_yun` body:
```python
note = '，'.join(parts) if parts else '无显著作用'
if len(note) > 30:
    note = note[:30]
```

Replace with:
```python
note = '，'.join(parts) if parts else '无显著作用'
note = _trim_note(note)
```

- [ ] **Step 2.3: Write 4 tests in `paipan/tests/test_xingyun.py`**

Append:

```python
from paipan.xingyun import _trim_note


def test_trim_note_short_unchanged():
    """≤ 30 字 → 不变."""
    s = '丙生用神，午比助用神'
    assert _trim_note(s) == s


def test_trim_note_long_with_comma_cuts_at_comma():
    """> 30 字, 含 ","在**后半截** (idx > limit//2=15) → 切到最后一个 ",".

    NOTE: fixture 必须保证 "，" 落在 idx > 15. 一个 "，" 在 idx ≤ 15 的 long
    note 会 fallback 到 char cut, 不测到 comma branch.
    """
    long_note = '丙生用神调候扶抑兼顾格局仍偏燥些，午比助用神但与命局丁壬合化木有反作用使整体偏弱很多'
    # "，" 在 idx=16, > limit//2=15 → cuts at this 边界
    out = _trim_note(long_note)
    assert len(out) <= 30
    assert out.endswith('，')


def test_trim_note_long_no_punct_falls_back_to_char_cut():
    """> 30 字 + 全无标点 → 字符切到 30."""
    long_note = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三'
    out = _trim_note(long_note)
    assert len(out) == 30


def test_trim_note_punct_in_first_half_falls_back():
    """> 30 字 + 标点在前半截 (idx < limit//2=15) → fallback 字符切.
    
    NOTE: 字符切会保留前面的 "，"; 只断言长度, 不断言标点存在与否.
    """
    long_note = '一二，四五六七八九十一二三四五六七八九十一二三四五六七八九十一二'
    # "，" 在 idx=2, < 15 → fallback to char cut
    out = _trim_note(long_note)
    assert len(out) == 30
```

- [ ] **Step 2.4: Run tests**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py -v -k "trim_note"
```
Expected: 4 passed.

- [ ] **Step 2.5: Run full paipan regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 584 + 4 = 588 passed (Task 1 baseline + 4 new).

- [ ] **Step 2.6: Commit**

```bash
git add paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.5a.1 #4 _trim_note Chinese-punct boundary truncation

Replace naive note[:30] in score_yun with _trim_note(): cuts at Chinese
punctuation boundary (priority: 。 > ；： > ，) when one exists in the
back half (idx > limit//2). Falls back to char-level slice otherwise.

4 tests cover: short-unchanged, long-with-comma-cuts-at-comma,
long-no-punct-falls-back, punct-in-first-half-falls-back.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: #3 — `mechanism_tags.py` 中心化重构

**Files:**
- Create: `paipan/paipan/mechanism_tags.py` (~30 行)
- Modify: `paipan/paipan/xingyun.py` (replace 14 处 f-string with imported constants/functions)
- Modify: `paipan/tests/test_xingyun.py` (1 byte-identity test)

- [ ] **Step 3.1: Create `paipan/paipan/mechanism_tags.py`**

```python
"""中心化 mechanism tag 词汇表（Plan 7.5a.1 §5.3）。

避免 xingyun.py 内部 f-string 散落；修改 tag 文案只改这一个文件。
所有 tag 字符串保持跟 Plan 7.4 ship 时 byte-for-byte 一致。
"""
from __future__ import annotations


# ===== 干 effect base scoring (5 outcomes) =====
GAN_SHENG = '干·相生'
GAN_KE = '干·相克'
GAN_BIZHU = '干·比助'
GAN_XIE = '干·相泄'
GAN_HAO = '干·相耗'


# ===== 支 effect base scoring (5 outcomes) =====
ZHI_SHENG = '支·相生'
ZHI_KE = '支·相克'
ZHI_BIZHU = '支·比助'
ZHI_XIE = '支·相泄'
ZHI_HAO = '支·相耗'


# ===== 合化 / 六合 modifier (4 builder functions, 后缀含 wuxing) =====

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

- [ ] **Step 3.2: Audit current f-string usage in `xingyun.py`**

Run grep first to find ALL mechanism tag f-string constructions:

```
grep -n "'干·\|'支·\|f'干·\|f'支·" paipan/paipan/xingyun.py
```

Expected to find ~14 hits across `_score_gan_to_yongshen` (5 base + 2 modifier = 7) and `_score_zhi_to_yongshen` (5 base + 2 modifier = 7) = 14 total.

Make a checklist of all hit lines before editing.

- [ ] **Step 3.3: Replace each f-string in `_score_gan_to_yongshen`**

In `paipan/paipan/xingyun.py`, find `_score_gan_to_yongshen` function. Update imports first:

```python
# Add at top of xingyun.py with other imports:
from paipan import mechanism_tags as M
```

Then in `_score_gan_to_yongshen` body, replace each `mech.append(...)` to use the constants/builders. Map:

| Old f-string | New constant/builder |
|---|---|
| `'干·相生'` | `M.GAN_SHENG` |
| `'干·相克'` | `M.GAN_KE` |
| `'干·比助'` | `M.GAN_BIZHU` |
| `'干·相泄'` | `M.GAN_XIE` |
| `'干·相耗'` (if present) | `M.GAN_HAO` |
| `f'干·合化转助·{he_wx}'` | `M.gan_hehua_zhuanzhu(he_wx)` |
| `f'干·合化反克·{he_wx}'` | `M.gan_hehua_fanke(he_wx)` |

E.g., from Plan 7.4 Task 3 implementation (per plan Step 3.2):
```python
# OLD:
base_mech.append(f'干·相生')
# NEW:
base_mech.append(M.GAN_SHENG)
```

- [ ] **Step 3.4: Replace each f-string in `_score_zhi_to_yongshen`**

Similarly for `_score_zhi_to_yongshen`:

| Old f-string | New constant/builder |
|---|---|
| `'支·相生'` | `M.ZHI_SHENG` |
| `'支·相克'` | `M.ZHI_KE` |
| `'支·比助'` | `M.ZHI_BIZHU` |
| `'支·相泄'` | `M.ZHI_XIE` |
| `'支·相耗'` (if present) | `M.ZHI_HAO` |
| `f'支·六合化{he_wx}·转助'` | `M.zhi_liuhe_zhuanzhu(he_wx)` |
| `f'支·六合化{he_wx}·反克'` | `M.zhi_liuhe_fanke(he_wx)` |

- [ ] **Step 3.5: Verify no f-string remains**

Re-run grep:

```
grep -n "'干·\|'支·\|f'干·\|f'支·" paipan/paipan/xingyun.py
```

Should return **0 hits** (all replaced). If any remain, replace them.

- [ ] **Step 3.6: Write byte-identity test in `paipan/tests/test_xingyun.py`**

Append:

```python
def test_mechanism_tags_byte_identical_to_plan74_strings():
    """Plan 7.5a.1 §5.3 + §6.3: 重构后 mechanism 字符串跟 Plan 7.4 ship 的字面值一致."""
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

- [ ] **Step 3.7: Run byte-identity test + Plan 7.4/7.5a regression**

```
uv run --package paipan pytest -q paipan/tests/test_xingyun.py::test_mechanism_tags_byte_identical_to_plan74_strings -v
```
Expected: 1 passed.

```
uv run --package paipan pytest -n auto -q paipan/tests/
```
Expected: 588 + 1 = 589 passed.

> **CRITICAL**: All Plan 7.4 mechanism-related tests must remain green. If any fail (e.g. `test_score_gan_pure_sheng` asserting `assert any('相生' in m for m in mech)`), it means a f-string was missed in steps 3.3-3.4. Re-run grep + audit. Do NOT modify the failing test's assertion — fix the missed f-string.

- [ ] **Step 3.8: Sanity check on real chart**

```bash
uv run --package paipan python -c "
from paipan import compute
out = compute(year=1993, month=7, day=15, hour=14, minute=30, gender='male', city='长沙')
xy = out['xingyun']
for d in xy['dayun']:
    print(d['ganzhi'], d['mechanisms'])
"
```

Expected: each line shows the same mechanism strings as before Task 3 (compare against Plan 7.4 release notes screenshot or Plan 7.4 Task 7 smoke output if you have it). Spot-check 2-3 lines.

- [ ] **Step 3.9: Commit**

```bash
git add paipan/paipan/mechanism_tags.py paipan/paipan/xingyun.py paipan/tests/test_xingyun.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(paipan): Plan 7.5a.1 #3 centralize mechanism tags

New paipan/paipan/mechanism_tags.py module exports 10 constants (5 干
+ 5 支 base scoring outcomes) and 4 builder functions (gan_hehua_*,
zhi_liuhe_*). xingyun.py refactored to import these instead of
constructing f-strings inline at 14 sites.

Byte-for-byte output preserved: byte-identity test asserts all 14
expected strings; full Plan 7.4/7.5a regression green proves
mechanism-string consumers (golden cases, render tests) unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: #2 — SMS test flake debug + fix

**Files:**
- Read first: `server/tests/unit/test_sms_service.py` (find the flaky test)
- Read first: `server/app/services/sms_service.py` (or similar, the SUT)
- Modify: TBD by debug findings

This task is **debug-driven**. Outcome shape unknown until root cause identified.

- [ ] **Step 4.1: Reproduce the flake reliably**

```
uv run --package server pip install pytest-randomly 2>/dev/null || true
uv run --package server pytest -p randomly server/tests/unit/test_sms_service.py -v --count=10 2>&1 | tee .claire/sms-flake-repro.log
```

If `pytest-randomly` not installed, fallback:
```
for i in 1 2 3 4 5; do
  uv run --package server pytest -q server/tests/unit/ 2>&1 | tail -5 | grep -E "PASS|FAIL"
done
```

Look for the failing test surfacing intermittently. If it doesn't repro in 5-10 runs, run with `--count=20` or specifically run `test_sms_service.py` first, then with other server tests in the same process:

```
uv run --package server pytest -q server/tests/unit/test_sms_service.py server/tests/unit/test_other_*.py -v
```

Goal: find a deterministic ordering that reproduces.

- [ ] **Step 4.2: Identify root cause**

Once flake reproduces, inspect:
1. `server/tests/unit/test_sms_service.py::test_send_sms_code_does_not_charge_when_user_none` — what does it actually test?
2. What fixture / mock / env state does it depend on?
3. Which test that runs before it modifies that shared state?

Common culprits:
- `monkeypatch` not used → env var leaks
- `unittest.mock.patch` used as decorator on previous test but state bleeds (rare but possible)
- DB session not rolled back (if SMS service touches DB)
- `httpx` or `requests` mock not reset

Print the offending shared state value before and after the flaky test to confirm.

- [ ] **Step 4.3: Apply minimum-scope fix**

Based on root cause, choose:

**Option A** (simplest): Add `autouse=True` fixture at module top of `test_sms_service.py` that resets the offending state:
```python
@pytest.fixture(autouse=True)
def _reset_sms_state(monkeypatch):
    """Plan 7.5a.1 #2: ensure no env/mock leak from prior test modules."""
    monkeypatch.setenv('SMS_SANDBOX_MODE', 'true')   # or whatever the actual env
    yield
```

**Option B**: Convert any module-level mock to function-level fixture scope.

**Option C**: Refactor the SMS service to not use module-level singletons.

Pick the option with smallest blast radius. **Disclose** what you chose + why in the commit message.

- [ ] **Step 4.4: Verify flake gone**

```
uv run --package server pytest -p randomly server/tests/unit/test_sms_service.py --count=20 2>&1 | tail -20
```

OR (if no pytest-randomly):
```
for i in 1 2 3 4 5; do
  uv run --package server pytest -n auto -q server/tests/ 2>&1 | tail -3
done
```

All 5 (or 20) runs must show "passed", no "failed". If even 1 fails, root cause not fully addressed — go back to Step 4.2.

- [ ] **Step 4.5: Run full server regression to confirm no new break**

```
uv run --package server pytest -n auto -q server/tests/
```
Expected: 437 (or 437+N if your fix added new fixture-related tests) passed.

- [ ] **Step 4.6: Commit**

```bash
git add server/tests/unit/test_sms_service.py [+ any other modified files]
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(server): Plan 7.5a.1 #2 SMS test flake — reset shared state

Root cause: <CODEX FILLS IN — e.g. SMS_SANDBOX_MODE env var leaked from
test_other_module which sets it via os.environ[] without monkeypatch>.

Fix: <CODEX FILLS IN — e.g. autouse=True fixture in test_sms_service.py
that monkeypatches SMS_SANDBOX_MODE=true before each test in the module>.

Verified: 20 consecutive pytest --random-order runs all green; full
server regression unchanged at 437 passed (or N more from new fixtures).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If after good-faith effort (1-2 hours) the root cause can't be identified or the fix balloons in scope, **STOP and report**. Don't ship a band-aid that just hides the flake. Better outcome: open a Plan 7.5a.2 / 7.6 follow-up task with detailed debug log + best-current-hypothesis.

---

## Self-Review Notes (for the executing engineer)

If any of these surface post-implementation, file a Plan 7.5a.2 follow-up:

1. **Task 3 missed f-string** — if a Plan 7.4 mechanism test fails after Task 3, grep wider (`grep -n "'干\|'支" paipan/paipan/xingyun.py` without the `·`) — there may be a f-string with a different separator that I didn't anticipate.

2. **Task 4 SMS flake is not env-related** — could be a real race condition in the SMS service implementation itself (e.g., shared HTTP client connection pool state). If debug points there, scope creep — open Plan 7.5a.2 and ship the other 3 fixes first.

3. **Task 1 `_GEJU_ALIASES.get(geju, geju)` returns None** — if `geju` arg is None (e.g. analyzer's `ge_ju_main` fell through to `'格局不清'` or similar edge case), `_GEJU_ALIASES.get(None, None)` returns None, then `if geju else ''` shortcuts to ''. Verify the existing 5 golden case behavior. If any `from` becomes empty string and breaks LLM rendering, add a fallback like `original_geju_name = _GEJU_ALIASES.get(geju, geju) if geju else '未定格局'`.

4. **Task 2 `_trim_note` cuts at standalone "："** — note 文本基本不会出现 "：" 单独，但如果以后 mechanism 描述加了 "：" 分隔的复合词，可能影响切边。Plan 7.5a.1 不预防；如有真实回归再加 case。

5. **Task 3 mechanism_tags 模块没被 server context.py 消费** — 当前 mechanism strings 只在 paipan 内部消费，context.py 只读 `xingyun.dayun[i].note` (人可读) 和 `xingyun.dayun[i].mechanisms` (列表) 但不解析 mechanisms。如果以后 context.py 需要按 mechanism 分类渲染（如 "这一段以合化为主"），可以 import M 并按 `if M.GAN_SHENG in mechs` 判断。
