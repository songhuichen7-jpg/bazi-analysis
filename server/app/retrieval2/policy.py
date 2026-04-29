"""Intent-specific retrieval policy.

BM25 and KG are intentionally generic. This module adds a small amount of
domain judgment: which books/chapters are authoritative for each question
type, and which neighboring topics should be kept out of the selector pool.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .types import ClaimTags, ClaimUnit


@dataclass(frozen=True, slots=True)
class RetrievalPolicy:
    kind: str
    positive_domains: tuple[str, ...] = ()
    preferred_books: tuple[str, ...] = ()
    allowed_file_fragments: tuple[str, ...] = ()
    preferred_files: tuple[str, ...] = ()
    preferred_file_fragments: tuple[str, ...] = ()
    rejected_file_fragments: tuple[str, ...] = ()
    required_domains: tuple[str, ...] = ()
    required_terms: tuple[str, ...] = ()
    day_gan: str = ""
    month_zhi: str = ""
    season: str = ""
    strict_chart_axis: bool = False
    selector_hint: str = ""
    term_boosts: tuple[str, ...] = field(default_factory=tuple)

    def rejects(self, claim: ClaimUnit, tags: ClaimTags) -> bool:
        file_name = claim.chapter_file
        if self.allowed_file_fragments and not any(
            fragment in file_name for fragment in self.allowed_file_fragments
        ):
            return True
        if any(fragment in file_name for fragment in self.rejected_file_fragments):
            return True
        if self.strict_chart_axis:
            if self.day_gan and tags.day_gan and self.day_gan not in tags.day_gan:
                return True
            if self.month_zhi and tags.month_zhi and self.month_zhi not in tags.month_zhi:
                return True
            if self.season and tags.season and self.season not in tags.season:
                return True
        if self.required_domains or self.required_terms:
            text = claim.text + claim.chapter_title + (claim.section or "")
            has_domain = bool(set(tags.domain) & set(self.required_domains))
            has_term = any(term in text for term in self.required_terms)
            if not has_domain and not has_term:
                return True
        return False

    def boost(self, claim: ClaimUnit, tags: ClaimTags) -> float:
        if self.rejects(claim, tags):
            return -1.0

        score = 0.0
        if claim.book in self.preferred_books:
            score += 0.25
        if claim.chapter_file in self.preferred_files:
            score += 1.25
        if any(fragment in claim.chapter_file for fragment in self.preferred_file_fragments):
            score += 0.8
        if self.positive_domains and set(tags.domain) & set(self.positive_domains):
            score += 0.65
        if self.day_gan and self.day_gan in tags.day_gan:
            score += 1.25
        if self.day_gan and self.day_gan in (claim.chapter_title + claim.chapter_file + (claim.section or "")):
            score += 0.85
        if self.month_zhi and self.month_zhi in tags.month_zhi:
            score += 0.55
        if self.season and self.season in tags.season:
            score += 0.35
        if self.day_gan and self.month_zhi and self.day_gan in tags.day_gan and self.month_zhi in tags.month_zhi:
            score += 1.1
        if self.term_boosts:
            text = claim.text + claim.chapter_title + (claim.section or "")
            score += 0.2 * sum(1 for term in self.term_boosts if term in text)
        return score


def _paipan(chart: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(chart, dict):
        return {}
    return chart.get("PAIPAN") or chart


def _day_gan(chart: dict[str, Any]) -> str:
    p = _paipan(chart)
    meta = p.get("META") or {}
    rizhu = str(meta.get("rizhuGan") or p.get("rizhu") or "")
    if rizhu:
        return rizhu[0]
    sizhu = p.get("sizhu") or {}
    day = str(sizhu.get("day") or "") if isinstance(sizhu, dict) else ""
    return day[:1] if day else ""


def _month_zhi(chart: dict[str, Any]) -> str:
    sizhu = _paipan(chart).get("sizhu") or {}
    month = str(sizhu.get("month") or "") if isinstance(sizhu, dict) else ""
    return month[1:2] if len(month) >= 2 else ""


def _season(chart: dict[str, Any]) -> str:
    return {
        "寅": "春", "卯": "春", "辰": "春",
        "巳": "夏", "午": "夏", "未": "夏",
        "申": "秋", "酉": "秋", "戌": "秋",
        "亥": "冬", "子": "冬", "丑": "冬",
    }.get(_month_zhi(chart), "")


def _main_shishen(chart: dict[str, Any]) -> str:
    p = _paipan(chart)
    geju = p.get("geJu") or p.get("ge_ju") or {}
    main = (
        (geju.get("mainCandidate") if isinstance(geju, dict) else None)
        or (geju.get("main_candidate") if isinstance(geju, dict) else None)
        or {}
    )
    text = ""
    if isinstance(main, dict):
        text = str(main.get("shishen") or main.get("name") or "")
    text = text or str(p.get("geju") or "")
    if "偏官" in text or "七杀" in text or "七煞" in text:
        return "七杀"
    if "正官" in text:
        return "正官"
    if "财" in text:
        return "正财"
    if "印" in text:
        return "正印"
    return ""


def _day_strength(chart: dict[str, Any]) -> str:
    raw = str(_paipan(chart).get("dayStrength") or "")
    if "弱" in raw or "衰" in raw or "轻" in raw:
        return "身弱"
    if "强" in raw or "旺" in raw:
        return "身强"
    return raw


def _yongshen_terms(chart: dict[str, Any]) -> tuple[str, ...]:
    p = _paipan(chart)
    out: list[str] = []
    if p.get("yongshen"):
        out.append(str(p.get("yongshen")))
    detail = p.get("yongshenDetail") or {}
    if isinstance(detail, dict):
        primary = detail.get("primary")
        if primary:
            out.append(str(primary))
        for cand in detail.get("candidates") or []:
            if isinstance(cand, dict) and cand.get("name"):
                out.append(str(cand.get("name")))
    return tuple(dict.fromkeys(t for t in out if t))


_QIONGTONG_BY_DAY_GAN = {
    "甲": "qiongtong-baojian/02_lun-jia-mu",
    "乙": "qiongtong-baojian/03_lun-yi-mu",
    "丙": "qiongtong-baojian/04_lun-bing-huo",
    "丁": "qiongtong-baojian/05_lun-ding-huo",
    "戊": "qiongtong-baojian/06_lun-wu-tu",
    "己": "qiongtong-baojian/07_lun-ji-tu",
    "庚": "qiongtong-baojian/08_lun-geng-jin",
    "辛": "qiongtong-baojian/09_lun-xin-jin",
    "壬": "qiongtong-baojian/10_lun-ren-shui",
    "癸": "qiongtong-baojian/11_lun-gui-shui",
}


_MONTH_NAME_BY_ZHI = {
    "寅": "正月", "卯": "二月", "辰": "三月",
    "巳": "四月", "午": "五月", "未": "六月",
    "申": "七月", "酉": "八月", "戌": "九月",
    "亥": "十月", "子": "十一月", "丑": "十二月",
}


def _looks_like_tiaohou(kind: str, user_message: str | None) -> bool:
    text = f"{kind} {user_message or ''}"
    return any(term in text for term in ("调候", "寒暖", "燥湿", "冬天", "夏天", "取暖", "解冻"))


def build_policy(chart: dict[str, Any], kind: str, user_message: str | None = None) -> RetrievalPolicy:
    """Return the ranking policy for one retrieval request."""
    if _looks_like_tiaohou(kind, user_message):
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("调候", "用神取舍"),
            preferred_books=("qiongtong-baojian",),
            allowed_file_fragments=("qiongtong-baojian/", "han-nuan", "zao-shi"),
            preferred_file_fragments=("qiongtong-baojian/", "ditian-sui/tong-shen-lun_29_han-nuan"),
            day_gan=_day_gan(chart),
            month_zhi=_month_zhi(chart),
            season=_season(chart),
            strict_chart_axis=True,
            selector_hint="调候问题优先选《穷通宝鉴》中日干×月令对应段；其次才选寒暖燥湿通论。",
            term_boosts=("专用", "先取", "次用", "寒", "暖", "燥", "湿"),
        )

    if kind == "relationship":
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("六亲",),
            allowed_file_fragments=(
                "ditian-sui/liu-qin-lun_01_fu-qi",
                "yuanhai-ziping/10_liu-qin-lun",
                "yuanhai-ziping/11_nv-ming-lun",
            ),
            preferred_files=("ditian-sui/liu-qin-lun_01_fu-qi.md",),
            preferred_file_fragments=("fu-qi", "夫妻"),
            rejected_file_fragments=("zi-nv",),
            selector_hint="婚姻/正缘问题优先选夫妻、夫星、妻星；子女段落除非同时直接谈夫妻，否则不要选。",
            term_boosts=("夫妻", "妻", "夫", "婚", "配偶", "财以妻"),
        )

    if kind == "wealth":
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("财官",),
            allowed_file_fragments=(
                "ditian-sui/liu-qin-lun_05_he-zhi-zhang",
                "yuanhai-ziping/06_shi-shen_zheng-cai-pian-cai",
                "ziping-zhenquan/33_lun-cai",
                "ziping-zhenquan/34_lun-cai-qu-yun",
            ),
            preferred_files=(
                "ditian-sui/liu-qin-lun_05_he-zhi-zhang.md",
                "yuanhai-ziping/06_shi-shen_zheng-cai-pian-cai.md",
                "ziping-zhenquan/33_lun-cai.md",
                "ziping-zhenquan/34_lun-cai-qu-yun.md",
            ),
            rejected_file_fragments=("sanming-tonghui/juan-12",),
            selector_hint="财运问题优先选财星、财格、财气通门户和正偏财章节；泛口诀、泛气候靠后。",
            term_boosts=("财气", "财星", "财格", "正财", "偏财", "食伤生财"),
        )

    if kind == "meta" and _main_shishen(chart) == "七杀":
        day_gan = _day_gan(chart)
        month_zhi = _month_zhi(chart)
        month_name = _MONTH_NAME_BY_ZHI.get(month_zhi, "")
        qiongtong_file = _QIONGTONG_BY_DAY_GAN.get(day_gan, "")
        season = _season(chart)
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("格局成败", "用神取舍", "财官", "调候"),
            allowed_file_fragments=tuple(
                f for f in (
                    qiongtong_file,
                    "ziping-zhenquan/39_lun-pian-guan",
                    "ziping-zhenquan/40_lun-pian-guan-qu-yun",
                    "ditian-sui/tong-shen-lun_21_guan-sha",
                    "sanming-tonghui/juan-04",
                    "sanming-tonghui/juan-05",
                )
                if f
            ),
            preferred_files=tuple(
                f"{f}.md" for f in (
                    qiongtong_file,
                    "sanming-tonghui/juan-04",
                    "ziping-zhenquan/39_lun-pian-guan",
                    "ditian-sui/tong-shen-lun_21_guan-sha",
                )
                if f
            ),
            day_gan=day_gan,
            month_zhi=month_zhi,
            season=season,
            strict_chart_axis=True,
            selector_hint=(
                "七杀格总览优先选：日干×月令原文、七杀/偏官成败、官杀处理、"
                "身弱杀重的制化；不要选别的日主、别的季节、日时断泛例。"
            ),
            term_boosts=tuple(
                t for t in (
                    f"{day_gan}日" if day_gan else "",
                    f"{month_zhi}月" if month_zhi else "",
                    f"{month_name}{day_gan}" if month_name and day_gan else "",
                    month_name,
                    "偏官", "七杀", "七煞", _day_strength(chart),
                    "丁火", "庚金", "制杀", "化杀", "杀重身轻", "财生杀", "杀印",
                    *_yongshen_terms(chart),
                )
                if t
            ),
        )

    if kind == "liunian":
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("行运",),
            allowed_file_fragments=(
                "ziping-zhenquan/25_lun-xing-yun",
                "ziping-zhenquan/26_lun-xing-yun-cheng-ge-bian-ge",
                "ditian-sui/liu-qin-lun_28_sui-yun",
                "yuanhai-ziping/02_lun-ri-zhu-yue-ling-da-yun-tai-sui",
            ),
            required_domains=("行运",),
            required_terms=("行运", "岁运", "太岁", "流年", "大运"),
            preferred_files=(
                "ziping-zhenquan/25_lun-xing-yun.md",
                "ziping-zhenquan/26_lun-xing-yun-cheng-ge-bian-ge.md",
                "ditian-sui/liu-qin-lun_28_sui-yun.md",
            ),
            selector_hint="大运/流年问题优先选行运、岁运、成格变格章节；不要只选原局格局通论。",
            term_boosts=("行运", "岁运", "流年", "太岁", "成格", "变格"),
        )

    if kind in {"timing", "dayun_step"}:
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("行运",),
            allowed_file_fragments=(
                "xing-yun",
                "sui-yun",
                "da-yun",
                "tai-sui",
                "qu-yun",
            ),
            required_domains=("行运",),
            required_terms=("行运", "岁运", "太岁", "流年", "大运", "取运"),
            preferred_files=(
                "ziping-zhenquan/25_lun-xing-yun.md",
                "ziping-zhenquan/26_lun-xing-yun-cheng-ge-bian-ge.md",
                "ditian-sui/liu-qin-lun_28_sui-yun.md",
            ),
            selector_hint="大运/流年问题优先选行运、岁运、成格变格、取运章节；不要只选原局格局通论。",
            term_boosts=("行运", "岁运", "流年", "太岁", "成格", "变格", "取运"),
        )

    if kind == "health":
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("疾病",),
            preferred_files=("ditian-sui/liu-qin-lun_25_ji-bing.md",),
            selector_hint="健康问题优先选疾病、偏枯、寒暖燥湿致病段落；格局富贵段落靠后。",
            term_boosts=("疾病", "病", "偏枯", "寒", "燥", "湿"),
        )

    if kind == "appearance":
        return RetrievalPolicy(
            kind=kind,
            positive_domains=("外貌", "性情"),
            preferred_files=("sanming-tonghui/juan-07.md",),
            selector_hint="外貌/气质问题优先选《三命通会》性情相貌与滴天髓性情，不选格局富贵泛论。",
            term_boosts=("性情", "相貌", "形体", "貌"),
        )

    return RetrievalPolicy(kind=kind)


__all__ = ["RetrievalPolicy", "build_policy"]
