"""Plan 7.4 行运 engine — skeleton & integration."""
from __future__ import annotations

from paipan import compute
from paipan.xingyun import (
    _detect_ganhe,
    _detect_liuhe,
    _score_gan_to_yongshen,
    _score_zhi_to_yongshen,
    score_yun,
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


def test_score_yun_label_大喜():
    """甲寅 vs 甲木 用神: 干甲比助 (+1) + 支寅比助 (+1) +
    寅+命局亥 六合化木转助 (+1) + 干甲+命局己 合化土反克 (-1) → +2... 喜 not 大喜 :(
    Need a cleaner case. Try: 甲寅 vs 甲木 用神, 命局支含亥 (寅亥合木) + no 命局己 →
    干 +1 (比助), 支 +1 + 1 (比助 + 六合化木) = +2 → final +3 喜.
    Still not 大喜. To hit 大喜 we need +4: try 癸卯 vs 木 用神, 命局含亥 (卯亥不合).
    Actually 癸 (水) 生 木 +2; 卯 (木) 比助 +1. Total +3 → 喜.
    Need at least +4: 甲寅 vs 木, 命局亥 (六合木 +1) + 命局戊 (甲戊不合) →
    干 +1 (比助), 支 +1 + 1 = +2 → +3 still 喜.
    Hmm — 大喜 requires 干生 (+2) + 支生 (+2) = +4. That's 癸亥 vs 木 用神.
    癸 生 木 +2; 亥 (水) 生 木 +2. Total +4 → 大喜.
    """
    out = score_yun('癸亥', '甲木', [], [])
    assert out['label'] == '大喜'
    assert out['score'] >= 4


def test_score_yun_label_喜():
    """甲寅 vs 甲木: 比助 +1 + 比助 +1 = +2 → 喜."""
    out = score_yun('甲寅', '甲木', [], [])
    assert out['label'] == '喜'
    assert 2 <= out['score'] <= 3


def test_score_yun_label_平():
    """戊辰 vs 甲木: 用神克 戊 (0) + 用神克 辰 (0) = 0 → 平."""
    out = score_yun('戊辰', '甲木', [], [])
    assert out['label'] == '平'
    assert -1 <= out['score'] <= 1


def test_score_yun_label_忌():
    """丁巳 vs 甲木: 用神生丁 -1 + 用神生巳火 -1 = -2 → 忌."""
    out = score_yun('丁巳', '甲木', [], [])
    assert out['label'] == '忌'
    assert -3 <= out['score'] <= -2


def test_score_yun_label_大忌():
    """庚申 vs 甲木: 庚克木 -2 + 申金克木 -2 = -4 → 大忌."""
    out = score_yun('庚申', '甲木', [], [])
    assert out['label'] == '大忌'
    assert out['score'] <= -4


def test_multi_element_yongshen_takes_max_score():
    """用神 '甲木 / 戊土 / 庚金'，行运 庚申:
       - vs 木: 庚克木 -2, 申克木 -2 → -4
       - vs 土: 庚 not directly act on 土 (土生庚) → 用神土被泄 -1, 申 同 → -1
       - vs 金: 庚比助 +1, 申比助 +1 → +2
       max = +2 → 喜
    """
    out = score_yun('庚申', '甲木 / 戊土 / 庚金', [], [])
    assert out['label'] == '喜'
    assert out['score'] >= 2


def test_multi_element_winning_element_recorded():
    """For the same case, winningYongshenElement should name 庚金."""
    out = score_yun('庚申', '甲木 / 戊土 / 庚金', [], [])
    assert out['winningYongshenElement'] == '庚金'


def test_score_yun_中和_命局_returns_平():
    """用神 = '中和（无明显偏枯）' → 平 with empty mechanisms."""
    out = score_yun('庚申', '中和（无明显偏枯）', [], [])
    assert out['label'] == '平'
    assert out['score'] == 0
    assert out['mechanisms'] == []
    assert '中和' in out['note']
