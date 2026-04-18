"""Stage 2 expert: intent-aware chart-slice + system prompt builder.

NOTE: archive/server-mvp/prompts.js:472-656 — pickChartSlice, INTENT_GUIDE,
buildExpertMessages.
"""
from __future__ import annotations

from typing import Any, Optional

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context
from app.prompts.loader import load_shard


# NOTE: prompts.js:44-51 — fallback style when no shard exists for an intent
FALLBACK_STYLE = """
你是一位懂命理的朋友。回复要：
1. 用聊天而非报告的语气；术语必须配白话翻译
2. 命理判断要有依据（命盘数据 + 古籍/经验）；不做空泛心灵鸡汤
3. 识别"真实边界"与"防御性回避"——前者尊重，后者温和挑战
4. 回复长度随内容走，写透为止，不要自行截断
5. 能用原话就用原话，避免机械的"我听到你说..."式复述
""".strip()


# NOTE: prompts.js:564-602 — verbatim intent-guide map
INTENT_GUIDE: dict[str, str] = {
    "relationship":
        '【本轮：关系/感情】聚焦日支（配偶宫）、正偏财与官杀的强弱与位置、六合/相冲对感情宫的影响、当前大运对关系的烘托。避免泛泛爱情鸡汤，要把判断挂在具体干支/十神/分数上。',
    "career":
        '【本轮：事业方向】聚焦格局（geju）、用神、官杀与食伤的配比（制/泄/化）、月令的土壤，再结合当前大运。给建议时要能落到"做什么类型的事"而不是"要努力"。',
    "wealth":
        '【本轮：财运】聚焦正偏财根气、食伤生财链路、比劫是否夺财、当前/下一步大运走财还是走印。不要给炒股吉凶，要给"你适合怎么挣钱"的结构化判断。',
    "timing":
        '【本轮：时机/大运流年】聚焦当前大运 + 下一步大运 + 近期流年，解释它对命主的结构意味着什么（补了什么、冲了什么）。日期要具体到岁数或年份。',
    "personality":
        '【本轮：性格自我】聚焦日主、十神结构、格局、十神组内的失衡（pair_mismatch）。用命盘"结构"解释性格的两面性，避免 MBTI 式标签化。',
    "health":
        '【本轮：身体情绪】聚焦五行偏枯、被冲最重的柱、过强/过弱的十神。只给结构性提醒（比如"水过弱、注意肾/泌尿与冬季"），不作医疗诊断。',
    "meta":
        '【本轮：命理概念】用户在问命理本身。先用两三句把概念讲清楚（白话+原理），再落回命主自身盘中对应的情况，不要只回答通识。',
    "chitchat":
        '【本轮：闲聊】用户没在问命盘。自然接话，不要硬塞八字分析。一两句即可。',
    "other":
        '【本轮：兜底】按常规方法论回答，若用户问题模糊可温和反问具体化。',
    "appearance":
        '【本轮：外貌/形象】聚焦三命通会"性情相貌"的体系：日主五行 + 主导十神 + 月令气候，对应身材、肤色、面相轮廓。挂出来的古籍是依据，不要随意加现代审美词。说"古籍把这种结构形容为...，落到你身上大概是..."。',
    "special_geju":
        '【本轮：特殊格局】用户问到了某个特殊格局名词。先用挂接的古籍原文确认它的成立条件，再对照命主盘看是否真的成立。如果不成立，明说"古籍要求 A、B、C，你的盘缺 C，所以这个格局不成立"。绝对不要凑话说成立。',
    "liunian":
        '【本轮：某一年的流年解读】\n'
        '在当前大运背景下讲这一年对命主的具体作用：\n'
        '- 年干支与日主的十神关系（ss 字段已给）\n'
        '- 年柱与大运干支的合冲刑害（同冲/同合会加码，互冲互合会缓和）\n'
        '- 落在"紧/松"哪种节奏：杀旺压身、财星辛劳、印年贵人等\n'
        '- 结尾给一句"这一年适合做什么 / 避免什么"，要具体\n'
        '- 4-8 行，口语，不要段落标题\n'
        '- 第一个字必须是具体干支或结论，不要"好的"、"这一年"这种套话开头。',
    "dayun_step":
        '【本轮：某一步大运的走向解读】\n'
        '分析这一步大运（干支 + 起运年龄）对日主的作用：干支各自是什么十神，和日主/用神的生克、与原局四柱的合冲。\n'
        '回答要落到具体十年里：前 2-3 年受上一步余气影响，中段（4-7 年）最纯，末 2 年过渡下一步。\n'
        '指出这十年哪条线被激活：事业/关系/财/健康，只选最突出的一两条。\n'
        '语气：像朋友在白板前给你画时间线。8-12 行，不用段落标题，不要前言后语。',
}


