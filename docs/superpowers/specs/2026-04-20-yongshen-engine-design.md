# Plan 7.3 — 用神 Engine (3-Method Composition)

**Status**: design
**Date**: 2026-04-20
**Base**: main @ `f9c0fd1` (Plan 7.2 merged)
**Depends on**: Plan 7.1 + 7.2 (analyzer with `force`/`geJu`/`zhiRelations`)
**Replaces**: `paipan/paipan/analyzer.py::suggest_yongshen` (current placeholder
that returns a single string from `dayStrength` + score sums)

---

## 1. Goal

Replace the current 4-line 用神 placeholder with a real classical-text-grounded
engine that composes three independent traditional methods, each producing a
candidate with reasoning + classical citation. The output feeds:

1. **Chart panel** — single-line "primary" 用神 label
2. **Chat LLM prompt** — full structured candidates list so the LLM can ground
   answers in specific classical excerpts instead of inventing

The current placeholder ("比劫（帮身）" / "印（扶身）" / "中和") is reductive
and untraceable to any classical source. Real 命理 practice uses three layered
methods, each with different rules and authority. The new engine surfaces all
three transparently.

## 2. Non-goals

- No UI redesign of the 用神 row (still a single-line label for v1; richer UI
  is Plan 7.4+).
- No retrieval integration changes — `source` is a short string pointer
  (e.g. `穷通宝鉴·论丁火·六月`); LLM uses existing retrieval to expand if needed.
- No ML / heuristic learning. Pure deterministic rule tables.
- No JS port. JS archive has no real algorithm here, just a 4-line placeholder.
- No coverage of 大运 / 流年 用神 dynamics (用神变化, 子平真诠 ch 10) — that's
  Plan 7.5+.
- No 神煞 / 病药 method coverage. Only 调候 + 格局 + 扶抑.

## 3. Architecture

### 3.1 Three independent methods + composition

```
analyze() — last step:

  primary_candidate = build_yongshen(
    rizhu_gan, month_zhi, force, geju, gan_he, day_strength
  )

  └── tiaohou_yongshen(rizhu_gan, month_zhi)
        → table lookup TIAOHOU[(rizhu, month_zhi)]
        → {method:'调候', name, supporting?, note, source}

  └── geju_yongshen(geju, force, gan_he)
        → rule sequence GEJU_RULES[geju] (first matching condition wins)
        → {method:'格局', name, sub_pattern?, note, source}

  └── fuyi_yongshen(force, day_strength)
        → 5-case branch on dayStrength + 五行 shortage
        → {method:'扶抑', name, note, source}

  ↓ compose_yongshen(candidates)

  yongshen = {
    primary:        '<one-line label>',
    primaryReason:  '<why this is primary>',
    candidates:     [c1, c2, c3],   # order: 调候, 格局, 扶抑 (deterministic)
    warnings:       ['古籍分歧提醒...'] | []
  }
```

### 3.2 Composition rule (compose_yongshen)

```
if 调候.name == 格局.name (or wuxing equivalent):
  primary = 调候.name
  primaryReason = '调候 + 格局共指'
  warnings = []
elif 调候 has a result and 格局 has a result, but they differ:
  primary = 调候.name           # 穷通宝鉴 hardest authority
  primaryReason = '以调候为主'
  warnings = ['调候用神与格局用神不同 —— 古籍两派各有取法']
elif only 格局 has a result (e.g. 调候 says "本月用神不显"):
  primary = 格局.name
  primaryReason = '格局法'
elif only 扶抑 has a result:
  primary = 扶抑.name
  primaryReason = '扶抑法（前两法无明确结论）'
else:
  primary = '中和（无明显偏枯）'
  primaryReason = '三法皆无强候选'
```

The candidates list ALWAYS contains all 3 methods (some may have empty `name`
and a `note` like "本月调候不强烈"), so the LLM sees the full picture.

### 3.3 Source pointer convention

`source` field is a short string in the form `<典籍>·<章/篇>·<细节>`:

