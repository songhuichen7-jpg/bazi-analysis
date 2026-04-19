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

    # 丙火 (12 months)
    ('丙', '寅'): {
        'name': '壬水',
        'supporting': '庚金',
        'note': '三阳开泰，取壬为尊，庚金佐之',
        'source': '穷通宝鉴·论丙火·正月',
    },
    ('丙', '卯'): {
        'name': '壬水',
        'supporting': '己土',
        'note': '阳气舒升，专用壬水，无壬姑取己土',
        'source': '穷通宝鉴·论丙火·二月',
    },
    ('丙', '辰'): {
        'name': '壬水',
        'supporting': '甲木',
        'note': '土重晦光，用壬不可离，甲木为辅',
        'source': '穷通宝鉴·论丙火·三月',
    },
    ('丙', '巳'): {
        'name': '壬水',
        'supporting': '庚金',
        'note': '建禄炎炎，宜专用壬，得庚发水源',
        'source': '穷通宝鉴·论丙火·四月',
    },
    ('丙', '午'): {
        'name': '壬水',
        'supporting': '庚金',
        'note': '五月专用壬水，丁多兼看癸，申水亦妙',
        'source': '穷通宝鉴·论丙火·五月',
    },
    ('丙', '未'): {
        'name': '壬水',
        'supporting': '庚金',
        'note': '退气生寒，壬水为用，取庚辅佐',
        'source': '穷通宝鉴·论丙火·六月',
    },
    ('丙', '申'): {
        'name': '壬水',
        'supporting': '戊土',
        'note': '太阳转西，仍用壬水，壬多取戊制',
        'source': '穷通宝鉴·论丙火·七月',
    },
    ('丙', '酉'): {
        'name': '壬水',
        'supporting': '癸水',
        'note': '日近黄昏，仍用壬辅映，无壬癸亦可',
        'source': '穷通宝鉴·论丙火·八月',
    },
    ('丙', '戌'): {
        'name': '甲木',
        'supporting': '壬水',
        'note': '火气愈退，必须先甲后壬，癸亦可佐',
        'source': '穷通宝鉴·论丙火·九月',
    },
    ('丙', '亥'): {
        'name': '甲木 / 戊土 / 庚金',
        'supporting': '壬水',
        'note': '太阳失令，甲戊庚显，火旺再取壬',
        'source': '穷通宝鉴·论丙火·十月',
    },
    ('丙', '子'): {
        'name': '壬水',
        'supporting': '戊土',
        'note': '冬至一阳生，壬水为最，戊土佐之',
        'source': '穷通宝鉴·论丙火·十一月',
    },
    ('丙', '丑'): {
        'name': '壬水',
        'supporting': '甲木',
        'note': '气进二阳，喜壬为用，土多不可少甲',
        'source': '穷通宝鉴·论丙火·十二月',
    },

    # 丁火 (12 months)
    ('丁', '寅'): {
        'name': '庚金',
        'supporting': '壬水',
        'note': '甲木当权，非庚不能劈甲引丁，水亦不可无',
        'source': '穷通宝鉴·论丁火·正月',
    },
    ('丁', '卯'): {
        'name': '庚金',
        'supporting': '甲木',
        'note': '湿乙伤丁，先庚后甲，庚甲两透最清',
        'source': '穷通宝鉴·论丁火·二月',
    },
    ('丁', '辰'): {
        'name': '甲木',
        'supporting': '庚金',
        'note': '戊土司令，先用甲引丁制土，次看庚金',
        'source': '穷通宝鉴·论丁火·三月',
    },
    ('丁', '巳'): {
        'name': '庚金',
        'supporting': '甲木',
        'note': '乘旺取甲引丁，必用庚劈甲成木火通明',
        'source': '穷通宝鉴·论丁火·四月',
    },
    ('丁', '午'): {
        'name': '庚金 / 壬水',
        'supporting': '甲木',
        'note': '建禄火盛，火局取庚壬，无火局再用甲',
        'source': '穷通宝鉴·论丁火·五月',
    },
    ('丁', '未'): {
        'name': '甲木',
        'supporting': '壬水',
        'note': '阴柔退气，专取甲木，壬水次之',
        'source': '穷通宝鉴·论丁火·六月',
    },
    ('丁', '申'): {
        'name': '甲木 / 丙火',
        'supporting': '庚金',
        'note': '七月甲丙并用，申中有庚，仍取庚劈甲',
        'source': '穷通宝鉴·论丁火·七月',
    },
    ('丁', '酉'): {
        'name': '甲木 / 丙火 / 庚金',
        'supporting': None,
        'note': '三秋分论言八月甲丙庚皆用，无甲乙亦可',
        'source': '穷通宝鉴·论丁火·八月',
    },
    ('丁', '戌'): {
        'name': '甲木 / 庚金',
        'supporting': None,
        'note': '三秋分论言九月专用甲庚，甲透文书清贵',
        'source': '穷通宝鉴·论丁火·九月',
    },
    ('丁', '亥'): {
        'name': '甲木 / 庚金',
        'supporting': '癸水 / 戊土',
        'note': '三冬丁火微寒，甲木为尊，庚金佐之',
        'source': '穷通宝鉴·论丁火·十月',
    },
    ('丁', '子'): {
        'name': '甲木',
        'supporting': '庚金',
        'note': '仲冬虽有从杀支格，调候仍甲尊庚佐',
        'source': '穷通宝鉴·论丁火·十一月',
    },
    ('丁', '丑'): {
        'name': '甲木 / 庚金',
        'supporting': '癸水 / 戊土',
        'note': '三冬总论言甲为尊，庚佐之，癸戊权宜',
        'source': '穷通宝鉴·论丁火·十二月',
    },
}

# Filled in Task 3
GEJU_RULES: dict[str, list[dict]] = {}

# Filled in Task 4
FUYI_CASES: list[dict] = []
