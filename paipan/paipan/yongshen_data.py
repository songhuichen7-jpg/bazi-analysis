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
TIAOHOU: dict[tuple[str, str], dict] = {
    # 甲木 (12 months)
    ('甲', '寅'): {
        'name': '丙火',
        'supporting': '癸水',
        'note': '初春余寒，得丙癸逢，名寒木向阳',
        'source': '穷通宝鉴·论甲木·正月',
    },
    ('甲', '卯'): {
        'name': '庚金',
        'supporting': '戊土',
        'note': '木旺阳刃，庚金得所，财资杀方贵',
        'source': '穷通宝鉴·论甲木·二月',
    },
    ('甲', '辰'): {
        'name': '庚金',
        'supporting': '壬水',
        'note': '木气相竭，先取庚金，次用壬水',
        'source': '穷通宝鉴·论甲木·三月',
    },
    ('甲', '巳'): {
        'name': '癸水',
        'supporting': '丁火',
        'note': '甲木退气，丙火司权，先癸后丁',
        'source': '穷通宝鉴·论甲木·四月',
    },
    ('甲', '午'): {
        'name': '癸水',
        'supporting': '丁火',
        'note': '木性虚焦，五月先癸后丁，庚金次之',
        'source': '穷通宝鉴·论甲木·五月',
    },
    ('甲', '未'): {
        'name': '丁火',
        'supporting': '庚金',
        'note': '三伏生寒，先丁后庚，无癸亦可',
        'source': '穷通宝鉴·论甲木·六月',
    },
    ('甲', '申'): {
        'name': '丁火',
        'supporting': '庚金',
        'note': '木性枯槁，丁火为尊，庚金不可少',
        'source': '穷通宝鉴·论甲木·七月',
    },
    ('甲', '酉'): {
        'name': '丁火',
        'supporting': '丙火',
        'note': '木囚金旺，丁火为先，次用丙火',
        'source': '穷通宝鉴·论甲木·八月',
    },
    ('甲', '戌'): {
        'name': '丁火 / 癸水',
        'supporting': '庚金',
        'note': '木星凋零，专用丁癸，见戊透则贵',
        'source': '穷通宝鉴·论甲木·九月',
    },
    ('甲', '亥'): {
        'name': '庚金 / 丁火',
        'supporting': '丙火',
        'note': '十月甲木，庚丁为要，丙火次之',
        'source': '穷通宝鉴·论甲木·十月',
    },
    ('甲', '子'): {
        'name': '丁火',
        'supporting': '庚金',
        'note': '木性生寒，丁先庚后，丙火佐之',
        'source': '穷通宝鉴·论甲木·十一月',
    },
    ('甲', '丑'): {
        'name': '庚金',
        'supporting': '丁火',
        'note': '天寒气冻，先用庚劈甲，丁火次之',
        'source': '穷通宝鉴·论甲木·十二月',
    },

    # 乙木 (12 months)
    ('乙', '寅'): {
        'name': '丙火',
        'supporting': '癸水',
        'note': '余寒未解，非丙不暖，癸水滋根为辅',
        'source': '穷通宝鉴·论乙木·正月',
    },
    ('乙', '卯'): {
        'name': '丙火',
        'supporting': '癸水',
        'note': '阳气渐升，以丙为君，癸为臣佐木',
        'source': '穷通宝鉴·论乙木·二月',
    },
    ('乙', '辰'): {
        'name': '癸水',
        'supporting': '丙火',
        'note': '阳气愈炽，先癸后丙，最忌己庚并见',
        'source': '穷通宝鉴·论乙木·三月',
    },
    ('乙', '巳'): {
        'name': '癸水',
        'supporting': '辛金',
        'note': '四月专取癸水为尊，辛透佐癸为清',
        'source': '穷通宝鉴·论乙木·四月',
    },
    ('乙', '午'): {
        'name': '癸水 / 丙火',
        'supporting': None,
        'note': '上半月用癸，下半月丙癸齐用',
        'source': '穷通宝鉴·论乙木·五月',
    },
    ('乙', '未'): {
        'name': '丙火',
        'supporting': '癸水',
        'note': '木性且寒，柱多金水，丙火为尊',
        'source': '穷通宝鉴·论乙木·六月',
    },
    ('乙', '申'): {
        'name': '己土',
        'supporting': '丙火',
        'note': '庚金乘令，喜己土为用，丙火辅之',
        'source': '穷通宝鉴·论乙木·七月',
    },
    ('乙', '酉'): {
        'name': '癸水 / 丙火',
        'supporting': None,
        'note': '白露后癸滋桂萼，秋分后喜丙向阳',
        'source': '穷通宝鉴·论乙木·八月',
    },
    ('乙', '戌'): {
        'name': '癸水',
        'supporting': '辛金',
        'note': '根枯叶落，必赖癸水滋养，辛金发源',
        'source': '穷通宝鉴·论乙木·九月',
    },
    ('乙', '亥'): {
        'name': '丙火',
        'supporting': '戊土',
        'note': '壬水司令，取丙为用，戊土次之',
        'source': '穷通宝鉴·论乙木·十月',
    },
    ('乙', '子'): {
        'name': '丙火',
        'supporting': None,
        'note': '花木寒冻，专用丙火解冻回春',
        'source': '穷通宝鉴·论乙木·十一月',
    },
    ('乙', '丑'): {
        'name': '丙火',
        'supporting': '己土',
        'note': '冬至后木寒，得丙透干，己土透更贵',
        'source': '穷通宝鉴·论乙木·十二月',
    },
}

# Filled in Task 3
GEJU_RULES: dict[str, list[dict]] = {}

# Filled in Task 4
FUYI_CASES: list[dict] = []
