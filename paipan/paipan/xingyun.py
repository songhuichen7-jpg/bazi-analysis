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
    """Filled in Task 3."""
    return None


def _detect_liuhe(zhi: str, mingju_zhis: list[str]) -> str | None:
    """Filled in Task 4."""
    return None


def _score_gan_to_yongshen(
    gan: str, ys_wuxing: str, mingju_gans: list[str]
) -> tuple[int, str, list[str]]:
    """Filled in Task 3. Returns (delta, reason_text, mechanism_tags)."""
    return (0, '', [])


def _score_zhi_to_yongshen(
    zhi: str, ys_wuxing: str, mingju_zhis: list[str]
) -> tuple[int, str, list[str]]:
    """Filled in Task 4."""
    return (0, '', [])


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
