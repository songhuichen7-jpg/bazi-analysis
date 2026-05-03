"""prompts/expert: chart slice + INTENT_GUIDE + build_messages.

NOTE: deviation from archive/server-mvp/prompts.js:472-562 — pick_chart_slice
operates on the FLAT chart.paipan shape used by the Python paipan engine,
not the JS UI-shape. FORCE/GUARDS filtering is dropped (data not in shape).
"""
from __future__ import annotations

import pytest

from app.prompts.expert import (
    FALLBACK_STYLE,
    INTENT_GUIDE,
    build_messages,
    pick_chart_slice,
)


# Flat shape — matches the engine output stored in chart.paipan.
_SAMPLE_PAIPAN = {
    "sizhu": {"year": "甲子", "month": "乙丑", "day": "丙寅", "hour": "丁卯"},
    "shishen": {"year": "正印", "month": "比肩", "day": "", "hour": "正印"},
    "cangGan": {"year": [], "month": [], "day": [], "hour": []},
    "naYin": {"year": "海中金", "month": "海中金", "day": "炉中火", "hour": "炉中火"},
    "rizhu": "丙",
    "todayYmd": "2026-04-18",
    "todayYearGz": "丙午",
    "todayMonthGz": "壬辰",
    "dayun": {
        "list": [
            {"ganZhi": "丙寅", "shiShen": "比肩", "startAge": 5,  "startYear": 1995, "endYear": 2004},
            {"ganZhi": "丁卯", "shiShen": "劫财", "startAge": 15, "startYear": 2005, "endYear": 2014},
            {"ganZhi": "戊辰", "shiShen": "食神", "startAge": 25, "startYear": 2015, "endYear": 2024},
            {"ganZhi": "己巳", "shiShen": "伤官", "startAge": 35, "startYear": 2025, "endYear": 2034},
            {"ganZhi": "庚午", "shiShen": "偏财", "startAge": 45, "startYear": 2035, "endYear": 2044},
        ],
    },
}


def test_intent_guide_covers_all_chat_intents():
    expected = {
        "relationship", "career", "wealth", "timing", "personality",
        "health", "meta", "chitchat", "other", "appearance", "special_geju",
        "liunian", "dayun_step",
    }
    assert expected.issubset(set(INTENT_GUIDE.keys()))


def test_pick_chart_slice_chitchat_returns_none():
    assert pick_chart_slice(_SAMPLE_PAIPAN, "chitchat") is None


def test_pick_chart_slice_other_returns_input_unchanged():
    """Non-timing, non-chitchat intents pass through (no FORCE/GUARDS to filter)."""
    s = pick_chart_slice(_SAMPLE_PAIPAN, "other")
    assert s is _SAMPLE_PAIPAN
    s2 = pick_chart_slice(_SAMPLE_PAIPAN, "career")
    assert s2 is _SAMPLE_PAIPAN
    s3 = pick_chart_slice(_SAMPLE_PAIPAN, "relationship")
    assert s3 is _SAMPLE_PAIPAN


def test_pick_chart_slice_timing_windows_dayun_around_current():
    """today=2026 lives in idx=3 (己巳). Window = dayun[max(0,2):6] = dayun[2:6]."""
    s = pick_chart_slice(_SAMPLE_PAIPAN, "timing")
    assert s is not _SAMPLE_PAIPAN  # new dict
    windowed = s["dayun"]["list"]
    gzs = [d["ganZhi"] for d in windowed]
    assert "己巳" in gzs
    assert len(windowed) <= 4
    # The original is not mutated
    assert len(_SAMPLE_PAIPAN["dayun"]["list"]) == 5


def test_pick_chart_slice_timing_with_no_match_falls_back_to_first_three():
    """If no dayun contains today's year, take the first 3 steps."""
    p = {**_SAMPLE_PAIPAN, "todayYmd": "1900-01-01"}
    s = pick_chart_slice(p, "timing")
    windowed = s["dayun"]["list"]
    # First 3 from sample
    assert [d["ganZhi"] for d in windowed] == ["丙寅", "丁卯", "戊辰"]


def test_pick_chart_slice_returns_none_on_empty_paipan():
    assert pick_chart_slice({}, "career") is None
    assert pick_chart_slice(None, "career") is None


