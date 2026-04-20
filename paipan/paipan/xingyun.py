"""Plan 7.4 — 行运 scoring engine.

Public API:
  score_yun(yun_ganzhi, yongshen_primary, mingju_gans, mingju_zhis) -> dict
  build_xingyun(dayun, yongshen_detail, mingju_gans, mingju_zhis, current_year) -> dict

Spec: docs/superpowers/specs/2026-04-20-xingyun-engine-design.md
"""
from __future__ import annotations

from paipan.ganzhi import GAN_WUXING, ZHI_WUXING, WUXING_SHENG, WUXING_KE
from paipan.xingyun_data import GAN_HE_TABLE, ZHI_LIUHE_TABLE, SCORE_THRESHOLDS


def _classify_score(score: int) -> str:
    """5-bin classifier per spec §3.4.

    Bins: >=4 大喜, 2-3 喜, -1..1 平, -3..-2 忌, <=-4 大忌
    """
    if score >= SCORE_THRESHOLDS['大喜']:
        return '大喜'
    if score >= SCORE_THRESHOLDS['喜']:
        return '喜'
    if score >= -1:
        return '平'
    if score >= -3:
        return '忌'
    return '大忌'


def _extract_yongshen_wuxings(primary: str) -> list[str]:
    """Parse '甲木 / 戊土 / 庚金' → ['木','土','金']. Filled in Task 5."""
    return []   # stub


def _detect_ganhe(gan: str, mingju_gans: list[str]) -> str | None:
    """Detect 干合化 between yun_gan and any mingju gan.

    Returns the 化出 wuxing if any 命局干 forms a 五合 with `gan`, else None.
    Simplified: any-position pair (does NOT require adjacency).
    """
    for mg in mingju_gans:
        if mg == gan:
            continue   # self-pair doesn't count
        wx = GAN_HE_TABLE.get(frozenset({gan, mg}))
        if wx:
            return wx
    return None


def _detect_liuhe(zhi: str, mingju_zhis: list[str]) -> str | None:
    """Detect 地支六合 between yun_zhi and any mingju zhi.

    Returns the 化出 wuxing if any 命局支 forms a 六合 with `zhi`, else None.
    Simplified: any-position pair (does NOT require adjacency).
    """
    for mz in mingju_zhis:
        if mz == zhi:
            continue   # self-pair doesn't count
        wx = ZHI_LIUHE_TABLE.get(frozenset({zhi, mz}))
        if wx:
            return wx
    return None


def _score_gan_to_yongshen(
    gan: str, ys_wuxing: str, mingju_gans: list[str]
) -> tuple[int, str, list[str]]:
    """Score 大运/流年 干 against a single 用神 五行.

    Base scoring (per spec §3.3 step 2):
      - gan_wuxing == ys_wuxing → +1 (比助)
      - gan_wuxing 生 ys_wuxing → +2
      - ys_wuxing 生 gan_wuxing → -1 (用神被泄)
      - gan_wuxing 克 ys_wuxing → -2
      - ys_wuxing 克 gan_wuxing → 0 (中性)
      - else → 0

    干合化 modifier (spec §3.3):
      - 合化 五行 == ys_wuxing → +1
      - 合化 五行 生 ys_wuxing → +1
      - 合化 五行 克 ys_wuxing → -1

    Returns (delta, human-readable reason, list of structured mechanism tags).
    """
    gw = GAN_WUXING.get(gan)
    if gw is None:
        return (0, '未知干', [])

    base_delta = 0
    base_reason = ''
    base_mech: list[str] = []

    if gw == ys_wuxing:
        base_delta = 1
        base_reason = f'{gan}比助用神'
        base_mech.append('干·比助')
    elif WUXING_SHENG.get(gw) == ys_wuxing:
        base_delta = 2
        base_reason = f'{gan}生用神'
        base_mech.append('干·相生')
    elif WUXING_SHENG.get(ys_wuxing) == gw:
        base_delta = -1
        base_reason = f'用神被{gan}泄'
        base_mech.append('干·相泄')
    elif WUXING_KE.get(gw) == ys_wuxing:
        base_delta = -2
        base_reason = f'{gan}克用神'
        base_mech.append('干·相克')
    elif WUXING_KE.get(ys_wuxing) == gw:
        base_delta = 0
        base_reason = f'用神克{gan}'
        # No mechanism tag for this — neutral

    # 干合化 modifier
    he_wx = _detect_ganhe(gan, mingju_gans)
    if he_wx:
        if he_wx == ys_wuxing or WUXING_SHENG.get(he_wx) == ys_wuxing:
            base_delta += 1
            base_reason += f'，与命局合化{he_wx}转助'
            base_mech.append(f'干·合化转助·{he_wx}')
        elif WUXING_KE.get(he_wx) == ys_wuxing:
            base_delta -= 1
            base_reason += f'，与命局合化{he_wx}反克'
            base_mech.append(f'干·合化反克·{he_wx}')

    return (base_delta, base_reason, base_mech)


