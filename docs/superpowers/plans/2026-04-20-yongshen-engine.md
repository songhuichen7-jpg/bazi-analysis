# Plan 7.3 — 用神 Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-line `suggest_yongshen` placeholder with a 3-method classical-grounded 用神 engine (调候 from 穷通宝鉴 + 格局 from 子平真诠 + 扶抑 from 滴天髓), each emitting a candidate with note + classical source pointer. Compose into `yongshenDetail` dict consumed by chat prompt context; keep top-level `chart.paipan.yongshen` as a string for chartUi.js backward compat.

**Architecture:** Pure data tables in `paipan/paipan/yongshen_data.py` (TIAOHOU 120 entries + GEJU_RULES ~30 entries + FUYI_CASES 5). Pure logic in `paipan/paipan/yongshen.py` (3 method functions + 1 composer). Wire into `analyzer.py` last step. Render new block in `server/app/prompts/context.py`. Frontend zero-touch.

**Tech Stack:** Python 3.12 · pytest. Data sourced by reading `classics/qiongtong-baojian/0X_lun-<gan>.md` and `classics/ziping-zhenquan/0X_lun-<geju>.md` and writing Python literals.

---

## 设计约束

1. **Spec is authoritative**: `docs/superpowers/specs/2026-04-20-yongshen-engine-design.md`. If spec says X, do X. If you discover spec contradicts reality (e.g. typo, wrong existing-code reference), fix spec inline + flag in commit.
2. **Backward compat**: `chart.paipan.yongshen` MUST stay a STRING (the primary label). The new dict goes in `chart.paipan.yongshenDetail`. Frontend (`chartUi.js`) gets zero changes.
3. **No JS port**: this engine has no JS reference. Tables are sourced from `classics/` markdown files in the repo.
4. **Plan 7.1 + 7.2 contracts preserved**: existing analyzer fields (`force`, `geJu`, `zhiRelations`, `notes`, `ganHe`) untouched. The `analyze()` return dict adds 2 new keys.
5. **Tests stay green**: 486 paipan + 426 backend + 51 frontend baseline. Add ≥10 new paipan + 1 new backend.

## 目录最终形态

```
paipan/
├── paipan/
│   ├── yongshen_data.py            # NEW — 3 static tables
│   ├── yongshen.py                 # NEW — 3 method fns + composer
│   ├── analyzer.py                 # MODIFY — append yongshen pass
│   └── compute.py                  # MODIFY — surface yongshen + yongshenDetail
└── tests/
    ├── test_yongshen_data.py       # NEW — table validity
    └── test_yongshen.py            # NEW — engine logic + golden cases

server/
├── app/
│   └── prompts/
│       └── context.py              # MODIFY — add 用神 block render
└── tests/
    └── unit/
        └── test_prompts_context_yongshen.py   # NEW — render test
```

No frontend changes. No backend route changes. No new deps.

## Task 列表预览

- **Task 1** — Skeleton: `yongshen_data.py` empty stubs + `yongshen.py` with stub `build_yongshen()` returning placeholder dict + wire `analyzer.py` + `compute.py`. Verify chart.paipan.yongshen still a string + new yongshenDetail dict appears.
- **Task 2** — TIAOHOU data extraction (10 日干 × 12 months = 120 entries) + `tiaohou_yongshen()` function + tests.
- **Task 3** — GEJU_RULES data extraction (~10 格局, ~30 rules) + `geju_yongshen()` function + tests.
- **Task 4** — `fuyi_yongshen()` function (5 dayStrength cases) + FUYI_CASES table + tests.
- **Task 5** — `compose_yongshen()` voting logic + 10 golden integration tests.
- **Task 6** — `compact_chart_context` 用神 block rendering + tests.
- **Task 7** — Smoke: paipan + backend + frontend full suite, browser dev-server check that chart panel still shows single-line 用神 + chat sees rich context.

---

## Task 1: Skeleton + analyzer integration

**Files:**
- Create: `paipan/paipan/yongshen_data.py`
- Create: `paipan/paipan/yongshen.py`
- Modify: `paipan/paipan/analyzer.py` (add yongshen pass)
- Modify: `paipan/paipan/compute.py` (surface 2 keys)
- Test: `paipan/tests/test_yongshen.py` (skeleton — `test_yongshen_dict_present`)

- [ ] **Step 1.1: Create `paipan/paipan/yongshen_data.py` with empty tables**

```python
"""Plan 7.3 — static lookup tables for 用神 engine.

Three independent classical methods:
- TIAOHOU       — 穷通宝鉴 调候用神, keyed by (rizhu_gan, month_zhi)
- GEJU_RULES    — 子平真诠 格局取用, keyed by 格局 name
- FUYI_CASES    — 滴天髓 扶抑用神, ordered list matched by dayStrength

Data is sourced from `classics/qiongtong-baojian/` and
`classics/ziping-zhenquan/` files, populated in Tasks 2-4.

Plan 7.3 spec: docs/superpowers/specs/2026-04-20-yongshen-engine-design.md
"""
from __future__ import annotations

# Filled in Task 2
TIAOHOU: dict[tuple[str, str], dict] = {}

# Filled in Task 3
GEJU_RULES: dict[str, list[dict]] = {}

# Filled in Task 4
FUYI_CASES: list[dict] = []
```

- [ ] **Step 1.2: Create `paipan/paipan/yongshen.py` with stub functions**

