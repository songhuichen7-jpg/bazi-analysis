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


def test_build_messages_history_max_8():
    history = [{"role": "user", "content": f"q{i}"} for i in range(20)]
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=history,
        user_message="新", intent="other", retrieved=[],
    )
    assert len(msgs) == 10  # 1 system + 8 history + 1 user


def test_build_messages_chitchat_skips_chart_context():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="你好", intent="chitchat", retrieved=[],
    )
    sys = msgs[0]["content"]
    # chitchat → pick_chart_slice returns None → no chart block
    assert "【命盘上下文】" not in sys


def test_build_messages_includes_intent_guide():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="今年运气", intent="timing", retrieved=[],
    )
    assert "【本轮：时机/大运流年】" in msgs[0]["content"]


def test_fallback_style_present():
    assert isinstance(FALLBACK_STYLE, str)
    assert len(FALLBACK_STYLE) > 50
