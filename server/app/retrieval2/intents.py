"""Chart → :class:`QueryIntent` list.

This is the **only file** that knows BaZi chart shape. Retrieval core
consumes ``QueryIntent`` (text + tag constraints + weight + kind) and is
divination-system-agnostic.

What lived in v1 as routing tables is expressed here as structured query
construction — adding a new intent kind is a single ``_emit`` call.
"""
from __future__ import annotations

from typing import Iterable

from .types import QueryIntent

# Chart accessors — tolerant of v1's flat / nested shapes.


def _paipan(chart: dict) -> dict:
    if not isinstance(chart, dict):
        return {}
    return chart.get("PAIPAN") or chart


def _sizhu(chart: dict) -> dict:
    sz = _paipan(chart).get("sizhu") or {}
    return sz if isinstance(sz, dict) else {}


def _day_gan(chart: dict) -> str:
    p = _paipan(chart)
    meta = p.get("META") or {}
    rizhu = str(meta.get("rizhuGan") or p.get("rizhu") or "")
    if rizhu:
        return rizhu[0]
    day_gz = str(_sizhu(p).get("day") or "")
    return day_gz[:1] if day_gz else ""


def _month_zhi(chart: dict) -> str:
    month = str(_sizhu(chart).get("month") or "")
    return month[1:2] if len(month) >= 2 else ""


_SEASON_BY_ZHI = {
    "寅": "春", "卯": "春", "辰": "春",
    "巳": "夏", "午": "夏", "未": "夏",
    "申": "秋", "酉": "秋", "戌": "秋",
    "亥": "冬", "子": "冬", "丑": "冬",
}
_EXTREME_SEASON_ZHI = frozenset("巳午未亥子丑")


def _normalize_shishen(value: str | None) -> str:
    text = str(value or "")
    if not text:
        return ""
    for label in ("七杀", "正官", "偏官", "正财", "偏财", "食神", "伤官",
                  "正印", "偏印", "印绶", "比肩", "劫财", "建禄", "阳刃"):
        if label in text:
            return label
    if "财" in text:
        return "正财"
    if "印" in text:
        return "正印"
    if "煞" in text or "杀" in text:
        return "七杀"
    return ""


def _main_shishen(chart: dict) -> str:
    p = _paipan(chart)
    geju_obj = p.get("geJu") or p.get("ge_ju") or {}
    main = (
        (geju_obj.get("mainCandidate") if isinstance(geju_obj, dict) else None)
        or (geju_obj.get("main_candidate") if isinstance(geju_obj, dict) else None)
        or {}
    )
    if isinstance(main, dict):
        cand = _normalize_shishen(main.get("shishen") or main.get("name"))
        if cand:
            return cand
    return _normalize_shishen(p.get("geju"))


def _yongshen_candidates(chart: dict) -> list[dict]:
    detail = _paipan(chart).get("yongshenDetail") or {}
    if not isinstance(detail, dict):
        return []
    return [c for c in (detail.get("candidates") or []) if isinstance(c, dict)]


def _day_strength_label(chart: dict) -> str:
    raw = str(_paipan(chart).get("dayStrength") or "")
    if "极弱" in raw or "极衰" in raw:
        return "极弱"
    if "极强" in raw or "极旺" in raw:
        return "极强"
    if "弱" in raw or "衰" in raw or "轻" in raw:
        return "身弱"
    if "强" in raw or "旺" in raw:
        return "身强"
    if "中和" in raw or "平" in raw:
        return "中和"
    return ""


_DOMAIN_TABLE: dict[str, tuple[dict[str, tuple[str, ...]], str]] = {
    "meta":         ({"domain": ("用神取舍", "格局成败")}, "用神 格局 月令"),
    "career":       ({"domain": ("财官", "格局成败")}, "事业 财官 格局"),
    "wealth":       ({"domain": ("财官",)}, "财 偏财 正财"),
    "personality":  ({"domain": ("性情", "外貌")}, "性情 性格 五行刚柔"),
    "relationship": ({"domain": ("六亲",)}, "夫妻 婚姻 妻财 配偶"),
    "appearance":   ({"domain": ("外貌", "性情")}, "性情相貌 形体"),
    "health":       ({"domain": ("疾病",)}, "疾病 衰旺"),
    "timing":       ({"domain": ("行运",)}, "大运 流年 岁运"),
    "dayun_step":   ({"domain": ("行运", "用神取舍")}, "大运 用神"),
    "liunian":      ({"domain": ("行运",)}, "流年 岁运 太岁 行运"),
    "special_geju": ({"domain": ("格局成败",)}, "特殊格局 外格"),
    "other":        ({"domain": ("用神取舍",)}, ""),
}


