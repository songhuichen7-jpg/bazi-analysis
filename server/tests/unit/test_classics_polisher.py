from __future__ import annotations

import json

import pytest


RAW_HITS = [
    {
        "source": "穷通宝鉴 · 论甲木",
        "file": "qiongtong-baojian/02_lun-jia-mu.md",
        "scope": "三秋甲木",
        "chars": 31,
        "text": "七月甲木丁火为尊庚金次之若有癸水阻隔便灭丁火",
    },
    {
        "source": "三命通会 · 卷四",
        "file": "sanming-tonghui/juan-04.md",
        "scope": "申月",
        "chars": 25,
        "text": "甲日申月為偏官喜身旺合制忌身弱",
    },
]


@pytest.mark.asyncio
async def test_polish_classics_allows_readable_quote_and_preserves_original(monkeypatch):
    from app.services import classics_polisher

    seen_messages = []

    async def fake_chat_once_with_fallback(**kwargs):
        seen_messages.extend(kwargs["messages"])
        return json.dumps({
            "items": [
                {
                    "id": "0",
                    "quote": "七月甲木，丁火为尊，庚金次之。",
                    "plain": "七月甲木先看丁火调候，再看庚金成器。",
                    "match": "本盘甲木生申月，庚透月干，丁火只藏支内。",
                }
            ]
        }, ensure_ascii=False), "fake-model"

    monkeypatch.setattr(classics_polisher, "chat_once_with_fallback", fake_chat_once_with_fallback)

    out = await classics_polisher.polish_classics_for_chart(
        {"sizhu": {"month": "庚申", "day": "甲戌"}, "dayStrength": "身弱", "yongshen": "丁火"},
        RAW_HITS,
    )

    assert len(out) == 1
    assert out[0]["source"] == "穷通宝鉴 · 论甲木"
    assert out[0]["scope"] == "三秋甲木"
    assert out[0]["text"] == "七月甲木，丁火为尊，庚金次之。"
    assert out[0]["quote"] == "七月甲木，丁火为尊，庚金次之。"
    assert out[0]["plain"] == "七月甲木先看丁火调候，再看庚金成器。"
    assert out[0]["match"] == "本盘甲木生申月，庚透月干，丁火只藏支内。"
    assert out[0]["original_text"] == RAW_HITS[0]["text"]
    assert out[0]["chars"] == len(out[0]["text"])
    prompt = "\n".join(m["content"] for m in seen_messages)
    assert "可以加标点" in prompt
    assert "不要把意译冒充逐字原文" in prompt


@pytest.mark.asyncio
async def test_polish_classics_falls_back_to_raw_hits_on_bad_json(monkeypatch):
    from app.services import classics_polisher

    async def fake_chat_once_with_fallback(**kwargs):
        return "不是 JSON", "fake-model"

    monkeypatch.setattr(classics_polisher, "chat_once_with_fallback", fake_chat_once_with_fallback)

    out = await classics_polisher.polish_classics_for_chart({}, RAW_HITS)

    assert len(out) == len(RAW_HITS)
    assert out[0]["source"] == RAW_HITS[0]["source"]
    assert out[0]["text"] == RAW_HITS[0]["text"]
    assert out[0]["chars"] == len(out[0]["text"])


@pytest.mark.asyncio
async def test_polish_classics_rejects_quote_from_wrong_source(monkeypatch):
    from app.services import classics_polisher

    async def fake_chat_once_with_fallback(**kwargs):
        return json.dumps({
            "items": [
                {
                    "id": "1",
                    "quote": "七月甲木，丁火为尊，庚金次之。",
                    "plain": "这句来自别的候选。",
                    "match": "不应被挂到三命通会名下。",
                }
            ]
        }, ensure_ascii=False), "fake-model"

    monkeypatch.setattr(classics_polisher, "chat_once_with_fallback", fake_chat_once_with_fallback)

    out = await classics_polisher.polish_classics_for_chart(
        {"sizhu": {"month": "庚申", "day": "甲戌"}},
        RAW_HITS,
    )

    assert out[0]["source"] == RAW_HITS[1]["source"]
    assert "七月甲木" not in out[0]["text"]
    assert "甲日申月" in out[0]["text"]
    assert "plain" not in out[0]
    assert "match" not in out[0]
