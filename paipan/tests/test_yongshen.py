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