```python
"""Plan 7.3 — 用神 engine.

Public API:
  build_yongshen(rizhu_gan, month_zhi, force, geju, gan_he, day_strength) -> dict

Returns a dict with shape:
  {
    'primary': '<one-line label, e.g. "庚金 / 丁火">',
    'primaryReason': '<why this is primary>',
    'candidates': [
      {'method': '调候'|'格局'|'扶抑', 'name': str|None,
       'note': str, 'source': str, ...},
      ...
    ],
    'warnings': [str, ...]   # may be empty
  }

Spec: docs/superpowers/specs/2026-04-20-yongshen-engine-design.md
"""
from __future__ import annotations

from paipan.yongshen_data import TIAOHOU, GEJU_RULES, FUYI_CASES


def tiaohou_yongshen(rizhu_gan: str, month_zhi: str) -> dict | None:
    """Return TIAOHOU entry or None if not strongly indicated."""
    entry = TIAOHOU.get((rizhu_gan, month_zhi))
    if not entry or not entry.get('name'):
        return None
    return {
        'method': '调候',
        'name': entry['name'],
        'supporting': entry.get('supporting'),
        'note': entry.get('note', ''),
        'source': entry.get('source', '穷通宝鉴'),
    }


def geju_yongshen(geju: str | None, force: dict, gan_he: dict) -> dict | None:
    """Return first matching GEJU_RULES entry or None if 格局 unknown/unclear."""
    if not geju:
        return None
    rules = GEJU_RULES.get(geju, [])
    for rule in rules:
        cond = rule.get('condition')
        if cond and cond(force, gan_he):
            return {
                'method': '格局',
                'name': rule['name'],
                'sub_pattern': rule.get('sub_pattern'),
                'note': rule.get('note', ''),
                'source': rule.get('source', '子平真诠'),
            }
    return None


def fuyi_yongshen(force: dict, day_strength: str | None) -> dict | None:
    """Return matching FUYI_CASES entry or None for 中和."""
    if not day_strength:
        return None
    for case in FUYI_CASES:
        when = case.get('when')
        if when and when(force, day_strength):
            return {
                'method': '扶抑',
                'name': case['name'],
                'note': case.get('note', ''),
                'source': case.get('source', '滴天髓·衰旺'),
            }
    return None


def _empty_candidate(method: str, note: str = '本法无明确结论') -> dict:
    return {'method': method, 'name': None, 'note': note, 'source': ''}


def compose_yongshen(
    tiaohou: dict | None,
    geju: dict | None,
    fuyi: dict | None,
) -> dict:
    """Compose 3 candidates into final dict per spec §3.2.

    Composition rule:
      - 调候 == 格局 → primary = 调候.name, no warning
      - 调候 != 格局 (both present) → primary = 调候.name, warning '古籍两派各有取法'
      - only 格局 → primary = 格局.name
      - only 扶抑 → primary = 扶抑.name
      - none → primary = '中和（无明显偏枯）'
    """
    candidates = [
        tiaohou or _empty_candidate('调候', '本月调候不强烈'),
        geju or _empty_candidate('格局', '格局未定或无规则'),
        fuyi or _empty_candidate('扶抑', '中和'),
    ]
    warnings: list[str] = []

    if tiaohou and geju:
        if _names_match(tiaohou.get('name'), geju.get('name')):
            primary = tiaohou['name']
            primary_reason = '调候 + 格局共指'
        else:
            primary = tiaohou['name']
            primary_reason = '以调候为主'
            warnings.append('调候用神与格局用神不同 —— 古籍两派各有取法')
    elif tiaohou:
        primary = tiaohou['name']
        primary_reason = '调候法'
    elif geju:
        primary = geju['name']
        primary_reason = '格局法'
    elif fuyi:
        primary = fuyi['name']
        primary_reason = '扶抑法（前两法无明确结论）'
    else:
        primary = '中和（无明显偏枯）'
        primary_reason = '三法皆无强候选'

    return {
        'primary': primary,
        'primaryReason': primary_reason,
        'candidates': candidates,
        'warnings': warnings,
    }


def _names_match(a: str | None, b: str | None) -> bool:
    """Loose name match. v1 just exact-match. v1.5 may add wuxing equivalence."""
    if not a or not b:
        return False
    return a == b


def build_yongshen(
    rizhu_gan: str,
    month_zhi: str | None,
    force: dict,
    geju: str | None,
    gan_he: dict,
    day_strength: str | None,
) -> dict:
    """Top-level 用神 engine entry point. Composes 3 methods."""
    tiaohou = tiaohou_yongshen(rizhu_gan, month_zhi) if month_zhi else None
    geju_res = geju_yongshen(geju, force, gan_he)
    fuyi_res = fuyi_yongshen(force, day_strength)
    return compose_yongshen(tiaohou, geju_res, fuyi_res)
```

- [ ] **Step 1.3: Wire `analyzer.py`**

Read `paipan/paipan/analyzer.py` and find the `analyze()` function's return statement (around the existing `force / geJu / zhiRelations / notes / ganHe` keys).

Add ABOVE the return:
```python
from paipan.yongshen import build_yongshen   # add to top of file imports

# ... after existing analysis ...

ge_ju_main = (ge_ju or {}).get('mainCandidate', {}).get('name')
yongshen_dict = build_yongshen(
    rizhu_gan=d.gan,
    month_zhi=m.zhi,
    force=force,
    geju=ge_ju_main,
    gan_he=gan_he,
    day_strength=force.get('dayStrength'),
)
```

Then in the return dict add 2 new keys:
```python
return {
    # ... existing keys ...
    'yongshen': yongshen_dict['primary'],   # STRING for backward compat
    'yongshenDetail': yongshen_dict,        # full dict for prompt
}
```

**IMPORTANT**: rename the existing `suggest_yongshen` to `_legacy_suggest_yongshen` (keep its body as-is, just add a docstring `# Plan 7.3: deprecated, kept for any external callers`). Do NOT delete it.

- [ ] **Step 1.4: Wire `compute.py`**

Read `paipan/paipan/compute.py`, find the line:
```python
result["yongshen"] = suggest_yongshen(analysis)
```

Replace with:
```python
# Plan 7.3: yongshen is now a structured engine. Top-level key stays a STRING
# (chartUi.js compat); full dict goes in yongshenDetail.
result["yongshen"] = analysis["yongshen"]              # primary string
result["yongshenDetail"] = analysis["yongshenDetail"]  # full dict
```

Update the import at the top of compute.py:
```python
# OLD:
from paipan.analyzer import analyze, suggest_yongshen
# NEW (drop suggest_yongshen — only analyze() is the public entry):
from paipan.analyzer import analyze
```

- [ ] **Step 1.5: Write skeleton tests `paipan/tests/test_yongshen.py`**

```python
"""Plan 7.3 yongshen engine — skeleton & integration."""
from __future__ import annotations

import pytest

from paipan import compute


def test_chart_yongshen_is_string_for_compat():
    """Plan 7.3 §6.4: chart.paipan.yongshen MUST stay a string."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    assert isinstance(out['yongshen'], str)
    assert out['yongshen']  # not empty


def test_chart_yongshen_detail_is_dict_with_required_keys():
    """Plan 7.3 §3.1: yongshenDetail dict has primary/candidates/warnings."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    detail = out.get('yongshenDetail')
    assert isinstance(detail, dict)
    assert 'primary' in detail
    assert 'primaryReason' in detail
    assert 'candidates' in detail
    assert 'warnings' in detail
    assert isinstance(detail['candidates'], list)
    assert len(detail['candidates']) == 3
    methods = {c['method'] for c in detail['candidates']}
    assert methods == {'调候', '格局', '扶抑'}


def test_chart_yongshen_string_matches_detail_primary():
    """The string at top-level must equal yongshenDetail['primary']."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    assert out['yongshen'] == out['yongshenDetail']['primary']
```

- [ ] **Step 1.6: Run tests — confirm GREEN (initially with empty tables, fuyi will fire as fallback)**

Run from project root:
```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py -v
```

Expected: 3 passed. Even with empty TIAOHOU/GEJU tables, `fuyi_yongshen` returns nothing (FUYI_CASES is empty too) → `compose_yongshen` returns `primary='中和（无明显偏枯）'`. Tests check shape, not content.

- [ ] **Step 1.7: Run full paipan + backend regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
```

Expected: paipan ≥ 489 (486 baseline + 3 new). Backend stays at 426.

- [ ] **Step 1.8: Commit**

```bash
git add paipan/paipan/yongshen_data.py paipan/paipan/yongshen.py \
        paipan/paipan/analyzer.py paipan/paipan/compute.py \
        paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.3 yongshen engine skeleton + analyzer wire

