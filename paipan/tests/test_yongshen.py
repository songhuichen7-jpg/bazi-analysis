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


def test_tiaohou_yongshen_甲木_正月():
    """甲木生寅月 (正月) → expect tiaohou hit from 论甲木."""
    from paipan.yongshen import tiaohou_yongshen
    res = tiaohou_yongshen('甲', '寅')
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
