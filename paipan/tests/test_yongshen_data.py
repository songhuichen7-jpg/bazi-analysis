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
