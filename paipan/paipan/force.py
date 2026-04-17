"""力量擂台 (§4). Port of paipan-engine/src/ming/liLiang.js.

Evaluates each 十神 across 4 dimensions: 透干、得令、根、合克.

Node exports ported:
    WEIGHTS
    analyzeForce → analyze_force

Python-only additions:
    compute_force — thin adapter used by the Python spec test suite that
    translates ``{year, month, day, hour}`` nested input to Node's flat
    ``{yearGan, yearZhi, ...}`` shape and returns just the raw ten-gods
    scores dict. No Node counterpart — documented as adapter-only.

Bug/quirk notes (preserved verbatim from Node):
    - ``keDiscount`` is defined in ``WEIGHTS`` but **never applied**
      anywhere in the algorithm. Port keeps it as a dead constant.
      See NOTE at ming/liLiang.js:30.
    - He-reduction formula at ming/liLiang.js:109-110 is intentionally
      ``reduction = scores[ss] * (1 - heDiscount); scores[ss] -= reduction``
      rather than ``scores[ss] *= heDiscount``. The ``adjustments[].reduction``
      value is oracle-fixed to 0.1 precision — the formula is ported literally.
"""
from __future__ import annotations

from paipan.cang_gan import get_ben_qi, get_cang_gan_weighted
from paipan.ganzhi import GAN_WUXING, WUXING_KE, WUXING_SHENG
from paipan.he_ke import find_gan_he, is_gan_he
from paipan.shi_shen import SHI_SHEN_PAIRS, get_shi_shen

# NOTE: ming/liLiang.js:23-31  力量权重配置
#  - keDiscount is **defined but never applied** in Node (dead constant).
#    Ported verbatim; do NOT implement 被克减分 logic.
WEIGHTS: dict[str, float] = {
    "tougan": 3.0,        # 透干
    "deling": 4.0,        # 得令（月令本气）
    "rootBenQi": 2.0,     # 地支本气根
    "rootZhongQi": 1.0,   # 地支中气根
    "rootYuQi": 0.5,      # 地支余气根
    "heDiscount": 0.4,    # 被合走，减到原 40%
    "keDiscount": 0.6,    # 被邻干克，减到原 60% — DEAD CONSTANT (never applied)
}

# NOTE: ming/liLiang.js:33-35  所有十神
ALL_SHI_SHEN: list[str] = [
    "比肩", "劫财", "食神", "伤官", "正财", "偏财", "正官", "七杀", "正印", "偏印",
]


# NOTE: ming/liLiang.js:176-201
def _get_rizhu_relation(ri_zhu: str, shi_shen: str, ctx: dict) -> list[dict]:
    """日主与某十神的关系（合/克/生）.

    Returns a list of ``{gan, position, relation}`` for every gan in the chart
    matching ``shi_shen``. Relation is one of
    ``合 / 日主克 / 克日主 / 日主生 / 生日主 / 同类 / 无关``.
    """
    gan_list: list[str] = ctx["ganList"]
    results: list[dict] = []

    # NOTE: ming/liLiang.js:181-199
    for i, g in enumerate(gan_list):
        if g == ri_zhu:
            continue
        if get_shi_shen(ri_zhu, g) != shi_shen:
            continue

        gw = GAN_WUXING[g]
        rw = GAN_WUXING[ri_zhu]
        if is_gan_he(ri_zhu, g):
            rel = "合"
        elif WUXING_KE.get(rw) == gw:
            rel = "日主克"
        elif WUXING_KE.get(gw) == rw:
            rel = "克日主"
        elif WUXING_SHENG.get(rw) == gw:
            rel = "日主生"
        elif WUXING_SHENG.get(gw) == rw:
            rel = "生日主"
        elif gw == rw:
            rel = "同类"
        else:
            rel = "无关"

        results.append({"gan": g, "position": i, "relation": rel})
    return results


