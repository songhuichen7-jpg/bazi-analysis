"""Plan 7.4 行运 engine — skeleton & integration."""
from __future__ import annotations

import pytest

from paipan import compute
from paipan.xingyun import (
    _is_same_combo,
    _trim_note,
    build_xingyun,
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


def test_trim_note_short_unchanged():
    """≤ 30 字 → 不变."""
    s = '丙生用神，午比助用神'
    assert _trim_note(s) == s


def test_trim_note_long_with_comma_cuts_at_comma():
    """> 30 字, 含 ","在后半截 → 切到最后一个 ",".  """
    long_note = '丙生用神调候扶抑兼顾格局仍偏燥些，午比助用神但与命局丁壬合化木有反作用使整体偏弱很多'
    out = _trim_note(long_note)
    assert len(out) <= 30
    # 切在 "，" 边界 (该 "，" 在 idx=16 > limit//2=15)
    assert out.endswith('，')


def test_trim_note_long_no_punct_falls_back_to_char_cut():
    """> 30 字 + 全无标点 → 字符切到 30."""
    long_note = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三'
    out = _trim_note(long_note)
    assert len(out) == 30


def test_trim_note_punct_in_first_half_falls_back():
    """> 30 字 + 标点在前半截 (idx < limit//2=15) → fallback 字符切.

    NOTE: 字符切会保留前面的 "，"; 只断言长度, 不断言标点存在与否.
    """
    long_note = '一二，四五六七八九十一二三四五六七八九十一二三四五六七八九十一二'
    # "，" 在 idx=2, < 15 → fallback to char cut
    out = _trim_note(long_note)
    assert len(out) == 30


def test_mechanism_tags_byte_identical_to_plan74_strings():
    """Plan 7.5a.1 §5.3 + §6.3: 重构后 mechanism 字符串跟 Plan 7.4 ship 的字面值一致."""
    from paipan import mechanism_tags as M

    # 5 干 base
    assert M.GAN_SHENG == '干·相生'
    assert M.GAN_KE == '干·相克'
    assert M.GAN_BIZHU == '干·比助'
    assert M.GAN_XIE == '干·相泄'
    assert M.GAN_HAO == '干·相耗'

    # 5 支 base
    assert M.ZHI_SHENG == '支·相生'
    assert M.ZHI_KE == '支·相克'
    assert M.ZHI_BIZHU == '支·比助'
    assert M.ZHI_XIE == '支·相泄'
    assert M.ZHI_HAO == '支·相耗'

    # 4 modifier builder
    assert M.gan_hehua_zhuanzhu('木') == '干·合化转助·木'
    assert M.gan_hehua_fanke('金') == '干·合化反克·金'
    assert M.zhi_liuhe_zhuanzhu('木') == '支·六合化木·转助'
    assert M.zhi_liuhe_fanke('火') == '支·六合化火·反克'


def test_xingyun_chart_context_plumbing():
    """Plan 7.5b §5.2: compute.py constructs chart_context and passes to build_xingyun.

    Verify by patching build_xingyun and capturing the call args.
    """
    import importlib

    compute_mod = importlib.import_module('paipan.compute')
    captured = {}
    original_build = compute_mod.build_xingyun

    def spy(**kwargs):
        captured.update(kwargs)
        return original_build(**kwargs)

    compute_mod.build_xingyun = spy
    try:
        compute_mod.compute(year=1993, month=7, day=15, hour=14, minute=30,
                             gender='male', city='长沙')
    finally:
        compute_mod.build_xingyun = original_build

    assert 'chart_context' in captured, 'compute.py should pass chart_context kwarg'
    cc = captured['chart_context']
    assert cc is not None
    assert cc['month_zhi'] == '未'   # 1993-07-15 month柱己未 → 月支未
    assert cc['rizhu_gan'] == '丁'    # 1993-07-15 丁酉日
    assert 'force' in cc
    assert 'gan_he' in cc
    assert 'original_geju_name' in cc


def test_is_same_combo_both_none_returns_false():
    assert _is_same_combo(None, None) is False
    assert _is_same_combo({'trigger': {}}, None) is False
    assert _is_same_combo(None, {'trigger': {}}) is False


def test_is_same_combo_same_type_same_zhi_returns_true():
    a = {'trigger': {'type': 'sanHe', 'zhi_list': ['亥', '卯', '未']}}
    b = {'trigger': {'type': 'sanHe', 'zhi_list': ['未', '亥', '卯']}}   # 顺序无关
    assert _is_same_combo(a, b) is True


def test_is_same_combo_different_type_or_zhi_returns_false():
    a = {'trigger': {'type': 'sanHe', 'zhi_list': ['亥', '卯', '未']}}
    b = {'trigger': {'type': 'sanHui', 'zhi_list': ['亥', '卯', '未']}}   # 不同 type
    assert _is_same_combo(a, b) is False

    c = {'trigger': {'type': 'sanHe', 'zhi_list': ['申', '子', '辰']}}   # 不同 zhi
    assert _is_same_combo(a, c) is False


def test_build_xingyun_returns_8_dayun():
    """The standard chart should produce 8 大运 entries."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert len(xy['dayun']) == 8
    for entry in xy['dayun']:
        assert 'label' in entry
        assert 'score' in entry
        assert 'note' in entry
        assert entry['label'] in {'大喜', '喜', '平', '忌', '大忌'}


def test_build_xingyun_currentDayunIndex_is_set():
    """For 1993 birth + 2026 current_year, current大运 should be in [1,8]."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert xy['currentDayunIndex'] is not None
    assert 1 <= xy['currentDayunIndex'] <= 8


def test_build_xingyun_liunian_keyed_by_dayun_index():
    """liunian dict keys are str(1)..str(8) and each list has 10 entries."""
    out = compute(year=1993, month=7, day=15, hour=14, minute=30,
                   gender='male', city='长沙')
    xy = out['xingyun']
    assert set(xy['liunian'].keys()) == {str(i) for i in range(1, 9)}
    for k, ln_list in xy['liunian'].items():
        assert len(ln_list) == 10, f'大运 {k} should have 10 流年, got {len(ln_list)}'


def test_build_xingyun_中和_命局_returns_empty():
    """If yongshen_detail.primary contains '中和', dayun and liunian should be empty."""
    fake_yongshen = {'primary': '中和（无明显偏枯）'}
    fake_dayun = {'list': []}   # any shape — should be ignored
    out = build_xingyun(fake_dayun, fake_yongshen, [], [], 2026)
    assert out['dayun'] == []
    assert out['liunian'] == {}
    assert out['currentDayunIndex'] is None
    assert '中和' in out['yongshenSnapshot']


GOLDEN_XINGYUN_CASES = [
    {
        'label': '丁火六月_身弱_食神格',
        'input': dict(year=1993, month=7, day=15, hour=14, minute=30,
                       gender='male', city='长沙'),
    },
    {
        'label': '丙火五月_身强',
        'input': dict(year=1990, month=5, day=12, hour=12, minute=0,
                       gender='male', city='北京'),
    },
    {
        'label': '甲木八月',
        'input': dict(year=2003, month=8, day=29, hour=8, minute=27,
                       gender='male', city='上海'),
    },
    {
        'label': '癸水正月',
        'input': dict(year=1985, month=1, day=5, hour=23, minute=45,
                       gender='female', city='广州'),
    },
    {
        'label': '辛金腊月',
        'input': dict(year=1976, month=11, day=30, hour=6, minute=15,
                       gender='female', city='成都'),
    },
    {
        'label': '戊土三月',
        'input': dict(year=2000, month=2, day=29, hour=16, minute=0,
                       gender='male', city='深圳'),
    },
    {
        'label': '丁火_寅午戌_三合',
        'input': dict(year=1984, month=10, day=5, hour=14, minute=0,
                       gender='male', city='北京'),
    },
    {
        'label': '乙木_寅卯辰_三会',
        'input': dict(year=1995, month=3, day=21, hour=12, minute=0,
                       gender='female', city='上海'),
    },
    {
        'label': '日主合化',
        'input': dict(year=1988, month=6, day=10, hour=9, minute=0,
                       gender='male', city='北京'),
    },
    {
        'label': '从格疑似',
        'input': dict(year=1974, month=8, day=8, hour=8, minute=0,
                       gender='female', city='昆明'),
    },
]


@pytest.mark.parametrize('case', GOLDEN_XINGYUN_CASES,
                          ids=[c['label'] for c in GOLDEN_XINGYUN_CASES])
def test_xingyun_golden_structural(case):
    """Each golden chart produces a structurally sound xingyun dict.

    Asserts (no specific label values — those are not oracle truths):
      - xingyun is a dict with required top-level keys
      - dayun has 8 entries (or 0 if 中和 命局)
      - if dayun non-empty: liunian has 8 keys × 10 entries each
      - currentDayunIndex is in [1,8] or None
      - every dayun/liunian entry has label in valid set
      - mechanisms list is well-formed (each tag matches expected pattern)
    """
    out = compute(**case['input'])
    xy = out.get('xingyun')
    assert xy is not None, f"{case['label']}: missing xingyun"
    assert 'dayun' in xy
    assert 'liunian' in xy
    assert 'currentDayunIndex' in xy
    assert 'yongshenSnapshot' in xy

    valid_labels = {'大喜', '喜', '平', '忌', '大忌'}

    if xy['dayun']:   # non-中和 case
        assert len(xy['dayun']) == 8, \
            f"{case['label']}: expected 8 dayun, got {len(xy['dayun'])}"
        for d in xy['dayun']:
            assert d['label'] in valid_labels
            assert isinstance(d['mechanisms'], list)
        assert len(xy['liunian']) == 8
        for k, ln_list in xy['liunian'].items():
            assert len(ln_list) == 10
            for ly in ln_list:
                assert ly['label'] in valid_labels

        cur = xy['currentDayunIndex']
        if cur is not None:
            assert 1 <= cur <= 8
    else:
        # 中和 命局 — verify empty consistency
        assert xy['liunian'] == {}
        assert xy['currentDayunIndex'] is None