def test_build_messages_includes_chart_context_for_non_chitchat():
    """Critical: chart-context block must reach the LLM for normal intents."""
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="今年我适合换工作吗",
        intent="career", retrieved=[],
    )
    sys = msgs[0]["content"]
    # compact_chart_context emits "【命盘上下文】" — must be present
    assert "【命盘上下文】" in sys
    # And key chart fields make it through
    assert "丙" in sys           # rizhu
    assert "甲子" in sys         # year sizhu


def test_build_messages_prepends_time_anchor_to_user_message():
    history = [{"role": "user", "content": "之前问题"}, {"role": "assistant", "content": "之前回答"}]
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=history,
        user_message="今年我适合换工作吗",
        intent="career", retrieved=[],
    )
    last = msgs[-1]
    assert last["role"] == "user"
    assert "【当前时间锚】" in last["content"]
    assert "今年我适合换工作吗" in last["content"]


def test_build_messages_uses_prebudgeted_history_without_local_eight_message_cutoff():
    history = [{"role": "user", "content": f"q{i}"} for i in range(20)]
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=history,
        user_message="新", intent="other", retrieved=[],
    )
    assert len(msgs) == 22  # 1 system + 20 prebudgeted history + 1 user
    assert [m["content"] for m in msgs[1:21]] == [f"q{i}" for i in range(20)]


def test_build_messages_includes_client_page_context_for_references():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN,
        history=[],
        user_message="上面第一条是什么意思",
        intent="career",
        retrieved=[],
        client_context={
            "view": "chart",
            "context_label": "戊午大运",
            "classics": [
                {
                    "source": "穷通宝鉴",
                    "scope": "论甲木 · 三秋甲木",
                    "quote": "七月甲木，丁火为尊，庚金次之。",
                    "plain": "七月甲木先看丁火，再看庚金。",
                    "match": "本盘甲木生申月，庚透而丁藏。",
                }
            ],
        },
    )
    sys = msgs[0]["content"]
    assert "【当前界面上下文】" in sys
    assert "当前焦点：戊午大运" in sys
    assert "穷通宝鉴 · 论甲木 · 三秋甲木" in sys
    assert "七月甲木，丁火为尊，庚金次之。" in sys
    assert "本盘甲木生申月，庚透而丁藏。" in sys


def test_build_messages_includes_long_term_conversation_memory():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN,
        history=[],
        user_message="继续讲刚才那个判断",
        intent="career",
        retrieved=[],
        memory_summary="用户之前重点关心七杀格、丁火用神、癸水阻丁，以及古籍旁证是否贴盘。",
    )
    sys = msgs[0]["content"]
    assert "【长期对话记忆】" in sys
    assert "七杀格" in sys
    assert "癸水阻丁" in sys


def test_build_messages_chitchat_skips_chart_context():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="你好", intent="chitchat", retrieved=[],
    )
    sys = msgs[0]["content"]
    # chitchat → pick_chart_slice returns None → no chart block
    assert "【命盘上下文】" not in sys


def test_build_messages_artifact_rules_gate_weather_and_scent_cards():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN,
        history=[],
        user_message="最近天气不好会影响我吗",
        intent="other",
        retrieved=[],
    )
    sys = msgs[0]["content"]

    assert "天气 → [[weather:天气名|一句短说明]]，只在用户明确要求用天气形容时使用" in sys
    assert "气味/香水 → [[scent:气味名|两三个气味层次]]，只在用户明确要求用气味/味道/香水形容时使用" in sys
    assert "书籍 → [[book:书名|作者]]" in sys


def test_build_messages_includes_intent_guide():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="今年运气", intent="timing", retrieved=[],
    )
    assert "【本轮：时机/大运流年】" in msgs[0]["content"]


def test_build_messages_includes_docs_bazi_output_style():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="今年我适合换工作吗",
        intent="career", retrieved=[],
    )
    sys = msgs[0]["content"]
    assert "【输出风格预设 — 对齐 docs/bazi-analysis §0】" in sys
    assert "像一个懂命理的朋友在聊天" in sys
    assert "内部 checklist" in sys
    assert "不要把结论都包成 A/B/C 标签" in sys


def test_build_messages_does_not_invite_free_classical_quotes():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="古籍怎么看这盘",
        intent="career", retrieved=[],
    )
    sys = msgs[0]["content"]
    assert "只引用本请求提供的古籍原文锚点" in sys
    assert "训练数据中的任何原文都可自由引用" not in sys
    assert "直接引用即可" not in sys


def test_fallback_style_present():
    assert isinstance(FALLBACK_STYLE, str)
    assert len(FALLBACK_STYLE) > 50
