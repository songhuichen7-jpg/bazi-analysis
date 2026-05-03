"""prompts/router: keyword fast-path + LLM router prompt + JSON parser.

NOTE: archive/server-mvp/prompts.js:367-466.
"""
from __future__ import annotations

import pytest

from app.prompts.router import (
    INTENTS,
    KEYWORDS,
    PRIORITY,
    build_messages,
    classify_by_keywords,
    parse_router_json,
)


def test_intents_list_complete():
    # NOTE: "media" 是后加的 intent — "用一首歌/电影/书形容我" 类比喻题
    # 走这个标签，前端把答里的 [[song:...]] / [[movie:...]] / [[book:...]]
    # token 渲染成媒体卡片。当时 INTENTS 加了 media 但这条测试没改。
    expected = {
        "relationship", "career", "wealth", "timing",
        "personality", "health", "meta", "chitchat", "other",
        "dayun_step", "liunian", "appearance", "special_geju",
        "divination",
        "media",
    }
    assert set(INTENTS) == expected


@pytest.mark.parametrize("text,expected_intent", [
    ("我下周该不该跳槽", "divination"),
    ("今年运气怎么样", "timing"),
    ("我和老公感情", "relationship"),
    ("我长得帅吗", "appearance"),
    ("创业能不能成", "divination"),      # "能不能" 命中 divination
    ("飞天禄马是什么", "special_geju"),
    ("七杀是啥意思", "meta"),
    ("我这个人是不是太敏感", "personality"),
    ("最近压力大失眠", "health"),
    ("用一种天气形容我现在的状态", "media"),
    ("用一种气味形容我这盘", "media"),
    ("用香水形容我的关系模式", "media"),
])
def test_classify_by_keywords_priority(text, expected_intent):
    r = classify_by_keywords(text)
    assert r is not None
    assert r["intent"] == expected_intent
    assert r["source"] == "keyword"
    assert r["reason"].startswith("kw:")


def test_classify_by_keywords_chitchat_only_when_short():
    """chitchat 仅在消息 ≤ 8 字时命中，避免长问题被吞."""
    assert classify_by_keywords("你好") is not None
    assert classify_by_keywords("你好").get("intent") == "chitchat"
    long_msg = "你好我想问问我的事业方向"
    r = classify_by_keywords(long_msg)
    assert r is None or r["intent"] != "chitchat"


def test_media_keywords_require_an_explicit_artifact_kind():
    """防误触发：普通"形容我"应回到性格，不要因为泛词直接出卡片。"""
    r = classify_by_keywords("形容一下我的性格")
    assert r is not None
    assert r["intent"] == "personality"


@pytest.mark.parametrize("text", [
    "最近天气不好会影响我吗",
    "这段关系的味道有点复杂",
    "我今天闻到香水以后有点头晕",
])
def test_weather_scent_casual_mentions_do_not_route_to_media(text):
    """只有明确要求"用天气/气味形容"才走媒体卡，普通闲聊不误触发。"""
    r = classify_by_keywords(text)
    assert r is None or r["intent"] != "media"


def test_classify_by_keywords_no_match_returns_none():
    assert classify_by_keywords("ahsdjkfhakjsdf 无关词") is None


def test_build_messages_includes_recent_history_max_4():
    history = [
        {"role": "user", "content": f"问题{i}"} for i in range(10)
    ]
    msgs = build_messages(history=history, user_message="新问题")
    # 1 system + ≤4 history + 1 user
    assert msgs[0]["role"] == "system"
    assert msgs[-1] == {"role": "user", "content": "新问题"}
    history_msgs = msgs[1:-1]
    assert len(history_msgs) <= 4


def test_parse_router_json_happy():
    raw = '{"intent": "career", "reason": "用户在问跳槽"}'
    r = parse_router_json(raw)
    assert r == {"intent": "career", "reason": "用户在问跳槽"}


def test_parse_router_json_with_codeblock_fence():
    raw = '```json\n{"intent": "wealth", "reason": "财运"}\n```'
    r = parse_router_json(raw)
    assert r["intent"] == "wealth"


def test_parse_router_json_invalid_intent_falls_back_other():
    raw = '{"intent": "nonsense", "reason": "?"}'
    r = parse_router_json(raw)
    assert r["intent"] == "other"


def test_parse_router_json_garbage_falls_back_other():
    assert parse_router_json("总之我觉得是事业问题")["intent"] == "other"
    assert parse_router_json("")["intent"] == "other"
    assert parse_router_json(None)["intent"] == "other"


def test_priority_divination_before_timing():
    """问'今年这事能不能成' — 同时含 timing+divination kw, divination 优先."""
    r = classify_by_keywords("今年这事能不能成")
    assert r is not None
    assert r["intent"] == "divination"