# NOTE: ming/liLiang.js:42-168
def analyze_force(bazi: dict) -> dict:
    """计算各十神的力量.

    Args:
        bazi: ``{yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi,
            hourGan, hourZhi}`` — Node-flat shape (mirrors liLiang.js:43).

    Returns rich dict with keys ``riZhu, scoresRaw, scoresNormalized,
    contributions, dayStrength, sameSideScore, otherSideScore, sameRatio,
    congCandidate, pairs, relations`` (mirrors liLiang.js:155-167).
    """
    # NOTE: ming/liLiang.js:43-44
    year_gan = bazi.get("yearGan")
    year_zhi = bazi.get("yearZhi")
    month_gan = bazi.get("monthGan")
    month_zhi = bazi.get("monthZhi")
    day_gan = bazi.get("dayGan")
    day_zhi = bazi.get("dayZhi")
    hour_gan = bazi.get("hourGan")
    hour_zhi = bazi.get("hourZhi")
    ri_zhu = day_gan

    # NOTE: ming/liLiang.js:47-52  天干列表 (日主含在内；透干阶段再跳过日干)
    gans: list[dict] = [x for x in [
        {"gan": year_gan, "pos": "年干"},
        {"gan": month_gan, "pos": "月干"},
        {"gan": day_gan, "pos": "日干"},
        {"gan": hour_gan, "pos": "时干"},
    ] if x["gan"]]

    # NOTE: ming/liLiang.js:55-60  地支列表
    zhis: list[dict] = [x for x in [
        {"zhi": year_zhi, "pos": "年支"},
        {"zhi": month_zhi, "pos": "月支"},
        {"zhi": day_zhi, "pos": "日支"},
        {"zhi": hour_zhi, "pos": "时支"},
    ] if x["zhi"]]

    # NOTE: ming/liLiang.js:63-68  得分表初始化
    scores: dict[str, float] = {}
    contributions: dict[str, dict] = {}
    for s in ALL_SHI_SHEN:
        scores[s] = 0.0
        contributions[s] = {"tougan": [], "deling": None, "roots": [], "adjustments": []}

    # NOTE: ming/liLiang.js:71-76  1) 透干 (skip 日干 本位)
    for entry in gans:
        if entry["pos"] == "日干":
            continue
        ss = get_shi_shen(ri_zhu, entry["gan"])
        scores[ss] += WEIGHTS["tougan"]
        contributions[ss]["tougan"].append({"gan": entry["gan"], "pos": entry["pos"]})

    # NOTE: ming/liLiang.js:79-84  2) 得令 (月支本气)
    month_ben_qi = get_ben_qi(month_zhi) if month_zhi else None
    if month_ben_qi:
        deling_ss = "比肩" if month_ben_qi == ri_zhu else get_shi_shen(ri_zhu, month_ben_qi)
        scores[deling_ss] += WEIGHTS["deling"]
        contributions[deling_ss]["deling"] = {"monthZhi": month_zhi, "benQi": month_ben_qi}

    # NOTE: ming/liLiang.js:87-99  3) 根 (所有地支藏干)
    for zentry in zhis:
        zhi = zentry["zhi"]
        pos = zentry["pos"]
        cg = get_cang_gan_weighted(zhi)
        for cg_entry in cg:
            gan = cg_entry["gan"]
            weight = cg_entry["weight"]
            role = cg_entry["role"]
            ss = "比肩" if gan == ri_zhu else get_shi_shen(ri_zhu, gan)
            # NOTE: ming/liLiang.js:92  月支本气已在得令算过，避免重复
            if pos == "月支" and role == "本气":
                continue
            if role == "本气":
                w = WEIGHTS["rootBenQi"]
            elif role == "中气":
                w = WEIGHTS["rootZhongQi"]
            else:
                w = WEIGHTS["rootYuQi"]
            scores[ss] += w * weight
            contributions[ss]["roots"].append({
                "zhi": zhi, "pos": pos, "gan": gan, "role": role, "weight": w * weight,
            })

    # NOTE: ming/liLiang.js:102-117  4) 合/克调整 (仅对透干天干)
    gan_list = [x["gan"] for x in gans]
    he_list = find_gan_he(gan_list)

    for he in he_list:
        for g in (he["a"], he["b"]):
            if g == ri_zhu:
                continue  # 日主被合，另外算
            ss = get_shi_shen(ri_zhu, g)
            # NOTE: ming/liLiang.js:109-110  literal formula — NOT equivalent to
            #       `scores[ss] *= heDiscount`. Preserves oracle-fixed
            #       `reduction` rounding to 0.1 precision.
            reduction = scores[ss] * (1 - WEIGHTS["heDiscount"])
            scores[ss] -= reduction
            contributions[ss]["adjustments"].append({
                "type": "被合",
                "with": he["b"] if g == he["a"] else he["a"],
                "reduction": round(reduction * 10) / 10,
            })

    # NOTE: ming/liLiang.js:120-124  归一化到 0-10 (最高分 → 10)
    max_score = max(max(scores.values()), 1)
    normalized: dict[str, float] = {}
    for s in ALL_SHI_SHEN:
        normalized[s] = round((scores[s] / max_score) * 10 * 10) / 10

    # NOTE: ming/liLiang.js:127-133  同类 vs 异类
    same_side_score = (
        scores["比肩"] + scores["劫财"] + scores["正印"] + scores["偏印"]
    )
    other_side_score = (
        scores["食神"] + scores["伤官"] + scores["正财"] + scores["偏财"]
        + scores["正官"] + scores["七杀"]
    )
    total_score = same_side_score + other_side_score
    same_ratio = same_side_score / total_score if total_score > 0 else 0

    # NOTE: ming/liLiang.js:135-138  身强/身弱/中和
    if same_ratio >= 0.55:
        day_strength = "身强"
    elif same_ratio <= 0.35:
        day_strength = "身弱"
    else:
        day_strength = "中和"

    # NOTE: ming/liLiang.js:141  从格候选
    cong_candidate = same_ratio <= 0.15

    # NOTE: ming/liLiang.js:144-147  正/偏对子显式对比
    pairs: dict[str, list[dict]] = {}
    for group, members in SHI_SHEN_PAIRS.items():
        pairs[group] = [
            {"name": m, "score": normalized[m], "raw": scores[m]} for m in members
        ]

    # NOTE: ming/liLiang.js:150-153  日主与各十神关系
    relations: dict[str, list[dict]] = {}
    for s in ALL_SHI_SHEN:
        relations[s] = _get_rizhu_relation(
            ri_zhu, s, {"ganList": gan_list, "zhis": zhis, "heList": he_list}
        )

    # NOTE: ming/liLiang.js:155-167
    return {
        "riZhu": ri_zhu,
        "scoresRaw": scores,
        "scoresNormalized": normalized,
        "contributions": contributions,
        "dayStrength": day_strength,
        "sameSideScore": round(same_side_score * 10) / 10,
        "otherSideScore": round(other_side_score * 10) / 10,
        "sameRatio": round(same_ratio * 100) / 100,
        "congCandidate": cong_candidate,
        "pairs": pairs,
        "relations": relations,
    }


def compute_force(paipan: dict, day_gan: str) -> dict[str, float]:
    """Python-only adapter used by the spec test suite.

    Translates ``{year: {gan, zhi}, month: {...}, day: {...}, hour: {...}}``
    input into Node-flat shape and returns just the raw ten-gods score dict
    (``scoresRaw``). ``day_gan`` is accepted explicitly to mirror the plan's
    API but must match ``paipan['day']['gan']``; it is otherwise unused.

    No Node counterpart.
    """
    def _gan(k: str) -> str | None:
        return paipan.get(k, {}).get("gan")

    def _zhi(k: str) -> str | None:
        return paipan.get(k, {}).get("zhi")

    bazi = {
        "yearGan": _gan("year"), "yearZhi": _zhi("year"),
        "monthGan": _gan("month"), "monthZhi": _zhi("month"),
        "dayGan": _gan("day") or day_gan, "dayZhi": _zhi("day"),
        "hourGan": _gan("hour"), "hourZhi": _zhi("hour"),
    }
    result = analyze_force(bazi)
    return result["scoresRaw"]