Add yongshen.py with 3-method composition (tiaohou/geju/fuyi/compose) and
yongshen_data.py with empty tables (filled in Tasks 2-4). Wire build_yongshen
into analyzer.py last step; compute.py surfaces:
  - chart.paipan.yongshen        — STRING (primary label, backward compat)
  - chart.paipan.yongshenDetail  — DICT (full candidates/warnings)

Existing suggest_yongshen renamed to _legacy_suggest_yongshen (kept).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: TIAOHOU table — 10 日干 × 12 月 = 120 entries

**Files:**
- Modify: `paipan/paipan/yongshen_data.py` (TIAOHOU dict body)
- Test: `paipan/tests/test_yongshen_data.py` (NEW — schema + coverage)

This task does the careful work of reading 10 chapters of 穷通宝鉴 and extracting per-month 用神 entries.

- [ ] **Step 2.1: Read source files**

Read each of these classics in turn (one Read per file), to understand the structure + extract the per-month 用神:

```
classics/qiongtong-baojian/02_lun-jia-mu.md   (甲)
classics/qiongtong-baojian/03_lun-yi-mu.md    (乙)
classics/qiongtong-baojian/04_lun-bing-huo.md (丙)
classics/qiongtong-baojian/05_lun-ding-huo.md (丁)
classics/qiongtong-baojian/06_lun-wu-tu.md    (戊)
classics/qiongtong-baojian/07_lun-ji-tu.md    (己)
classics/qiongtong-baojian/08_lun-geng-jin.md (庚)
classics/qiongtong-baojian/09_lun-xin-jin.md  (辛)
classics/qiongtong-baojian/10_lun-ren-shui.md (壬)
classics/qiongtong-baojian/11_lun-gui-shui.md (癸)
```

Each chapter is divided into 12 months (正月/二月/.../腊月 or 寅月/卯月/.../丑月). For each month, the text typically lists:
- 主用神 (primary)
- 辅用神 / 配用 (secondary, optional)
- 喜见 / 忌见 (favorable / taboo, optional — NOT recorded in TIAOHOU)
- 立论 (the analytical reasoning)

For each (gan, month_zhi) pair, extract:
- `name`: the primary 用神 string. If text says "用甲木" → name = "甲木". If lists multiple primary → "甲木 / 庚金". If month is neutral / no clear primary → name = None.
- `supporting`: secondary 用神 if explicitly named, else None.
- `note`: a 15-30 字 summary of the reason. Quote-worthy phrasing from the text preferred. Example: "丁火生于六月，土旺秉令，须庚金壬水"
- `source`: `穷通宝鉴·论<日干>·<月份中文>` (e.g., `穷通宝鉴·论丁火·六月`).

**Month_zhi mapping** (for the dict key):
```
正月=寅, 二月=卯, 三月=辰, 四月=巳, 五月=午, 六月=未,
七月=申, 八月=酉, 九月=戌, 十月=亥, 十一月=子, 十二月=丑
```

- [ ] **Step 2.2: Populate `TIAOHOU` dict in `paipan/paipan/yongshen_data.py`**

Replace the empty `TIAOHOU = {}` with all 120 entries. Format strictly:

```python
TIAOHOU: dict[tuple[str, str], dict] = {
    # 甲木 (12 months)
    ('甲', '寅'): {
        'name': '丙火',
        'supporting': '癸水',
        'note': '甲木生寅月，木旺生火，喜丙火透出、癸水滋润',
        'source': '穷通宝鉴·论甲木·正月',
    },
    ('甲', '卯'): {...},
    # ... 10 more for 甲

    # 乙木 (12 months)
    ('乙', '寅'): {...},
    # ... 11 more for 乙

    # ... continue through 癸
}
```

If the text is genuinely ambiguous on a month (rare, but possible for some 杂气月), set `name=None` with a note like "本月无明确调候，看格局" — composition treats it as no result.

**Format discipline**:
- `note`: ≤ 30 字 ideally; if longer, OK but break at natural pauses. No bullets, plain prose.
- `name`: keep to 1-2 字 (single 干: '甲木'; pair: '甲木 / 庚金'). NOT '丙火和癸水' — use ` / ` separator.
- Tuple keys: always `(<gan>, <zhi>)` with single-char gan and single-char zhi.

- [ ] **Step 2.3: Write `paipan/tests/test_yongshen_data.py` table validity tests**

```python
"""Plan 7.3 — yongshen_data table schema validity."""
from __future__ import annotations

import pytest

from paipan.yongshen_data import TIAOHOU, GEJU_RULES, FUYI_CASES


# All 10 day masters
ALL_GANS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
# All 12 months by 地支
ALL_MONTH_ZHIS = ['寅', '卯', '辰', '巳', '午', '未',
                   '申', '酉', '戌', '亥', '子', '丑']


def test_tiaohou_covers_all_120_pairs():
    """Plan 7.3 §4.1: TIAOHOU should have all 10 × 12 = 120 entries."""
    for gan in ALL_GANS:
        for zhi in ALL_MONTH_ZHIS:
            assert (gan, zhi) in TIAOHOU, f"missing TIAOHOU[({gan},{zhi})]"


def test_tiaohou_entries_have_required_fields():
    for key, entry in TIAOHOU.items():
        assert 'name' in entry, f"TIAOHOU[{key}] missing 'name'"
        assert 'note' in entry, f"TIAOHOU[{key}] missing 'note'"
        assert 'source' in entry, f"TIAOHOU[{key}] missing 'source'"
        # source must point to 穷通宝鉴
        assert '穷通宝鉴' in entry['source'], \
            f"TIAOHOU[{key}].source should cite 穷通宝鉴, got {entry['source']!r}"


def test_tiaohou_note_length_reasonable():
    """Notes should be concise (≤ 60 chars after Plan 7.3 spec §4.1 ~30字)."""
    for key, entry in TIAOHOU.items():
        note = entry.get('note', '')
        assert len(note) <= 60, \
            f"TIAOHOU[{key}].note too long ({len(note)} chars): {note!r}"
```

- [ ] **Step 2.4: Run tests — confirm GREEN**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen_data.py -v
```

Expected: 3 passed (covers_all_120 + entries_have_required_fields + note_length).

- [ ] **Step 2.5: Add `tiaohou_yongshen` engine test**

Append to `paipan/tests/test_yongshen.py`:

```python
def test_tiaohou_yongshen_丁火_六月():
    """丁火生未月 (六月) → expect tiaohou hit with 庚金 or similar."""
    from paipan.yongshen import tiaohou_yongshen
    res = tiaohou_yongshen('丁', '未')
    assert res is not None
    assert res['method'] == '调候'
    assert res['name'] is not None
    assert '穷通宝鉴' in res['source']


def test_tiaohou_yongshen_unknown_combination_returns_none():
    """Empty key returns None (e.g. None gan)."""
    from paipan.yongshen import tiaohou_yongshen
    # Use a key guaranteed missing in dict (won't match any real combination)
    res = tiaohou_yongshen('XX', '寅')   # XX is not a real gan
    assert res is None