def _emit(
    out: list[QueryIntent],
    *,
    text: str = "",
    constraints: dict[str, Iterable[str]] | None = None,
    weight: float = 1.0,
    kind: str = "generic",
) -> None:
    cleaned: dict[str, tuple[str, ...]] = {}
    for k, vs in (constraints or {}).items():
        tup = tuple(v for v in (vs or ()) if v)
        if tup:
            cleaned[k] = tup
    if not text and not cleaned:
        return
    out.append(QueryIntent(text=text, constraints=cleaned, weight=weight, kind=kind))


def bazi_chart_to_intents(
    chart: dict,
    kind: str = "meta",
    user_message: str | None = None,
) -> list[QueryIntent]:
    """Build the search intent list for a BaZi chart + intent kind."""
    p = _paipan(chart)
    out: list[QueryIntent] = []

    if kind == "chitchat":
        return out

    day_gan = _day_gan(p)
    month_zhi = _month_zhi(p)
    season = _SEASON_BY_ZHI.get(month_zhi, "")
    strength = _day_strength_label(p)
    main = _main_shishen(p)

    # 1. 调候 — 日干 × 月支 — always cheap & high-hit
    if day_gan or month_zhi:
        _emit(out,
            text=f"{day_gan or ''}日 {month_zhi or ''}月 调候 寒暖燥湿".strip(),
            constraints={
                "day_gan": (day_gan,) if day_gan else (),
                "month_zhi": (month_zhi,) if month_zhi else (),
                "yongshen_method": ("调候",),
            },
            weight=1.0, kind="tiaohou",
        )

    # 2. Main 格局
    if main:
        cons: dict[str, Iterable[str]] = {"shishen": (main,)}
        if strength:
            cons["day_strength"] = (strength,)
        _emit(out, text=f"{main} {strength}".strip(),
              constraints=cons, weight=1.0, kind="main_geju")

    # 3. 用神 candidates
    seen: set[str] = set()
    for cand in _yongshen_candidates(p):
        method = str(cand.get("method") or "").strip().split()[0] if cand.get("method") else ""
        name = str(cand.get("name") or "").strip()
        source = str(cand.get("source") or "").strip()
        if not method and not name:
            continue
        if method in seen:
            continue
        seen.add(method)
        cand_shishen = _normalize_shishen(name)
        cons = {}
        if method:
            cons["yongshen_method"] = (method,)
        if cand_shishen:
            cons["shishen"] = (cand_shishen,)
        text = " ".join(t for t in (method, name, source) if t)
        _emit(out, text=text, constraints=cons, weight=0.85,
              kind=f"yongshen.{method or 'unknown'}")

    # 4. Domain anchor for the intent kind
    dom_cons, dom_text = _DOMAIN_TABLE.get(kind, ({}, ""))
    if dom_cons or dom_text:
        _emit(out, text=dom_text, constraints=dom_cons, weight=0.7,
              kind=f"domain.{kind}")

    # 5. Extreme-season climate hint
    if month_zhi in _EXTREME_SEASON_ZHI:
        _emit(out, text="寒暖 调候 偏枯",
              constraints={"season": (season,) if season else (),
                           "yongshen_method": ("调候",)},
              weight=0.5, kind="climate.extreme")

    # 6. 七杀 + 身弱 — special combo
    if main == "七杀" and strength in {"身弱", "极弱"}:
        _emit(out, text="杀重身轻 用印 制煞 化煞",
              constraints={
                  "shishen": ("七杀", "正印", "偏印"),
                  "yongshen_method": ("通关", "扶抑"),
                  "day_strength": ("身弱", "极弱"),
              },
              weight=0.8, kind="combo.shaqing_yinzhong")

    # 7. User question — pure text
    if user_message:
        _emit(out, text=user_message[:200], weight=0.75, kind="user_msg")

    return out


__all__ = ["bazi_chart_to_intents"]