def _load_shards_for(intent: str) -> str:
    """Port of loadShardsFor(intent) from prompts.js:36-42.

    Always includes core shard; appends intent-specific shard if it exists.
    """
    out: list[str] = []
    core = load_shard("core")
    if core:
        out.append(core)
    if intent:
        specific = load_shard(intent)
        if specific:
            out.append(specific)
    return "\n\n---\n\n".join(out)


def _resolve_today_year(meta: dict) -> Optional[int]:
    ymd = (meta or {}).get("today", {}).get("ymd")
    if isinstance(ymd, str) and len(ymd) >= 4 and ymd[:4].isdigit():
        return int(ymd[:4])
    return None


def _resolve_current_dayun_index(paipan: dict) -> int:
    """Return index in DAYUN of the step containing today's year, or -1."""
    today = _resolve_today_year(paipan.get("META") or {})
    dayun = paipan.get("DAYUN") or []
    if today is None or not dayun:
        return -1
    for i, step in enumerate(dayun):
        try:
            sy, ey = int(step.get("startYear")), int(step.get("endYear"))
        except (TypeError, ValueError):
            continue
        if sy <= today <= ey:
            return i
    for i, step in enumerate(dayun):
        if step.get("current"):
            return i
    return -1


def pick_chart_slice(paipan: dict, intent: str) -> Optional[dict]:
    """Return a chart-shaped subset filtered for this intent, or None for chitchat.

    NOTE: prompts.js:472-562.
    """
    if not paipan:
        return None
    if intent == "chitchat":
        return None
    if intent == "other":
        return paipan

    P = paipan.get("PAIPAN") or {}
    M = paipan.get("META") or {}
    F = paipan.get("FORCE") or []
    G = paipan.get("GUARDS") or []
    D = paipan.get("DAYUN") or []
    cur_idx = _resolve_current_dayun_index(paipan)
    cur_dayun = D[cur_idx] if cur_idx >= 0 else None
    next_dayun = D[cur_idx + 1] if cur_idx >= 0 and cur_idx + 1 < len(D) else None

    base_meta = {
        "rizhu": M.get("rizhu"), "rizhuGan": M.get("rizhuGan"),
        "dayStrength": M.get("dayStrength"),
        "geju": M.get("geju"), "gejuNote": M.get("gejuNote"),
        "yongshen": M.get("yongshen"),
        "input": M.get("input"),
        "today": M.get("today"),
    }

    def pick_force(names: set[str]) -> list:
        return [x for x in F if x.get("name") in names]

    if intent == "relationship":
        return {
            "PAIPAN": P,
            "FORCE": pick_force({"正财", "偏财", "正官", "七杀", "比肩", "劫财"}),
            "GUARDS": [g for g in G if g.get("type") in {"liuhe", "chong"}
                       or "财" in (g.get("note") or "")
                       or "官" in (g.get("note") or "")],
            "DAYUN": [cur_dayun] if cur_dayun else [],
            "META": base_meta,
        }
    if intent == "career":
        return {
            "PAIPAN": P,
            "FORCE": pick_force({"正官", "七杀", "食神", "伤官", "正印", "偏印"}),
            "GUARDS": G,
            "DAYUN": [d for d in (cur_dayun, next_dayun) if d],
            "META": base_meta,
        }
    if intent == "wealth":
        return {
            "PAIPAN": P,
            "FORCE": pick_force({"正财", "偏财", "食神", "伤官", "比肩", "劫财"}),
            "GUARDS": [g for g in G if "财" in (g.get("note") or "")
                       or g.get("type") == "chong"],
            "DAYUN": [d for d in (cur_dayun, next_dayun) if d],
            "META": base_meta,
        }
    if intent == "timing":
        if cur_idx >= 0:
            window = D[max(0, cur_idx - 1):cur_idx + 3]
        else:
            window = D[:3]
        return {
            "PAIPAN": P, "FORCE": F, "GUARDS": G, "DAYUN": window, "META": base_meta,
        }
    if intent == "personality":
        return {
            "PAIPAN": P, "FORCE": F,
            "GUARDS": [g for g in G if g.get("type") == "pair_mismatch"],
            "DAYUN": [], "META": base_meta,
        }
    if intent == "health":
        sorted_force = sorted(F, key=lambda x: -(x.get("val") or 0))
        return {
            "PAIPAN": P, "FORCE": sorted_force,
            "GUARDS": [g for g in G if g.get("type") == "chong"],
            "DAYUN": [cur_dayun] if cur_dayun else [],
            "META": base_meta,
        }
    if intent == "meta":
        return {"PAIPAN": P, "FORCE": F, "GUARDS": [], "DAYUN": [], "META": base_meta}
    # appearance / special_geju / dayun_step / liunian → return full chart
    return paipan