```

- [ ] **Step 2.6: Run tests + regression**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py paipan/tests/test_yongshen_data.py -v
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: yongshen tests = 5 (3 skeleton + 2 tiaohou). All paipan ≥ 491.

- [ ] **Step 2.7: Commit**

```bash
git add paipan/paipan/yongshen_data.py paipan/tests/test_yongshen_data.py \
        paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.3 TIAOHOU table populated (10 日干 × 12 月)

120 entries extracted from classics/qiongtong-baojian/0X_lun-<gan>.md.
Each entry has name (primary 用神), optional supporting, ≤60-char note,
and 穷通宝鉴·论<gan>·<月> source pointer. Engine fn tiaohou_yongshen()
returns dict with method='调候' on hit, None on miss/ambiguous-month.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: GEJU_RULES table — 8 main 格局 + 杂气月 + 格局不清

**Files:**
- Modify: `paipan/paipan/yongshen_data.py` (GEJU_RULES dict body)
- Test: extend `paipan/tests/test_yongshen_data.py` + `test_yongshen.py`

This task reads 子平真诠 chapters 8 and 13-45 to extract 格局-specific 用神 rules.

- [ ] **Step 3.1: Read source chapters**

Read in order:
```
classics/ziping-zhenquan/08_lun-yong-shen.md             (用神原理 — overall framework)
classics/ziping-zhenquan/09_lun-yong-shen-cheng-bai-jiu-ying.md  (成败救应)
classics/ziping-zhenquan/16_lun-za-qi-ru-he-qu-yong.md   (杂气月取用)
classics/ziping-zhenquan/<其余 per-格局 chapters>          (each格局 has its own chapter)
```

Run `ls classics/ziping-zhenquan/` to see all chapters; the per-格局 ones are
typically named like `13_lun-zheng-guan.md` (正官), `15_lun-pian-guan.md` (七杀),
etc. List them out and read each one for the per-格局 取用 rules.

For each 格局, extract a sequence of rules. Each rule has:
- `condition`: a Python lambda over `(force, gan_he)` that fires when the rule applies. Common conditions:
  - `lambda f, gh: f['scores'].get('<shishen>', 0) > 3` — that 十神 has meaningful presence
  - `lambda f, gh: any(h.get('<key>') for h in gh.get('withRiZhu', []))` — 日主 has 合
  - `lambda f, gh: True` — default (always true; place last in the rule list)
- `name`: the 用神 label (e.g. '财（生官）', '印（化杀）', '食神（制杀）')
- `sub_pattern` (optional): short pattern name (e.g. '官印相生', '食制', '裸杀')
- `note`: 15-30 字 reason
- `source`: `子平真诠·论<格局>` or `子平真诠·论<格局>·<细节>`

The first rule whose `condition` returns True wins.

- [ ] **Step 3.2: Populate `GEJU_RULES` dict in `paipan/paipan/yongshen_data.py`**

Append after TIAOHOU:

```python
GEJU_RULES: dict[str, list[dict]] = {
    '正官格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正财', 0) > 3
                                          or f['scores'].get('偏财', 0) > 3),
            'name': '财（生官）',
            'sub_pattern': '财官同辉',
            'note': '正官得财生为美',
            'source': '子平真诠·论正官',
        },
        {
            'condition': lambda f, gh: (f['scores'].get('正印', 0) > 3
                                          or f['scores'].get('偏印', 0) > 3),
            'name': '印（护官）',
            'sub_pattern': '官印相生',
            'note': '正官得印护卫，主贵',
            'source': '子平真诠·论正官',
        },
        {
            'condition': lambda f, gh: True,
            'name': '正官',
            'note': '官清水秀，孤官无辅',
            'source': '子平真诠·论正官',
        },
    ],
    '七杀格': [
        {
            'condition': lambda f, gh: f['scores'].get('食神', 0) > 3,
            'name': '食神（制杀）',
            'sub_pattern': '食制',
            'note': '七杀得食神制为美格',
            'source': '子平真诠·论七杀',
        },
        {
            'condition': lambda f, gh: (f['scores'].get('正印', 0) > 3
                                          or f['scores'].get('偏印', 0) > 3),
            'name': '印（化杀）',
            'sub_pattern': '印化',
            'note': '七杀透干无制，须印化',
            'source': '子平真诠·论七杀',
        },
        {
            'condition': lambda f, gh: True,
            'name': '七杀（无制无化）',
            'sub_pattern': '裸杀',
            'note': '七杀失制，凶',
            'source': '子平真诠·论七杀',
        },
    ],
    '食神格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正财', 0) > 3
                                          or f['scores'].get('偏财', 0) > 3),
            'name': '财（食神生财）',
            'sub_pattern': '食神生财',
            'note': '食神泄秀生财，富格',
            'source': '子平真诠·论食神',
        },
        {
            'condition': lambda f, gh: f['scores'].get('七杀', 0) > 3,
            'name': '食神（制杀）',
            'sub_pattern': '食神制杀',
            'note': '食神制七杀，贵格',
            'source': '子平真诠·论食神',
        },
        {
            'condition': lambda f, gh: True,
            'name': '食神',
            'note': '食神为用，泄秀通气',
            'source': '子平真诠·论食神',
        },
    ],
    '伤官格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正印', 0) > 3
                                          or f['scores'].get('偏印', 0) > 3),
            'name': '印（伤官配印）',
            'sub_pattern': '伤官配印',
            'note': '伤官见印为美',
            'source': '子平真诠·论伤官',
        },
        {
            'condition': lambda f, gh: (f['scores'].get('正财', 0) > 3
                                          or f['scores'].get('偏财', 0) > 3),
            'name': '财（伤官生财）',
            'sub_pattern': '伤官生财',
            'note': '伤官生财，富格',
            'source': '子平真诠·论伤官',
        },
        {
            'condition': lambda f, gh: True,
            'name': '伤官',
            'note': '伤官当令，需配印或财',
            'source': '子平真诠·论伤官',
        },
    ],
    '正财格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正官', 0) > 3
                                          or f['scores'].get('七杀', 0) > 3),
            'name': '官（财生官）',
            'sub_pattern': '财官同辉',
            'note': '正财生官，富贵兼有',
            'source': '子平真诠·论正财',
        },
        {
            'condition': lambda f, gh: True,
            'name': '正财',
            'note': '财为用，须身能任',
            'source': '子平真诠·论正财',
        },
    ],
    '偏财格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正官', 0) > 3
                                          or f['scores'].get('七杀', 0) > 3),
            'name': '官（财生官）',
            'sub_pattern': '财官同辉',
            'note': '偏财生官，富贵',
            'source': '子平真诠·论偏财',
        },
        {
            'condition': lambda f, gh: True,
            'name': '偏财',
            'note': '偏财为用',
            'source': '子平真诠·论偏财',
        },
    ],
    '正印格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正官', 0) > 3
                                          or f['scores'].get('七杀', 0) > 3),
            'name': '官（官印相生）',
            'sub_pattern': '官印相生',
            'note': '正印得官生',
            'source': '子平真诠·论正印',
        },
        {
            'condition': lambda f, gh: True,
            'name': '正印',
            'note': '印为用神',
            'source': '子平真诠·论正印',
        },
    ],
    '偏印格': [
        {
            'condition': lambda f, gh: (f['scores'].get('正官', 0) > 3
                                          or f['scores'].get('七杀', 0) > 3),
            'name': '官（官印相生）',
            'sub_pattern': '官印相生',
            'note': '偏印得官杀生',
            'source': '子平真诠·论偏印',
        },
        {
            'condition': lambda f, gh: True,
            'name': '偏印',
            'note': '偏印为用',
            'source': '子平真诠·论偏印',
        },
    ],
    '比肩格': [
        {
            'condition': lambda f, gh: (f['scores'].get('食神', 0) > 3
                                          or f['scores'].get('伤官', 0) > 3),
            'name': '食伤（泄秀）',
            'sub_pattern': '建禄食伤',
            'note': '建禄格喜食伤泄秀',
            'source': '子平真诠·论建禄月劫',
        },
        {
            'condition': lambda f, gh: (f['scores'].get('正官', 0) > 3
                                          or f['scores'].get('七杀', 0) > 3),
            'name': '官杀（制比劫）',
            'sub_pattern': '建禄遇官',
            'note': '建禄遇官杀，贵格',
            'source': '子平真诠·论建禄月劫',
        },
        {
            'condition': lambda f, gh: True,
            'name': '比肩（自立）',
            'note': '建禄无显格，自立而行',
            'source': '子平真诠·论建禄月劫',
        },
    ],
    '劫财格': [
        {
            'condition': lambda f, gh: (f['scores'].get('食神', 0) > 3
                                          or f['scores'].get('伤官', 0) > 3),
            'name': '食伤（泄秀）',
            'sub_pattern': '月劫食伤',
            'note': '月劫格喜食伤泄秀',
            'source': '子平真诠·论建禄月劫',
        },
        {
            'condition': lambda f, gh: (f['scores'].get('正官', 0) > 3
                                          or f['scores'].get('七杀', 0) > 3),
            'name': '官杀（制比劫）',
            'sub_pattern': '月劫遇官',
            'note': '月劫遇官杀，贵格',
            'source': '子平真诠·论建禄月劫',
        },
        {
            'condition': lambda f, gh: True,
            'name': '劫财（自立）',
            'note': '月劫无显格，自立而行',
            'source': '子平真诠·论建禄月劫',
        },
    ],
    '杂气月（辰戌丑未）': [
        {
            'condition': lambda f, gh: True,
            'name': '看透出十神',
            'note': '辰戌丑未月，看哪个十神透干定格',
            'source': '子平真诠·论杂气如何取用',
        },
    ],
    '格局不清': [],   # empty list → geju_yongshen returns None
}
```

