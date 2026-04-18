"""app.prompts.chips — ports prompts.js:929-1006."""
from __future__ import annotations

from tests.unit._chart_fixtures import sample_chart


def test_build_chips_messages_shape():
    from app.prompts.chips import build_messages
    msgs = build_messages(sample_chart(), history=[])
    assert isinstance(msgs, list)
    assert any(m["role"] == "system" for m in msgs)


def test_parse_chips_json_happy():
    from app.prompts.chips import parse_chips_json
    out = parse_chips_json('["最近事业运如何？", "婚姻缘分时机？", "什么时候发财？"]')
    assert out == ["最近事业运如何？", "婚姻缘分时机？", "什么时候发财？"]


def test_parse_chips_json_malformed_returns_empty():
    from app.prompts.chips import parse_chips_json
    assert parse_chips_json("") == []
    assert parse_chips_json("not json") == []
    assert parse_chips_json("{}") == []


def test_parse_chips_json_wrapped_in_markdown():
    from app.prompts.chips import parse_chips_json
    raw = "```json\n[\"a\",\"b\",\"c\"]\n```"
    out = parse_chips_json(raw)
    assert out == ["a", "b", "c"]
