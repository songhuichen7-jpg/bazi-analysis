"""Stage 2 expert: intent-aware chart-slice + system prompt builder.

NOTE: archive/server-mvp/prompts.js:472-656 — pickChartSlice, INTENT_GUIDE,
buildExpertMessages.
"""
from __future__ import annotations

from typing import Any, Optional

from app.prompts.anchor import build_classical_anchor
from app.prompts.context import compact_chart_context
from app.prompts.loader import load_shard
from app.prompts.style import BAZI_OUTPUT_STYLE_PRESET, CLASSICAL_QUOTE_POLICY


CLIENT_CONTEXT_MAX_CLASSICS = 6
CLIENT_CONTEXT_QUOTE_MAX = 240
CLIENT_CONTEXT_NOTE_MAX = 180


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


def _resolve_today_year(paipan: dict) -> Optional[int]:
    """NOTE: matches context.resolve_today_year — flat paipan with key 'todayYmd'."""
    ymd = str((paipan or {}).get("todayYmd") or "")
    if len(ymd) >= 4 and ymd[:4].isdigit():
        return int(ymd[:4])
    return None


def _resolve_current_dayun_index(paipan: dict) -> int:
    """Index in dayun of the step containing today's year, or -1.

    Reads flat paipan; dayun may be {"list": [...]} or a plain list (matches
    context.compact_chart_context normalization).
    """
    today = _resolve_today_year(paipan)
    raw = (paipan or {}).get("dayun") or {}
    dayun = raw.get("list") if isinstance(raw, dict) else list(raw)
    dayun = dayun or []
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
    """Return a flat-paipan-shaped subset filtered for this intent, or None for chitchat.

    Operates on the same FLAT shape that ``chart.paipan`` carries and that
    ``compact_chart_context`` already consumes. FORCE/GUARDS filtering from
    the JS port is dropped — the Python paipan engine output does not carry
    those arrays separately.

    For ``timing`` intent: trim the dayun list to a window around the
    current step (±1, +3 forward) so the prompt focuses on the relevant
    period without full 8-step history.

    For all other non-chitchat intents: return the paipan unchanged.
    For chitchat: return None (caller skips chart context entirely).

    NOTE: deviation from JS prompts.js:472-562 — see commit message for rationale.
    """
    if not paipan:
        return None
    if intent == "chitchat":
        return None
    if intent != "timing":
        return paipan

    # timing: window the dayun list to ±1 around current, +3 forward
    cur_idx = _resolve_current_dayun_index(paipan)
    raw = paipan.get("dayun") or {}
    if isinstance(raw, dict):
        dayun_list = raw.get("list") or []
        wrap_in_dict = True
    else:
        dayun_list = list(raw)
        wrap_in_dict = False

    if not dayun_list:
        return paipan
    if cur_idx >= 0:
        window = dayun_list[max(0, cur_idx - 1):cur_idx + 3]
    else:
        window = dayun_list[:3]

    # Return a shallow copy with dayun replaced (preserve original wrapping)
    sliced = dict(paipan)
    if wrap_in_dict:
        sliced["dayun"] = {**raw, "list": window}
    else:
        sliced["dayun"] = window
    return sliced


def _runtime_constraints() -> str:
    """NOTE: prompts.js:608-617 — anti-tool-leak hard override."""
    return '\n\n'.join([
        '【运行时约束 — 最高优先级】\n'
        '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、```...```、'
        '"让我先查一下古籍" 这类过程性描述。\n'
        '命盘上下文和可用古籍锚点已在本请求给出；直接输出给用户看的回答，不写思考过程、草稿或自我校对。',
        BAZI_OUTPUT_STYLE_PRESET,
        CLASSICAL_QUOTE_POLICY,
        '【输出格式】纯文本或极简 Markdown。\n'
        '- 回复长度随内容走，写透为止，不要自行截断；复杂问题可以展开到 1200-2500 字，不要为了显得简短而省略关键推理\n'
        '- 关键判断要落到命盘里具体的干支/十神/分数，不要悬空下结论\n'
        '- 引用古籍时用「」包裹原文，立刻接白话，再接命盘对应；没有锚点时不硬引原文',
    ])