- `穷通宝鉴·论丁火·六月`
- `子平真诠·论用神·章八`
- `子平真诠·论七杀·食制 vs 印化`
- `滴天髓·衰旺·任注`
- `扶抑（滴天髓·衰旺）` — when 扶抑 method emits its result

These pointers feed the existing Plan 5 retrieval system, which can pull the
full classical text on demand into the chat prompt.

## 4. Data tables (`paipan/paipan/yongshen_data.py`)

Single new file, ~600 lines of pure data + brief docstring.

### 4.1 TIAOHOU table — 穷通宝鉴 调候用神

Lookup `(rizhu_gan, month_zhi) → {primary, supporting, note, source}`. 10 ×
12 = 120 entries.

```python
TIAOHOU: dict[tuple[str, str], dict] = {
    ('丁', '寅'): {
        'name': '甲木',
        'supporting': '庚金',
        'note': '丁火生寅月，木旺火相，喜甲木引化、庚金劈甲',
        'source': '穷通宝鉴·论丁火·正月',
    },
    ('丁', '卯'): {...},
    # ... 120 total
}
```

Each entry is curated from the corresponding classics file
(`classics/qiongtong-baojian/0X_lun-<gan>.md` 中按月份段落). Empty-or-weak entries
allowed (e.g. some neutral months) — those return `name=None` to signal "no
strong tiaohou", which composition treats as no result.

### 4.2 GEJU_RULES table — 子平真诠 格局取用

Rule sequence per 格局 (first matching wins). Each rule has a `condition`
callable on the analyzer's `force` dict + a result template.

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
        # default
        {
            'condition': lambda f, gh: True,
            'name': '正官',
            'note': '官清水秀，孤官无辅',
            'source': '子平真诠·论正官',
        },
    ],
    '七杀格': [
        # 食神制杀
        {'condition': lambda f, gh: f['scores'].get('食神', 0) > 3,
         'name': '食神（制杀）', 'sub_pattern': '食制',
         'note': '七杀得食神制为美格', 'source': '子平真诠·论七杀'},
        # 印化杀
        {'condition': lambda f, gh: (f['scores'].get('正印', 0) > 3
                                       or f['scores'].get('偏印', 0) > 3),
         'name': '印（化杀）', 'sub_pattern': '印化',
         'note': '七杀透干无制，须印化', 'source': '子平真诠·论七杀'},
        # default
        {'condition': lambda f, gh: True,
         'name': '七杀（无制无化）', 'sub_pattern': '裸杀',
         'note': '七杀失制，凶', 'source': '子平真诠·论七杀'},
    ],
    '正财格': [...],
    '偏财格': [...],
    '食神格': [...],
    '伤官格': [...],
    '正印格': [...],
    '偏印格': [...],
    '比肩格': [...],   # 建禄
    '劫财格': [...],   # 月劫
    '杂气月（辰戌丑未）': [...],   # 子平真诠 ch 16
    '格局不清': [],   # empty → geju method emits no result
}
```

~10 main 格局 × 2-4 rules each ≈ 30 rules total. Each rule cites a specific
chapter / sub-section of 子平真诠.

### 4.3 FUYI table — 扶抑 5-case

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
        'name': '印 / 比劫',  # detailed in note based on which is weaker
        'note': '...',
        'source': '滴天髓·衰旺',
    },
    # 中和
    # 身强
    # 极强
]
```

5 cases match the 5 dayStrength values returned by 力量分析.

## 5. Public API (`paipan/paipan/yongshen.py`)

Single new file, ~200 lines of code (separate from data).

```python
def tiaohou_yongshen(rizhu_gan: str, month_zhi: str) -> dict | None:
    """Return TIAOHOU entry or None if not strongly indicated."""

def geju_yongshen(geju: str, force: dict, gan_he: dict) -> dict | None:
    """Return first matching GEJU_RULES entry or None if 格局 unclear."""

def fuyi_yongshen(force: dict, day_strength: str) -> dict | None:
    """Return matching FUYI_CASES entry or None for 中和."""

def build_yongshen(
    rizhu_gan: str, month_zhi: str,
    force: dict, geju: str | None,
    gan_he: dict, day_strength: str,
) -> dict:
    """Compose 3 methods → primary/candidates/warnings dict (see §3.1)."""
```