If reading the actual classics reveals additional sub-cases or different
threshold values than the `> 3` defaults above, ADJUST the rules to match.
The thresholds above are starting estimates; the classical texts may suggest
different cutoffs.

- [ ] **Step 3.3: Add data validity tests**

Append to `paipan/tests/test_yongshen_data.py`:

```python
def test_geju_rules_each_格局_has_at_least_one_default():
    """Each 格局 with rules must have a final 'condition: lambda ...: True' default."""
    for geju, rules in GEJU_RULES.items():
        if not rules:
            continue   # 格局不清 is intentionally empty
        last = rules[-1]
        assert callable(last.get('condition')), \
            f"{geju} last rule missing condition"
        # Default rule should accept anything: simulate with empty force/gan_he
        assert last['condition']({'scores': {}}, {}) is True, \
            f"{geju} last rule should be a default (always True)"


def test_geju_rules_entries_have_required_fields():
    for geju, rules in GEJU_RULES.items():
        for i, rule in enumerate(rules):
            assert 'condition' in rule, f"{geju}[{i}] missing condition"
            assert callable(rule['condition'])
            assert 'name' in rule, f"{geju}[{i}] missing name"
            assert 'source' in rule, f"{geju}[{i}] missing source"
            assert '子平真诠' in rule['source'], \
                f"{geju}[{i}].source should cite 子平真诠"
```

- [ ] **Step 3.4: Add `geju_yongshen` engine tests**

Append to `paipan/tests/test_yongshen.py`:

```python
def test_geju_yongshen_七杀格_with_食神_returns_食制():
    from paipan.yongshen import geju_yongshen
    force = {'scores': {'食神': 5, '七杀': 4}}
    res = geju_yongshen('七杀格', force, {})
    assert res is not None
    assert res['method'] == '格局'
    assert '食神' in res['name'] or '制' in res['name']
    assert '子平真诠' in res['source']


def test_geju_yongshen_unknown_geju_returns_none():
    from paipan.yongshen import geju_yongshen
    res = geju_yongshen('不存在的格局', {'scores': {}}, {})
    assert res is None


def test_geju_yongshen_格局不清_returns_none():
    from paipan.yongshen import geju_yongshen
    res = geju_yongshen('格局不清', {'scores': {}}, {})
    assert res is None
```

- [ ] **Step 3.5: Run tests + regression**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py paipan/tests/test_yongshen_data.py -v
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: yongshen tests = 8 (5 prior + 3 geju). All paipan ≥ 494.

- [ ] **Step 3.6: Commit**

```bash
git add paipan/paipan/yongshen_data.py paipan/tests/test_yongshen_data.py \
        paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.3 GEJU_RULES table (10 主格局 + 杂气月 + 格局不清)

~30 rules extracted from classics/ziping-zhenquan/. Each 格局 has 1-3
ordered rules; first matching condition wins. All cite 子平真诠 chapter.
Engine fn geju_yongshen() returns dict on first match, None on unknown
geju or 格局不清.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: FUYI_CASES table — 5 dayStrength branches

**Files:**
- Modify: `paipan/paipan/yongshen_data.py` (FUYI_CASES list)
- Test: extend `test_yongshen_data.py` + `test_yongshen.py`

- [ ] **Step 4.1: Populate `FUYI_CASES` in `paipan/paipan/yongshen_data.py`**

Append after GEJU_RULES:

```python
FUYI_CASES: list[dict] = [
    {
        'when': lambda f, ds: ds == '极弱',
        'name': '印 + 比劫（同扶）',
        'note': '极弱日主须印生比扶并用',
        'source': '滴天髓·衰旺·任注',
    },
    {
        'when': lambda f, ds: ds == '身弱',
        'name': '印 / 比劫',
        'note': '身弱择印或比劫扶身（看哪个有根）',
        'source': '滴天髓·衰旺',
    },
    {
        'when': lambda f, ds: ds == '中和',
        'name': None,   # 中和不需扶抑用神
        'note': '日主中和，扶抑法无明确用神',
        'source': '滴天髓·衰旺',
    },
    {
        'when': lambda f, ds: ds == '身强',
        'name': '官杀 / 财 / 食伤',
        'note': '身强择官杀制、财耗、食伤泄（看哪个最具体）',
        'source': '滴天髓·衰旺',
    },
    {
        'when': lambda f, ds: ds == '极强',
        'name': '官杀 + 食伤（双泄）',
        'note': '极强日主须官杀制 + 食伤泄并用',
        'source': '滴天髓·衰旺·任注',
    },
]
```

Note: the case with `name=None` (中和) intentionally produces no usable result —
`fuyi_yongshen()` returns the dict but with `name=None`, so `compose_yongshen()`
treats it as "no扶抑 candidate". Then `_empty_candidate('扶抑', '中和')` is used
in the candidates list.

Adjust the `fuyi_yongshen` function in `paipan/paipan/yongshen.py` to check
`name is None` and return None in that case:

```python
def fuyi_yongshen(force: dict, day_strength: str | None) -> dict | None:
    if not day_strength:
        return None
    for case in FUYI_CASES:
        when = case.get('when')
        if when and when(force, day_strength):
            if case.get('name') is None:
                return None   # 中和 case — no 扶抑 用神
            return {
                'method': '扶抑',
                'name': case['name'],
                'note': case.get('note', ''),
                'source': case.get('source', '滴天髓·衰旺'),
            }
    return None
