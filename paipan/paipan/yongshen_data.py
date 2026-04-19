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