def _clip_text(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


def _render_client_context(client_context: dict[str, Any] | None) -> str:
    if not isinstance(client_context, dict):
        return ""

    lines: list[str] = ["【当前界面上下文】"]
    view = _clip_text(client_context.get("view"), 40)
    context_label = _clip_text(client_context.get("context_label"), 80)
    if view:
        lines.append(f"当前视图：{view}")
    if context_label:
        lines.append(f"当前焦点：{context_label}")

    raw_classics = client_context.get("classics")
    classics = raw_classics if isinstance(raw_classics, list) else []
    visible_classics = [item for item in classics if isinstance(item, dict)][:CLIENT_CONTEXT_MAX_CLASSICS]
    if visible_classics:
        lines.append("左侧古籍旁证（供理解用户说“上面/第几条/这段”时的指代；不替代本轮动态检索）：")
        for idx, item in enumerate(visible_classics, start=1):
            title_parts = [
                _clip_text(item.get("source"), 40),
                _clip_text(item.get("scope"), 80),
            ]
            title = " · ".join(part for part in title_parts if part) or "古籍旁证"
            lines.append(f"{idx}. {title}")
            quote = _clip_text(item.get("quote") or item.get("text"), CLIENT_CONTEXT_QUOTE_MAX)
            plain = _clip_text(item.get("plain"), CLIENT_CONTEXT_NOTE_MAX)
            match = _clip_text(item.get("match"), CLIENT_CONTEXT_NOTE_MAX)
            if quote:
                lines.append(f"   原文：{quote}")
            if plain:
                lines.append(f"   白话：{plain}")
            if match:
                lines.append(f"   对照本盘：{match}")

    return "\n".join(lines) if len(lines) > 1 else ""


def _render_memory_summary(memory_summary: str | None) -> str:
    summary = _clip_text(memory_summary, 3200)
    if not summary:
        return ""
    return (
        "【长期对话记忆】\n"
        "这是较早对话的压缩摘要，用来保持连续性；若与本轮用户新说法冲突，以本轮为准。\n"
        f"{summary}"
    )


def build_messages(
    paipan: dict, history: list[dict],
    user_message: str, intent: str,
    retrieved: list[dict],
    client_context: dict[str, Any] | None = None,
    memory_summary: str | None = None,
    hepan_summary: str | None = None,
) -> list[dict]:
    """Build expert messages (system + prebudgeted history + user with time anchor).

    NOTE: prompts.js:604-656.

    ``hepan_summary``: 调用方拿 services.hepan.context.recent_hepan_summaries_for_user
    生成的 1-N 行 plain text，描述用户跟谁有过合盘。空串就跳过 — 没合过
    盘的用户不会被这段碎信息打扰。
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

    rendered_memory = _render_memory_summary(memory_summary)
    if rendered_memory:
        parts.append(rendered_memory)

    # Hepan 关系记忆 — 跟 memory_summary 一样属于"用户长期事实"，紧挨着摆。
    # 用 .strip() 防御传入的字符串带前后空行；空串自然跳过。
    if hepan_summary and hepan_summary.strip():
        parts.append(hepan_summary.strip())

    # Chart slice
    sliced = pick_chart_slice(paipan, intent)
    if sliced:
        ctx = compact_chart_context(sliced)
        if ctx:
            parts.append(ctx)

    rendered_client_context = _render_client_context(client_context)
    if rendered_client_context:
        parts.append(rendered_client_context)

    # Classical anchor (skip for chitchat)
    # NOTE: terse=False — chat path needs full classical text (up to PER_SOURCE_MAX
    # ≈ 2500 chars × ~3 sources within TOTAL_MAX 6000) so LLM can quote 古籍 in
    # depth. terse=True (200-char truncation) was the Plan 6 default and made
    # chat replies feel thin compared to sections (which always used terse=False).
    # See investigation notes in commit message.
    if intent != "chitchat":
        anchor = build_classical_anchor(retrieved or [], terse=False)
        if anchor:
            parts.append(anchor)

    # Media-token reminder placed last in system so its recency bias keeps the
    # LLM from defaulting to 书名号 / markdown links when mentioning specific
    # songs / movies / books. The full rule lives in shards/core.md but core
    # is buried mid-prompt and gets ignored.
    parts.append(
        "【最后强调 — 提到歌曲/电影/书籍时】\n"
        "如果回答中要提到具体歌曲、电影或书籍，**必须**用结构化标记：\n"
        "  歌曲 → [[song:歌名|艺人]]\n"
        "  电影 → [[movie:片名|导演]]，导演拿不准时 [[movie:片名]]\n"
        "  书籍 → [[book:书名|作者]]\n"
        "**绝不要**用《XX》、《XX - 艺人》、markdown 链接 [X](Y) 或单层 [...] 替代。"
        "用户问\"用一首歌/电影/书形容\"这类时尤其要遵守。例：\n"
        "  ✓ 推荐 [[movie:肖申克的救赎|弗兰克·德拉邦特]]\n"
        "  ✗ 推荐《肖申克的救赎》"
    )

    # Time anchor — prepended to user msg (highest-attention slot)
    # Flat paipan carries todayYmd / todayYearGz / todayMonthGz directly.
    year_gz = (paipan or {}).get("todayYearGz") or ""
    if year_gz:
        today_ymd = (paipan or {}).get("todayYmd") or ""
        month_gz = (paipan or {}).get("todayMonthGz") or ""
        anchor_line = (
            "【当前时间锚】今天 " + today_ymd + "，年柱 " + year_gz
            + (("，月柱 " + month_gz) if month_gz else "")
            + '。所有"今年/明年/最近"默认以此为基准，不要自己另行推断。\n\n'
        )
    else:
        anchor_line = ""

    history_window = history or []
    return [
        {"role": "system", "content": "\n\n".join(parts)},
        *history_window,
        {"role": "user", "content": anchor_line + user_message},
    ]