```

- [ ] **Step 4.2: Add data validity tests**

Append to `paipan/tests/test_yongshen_data.py`:

```python
def test_fuyi_cases_cover_all_5_dayStrength_values():
    """Each of {极弱, 身弱, 中和, 身强, 极强} should match exactly one case."""
    expected = {'极弱', '身弱', '中和', '身强', '极强'}
    seen = set()
    for ds in expected:
        for case in FUYI_CASES:
            if case['when']({'scores': {}}, ds):
                seen.add(ds)
                break
    assert seen == expected, f"missing: {expected - seen}"


def test_fuyi_cases_entries_have_required_fields():
    for i, case in enumerate(FUYI_CASES):
        assert 'when' in case and callable(case['when']), \
            f"FUYI_CASES[{i}] missing or non-callable when"
        assert 'name' in case, f"FUYI_CASES[{i}] missing name (None allowed)"
        assert 'note' in case, f"FUYI_CASES[{i}] missing note"
        assert 'source' in case, f"FUYI_CASES[{i}] missing source"
```

- [ ] **Step 4.3: Add `fuyi_yongshen` engine tests**

Append to `paipan/tests/test_yongshen.py`:

```python
def test_fuyi_yongshen_身弱_returns_扶身_candidate():
    from paipan.yongshen import fuyi_yongshen
    res = fuyi_yongshen({'scores': {}}, '身弱')
    assert res is not None
    assert res['method'] == '扶抑'
    assert '滴天髓' in res['source']


def test_fuyi_yongshen_中和_returns_none():
    """中和 should produce no 扶抑 candidate."""
    from paipan.yongshen import fuyi_yongshen
    assert fuyi_yongshen({'scores': {}}, '中和') is None


def test_fuyi_yongshen_身强_returns_泄身_candidate():
    from paipan.yongshen import fuyi_yongshen
    res = fuyi_yongshen({'scores': {}}, '身强')
    assert res is not None
    assert res['method'] == '扶抑'


def test_fuyi_yongshen_unknown_strength_returns_none():
    from paipan.yongshen import fuyi_yongshen
    assert fuyi_yongshen({'scores': {}}, None) is None
    assert fuyi_yongshen({'scores': {}}, 'something_weird') is None
```

- [ ] **Step 4.4: Run tests + regression**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py paipan/tests/test_yongshen_data.py -v
uv run --package paipan pytest -n auto -q paipan/tests/
```

Expected: yongshen tests = 12 (8 prior + 4 fuyi). All paipan ≥ 498.

- [ ] **Step 4.5: Commit**

```bash
git add paipan/paipan/yongshen_data.py paipan/paipan/yongshen.py \
        paipan/tests/test_yongshen_data.py paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(paipan): Plan 7.3 FUYI_CASES table (5 dayStrength branches)

5 cases keyed on dayStrength ∈ {极弱, 身弱, 中和, 身强, 极强}, each
citing 滴天髓·衰旺. 中和 returns None (扶抑 has no result for balanced
charts). fuyi_yongshen() function updated to handle the None case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Composition logic + 10 golden integration tests

**Files:**
- Modify: `paipan/paipan/yongshen.py` (compose_yongshen — already drafted in Task 1, refine if needed)
- Test: extend `paipan/tests/test_yongshen.py` with 10 golden cases

The `compose_yongshen` function from Task 1 should already work. This task
verifies it on real chart data + adds explicit composition unit tests.

- [ ] **Step 5.1: Add unit tests for compose_yongshen branches**

Append to `paipan/tests/test_yongshen.py`:

```python
from paipan.yongshen import compose_yongshen


def _candidate(method, name, note='', source=''):
    return {'method': method, 'name': name, 'note': note, 'source': source}


def test_compose_調候格局共指():
    t = _candidate('调候', '庚金', source='穷通宝鉴·论丁火·六月')
    g = _candidate('格局', '庚金', source='子平真诠·论七杀')
    out = compose_yongshen(t, g, None)
    assert out['primary'] == '庚金'
    assert out['primaryReason'] == '调候 + 格局共指'
    assert out['warnings'] == []


def test_compose_調候格局不同_warns():
    t = _candidate('调候', '庚金', source='穷通宝鉴·论丁火·六月')
    g = _candidate('格局', '印（化杀）', source='子平真诠·论七杀')
    out = compose_yongshen(t, g, None)
    assert out['primary'] == '庚金'   # 调候 wins per spec §3.2
    assert out['primaryReason'] == '以调候为主'
    assert len(out['warnings']) == 1
    assert '古籍两派' in out['warnings'][0]


def test_compose_only_geju_when_no_tiaohou():
    g = _candidate('格局', '财（生官）', source='子平真诠·论正官')
    out = compose_yongshen(None, g, None)
    assert out['primary'] == '财（生官）'
    assert out['primaryReason'] == '格局法'


def test_compose_only_fuyi_as_last_resort():
    f = _candidate('扶抑', '印 / 比劫', source='滴天髓·衰旺')
    out = compose_yongshen(None, None, f)
    assert out['primary'] == '印 / 比劫'
    assert out['primaryReason'] == '扶抑法（前两法无明确结论）'


def test_compose_no_method_returns_中和():
    out = compose_yongshen(None, None, None)
    assert out['primary'] == '中和（无明显偏枯）'
    assert out['primaryReason'] == '三法皆无强候选'


def test_compose_candidates_always_3_in_fixed_order():
    """Even when methods produce no result, candidates list has 3 entries
    in order [调候, 格局, 扶抑] for stable LLM prompt rendering."""
    out = compose_yongshen(None, None, None)
    assert len(out['candidates']) == 3
    assert [c['method'] for c in out['candidates']] == ['调候', '格局', '扶抑']