## 6. Integration points

### 6.1 `analyzer.py` — append yongshen pass

After existing `force / geJu / zhiRelations / notes / ganHe` computation:

```python
yongshen_dict = build_yongshen(
    rizhu_gan=d.gan,
    month_zhi=m.zhi,
    force=force,
    geju=ge_ju.get('mainCandidate', {}).get('name'),
    gan_he=gan_he,
    day_strength=force.get('dayStrength'),
)

return {
    ...,  # existing fields
    'yongshen': yongshen_dict['primary'],   # STRING — chartUi.js + compat
    'yongshenDetail': yongshen_dict,        # DICT — full candidates / warnings
}
```

**Backward compat strategy**: keep top-level `yongshen` as a STRING (the
`primary` label) so the existing wiring (`compute.py` → `chartUi.js` →
`meta.yongshen` → chart panel rendering) is untouched. The new structured dict
lives under a NEW key `yongshenDetail` and is consumed only by the prompt
renderer in §6.3.

### 6.2 `compute.py` — surface to top-level

Replace the current call:

```python
# OLD (Plan 7.1):
result["yongshen"] = suggest_yongshen(analysis)

# NEW:
result["yongshen"] = analysis["yongshen"]              # primary string
result["yongshenDetail"] = analysis["yongshenDetail"]  # full dict
```

The existing `suggest_yongshen` callable in `analyzer.py` is renamed to
`_legacy_suggest_yongshen` (kept for any external callers, marked deprecated)
and `compute.py` no longer calls it directly — `analyzer.analyze()` builds
the new yongshen dict internally.

### 6.3 `compact_chart_context` (server/app/prompts/context.py) — add new block

Currently `compact_chart_context` does NOT render 用神 at all (only sizhu,
shishen, cangGan, naYin, rizhu, dayun, today). Plan 7.3 ADDS a new block
between 日主 and 大运:

```
用神：{primary}（{primaryReason}）
  · 调候 ▸ {tiaohou.name}（{tiaohou.note}）  {tiaohou.source}
  · 格局 ▸ {geju.name}（{geju.note}）  {geju.source}
  · 扶抑 ▸ {fuyi.name}（{fuyi.note}）  {fuyi.source}
{warnings 每条前缀 ⚠}
```

If a method has no result, render `· {method} ▸ —`.

The renderer reads `paipan["yongshenDetail"]` (the new dict). When the dict is
absent (e.g. legacy chart data not regenerated), skip the block entirely.

### 6.4 Backward compat for `meta.yongshen`

Existing `chartUi.js::chartResponseToEntry` reads `rawChart.yongshen` (string)
and writes it to UI store as `meta.yongshen`. Plan 7.3 keeps `chart.paipan.yongshen`
as a string (the primary label), so chartUi.js and chart panel rendering
require **zero changes**.

If frontend wants to surface candidates later (Plan 7.4), it can read
`chart.paipan.yongshenDetail` directly. No frontend changes in this plan.

## 7. Data sourcing strategy

The 120 TIAOHOU entries + 30 GEJU rule entries are too much to type by hand
without errors.

**Recommended**: codex uses an LLM-extraction pass:

1. Read `classics/qiongtong-baojian/0X_lun-<gan>.md` (10 files), extract per-month
   entries into a JSON draft. Format prescribed (matches `TIAOHOU` schema).
2. Read `classics/ziping-zhenquan/0X_lun-<geju>.md` (~15 files), extract rule
   templates into a JSON draft.
3. Hand-edit the JSON drafts to fix obvious LLM mis-extractions, normalize
   notes to ≤30 chars, normalize source pointers.