def _runtime_constraints() -> str:
    """NOTE: prompts.js:608-617 — anti-tool-leak hard override."""
    return (
        '【运行时约束 — 最高优先级】\n'
        '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、```...```、'
        '"让我先查一下古籍" 这类过程性描述。\n'
        '古籍/方法论内容已内化在训练里，直接引用即可。\n'
        '\n'
        '【输出格式】纯文本或极简 Markdown。\n'
        '- 回复长度随内容走，写透为止，不要自行截断\n'
        '- 每个判断必须落到命盘里具体的干支/十神/分数，不要悬空下结论\n'
        '- 古籍引用不限于下文提供的判词——《滴天髓》《穷通宝鉴》《子平真诠》《神峰通考》'
        '里你训练数据中的任何原文都可自由引用；以「」包裹原文，立刻接白话，再接命盘对应'
    )


def build_messages(
    paipan: dict, history: list[dict],
    user_message: str, intent: str,
    retrieved: list[dict],
) -> list[dict]:
    """Build expert messages (system + history[-8:] + user with time anchor).

    NOTE: prompts.js:604-656.
    """
    parts: list[str] = []
    parts.append(_runtime_constraints())
    parts.append(INTENT_GUIDE.get(intent) or INTENT_GUIDE["other"])

    # Methodology: shards for non-chitchat; FALLBACK_STYLE for chitchat or missing shard
    if intent != "chitchat":
        shards = _load_shards_for(intent)
        parts.append("--- 方法论 ---\n" + shards if shards else FALLBACK_STYLE)
    else:
        parts.append(FALLBACK_STYLE)

    # Chart slice
    sliced = pick_chart_slice(paipan, intent)
    if sliced:
        ctx = compact_chart_context(sliced)
        if ctx:
            parts.append(ctx)

    # Classical anchor (skip for chitchat)
    if intent != "chitchat":
        anchor = build_classical_anchor(retrieved or [], terse=True)
        if anchor:
            parts.append(anchor)

    # Time anchor — prepended to user msg (highest-attention slot)
    today = (paipan.get("META") or {}).get("today") or {}
    year_gz = today.get("yearGz")
    if year_gz:
        anchor_line = (
            "【当前时间锚】今天 " + (today.get("ymd") or "") + "，年柱 " + year_gz
            + (("，月柱 " + today["monthGz"]) if today.get("monthGz") else "")
            + '。所有"今年/明年/最近"默认以此为基准，不要自己另行推断。\n\n'
        )
    else:
        anchor_line = ""

    history_window = (history or [])[-8:]
    return [
        {"role": "system", "content": "\n\n".join(parts)},
        *history_window,
        {"role": "user", "content": anchor_line + user_message},
    ]