```

- [ ] **Step 5.2: Add 10 golden integration cases**

Continue appending to `paipan/tests/test_yongshen.py`:

```python
GOLDEN_YONGSHEN_CASES = [
    # (label, input_kwargs, expected_assertions)
    {
        'label': '丁火六月_身弱_食神格',
        'input': dict(year=1993, month=7, day=15, hour=14, minute=30,
                       gender='male', city='长沙'),
        'expect': {
            'has_tiaohou': True,
            'has_geju': True,
            'tiaohou_source_contains': '穷通宝鉴',
            'geju_source_contains': '子平真诠',
        },
    },
    {
        'label': '丙火五月_身强',
        'input': dict(year=1990, month=5, day=12, hour=12, minute=0,
                       gender='male', city='北京'),
        'expect': {
            'has_tiaohou': True,
            'primary_not_empty': True,
        },
    },
    {
        'label': '甲木八月',
        'input': dict(year=2003, month=8, day=29, hour=8, minute=27,
                       gender='male', city='上海'),
        'expect': {'has_tiaohou': True},
    },
    {
        'label': '癸水正月',
        'input': dict(year=1985, month=1, day=5, hour=23, minute=45,
                       gender='female', city='广州'),
        'expect': {'has_tiaohou': True},
    },
    {
        'label': '辛金腊月',
        'input': dict(year=1976, month=11, day=30, hour=6, minute=15,
                       gender='female', city='成都'),
        'expect': {'has_tiaohou': True},
    },
    {
        'label': '戊土三月',
        'input': dict(year=2000, month=2, day=29, hour=16, minute=0,
                       gender='male', city='深圳'),
        'expect': {'has_tiaohou': True},
    },
    {
        'label': '丁火_寅午戌_三合',
        'input': dict(year=1984, month=10, day=5, hour=14, minute=0,
                       gender='male', city='北京'),
        'expect': {'primary_not_empty': True},
    },
    {
        'label': '乙木_寅卯辰_三会',
        'input': dict(year=1995, month=3, day=21, hour=12, minute=0,
                       gender='female', city='上海'),
        'expect': {'primary_not_empty': True},
    },
    {
        'label': '日主合化',
        'input': dict(year=1988, month=6, day=10, hour=9, minute=0,
                       gender='male', city='北京'),
        'expect': {'primary_not_empty': True},
    },
    {
        'label': '从格疑似',
        'input': dict(year=1974, month=8, day=8, hour=8, minute=0,
                       gender='female', city='昆明'),
        'expect': {'primary_not_empty': True},
    },
]


@pytest.mark.parametrize('case', GOLDEN_YONGSHEN_CASES,
                          ids=[c['label'] for c in GOLDEN_YONGSHEN_CASES])
def test_yongshen_golden(case):
    """Plan 7.3 §8.2: 10 golden cases assert structural soundness on real charts."""
    out = compute(**case['input'])
    detail = out.get('yongshenDetail')
    assert detail, f"{case['label']}: missing yongshenDetail"
    expect = case['expect']

    if expect.get('primary_not_empty'):
        assert detail['primary'], f"{case['label']}: primary is empty"

    if expect.get('has_tiaohou'):
        tiaohou = next(c for c in detail['candidates'] if c['method'] == '调候')
        assert tiaohou['name'], \
            f"{case['label']}: expected 调候 candidate (got name={tiaohou['name']!r})"

    if expect.get('has_geju'):
        geju = next(c for c in detail['candidates'] if c['method'] == '格局')
        assert geju['name'], \
            f"{case['label']}: expected 格局 candidate (got name={geju['name']!r})"

    if 'tiaohou_source_contains' in expect:
        tiaohou = next(c for c in detail['candidates'] if c['method'] == '调候')
        assert expect['tiaohou_source_contains'] in (tiaohou.get('source') or ''), \
            f"{case['label']}: 调候 source missing token"

    if 'geju_source_contains' in expect:
        geju = next(c for c in detail['candidates'] if c['method'] == '格局')
        assert expect['geju_source_contains'] in (geju.get('source') or ''), \
            f"{case['label']}: 格局 source missing token"
```

- [ ] **Step 5.3: Run all yongshen tests**

```
uv run --package paipan pytest -q paipan/tests/test_yongshen.py paipan/tests/test_yongshen_data.py -v
```

Expected: 6 compose unit tests + 10 golden parametrized cases + 12 prior = 28 tests pass.

If a golden case fails because the data tables don't yet cover that month/格局 (Tasks 2-3 may have left some entries with `name=None`), look at which assertion failed and either:
1. Loosen the assertion (e.g. drop `has_tiaohou` for that case), OR
2. Backfill the missing TIAOHOU/GEJU entry (preferred — file the gap as a data improvement)

- [ ] **Step 5.4: Run full paipan + backend regression**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
```

Expected: paipan ≥ 514 (486 + 28 new). Backend stays 426.

- [ ] **Step 5.5: Commit**

```bash
git add paipan/tests/test_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
test(paipan): Plan 7.3 compose_yongshen branches + 10 golden cases

6 unit tests for the 5 composition branches (共指 / 不同 / only-geju /
only-fuyi / 三法皆空) + candidate-list-stability assertion. 10
parametrized golden cases on real chart inputs assert structural
soundness (presence of expected method candidates + classical sources).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Render 用神 block in `compact_chart_context`

**Files:**
- Modify: `server/app/prompts/context.py`
- Test: `server/tests/unit/test_prompts_context_yongshen.py` (NEW)

- [ ] **Step 6.1: Read current `compact_chart_context`**

Read `server/app/prompts/context.py` to confirm:
- It currently does NOT render any 用神 line (verified in Plan 7.3 spec §6.3)
- The function signature is `compact_chart_context(paipan: dict) -> str`
- It builds a list of `lines` then `\n.join`s them
- The 日主 line is around line 56: `lines.append(f"日主  {p.get('rizhu','')}")`

We'll insert the 用神 block AFTER the 日主 line and BEFORE the 大运 line.

- [ ] **Step 6.2: Add 用神 rendering helper at top of file**

```python
def _render_yongshen_block(paipan: dict) -> list[str]:
    """Plan 7.3 §6.3 — render 用神 detail as compact text lines for LLM prompt.

    Returns a list of lines to append to the chart-context block. Returns []
    when yongshenDetail is absent or empty.
    """
    detail = paipan.get('yongshenDetail') or {}
    if not detail.get('primary'):
        return []

    lines: list[str] = []
    primary = detail['primary']
    reason = detail.get('primaryReason', '')
    head = f"用神：{primary}"
    if reason:
        head += f"（{reason}）"
    lines.append(head)

    for c in detail.get('candidates') or []:
        method = c.get('method', '?')
        name = c.get('name') or '—'
        note = c.get('note', '')
        source = c.get('source', '')
        if name == '—' and not note:
            lines.append(f"  · {method} ▸ —")
            continue
        line = f"  · {method} ▸ {name}"
        if note:
            line += f"（{note}）"
        if source:
            line += f"  {source}"
        lines.append(line)

    for w in detail.get('warnings') or []:
        lines.append(f"  ⚠ {w}")

    return lines
```

Then in the body of `compact_chart_context`, find the block where 日主 is
appended and insert AFTER it:

```python
lines.append(f"日主  {p.get('rizhu','')}")

# Plan 7.3: yongshen block (3-method composition)
lines.extend(_render_yongshen_block(p))
```

If the 日主 line is in a conditional (e.g. `if p.get('rizhu'): lines.append(...)`),
put the `_render_yongshen_block` call inside the same conditional so we don't
render 用神 for charts with no 日主.

- [ ] **Step 6.3: Write test `server/tests/unit/test_prompts_context_yongshen.py`**

```python
"""Plan 7.3 §6.3 — compact_chart_context renders 用神 block."""
from __future__ import annotations

