"""prompts/expert: chart slice + INTENT_GUIDE + build_messages.

NOTE: archive/server-mvp/prompts.js:472-656.
"""
from __future__ import annotations

import pytest

from app.prompts.expert import (
    FALLBACK_STYLE,
    INTENT_GUIDE,
    build_messages,
    pick_chart_slice,
)


_SAMPLE_PAIPAN = {
    "PAIPAN": {"sizhu": {"year": "甲子", "month": "乙丑", "day": "丙寅", "hour": "丁卯"}},
    "META": {"rizhu": "丙", "rizhuGan": "丙", "dayStrength": "中和",
             "geju": "正官格", "yongshen": "甲木",
             "today": {"ymd": "2026-04-18", "yearGz": "丙午", "monthGz": "壬辰"},
             "input": {"year": 1990, "month": 5, "day": 5, "hour": 14, "minute": 0,
                       "city": "北京", "gender": "male"}},
    "FORCE": [
        {"name": "正财", "val": 5.5}, {"name": "偏财", "val": 1.2},
        {"name": "正官", "val": 7.8}, {"name": "七杀", "val": 2.1},
        {"name": "比肩", "val": 3.0}, {"name": "劫财", "val": 0.5},
        {"name": "食神", "val": 4.0}, {"name": "伤官", "val": 1.5},
        {"name": "正印", "val": 6.0}, {"name": "偏印", "val": 0.8},
    ],
    "GUARDS": [
        {"type": "liuhe", "note": "辰酉合（正财得地）"},
        {"type": "chong", "note": "子午冲"},
        {"type": "pair_mismatch", "note": "正印偏印悬殊"},
    ],
    "DAYUN": [
        {"age": 5, "gz": "丙寅", "ss": "比肩", "startYear": 1995, "endYear": 2004},
        {"age": 15, "gz": "丁卯", "ss": "劫财", "startYear": 2005, "endYear": 2014},
        {"age": 25, "gz": "戊辰", "ss": "食神", "startYear": 2015, "endYear": 2024},
        {"age": 35, "gz": "己巳", "ss": "伤官", "startYear": 2025, "endYear": 2034},
    ],
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


def test_pick_chart_slice_other_returns_full():
    assert pick_chart_slice(_SAMPLE_PAIPAN, "other") == _SAMPLE_PAIPAN


def test_pick_chart_slice_relationship_filters_force():
    s = pick_chart_slice(_SAMPLE_PAIPAN, "relationship")
    names = {f["name"] for f in s["FORCE"]}
    assert names == {"正财", "偏财", "正官", "七杀", "比肩", "劫财"}


def test_pick_chart_slice_career_keeps_official_food_seal():
    s = pick_chart_slice(_SAMPLE_PAIPAN, "career")
    names = {f["name"] for f in s["FORCE"]}
    assert names == {"正官", "七杀", "食神", "伤官", "正印", "偏印"}


def test_pick_chart_slice_timing_window_around_current():
    """Today=2026 in 4th dayun (35-44, 己巳). Window = max(0,idx-1)..idx+3."""
    s = pick_chart_slice(_SAMPLE_PAIPAN, "timing")
    # idx=3 → slice [2..6) → indices 2,3 (only 2 entries beyond)
    assert len(s["DAYUN"]) >= 2
    # Verify current dayun is in the slice
    gzs = {d["gz"] for d in s["DAYUN"]}
    assert "己巳" in gzs


def test_build_messages_prepends_time_anchor_to_user_message():
    history = [{"role": "user", "content": "之前问题"}, {"role": "assistant", "content": "之前回答"}]
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=history,
        user_message="今年我适合换工作吗",
        intent="career", retrieved=[],
    )
    assert msgs[0]["role"] == "system"
    # last message must be user with anchor prepended
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
    # 1 system + 8 history + 1 user
    assert len(msgs) == 10


def test_build_messages_chitchat_skips_chart_and_classical():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="你好", intent="chitchat", retrieved=[],
    )
    sys = msgs[0]["content"]
    # chitchat goes through FALLBACK_STYLE, not the chart context
    assert "【用户命盘】" not in sys


def test_build_messages_includes_intent_guide():
    msgs = build_messages(
        paipan=_SAMPLE_PAIPAN, history=[],
        user_message="今年运气", intent="timing", retrieved=[],
    )
    assert "【本轮：时机/大运流年】" in msgs[0]["content"]


def test_fallback_style_present():
    assert isinstance(FALLBACK_STYLE, str)
    assert len(FALLBACK_STYLE) > 50