4. Convert JSON → Python literal in `yongshen_data.py`.

The user (project owner) has 命理 background and reviews the final tables for
sanity before merge.

This sourcing is itself part of Plan 7.3 implementation work, NOT a prerequisite.

## 8. Tests

### 8.1 Data validity (`paipan/tests/test_yongshen_data.py`)

- All 120 TIAOHOU entries have valid keys + non-empty `source`
- All GEJU_RULES list entries have callable `condition` + non-empty `name`/`source`
- All FUYI_CASES have callable `when` + non-empty `name`

### 8.2 Engine logic (`paipan/tests/test_yongshen.py`)

10 hand-curated golden cases. Each asserts:
- `primary` matches expected
- `candidates` has 3 entries with method ∈ {调候, 格局, 扶抑}
- The method that produced primary is in the first slot of candidates? (no — order is fixed: 调候/格局/扶抑 deterministic)
- `warnings` matches expected (empty or contains specific phrase)

Sample case:
```python
def test_丁火六月_身弱_七杀格():
    """丁火生未月，七杀透干，身弱 → 调候=庚金/丁火, 格局=印化杀, 扶抑=印, 三派齐共指 印 / 庚金"""
    out = compute(year=1993, month=7, day=15, hour=14, gender='male', city='长沙')
    ys = out['yongshen']
    assert ys['primary'].endswith('庚金') or '庚金' in ys['primary']
    assert any(c['method'] == '调候' for c in ys['candidates'])
    assert any('穷通宝鉴' in c.get('source', '') for c in ys['candidates'])
```

### 8.3 Prompt rendering (`server/tests/unit/test_prompts_context_yongshen.py`)

- Given a chart with full yongshen dict, `compact_chart_context()` renders
  the new 用神 block with all 3 methods + at most 1 warning line.
- Old "用神（粗算）：" string DOES NOT appear (regression check on the format change).

## 9. Acceptance gates

- All existing 486 paipan + 426 backend + 51 frontend tests stay green.
- New paipan tests: ≥10 (engine + data validity).
- New server test: ≥1 (prompt rendering).
- Total: paipan ≥ 496, backend ≥ 427.
- Browser smoke: chart panel still shows a single-line `用神：xxx` (the new
  primary string). No UI regression.
- LLM chat sanity: send a chat about 用神 → assistant response cites a specific
  classical source visible in the system prompt block (verify by reading the
  prompt or the assistant reply). This is a manual-only check.

## 10. Plan-spec deviations possible at impl time

If during implementation the codex discovers:
- A 调候 entry where the classical text doesn't strongly indicate a primary
  → entry has `name: None`, composition treats as no result.
- A 格局 sub-pattern needs an extra rule beyond the 30 sketched here → add it
  to `GEJU_RULES`, document in the file's docstring.
- 子平真诠's text is ambiguous on a specific 格局 sub-case → flag in the entry's
  `note` with a short caveat instead of inventing.

These are fine. Sourcing imperfections are handled at the data layer, not the
algorithm layer.

## 11. Risks

| Risk | Mitigation |
|---|---|
| LLM-extracted tables have errors | Plan 7.3 includes a hand-review pass before merge; user with 命理 background does final sanity. |
| 调候 vs 格局 disagreement is the norm, not exception → too many warnings | Composition tolerates this; warning phrasing is informational not alarming. v1.5 may add a "consensus method" if disagreement noisy. |
| Some LLM responses still drift from 用神 候选 | The prompt block is data, not enforcement. Cannot guarantee model compliance. Plan 7.4 may add a self-check pass. |
| 用神 changes with 大运/流年 (用神变化, ZPZQ ch 10) | Out of scope for 7.3. Static 用神 only. Plan 7.5 territory. |

## 12. Rollout

Single PR. No migration. No feature flag. Existing `meta.yongshen` consumers
keep working because `chart.paipan.yongshen` remains a string (now sourced from
`yongshenDetail.primary`). New `yongshenDetail` dict is purely additive.