from app.prompts.context import compact_chart_context


def _sample_paipan(yongshen_detail=None):
    return {
        'sizhu': {'year': '癸酉', 'month': '己未', 'day': '丁酉', 'hour': '丁未'},
        'rizhu': '丁',
        'yongshen': '庚金',
        'yongshenDetail': yongshen_detail,
    }


def test_renders_用神_block_when_detail_present():
    detail = {
        'primary': '庚金',
        'primaryReason': '调候 + 格局共指',
        'candidates': [
            {'method': '调候', 'name': '庚金', 'note': '丁火生未月', 'source': '穷通宝鉴·论丁火·六月'},
            {'method': '格局', 'name': '印（化杀）', 'note': '七杀透干', 'source': '子平真诠·论七杀'},
            {'method': '扶抑', 'name': '印 / 比劫', 'note': '身弱', 'source': '滴天髓·衰旺'},
        ],
        'warnings': [],
    }
    text = compact_chart_context(_sample_paipan(detail))
    assert '用神：庚金' in text
    assert '调候 + 格局共指' in text
    assert '调候 ▸ 庚金' in text
    assert '穷通宝鉴·论丁火·六月' in text
    assert '格局 ▸ 印（化杀）' in text
    assert '子平真诠·论七杀' in text
    assert '扶抑 ▸ 印 / 比劫' in text


def test_renders_warning_lines_with_prefix():
    detail = {
        'primary': '庚金',
        'primaryReason': '以调候为主',
        'candidates': [
            {'method': '调候', 'name': '庚金', 'note': '', 'source': '穷通宝鉴'},
            {'method': '格局', 'name': '印（化杀）', 'note': '', 'source': '子平真诠'},
            {'method': '扶抑', 'name': None, 'note': '', 'source': ''},
        ],
        'warnings': ['调候用神与格局用神不同 —— 古籍两派各有取法'],
    }
    text = compact_chart_context(_sample_paipan(detail))
    assert '⚠ 调候用神与格局用神不同' in text


def test_skips_block_when_yongshen_detail_absent():
    """No yongshenDetail → no 用神 line at all."""
    paipan = _sample_paipan(yongshen_detail=None)
    text = compact_chart_context(paipan)
    assert '用神：' not in text


def test_renders_em_dash_for_methods_without_name():
    detail = {
        'primary': '中和（无明显偏枯）',
        'primaryReason': '三法皆无强候选',
        'candidates': [
            {'method': '调候', 'name': None, 'note': '本月调候不强烈', 'source': ''},
            {'method': '格局', 'name': None, 'note': '格局未定或无规则', 'source': ''},
            {'method': '扶抑', 'name': None, 'note': '中和', 'source': ''},
        ],
        'warnings': [],
    }
    text = compact_chart_context(_sample_paipan(detail))
    # Even with all-None names, primary still renders + each method is shown
    assert '用神：中和' in text
    # Note text still appears for each method
    assert '本月调候不强烈' in text
    assert '中和' in text
```

- [ ] **Step 6.4: Run test — confirm GREEN**

```
uv run --package server pytest -q server/tests/unit/test_prompts_context_yongshen.py -v
```

Expected: 4 passed.

- [ ] **Step 6.5: Run full backend regression**

```
uv run --package server pytest -n auto -q server/tests/
```

Expected: 426 + 4 = 430 passed.

- [ ] **Step 6.6: Commit**

```bash
git add server/app/prompts/context.py server/tests/unit/test_prompts_context_yongshen.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(server): Plan 7.3 render 用神 block in compact_chart_context

New _render_yongshen_block helper produces a primary line + 3 method
candidate lines + warnings (⚠ prefix). Inserted after 日主 in the
existing chart context. Renders nothing when yongshenDetail is absent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final smoke + browser verification

**Files:**
- Verify only — no source changes

- [ ] **Step 7.1: Run all 3 test suites**

```
uv run --package paipan pytest -n auto -q paipan/tests/
uv run --package server pytest -n auto -q server/tests/
cd frontend && node --test tests/*.mjs
```

Expected:
- paipan: ≥ 514 (486 + 28 new from yongshen tests)
- backend: ≥ 430 (426 + 4 from prompt rendering)
- frontend: 51 (unchanged — no frontend touch)

- [ ] **Step 7.2: Boot dev servers + browser smoke**

```bash
# Terminal A:
cd /Users/veko/code/usual/bazi-analysis/server && uv run --package server --with 'uvicorn[standard]' python -m uvicorn app.main:app --port 3101 --host 127.0.0.1

# Terminal B:
cd /Users/veko/code/usual/bazi-analysis/frontend && npm run dev
```

Open http://localhost:5173 → register a fresh user → submit form → land on shell.

Verify:
- Chart panel left shows `用神：<some-string>` (single-line, unchanged from Plan 7.1) — the string is now sourced from the new engine's `primary`.
- Send a chat question about 用神 (e.g. "我用神是什么"). The assistant reply should reference the primary 用神 + ideally cite a classical source visible in the new context block.

If reply doesn't cite a source, it's a model behavior issue not a code bug. Note in the report.

- [ ] **Step 7.3: Capture browser screenshot**

Save a screenshot of the shell with chart panel visible to `.claire/plan73-yongshen-smoke.png`.

- [ ] **Step 7.4: Commit (no code change, just verification record)**

This task has no commits unless verification revealed a regression. If everything
green, just report DONE.

If a regression is found:
- Identify the source (likely a thresholds-vs-real-chart mismatch in GEJU_RULES — adjust the threshold and re-run)
- Add the fix as an additional commit on this same task
- Re-run the smoke

---

## Self-Review Notes (for the executing engineer)

If you find any of these post-merge, file a Plan 7.4 follow-up:

1. **TIAOHOU thresholds may need tuning** — some months in 穷通宝鉴 have weak/ambiguous primary (e.g. 二月乙木). If a golden test fails because `name=None`, decide: backfill the entry OR loosen the test. Don't fudge the data.

2. **GEJU_RULES `condition` thresholds** (`> 3`) are ESTIMATES from the spec. The actual classical text may suggest different cutoffs (e.g. "财显" might mean score > 5, not > 3). Read the per-格局 chapter and adjust.

3. **Composition rule may need a 5-strict mode** — current spec says 调候 wins on disagreement. Some practitioners argue 格局 should win in 子平真诠-orthodox cases. v1 keeps 调候-first; if user wants tunable, add a setting.

4. **`yongshenDetail` shape change is breaking** if any external caller starts reading it. Plan 7.3 is the first version; document the dict shape clearly in `paipan/paipan/yongshen.py` docstring (already in spec).

5. **No 大运/流年 用神 dynamics** (用神变化 ZPZQ ch 10) — out of scope for v1. If a chat user asks "10 年后我的用神还是这个吗", the LLM has no engine support. Flag for Plan 7.5.
