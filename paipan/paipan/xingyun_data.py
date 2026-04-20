"""Plan 7.4 — static lookup tables for 行运 scoring engine.

Tables:
- GAN_HE_TABLE      — 5 对天干合化 (甲己→土,乙庚→金 等)
- ZHI_LIUHE_TABLE   — 6 对地支六合 (子丑→土,寅亥→木 等)
- SCORE_THRESHOLDS  — 5-bin 分类阈值

Existing wuxing tables are imported from paipan.ganzhi (GAN_WUXING /
ZHI_WUXING / WUXING_SHENG / WUXING_KE) — do NOT duplicate.

Spec: docs/superpowers/specs/2026-04-20-xingyun-engine-design.md
"""
from __future__ import annotations

# 5 对天干合化 (filled in Task 2)
GAN_HE_TABLE: dict[frozenset[str], str] = {}

# 6 对地支六合 (filled in Task 2)
ZHI_LIUHE_TABLE: dict[frozenset[str], str] = {}

# 5-bin 分类阈值 (filled in Task 2)
SCORE_THRESHOLDS: dict[str, int] = {}