def _score_zhi_to_yongshen(
    zhi: str, ys_wuxing: str, mingju_zhis: list[str]
) -> tuple[int, str, list[str]]:
    """Score 大运/流年 支 (本气五行) against a single 用神 五行.

    Logic mirrors _score_gan_to_yongshen but uses ZHI_WUXING for base 五行
    and ZHI_LIUHE_TABLE for the合化 modifier.

    Returns (delta, reason, mechanisms).
    """
    zw = ZHI_WUXING.get(zhi)
    if zw is None:
        return (0, '未知支', [])

    base_delta = 0
    base_reason = ''
    base_mech: list[str] = []

    if zw == ys_wuxing:
        base_delta = 1
        base_reason = f'{zhi}比助用神'
        base_mech.append('支·比助')
    elif WUXING_SHENG.get(zw) == ys_wuxing:
        base_delta = 2
        base_reason = f'{zhi}生用神'
        base_mech.append('支·相生')
    elif WUXING_SHENG.get(ys_wuxing) == zw:
        base_delta = -1
        base_reason = f'用神被{zhi}泄'
        base_mech.append('支·相泄')
    elif WUXING_KE.get(zw) == ys_wuxing:
        base_delta = -2
        base_reason = f'{zhi}克用神'
        base_mech.append('支·相克')
    elif WUXING_KE.get(ys_wuxing) == zw:
        base_delta = 0
        base_reason = f'用神克{zhi}'

    # 六合 modifier
    he_wx = _detect_liuhe(zhi, mingju_zhis)
    if he_wx:
        if he_wx == ys_wuxing or WUXING_SHENG.get(he_wx) == ys_wuxing:
            base_delta += 1
            base_reason += f'，与命局六合化{he_wx}转助'
            base_mech.append(f'支·六合化{he_wx}·转助')
        elif WUXING_KE.get(he_wx) == ys_wuxing:
            base_delta -= 1
            base_reason += f'，与命局六合化{he_wx}反克'
            base_mech.append(f'支·六合化{he_wx}·反克')

    return (base_delta, base_reason, base_mech)


def score_yun(
    yun_ganzhi: str,
    yongshen_primary: str,
    mingju_gans: list[str],
    mingju_zhis: list[str],
) -> dict:
    """Score one 大运/流年 ganzhi against 命局 用神. Filled in Task 5."""
    return {
        'label': '平',
        'score': 0,
        'note': '',
        'mechanisms': [],
        'gan_effect': {'delta': 0, 'reason': ''},
        'zhi_effect': {'delta': 0, 'reason': ''},
        'winningYongshenElement': None,
    }


def build_xingyun(
    dayun: dict,
    yongshen_detail: dict,
    mingju_gans: list[str],
    mingju_zhis: list[str],
    current_year: int,
) -> dict:
    """Batch entry. Filled in Task 6.

    Returns:
        {
          'dayun': [...8 条...],
          'liunian': {str(idx): [...10 条...]},
          'currentDayunIndex': int | None,
          'yongshenSnapshot': str,
        }
    """
    return {
        'dayun': [],
        'liunian': {},
        'currentDayunIndex': None,
        'yongshenSnapshot': (yongshen_detail or {}).get('primary', ''),
    }
