"""Retrieval service — kind-routed classical excerpt selection.

Port of archive/server-mvp/retrieval.js:179-340 (retrieveForChart + intent
dispatch tables).

Budget constants:
    PER_SOURCE_MAX = 2500      # max chars per book
    TOTAL_MAX = 6000           # aggregate budget across all sources
"""
from __future__ import annotations

from typing import TypedDict

from app.retrieval.loader import (
    _extract_qiongtong_section_detail,
    extract_by_heading,
    read_classic,
    strip_frontmatter,
)

# NOTE: retrieval.js:193-194
PER_SOURCE_MAX = 2500
TOTAL_MAX = 6000


class RetrievalHit(TypedDict):
    source: str
    scope: str
    chars: int
    text: str


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


# NOTE: retrieval.js:179-187 — pick 十神-specific chapter if user message mentions one
def pick_meta_classic(user_message: str | None) -> dict | None:
    if not user_message:
        return None
    for kw, file in SHISHEN_CHAPTER.items():
        if kw in user_message:
            label = SHISHEN_LABEL.get(file, "子平真诠·" + kw)
            return {"file": file, "label": label}
    return None


# NOTE: retrieval.js:233-239
def pick_geju_keyword(user_message: str | None) -> list[str] | None:
    if not user_message:
        return None
    for asked_kw, headings in SANMING_GEJU_KEYWORDS.items():
        if asked_kw in user_message:
            return headings
    return None


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

    if extract_heading:
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

    # NOTE: retrieval.js:283-313 — intent-driven routes
    routes = INTENT_ROUTES.get(intent, [])
    dynamic_routes: list[dict] = []

    if intent == "meta" and user_message:
        picked = pick_meta_classic(user_message)
        if picked:
            dynamic_routes.append(picked)

    all_routes = dynamic_routes + list(routes)
    seen: set[str] = set()
    for route in all_routes:
        file = route["file"]
        if file in seen:
            continue
        seen.add(file)
        if total_chars >= TOTAL_MAX:
            break
        opts: dict = {}
        if "extractHeading" in route:
            opts["extractHeading"] = route["extractHeading"]
        if route.get("extractByMessageKeyword"):
            headings = pick_geju_keyword(user_message)
            if headings:
                opts["headingCandidates"] = headings
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
        total_chars += loaded["chars"]

    return results
