"""Plan 7.3 — 用神 engine.

Public API:
  build_yongshen(rizhu_gan, month_zhi, force, geju, gan_he, day_strength) -> dict

Returns a dict with shape:
  {
    'primary': '<one-line label, e.g. "庚金 / 丁火">',
    'primaryReason': '<why this is primary>',
    'candidates': [
      {'method': '调候'|'格局'|'扶抑', 'name': str|None,
       'note': str, 'source': str, ...},
      ...
    ],
    'warnings': [str, ...]   # may be empty
  }

Spec: docs/superpowers/specs/2026-04-20-yongshen-engine-design.md
"""
from __future__ import annotations

from paipan.yongshen_data import TIAOHOU, GEJU_RULES, FUYI_CASES


_GEJU_ALIASES = {
    '建禄格': '比肩格',
    '月刃格': '劫财格',
    '阳刃格': '劫财格',
}


def tiaohou_yongshen(rizhu_gan: str, month_zhi: str) -> dict | None:
    """Return TIAOHOU entry or None if not strongly indicated."""
    entry = TIAOHOU.get((rizhu_gan, month_zhi))
    if not entry or not entry.get('name'):
        return None
    return {
        'method': '调候',
        'name': entry['name'],
        'supporting': entry.get('supporting'),
        'note': entry.get('note', ''),
        'source': entry.get('source', '穷通宝鉴'),
    }


def geju_yongshen(geju: str | None, force: dict, gan_he: dict) -> dict | None:
    """Return first matching GEJU_RULES entry or None if 格局 unknown/unclear."""
    if not geju:
        return None
    normalized_geju = _GEJU_ALIASES.get(geju, geju)
    rules = GEJU_RULES.get(normalized_geju, [])
    for rule in rules:
        cond = rule.get('condition')
        if cond and cond(force, gan_he):
            return {
                'method': '格局',
                'name': rule['name'],
                'sub_pattern': rule.get('sub_pattern'),
                'note': rule.get('note', ''),
                'source': rule.get('source', '子平真诠'),
            }
    return None


def fuyi_yongshen(force: dict, day_strength: str | None) -> dict | None:
    """Return matching FUYI_CASES entry or None for 中和."""
    if not day_strength:
        return None
    for case in FUYI_CASES:
        when = case.get('when')
        if when and when(force, day_strength):
            return {
                'method': '扶抑',
                'name': case['name'],
                'note': case.get('note', ''),
                'source': case.get('source', '滴天髓·衰旺'),
            }
    return None


def _empty_candidate(method: str, note: str = '本法无明确结论') -> dict:
    return {'method': method, 'name': None, 'note': note, 'source': ''}


def compose_yongshen(
    tiaohou: dict | None,
    geju: dict | None,
    fuyi: dict | None,
) -> dict:
    """Compose 3 candidates into final dict per spec §3.2.

    Composition rule:
      - 调候 == 格局 → primary = 调候.name, no warning
      - 调候 != 格局 (both present) → primary = 调候.name, warning '古籍两派各有取法'
      - only 格局 → primary = 格局.name
      - only 扶抑 → primary = 扶抑.name
      - none → primary = '中和（无明显偏枯）'
    """
    candidates = [
        tiaohou or _empty_candidate('调候', '本月调候不强烈'),
        geju or _empty_candidate('格局', '格局未定或无规则'),
        fuyi or _empty_candidate('扶抑', '中和'),
    ]
    warnings: list[str] = []

    if tiaohou and geju:
        if _names_match(tiaohou.get('name'), geju.get('name')):
            primary = tiaohou['name']
            primary_reason = '调候 + 格局共指'
        else:
            primary = tiaohou['name']
            primary_reason = '以调候为主'
            warnings.append('调候用神与格局用神不同 —— 古籍两派各有取法')
    elif tiaohou:
        primary = tiaohou['name']
        primary_reason = '调候法'
    elif geju:
        primary = geju['name']
        primary_reason = '格局法'
    elif fuyi:
        primary = fuyi['name']
        primary_reason = '扶抑法（前两法无明确结论）'
    else:
        primary = '中和（无明显偏枯）'
        primary_reason = '三法皆无强候选'

    return {
        'primary': primary,
        'primaryReason': primary_reason,
        'candidates': candidates,
        'warnings': warnings,
    }


def _names_match(a: str | None, b: str | None) -> bool:
    """Loose name match. v1 just exact-match. v1.5 may add wuxing equivalence."""
    if not a or not b:
        return False
    return a == b


def build_yongshen(
    rizhu_gan: str,
    month_zhi: str | None,
    force: dict,
    geju: str | None,
    gan_he: dict,
    day_strength: str | None,
) -> dict:
    """Top-level 用神 engine entry point. Composes 3 methods."""
    tiaohou = tiaohou_yongshen(rizhu_gan, month_zhi) if month_zhi else None
    geju_res = geju_yongshen(geju, force, gan_he)
    fuyi_res = fuyi_yongshen(force, day_strength)
    return compose_yongshen(tiaohou, geju_res, fuyi_res)
