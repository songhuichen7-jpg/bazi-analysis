"""Plan 7.4 行运 engine — skeleton & integration."""
from __future__ import annotations

from paipan import compute
from paipan.xingyun import (
    _detect_ganhe,
    _detect_liuhe,
    _score_gan_to_yongshen,
    _score_zhi_to_yongshen,
)


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


# === 干合化 detection ===

def test_detect_ganhe_甲己合土():
    """命局含 己 + 行运 甲 → 合化 土."""
    assert _detect_ganhe('甲', ['己', '丁', '丁']) == '土'


def test_detect_ganhe_no_match():
    """命局没有可合的 干 → None."""
    assert _detect_ganhe('甲', ['乙', '丙', '丁']) is None


# === 干 score ===

def test_score_gan_pure_sheng():
    """癸 (水) 生 甲木 用神 → +2."""
    delta, reason, mech = _score_gan_to_yongshen('癸', '木', [])
    assert delta == 2
    assert '生用神' in reason
    assert any('相生' in m for m in mech)


def test_score_gan_with_ganhe_modifier():
    """戊 vs 木 用神：基础 0 (用神克 戊)，但 命局 含 癸 → 戊癸合化火，火泄木 → 干 -1 modifier。

    最终 delta = 0 + 0 (用神克干 base) + (-1 if 火克木 else +1 if 火生木)
    五行 火 生 木 (no), 火 克 木 (no, actually 火 不克 木 — 金克木). 火 与 木 关系：木生火，火 是 木的食伤 → spec 规则 "合化五行 生用神→+1"，但这里是 用神 生 合化五行 (木生火) → no rule fires → modifier 0.

    Wait — re-reading spec §3.3 干合化 modifier: 只看合化五行 == 用神/生用神/克用神 三种。木生火 不在这三种里 → modifier 0. So delta stays 0.
    """
    delta, reason, mech = _score_gan_to_yongshen('戊', '木', ['癸', '己', '丁'])
    # base: 木 克 戊 → 0
    # 戊+癸 合化 火, 火 不== 木, 火不生木 (金生木 actually no — 水生木), 火不克木 (金克木) → no modifier
    assert delta == 0


# === 六合 detection ===

def test_detect_liuhe_寅亥合木():
    """命局含 亥 + 行运 寅 → 六合 木."""
    assert _detect_liuhe('寅', ['亥', '酉', '酉']) == '木'


def test_detect_liuhe_no_match():
    """命局没有可六合的 支 → None."""
    assert _detect_liuhe('寅', ['酉', '酉', '未']) is None


# === 支 score ===

def test_score_zhi_pure_bizhu():
    """寅 (木) 比助 木 用神 → +1."""
    delta, reason, mech = _score_zhi_to_yongshen('寅', '木', [])
    assert delta == 1
    assert '比助' in reason
    assert any('比助' in m for m in mech)


def test_score_zhi_with_liuhe_modifier():
    """寅 vs 木 用神，命局含 亥 → 寅亥合化木，本气木已比助 +1, 六合化木 转助 +1 → +2."""
    delta, reason, mech = _score_zhi_to_yongshen('寅', '木', ['亥', '酉', '酉'])
    # base: 寅 (木) 比助 木 → +1
    # 寅+亥 合化 木, 木 == 用神木 → modifier +1
    assert delta == 2
    assert '六合' in reason
    assert any('六合化木' in m for m in mech)
