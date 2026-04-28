"""Retrieval service — kind-routed classical excerpt selection.

Port of archive/server-mvp/retrieval.js:179-340 (retrieveForChart + intent
dispatch tables).

Budget constants:
    PER_SOURCE_MAX = 4000      # max chars per book
    TOTAL_MAX = 20000          # aggregate budget across all sources
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import TypedDict

from app.prompts.loader import _repo_root
from app.retrieval.loader import (
    GAN_WUXING,
    ZHI_TO_MONTH,
    _extract_qiongtong_section_detail,
    extract_by_heading,
    read_classic,
    strip_frontmatter,
)

# NOTE: retrieval.js:193-194
PER_SOURCE_MAX = 4000
TOTAL_MAX = 20000
FOCUSED_SOURCE_MAX = 900


class RetrievalHit(TypedDict):
    source: str
    scope: str
    chars: int
    text: str


CONTEXT_ROUTE_MIN_SCORE = 45
CONTEXT_ROUTE_MAX = 12


# NOTE: retrieval.js:90-131 — intent → list of retrieval strategies
INTENT_ROUTES: dict[str, list[dict]] = {
    "meta": [
        {"file": "ziping-zhenquan/08_lun-yong-shen.md", "label": "子平真诠·论用神"},
    ],
    "career": [
        {"file": "ziping-zhenquan/08_lun-yong-shen.md", "label": "子平真诠·论用神"},
    ],
    "wealth": [
        {"file": "ziping-zhenquan/08_lun-yong-shen.md", "label": "子平真诠·论用神"},
    ],
    "timing": [
        {"file": "ziping-zhenquan/08_lun-yong-shen.md", "label": "子平真诠·论用神"},
    ],
    "relationship": [
        {"file": "ditian-sui/liu-qin-lun_01_fu-qi.md", "label": "滴天髓·夫妻"},
        {"file": "ziping-zhenquan/23_lun-gong-fen-yong-shen-pei-liu-qin.md", "label": "子平真诠·宫分六亲"},
    ],
    "personality": [
        {"file": "ditian-sui/liu-qin-lun_24_xing-qing.md", "label": "滴天髓·性情"},
    ],
    "health": [
        {"file": "ditian-sui/tong-shen-lun_17_shuai-wang.md", "label": "滴天髓·衰旺"},
    ],
    "dayun_step": [
        {"file": "ziping-zhenquan/08_lun-yong-shen.md", "label": "子平真诠·论用神"},
    ],
    "liunian": [],      # fast model, token-tight → only qiongtong
    "chitchat": [],
    "other": [],
    "appearance": [
        {"file": "sanming-tonghui/juan-07.md", "label": "三命通会·卷七·论性情相貌",
         "extractHeading": "論性情相貌"},
    ],
    "special_geju": [
        {"file": "sanming-tonghui/juan-06.md", "label": "三命通会·卷六·特殊格局",
         "extractByMessageKeyword": True},
        {"file": "yuanhai-ziping/09_shen-sha_yang-ren-ji-ren-ri-gui-ri-de-kui-gang-jin-shen.md",
         "label": "渊海子平·论阳刃日刃魁罡金神"},
    ],
}

# NOTE: retrieval.js:133-150 — user-message keywords → 三命通会 卷六 section headings
SANMING_GEJU_KEYWORDS: dict[str, list[str]] = {
    "飞天禄马": ["飛天禄馬", "飛天"],
    "倒冲":     ["倒冲", "衝合"],
    "井栏叉":   ["井欄", "井栏"],
    "六阴朝阳": ["六隂朝陽", "六阴"],
    "六乙鼠贵": ["六乙䑕貴", "六乙鼠"],
    "朝阳格":   ["朝陽", "朝阳"],
    "金神":     ["金神"],
    "魁罡":     ["魁罡"],
    "日刃":     ["日刃"],
    "日德":     ["日德"],
    "日贵":     ["日貴", "日贵"],
    "从格":     ["弃命", "從"],
    "专旺":     ["專旺", "专旺"],
    "曲直":     ["曲直"],
}

# NOTE: retrieval.js:153-166 — 十神 keyword → chapter file
SHISHEN_CHAPTER: dict[str, str] = {
    "七杀": "ziping-zhenquan/39_lun-pian-guan.md",
    "偏官": "ziping-zhenquan/39_lun-pian-guan.md",
    "正官": "ziping-zhenquan/31_lun-zheng-guan.md",
    "正财": "ziping-zhenquan/33_lun-cai.md",
    "偏财": "ziping-zhenquan/33_lun-cai.md",
    "食神": "ziping-zhenquan/37_lun-shi-shen.md",
    "伤官": "ziping-zhenquan/41_lun-shang-guan.md",
    "正印": "ziping-zhenquan/35_lun-yin-shou.md",
    "偏印": "ziping-zhenquan/35_lun-yin-shou.md",
    "印绶": "ziping-zhenquan/35_lun-yin-shou.md",
    "阳刃": "ziping-zhenquan/43_lun-yang-ren.md",
    "建禄": "ziping-zhenquan/45_lun-jian-lu-yue-jie.md",
}

# NOTE: retrieval.js:168-177 — chapter file → display label
SHISHEN_LABEL: dict[str, str] = {
    "ziping-zhenquan/39_lun-pian-guan.md":       "子平真诠·论偏官（七杀）",
    "ziping-zhenquan/31_lun-zheng-guan.md":       "子平真诠·论正官",
    "ziping-zhenquan/33_lun-cai.md":              "子平真诠·论财",
    "ziping-zhenquan/37_lun-shi-shen.md":         "子平真诠·论食神",
    "ziping-zhenquan/41_lun-shang-guan.md":       "子平真诠·论伤官",
    "ziping-zhenquan/35_lun-yin-shou.md":         "子平真诠·论印绶",
    "ziping-zhenquan/43_lun-yang-ren.md":         "子平真诠·论阳刃",
    "ziping-zhenquan/45_lun-jian-lu-yue-jie.md":  "子平真诠·论建禄月劫",
}

SOURCE_ROUTE_ALIASES: dict[str, dict] = {
    "滴天髓·衰旺": {
        "file": "ditian-sui/tong-shen-lun_17_shuai-wang.md",
        "label": "滴天髓·衰旺",
        "focusTerms": ["衰旺", "旺则", "衰则", "得时", "失令", "通根", "身弱", "身旺"],
        "maxChars": 900,
    },
    "滴天髓·寒暖": {
        "file": "ditian-sui/tong-shen-lun_29_han-nuan.md",
        "label": "滴天髓·寒暖",
        "focusTerms": ["寒暖", "调候", "冬", "夏", "火", "水"],
        "maxChars": 850,
    },
    "滴天髓·燥湿": {
        "file": "ditian-sui/tong-shen-lun_30_zao-shi.md",
        "label": "滴天髓·燥湿",
        "focusTerms": ["燥湿", "调候", "湿", "燥", "土"],
        "maxChars": 850,
    },
    "子平真诠·论用神": {
        "file": "ziping-zhenquan/08_lun-yong-shen.md",
        "label": "子平真诠·论用神",
        "focusTerms": ["用神", "月令", "善", "不善", "顺用", "逆用"],
        "maxChars": 900,
    },
    "子平真诠·论用神成败救应": {
        "file": "ziping-zhenquan/09_lun-yong-shen-cheng-bai-jiu-ying.md",
        "label": "子平真诠·论用神成败救应",
        "focusTerms": ["成败", "救应", "七煞逢财", "煞逢食制", "印来护煞"],
        "maxChars": 900,
    },
    "子平真诠·论用神格局高低": {
        "file": "ziping-zhenquan/12_lun-yong-shen-ge-ju-gao-di.md",
        "label": "子平真诠·论用神格局高低",
        "focusTerms": ["格局", "高低", "清", "有情", "无情"],
        "maxChars": 850,
    },
    "子平真诠·论用神配气候得失": {
        "file": "ziping-zhenquan/14_lun-yong-shen-pei-qi-hou-de-shi.md",
        "label": "子平真诠·论用神配气候得失",
        "focusTerms": ["气候", "调候", "寒", "暖", "燥", "湿"],
        "maxChars": 850,
    },
    "子平真诠·论印绶": {
        "file": "ziping-zhenquan/35_lun-yin-shou.md",
        "label": "子平真诠·论印绶",
        "focusTerms": ["印绶", "生身", "偏官", "七煞", "身轻印重"],
        "maxChars": 900,
    },
    "滴天髓·理气": {
        "file": "ditian-sui/tong-shen-lun_05_li-qi.md",
        "label": "滴天髓·理气",
        "focusTerms": ["理气", "杀重身轻", "用火敌杀", "甲木", "庚金", "丁火"],
        "maxChars": 900,
    },
    "滴天髓·通关": {
        "file": "ditian-sui/tong-shen-lun_20_tong-guan.md",
        "label": "滴天髓·通关",
        "focusTerms": ["通关", "杀重喜印", "官煞", "印"],
        "maxChars": 900,
    },
}

EXTREME_SEASON_ZHI = set("巳午未亥子丑")
EARTH_MONTH_ZHI = set("辰戌丑未")
GANZHI_PAIR_RE = re.compile(r"[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]")
GANZHI_ONLY_RE = re.compile(r"^(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]){1,10}$")


SHISHEN_FOCUS_TERMS: dict[str, list[str]] = {
    "七杀": ["七杀", "七煞", "偏官", "煞", "制煞", "食制", "用印", "身轻"],
    "偏官": ["七杀", "七煞", "偏官", "煞", "制煞", "食制", "用印", "身轻"],
    "正官": ["正官", "官星", "官", "清纯", "财印"],
    "正财": ["财", "财旺", "生官", "佩印", "食生", "财格"],
    "偏财": ["财", "财旺", "生官", "佩印", "食生", "财格"],
    "食神": ["食神", "食", "生财", "制煞", "泄秀"],
    "伤官": ["伤官", "伤", "佩印", "生财", "伤官格"],
    "正印": ["印绶", "印", "生身", "用煞", "官星", "身轻"],
    "偏印": ["印绶", "印", "生身", "用煞", "官星", "身轻"],
    "印绶": ["印绶", "印", "生身", "用煞", "官星", "身轻"],
    "阳刃": ["阳刃", "刃", "官煞", "食伤"],
    "建禄": ["建禄", "月劫", "禄", "财官", "食伤"],
}


# NOTE: retrieval.js:179-187 — pick 十神-specific chapter if user message mentions one
def pick_meta_classic(user_message: str | None) -> dict | None:
    if not user_message:
        return None
    for kw, file in SHISHEN_CHAPTER.items():
        if kw in user_message:
            label = SHISHEN_LABEL.get(file, "子平真诠·" + kw)
            return {"file": file, "label": label}
    return None


def _chart_paipan(chart: dict) -> dict:
    return (chart.get("PAIPAN") or chart) if isinstance(chart, dict) else {}


def _sizhu(chart: dict) -> dict:
    paipan = _chart_paipan(chart)
    return (paipan.get("sizhu") or {}) if isinstance(paipan.get("sizhu"), dict) else {}


def _day_gan(chart: dict) -> str:
    paipan = _chart_paipan(chart)
    meta = paipan.get("META") or {}
    rizhu = str(meta.get("rizhuGan") or paipan.get("rizhu") or "")
    if rizhu:
        return rizhu[0]
    day_gz = str(_sizhu(paipan).get("day") or "")
    return day_gz[0] if day_gz else ""


def _month_zhi(chart: dict) -> str:
    month_gz = str(_sizhu(chart).get("month") or "")
    return month_gz[1] if len(month_gz) >= 2 else ""


def _month_label(chart: dict) -> str:
    month_zhi = _month_zhi(chart)
    return (ZHI_TO_MONTH.get(month_zhi) or {}).get("num", "")


def _gan_element_label(gan: str) -> str:
    return gan + GAN_WUXING.get(gan, "") if gan else ""


def _normalize_shishen(value: str | None) -> str:
    text = str(value or "")
    if "七杀" in text:
        return "七杀"
    if "偏官" in text:
        return "偏官"
    for key in SHISHEN_CHAPTER:
        if key in text:
            return key
    if "财" in text:
        return "正财" if "正财" in text else "偏财" if "偏财" in text else "正财"
    if "印" in text:
        return "正印" if "正印" in text else "偏印" if "偏印" in text else "印绶"
    return ""


def _merge_terms(*groups: list[str] | tuple[str, ...] | None) -> list[str]:
    out: list[str] = []
    for group in groups:
        if not group:
            continue
        for value in group:
            text = str(value or "").strip()
            if text and text not in out:
                out.append(text)
    return out


def _shishen_focus_terms(shishen: str) -> list[str]:
    normalized = _normalize_shishen(shishen)
    return SHISHEN_FOCUS_TERMS.get(normalized, [normalized] if normalized else [])


def _route_for_shishen(shishen: str, score: int) -> dict | None:
    normalized = _normalize_shishen(shishen)
    file = SHISHEN_CHAPTER.get(normalized)
    if not file:
        return None
    return {
        "file": file,
        "label": SHISHEN_LABEL.get(file, "子平真诠·" + normalized),
        "score": score,
        "focusTerms": _shishen_focus_terms(normalized),
        "maxChars": 900,
    }


def _route_for_source(source: str, score: int) -> dict | None:
    text = str(source or "")
    for alias, route in SOURCE_ROUTE_ALIASES.items():
        if alias in text:
            return {**route, "score": score}
    if "子平真诠" in text:
        shishen = _normalize_shishen(text)
        route = _route_for_shishen(shishen, score)
        if route:
            return route
    return None


def _main_shishen(chart: dict) -> str:
    paipan = _chart_paipan(chart)
    geju_obj = paipan.get("geJu") or paipan.get("ge_ju") or {}
    main = geju_obj.get("mainCandidate") or geju_obj.get("main_candidate") or {}
    from_main = _normalize_shishen(main.get("shishen") or main.get("name"))
    if from_main:
        return from_main
    return _normalize_shishen(paipan.get("geju"))


def _strong_shishen(chart: dict, limit: int = 2) -> list[str]:
    paipan = _chart_paipan(chart)
    force = paipan.get("force") or {}
    scores = force.get("scores") or {}
    if not isinstance(scores, dict):
        return []
    ranked = sorted(
        ((name, float(score or 0)) for name, score in scores.items()),
        key=lambda item: item[1],
        reverse=True,
    )
    out: list[str] = []
    for name, score in ranked:
        if score <= 0:
            continue
        normalized = _normalize_shishen(name)
        if normalized and normalized not in out:
            out.append(normalized)
        if len(out) >= limit:
            break
    return out


def _yongshen_sources(chart: dict) -> list[str]:
    paipan = _chart_paipan(chart)
    detail = paipan.get("yongshenDetail") or {}
    candidates = detail.get("candidates") if isinstance(detail, dict) else []
    if not isinstance(candidates, list):
        return []
    return [str(item.get("source") or "") for item in candidates if isinstance(item, dict)]


def _chart_focus_terms(chart: dict) -> list[str]:
    paipan = _chart_paipan(chart)
    terms: list[str] = []

    day_gan = _day_gan(paipan)
    if day_gan:
        terms.append(day_gan)

    for key in ("geju", "dayStrength", "yongshen"):
        value = str(paipan.get(key) or "").strip()
        if value:
            terms.append(value)
            normalized = _normalize_shishen(value)
            terms.extend(_shishen_focus_terms(normalized))

    main = _main_shishen(paipan)
    terms.extend(_shishen_focus_terms(main))

    force = paipan.get("force") or {}
    scores = force.get("scores") or {}
    if isinstance(scores, dict):
        for name in scores:
            terms.extend(_shishen_focus_terms(str(name)))

    detail = paipan.get("yongshenDetail") or {}
    if isinstance(detail, dict):
        for key in ("primary", "supporting", "primaryReason"):
            value = str(detail.get(key) or "").strip()
            if value:
                terms.append(value)
        candidates = detail.get("candidates") or []
        if isinstance(candidates, list):
            for item in candidates:
                if not isinstance(item, dict):
                    continue
                for key in ("name", "supporting", "source", "sub_pattern"):
                    value = str(item.get(key) or "").strip()
                    if value:
                        terms.append(value)
                        terms.extend(_shishen_focus_terms(value))

    strength = str(paipan.get("dayStrength") or "")
    if "弱" in strength or "轻" in strength:
        terms.extend(["身轻", "衰", "失令", "帮身", "生身"])
    if "旺" in strength or "强" in strength:
        terms.extend(["身强", "旺", "得时", "泄", "伤"])

    return _merge_terms(terms)


def _chart_search_terms(chart: dict) -> list[str]:
    paipan = _chart_paipan(chart)
    sizhu = _sizhu(paipan)
    terms: list[str] = []

    day_gan = _day_gan(paipan)
    month_label = _month_label(paipan)
    if day_gan:
        terms.extend([day_gan, _gan_element_label(day_gan)])
        if month_label:
            terms.append(month_label + _gan_element_label(day_gan))

    for ganzhi in sizhu.values():
        text = str(ganzhi or "")
        if text:
            terms.append(text)
        if text[:1]:
            terms.append(_gan_element_label(text[:1]))

    for key in ("geju", "dayStrength", "yongshen"):
        value = str(paipan.get(key) or "").strip()
        if value:
            terms.append(value)

    main = _main_shishen(paipan)
    terms.extend(_shishen_focus_terms(main))
    strength = str(paipan.get("dayStrength") or "")
    if main in {"七杀", "偏官"}:
        terms.extend(["七杀", "七煞", "偏官", "制煞", "化煞", "用印", "官杀"])
        if "弱" in strength or "轻" in strength:
            terms.extend(["杀重身轻", "煞重身轻", "杀重喜印", "煞重喜印", "身轻印重", "用火敌杀"])

    primary = str((paipan.get("yongshenDetail") or {}).get("primary") or paipan.get("yongshen") or "")
    if primary:
        terms.append(primary)
        if day_gan == "甲" and "丁" in primary:
            terms.extend(["丁火", "庚金", "甲木休困", "用火敌杀"])

    detail = paipan.get("yongshenDetail") or {}
    candidates = detail.get("candidates") if isinstance(detail, dict) else []
    if isinstance(candidates, list):
        for item in candidates:
            if not isinstance(item, dict):
                continue
            for key in ("name", "supporting", "sub_pattern", "source", "note"):
                value = str(item.get(key) or "").strip()
                if value:
                    terms.append(value)
                    terms.extend(_shishen_focus_terms(value))

    return _merge_terms(terms)


BOOK_LABELS: dict[str, str] = {
    "ditian-sui": "滴天髓",
    "qiongtong-baojian": "穷通宝鉴",
    "ziping-zhenquan": "子平真诠",
    "sanming-tonghui": "三命通会",
    "yuanhai-ziping": "渊海子平",
}


def _clean_classic_title(title: str, fallback: str) -> str:
    text = re.sub(r"^#{1,6}\s*", "", title).strip()
    text = re.sub(r"^[一二三四五六七八九十百\d]+[、.．]\s*", "", text).strip()
    return text or fallback


def _source_label_from_file(file: str, content: str) -> str:
    book = BOOK_LABELS.get(file.split("/", 1)[0], "古籍")
    title = ""
    for line in content.splitlines():
        if line.startswith("#"):
            title = _clean_classic_title(line, file.rsplit("/", 1)[-1].replace(".md", ""))
            break
    return book + "·" + title if title else book


@lru_cache(maxsize=1)
def _classic_search_index() -> tuple[dict, ...]:
    root = _repo_root() / "classics"
    rows: list[dict] = []
    for path in sorted(root.glob("*/*.md")):
        rel = path.relative_to(root).as_posix()
        if rel.startswith("qiongtong-baojian/") or rel.endswith("/00_mu-lu.md") or rel.endswith("/00_readme.md"):
            continue
        if not (
            rel.startswith("ziping-zhenquan/")
            or rel.startswith("yuanhai-ziping/")
            or rel.startswith("ditian-sui/tong-shen-lun_")
        ):
            continue
        content = read_classic(rel)
        if not content:
            continue
        label = _source_label_from_file(rel, content)
        for index, paragraph in enumerate(_classic_paragraphs(content)):
            if len(paragraph) < 18:
                continue
            rows.append({"file": rel, "label": label, "index": index, "text": paragraph})
    return tuple(rows)


def _search_score(paragraph: str, terms: list[str]) -> int:
    score = 0
    term_set = set(terms)
    for term in terms:
        if len(term) < 2 or term in {"财", "印", "煞", "伤", "官星"}:
            continue
        if term in paragraph:
            score += 14 if len(term) >= 4 else 8
    has = paragraph.__contains__
    if "甲木休困" in term_set and has("甲木") and has("庚金") and has("丁火"):
        score += 40
    if ("杀重身轻" in term_set or "煞重身轻" in term_set) and (has("杀重身轻") or has("煞重身轻")):
        score += 35
    if ("用火敌杀" in term_set and has("用火敌杀")) or has("制煞") or has("化煞"):
        score += 25
    if (
        ("杀重喜印" in term_set and has("杀重喜印"))
        or ("煞重喜印" in term_set and has("煞重喜印"))
        or ("身轻印重" in term_set and has("身轻印重"))
    ):
        score += 25
    if _looks_like_case_paragraph(paragraph):
        score -= 30
    if len(paragraph) > 800:
        score -= 8
    return score


def _lexical_routes(chart: dict, limit: int = 3) -> list[dict]:
    terms = _chart_search_terms(chart)
    if not terms:
        return []

    best_by_file: dict[str, tuple[int, dict]] = {}
    for row in _classic_search_index():
        score = _search_score(row["text"], terms)
        if score < 45:
            continue
        current = best_by_file.get(row["file"])
        if current is None or score > current[0]:
            best_by_file[row["file"]] = (score, row)

    routes: list[dict] = []
    for score, row in sorted(best_by_file.values(), key=lambda item: item[0], reverse=True):
        routes.append({
            "file": row["file"],
            "label": row["label"],
            "score": min(98, score),
            "exactText": row["text"],
        })
        if len(routes) >= limit:
            break
    return routes


def _has_tiaohou(chart: dict) -> bool:
    paipan = _chart_paipan(chart)
    detail = paipan.get("yongshenDetail") or {}
    if not isinstance(detail, dict):
        return False
    text = " ".join([
        str(detail.get("primaryReason") or ""),
        " ".join(_yongshen_sources(paipan)),
    ])
    return "调候" in text or "穷通宝鉴" in text


def _add_route(routes: list[dict], route: dict | None) -> None:
    if not route:
        return
    if route.get("score", 0) < CONTEXT_ROUTE_MIN_SCORE:
        return
    routes.append(route)


def _context_routes(chart: dict, intent: str, user_message: str | None) -> list[dict]:
    if intent == "chitchat":
        return []

    routes: list[dict] = []
    picked = pick_meta_classic(user_message)
    if picked:
        _add_route(routes, {**picked, "score": 110})

    if intent in {"meta", "other", "career", "wealth", "personality", "dayun_step"}:
        main = _main_shishen(chart)
        _add_route(routes, _route_for_shishen(main, 100))

        for source in _yongshen_sources(chart):
            _add_route(routes, _route_for_source(source, 92))

        strength = str(_chart_paipan(chart).get("dayStrength") or "")
        if main in {"七杀", "偏官"} and ("弱" in strength or "轻" in strength):
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["子平真诠·论印绶"], "score": 96})
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["子平真诠·论用神成败救应"], "score": 88})
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["滴天髓·通关"], "score": 84})

        for route in _lexical_routes(chart):
            _add_route(routes, route)

        for shishen in _strong_shishen(chart):
            _add_route(routes, _route_for_shishen(shishen, 70))

        if _chart_paipan(chart).get("geju"):
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["子平真诠·论用神格局高低"], "score": 62})

        month_zhi = _month_zhi(chart)
        if _has_tiaohou(chart) or month_zhi in EXTREME_SEASON_ZHI:
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["子平真诠·论用神配气候得失"], "score": 68})
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["滴天髓·寒暖"], "score": 58})
        if month_zhi in EARTH_MONTH_ZHI:
            _add_route(routes, {**SOURCE_ROUTE_ALIASES["滴天髓·燥湿"], "score": 56})

    return sorted(routes, key=lambda route: route.get("score", 0), reverse=True)


# NOTE: retrieval.js:233-239
def pick_geju_keyword(user_message: str | None) -> list[str] | None:
    if not user_message:
        return None
    for asked_kw, headings in SANMING_GEJU_KEYWORDS.items():
        if asked_kw in user_message:
            return headings
    return None


def _clean_classic_line(line: str) -> str:
    text = line.strip()
    text = re.sub(r"^>\s*", "", text)
    text = text.replace("**", "").replace("`", "")
    return text.strip()


def _is_classic_meta_line(line: str) -> bool:
    if not line:
        return True
    if re.match(r"^#{1,6}\s+", line):
        return True
    if re.match(r"^[-*_]{3,}$", line):
        return True
    return bool(re.match(r"^(来源|作者|原著|评注)[:：]", line))


def _split_sentences(text: str, target: int = 360) -> list[str]:
    if len(text) <= target:
        return [text]

    sentences = [item.strip() for item in re.findall(r"[^。！？；;]+[。！？；;]?", text) if item.strip()]
    if not sentences:
        return [text[i:i + target].strip() for i in range(0, len(text), target) if text[i:i + target].strip()]

    chunks: list[str] = []
    buf = ""
    for sentence in sentences:
        if len(sentence) > target:
            if buf:
                chunks.append(buf)
                buf = ""
            chunks.extend(
                sentence[i:i + target].strip()
                for i in range(0, len(sentence), target)
                if sentence[i:i + target].strip()
            )
            continue
        if buf and len(buf) + len(sentence) > target:
            chunks.append(buf)
            buf = sentence
        else:
            buf += sentence
    if buf:
        chunks.append(buf)
    return chunks


def _classic_paragraphs(text: str) -> list[str]:
    paragraphs: list[str] = []
    for raw_line in strip_frontmatter(text).splitlines():
        line = _clean_classic_line(raw_line)
        if _is_classic_meta_line(line):
            continue
        paragraphs.extend(_split_sentences(line))
    return [paragraph for paragraph in paragraphs if paragraph]


def _ganzi_count(text: str) -> int:
    return len(GANZHI_PAIR_RE.findall(text))


def _looks_like_case_paragraph(paragraph: str) -> bool:
    compact = re.sub(r"[\s　、，,；;。:：]+", "", paragraph)
    if not compact:
        return True
    conceptual_markers = (
        "有用偏官者",
        "有七煞用印者",
        "煞重身轻",
        "杀重身轻",
        "身轻印重",
        "杀重喜印",
        "用火敌杀",
    )
    if any(marker in compact for marker in conceptual_markers):
        return False
    if GANZHI_ONLY_RE.fullmatch(compact):
        return True
    if re.match(r"^[甲乙丙丁戊己庚辛壬癸][木火土金水]?生于[正一二三四五六七八九十冬腊寅卯辰巳午未申酉戌亥子丑]+月", compact):
        return True
    if len(compact) <= 18 and _ganzi_count(compact) >= 2:
        return True
    if re.match(r"^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]日生", compact):
        return True
    if compact.startswith(("此造", "此丙", "此丁", "此戊", "此己", "此庚", "此辛", "此壬", "此癸", "此甲", "此乙")):
        return True
    if _ganzi_count(compact) >= 6 and any(marker in compact for marker in ("命", "运", "日生", "此造")):
        return True
    return False


def _term_variants(term: str) -> list[str]:
    text = str(term or "").strip()
    if not text:
        return []
    variants = [text]
    normalized = _normalize_shishen(text)
    if normalized:
        variants.extend(_shishen_focus_terms(normalized))
    if "七杀" in text:
        variants.extend(["七煞", "偏官", "煞"])
    if "偏官" in text:
        variants.extend(["七杀", "七煞", "煞"])
    if "身弱" in text:
        variants.extend(["身轻", "衰", "失令"])
    if "身旺" in text or "身强" in text:
        variants.extend(["身强", "旺", "得时"])
    if len(text) >= 2 and text[-1] in "木火土金水":
        variants.append(text[:-1])
    return _merge_terms(variants)


def _paragraph_score(paragraph: str, terms: list[str], index: int) -> int:
    score = 0
    for term in terms:
        for variant in _term_variants(term):
            if not variant:
                continue
            if variant in paragraph:
                score += 10 if len(variant) > 1 else 3
    if index < 3:
        score += 6
    if "原注" in paragraph or "任氏曰" in paragraph:
        score += 4
    if "不可执一" in paragraph or "真机" in paragraph or "月令" in paragraph:
        score += 3
    if _ganzi_count(paragraph) >= 3:
        score -= 4
    return score


def _trim_to_limit(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    cut = max(
        text.rfind("。", 0, max_chars - 6),
        text.rfind("；", 0, max_chars - 6),
        text.rfind("\n\n", 0, max_chars - 6),
    )
    if cut < max_chars * 0.55:
        cut = max_chars - 6
    return text[:cut + 1].rstrip() + "\n…(节选)"


def focus_classic_text(
    text: str,
    focus_terms: list[str] | None = None,
    max_chars: int = FOCUSED_SOURCE_MAX,
    *,
    include_anchor: bool = True,
) -> str:
    """Shape a full classical chapter into a few display-safe evidence paragraphs."""
    paragraphs = _classic_paragraphs(text)
    usable = [(idx, paragraph) for idx, paragraph in enumerate(paragraphs) if not _looks_like_case_paragraph(paragraph)]
    if not usable:
        return _trim_to_limit(strip_frontmatter(text), max_chars)

    selected: dict[int, str] = {}
    terms = _merge_terms(focus_terms or [])
    if include_anchor or not terms:
        anchor_chars = 0
        for idx, paragraph in usable:
            selected[idx] = paragraph
            anchor_chars += len(paragraph)
            if len(selected) >= 2 or anchor_chars >= max_chars * 0.45:
                break

    ranked = sorted(
        (
            (_paragraph_score(paragraph, terms, idx), idx, paragraph)
            for idx, paragraph in usable
            if idx not in selected
        ),
        key=lambda item: (-item[0], item[1]),
    )

    for score, idx, paragraph in ranked:
        if score <= 0 and len(selected) >= 2:
            continue
        trial = "\n\n".join(
            text for _, text in sorted({**selected, idx: paragraph}.items(), key=lambda item: item[0])
        )
        if len(trial) > max_chars * 1.2 and selected:
            continue
        selected[idx] = paragraph
        if len(_trim_to_limit(trial, max_chars)) >= max_chars * 0.85:
            break

    if not selected:
        idx, paragraph = usable[0]
        selected[idx] = paragraph

    ordered = sorted(selected.items(), key=lambda item: item[0]) if include_anchor else selected.items()
    focused = "\n\n".join(text for _, text in ordered)
    return _trim_to_limit(focused, max_chars)


# NOTE: retrieval.js:241-268 — budget-aware file loader
def load_classic_file(file: str, label: str, opts: dict | None = None) -> RetrievalHit | None:
    if opts is None:
        opts = {}
    full = read_classic(file)
    if not full:
        return None

    body: str | None = None
    scope = "full"

    extract_heading = opts.get("extractHeading")
    heading_candidates = opts.get("headingCandidates")
    exact_text = opts.get("exactText")

    if exact_text:
        body = str(exact_text)
        scope = "full"
    elif extract_heading:
        sec = extract_by_heading(full, extract_heading)
        if sec:
            body = sec
            scope = "heading:" + extract_heading
    elif heading_candidates:
        for kw in heading_candidates:
            sec = extract_by_heading(full, kw)
            if sec:
                body = sec
                scope = "heading:" + kw
                break

    if body is None:
        body = strip_frontmatter(full)
        scope = "fallback-head" if (extract_heading or heading_candidates) else "full"

    focus_terms = opts.get("focusTerms")
    if focus_terms:
        focused = focus_classic_text(body, focus_terms, int(opts.get("maxChars") or FOCUSED_SOURCE_MAX))
        if focused:
            body = focused
            scope = scope + "·focused"

    text = body[:PER_SOURCE_MAX] + "\n…(节选)" if len(body) > PER_SOURCE_MAX else body
    return RetrievalHit(source=label, file=file, scope=scope, text=text, chars=len(text))


# NOTE: retrieval.js:318-339
def _retrieve_qiongtong(chart: dict) -> RetrievalHit | None:
    try:
        # Support both flat format {rizhu, sizhu} and nested {META, PAIPAN}
        day_gan: str | None = (
            (chart.get("META") or {}).get("rizhuGan")
            or chart.get("rizhu")
        )
        sizhu = (chart.get("PAIPAN") or {}).get("sizhu") or chart.get("sizhu") or {}
        month_gz: str | None = sizhu.get("month")

        if not day_gan or not month_gz or len(month_gz) < 2:
            return None
        month_zhi = month_gz[1]

        from app.retrieval.loader import QIONGTONG_FILE
        file = QIONGTONG_FILE.get(day_gan)
        if not file:
            return None

        content = read_classic(file)
        if not content:
            return None

        section = _extract_qiongtong_section_detail(content, day_gan, month_zhi)
        if not section:
            return None

        MAX = PER_SOURCE_MAX
        raw_text: str = section["text"]
        text = raw_text[:MAX] + "\n…(节选)" if len(raw_text) > MAX else raw_text
        return RetrievalHit(
            source="穷通宝鉴 · " + section["heading"],
            file=file,
            scope=section["scope"],
            text=text,
            chars=len(text),
        )
    except Exception:
        return None


async def retrieve_for_chart(
    chart: dict,
    kind: str,
    user_message: str | None = None,
) -> list[RetrievalHit]:
    """Dispatch based on kind string:
      - "meta"            → qiongtong + multiple classics
      - "section:<name>"  → section-specific (maps to named intent if known)
      - "dayun_step"      → qiongtong + 子平真诠
      - "liunian"         → qiongtong only

    Unknown kind → return [].

    Port of retrieveForChart — retrieval.js:274-316.
    """
    # NOTE: retrieval.js:274-316
    # Resolve section: prefix to plain intent name
    intent = kind
    if kind.startswith("section:"):
        intent = kind[len("section:"):]

    # Unknown intent — return empty immediately
    if intent not in INTENT_ROUTES:
        return []

    results: list[RetrievalHit] = []
    total_chars = 0

    # NOTE: retrieval.js:279-280 — always include qiongtong first
    qt = _retrieve_qiongtong(chart)
    if qt:
        results.append(qt)
        total_chars += qt["chars"]

    planned_routes: list[dict] = []
    if intent in {"meta", "other", "career", "wealth", "personality", "dayun_step"}:
        try:
            from app.retrieval.llm_plan import llm_planned_routes

            planned_routes = await llm_planned_routes(chart, intent, user_message)
        except Exception:
            planned_routes = []

    # NOTE: retrieval.js:283-313 — intent-driven routes
    routes = INTENT_ROUTES.get(intent, [])
    all_routes = planned_routes + _context_routes(chart, intent, user_message) + list(routes)
    seen: set[str] = {str(hit.get("file")) for hit in results if hit.get("file")}
    loaded_count = 0
    for route in all_routes:
        file = route["file"]
        if file in seen:
            continue
        seen.add(file)
        if intent == "meta" and loaded_count >= CONTEXT_ROUTE_MAX:
            break
        if total_chars >= TOTAL_MAX:
            break
        opts: dict = {}
        if "extractHeading" in route:
            opts["extractHeading"] = route["extractHeading"]
        if "exactText" in route:
            opts["exactText"] = route["exactText"]
        if route.get("extractByMessageKeyword"):
            headings = pick_geju_keyword(user_message)
            if headings:
                opts["headingCandidates"] = headings
        if intent != "meta" and route.get("focusTerms"):
            opts["focusTerms"] = list(route.get("focusTerms") or [])
            opts["maxChars"] = int(route.get("maxChars") or FOCUSED_SOURCE_MAX)
        loaded = load_classic_file(file, route["label"], opts)
        if not loaded:
            continue
        if total_chars + loaded["chars"] > TOTAL_MAX:
            room = TOTAL_MAX - total_chars
            if room < 500:
                break
            loaded["text"] = loaded["text"][:room] + "\n…(截断)"
            loaded["chars"] = len(loaded["text"])
        results.append(loaded)
        loaded_count += 1
        total_chars += loaded["chars"]

    return results
