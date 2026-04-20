"""Plan 7.4 行运 engine — skeleton & integration."""
from __future__ import annotations

from paipan import compute


def test_chart_xingyun_present_and_is_dict():
    """Plan 7.4 §6.1: chart.paipan.xingyun is a dict."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    assert isinstance(out.get('xingyun'), dict)


def test_chart_xingyun_has_expected_top_keys():
    """Plan 7.4 §5.2: required top-level keys present."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert 'dayun' in xy
    assert 'liunian' in xy
    assert 'currentDayunIndex' in xy
    assert 'yongshenSnapshot' in xy


def test_chart_xingyun_yongshenSnapshot_matches_plan73_primary():
    """xingyun.yongshenSnapshot == yongshenDetail.primary."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    assert out['xingyun']['yongshenSnapshot'] == out['yongshenDetail']['primary']
