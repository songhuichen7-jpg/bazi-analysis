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

    # Polished item from 穷通 plus a fallback for 三命通会 that the LLM dropped.
    assert len(out) == 2
    assert out[0]["source"] == "穷通宝鉴 · 论甲木"
    assert out[0]["scope"] == "三秋甲木"
    assert out[0]["text"] == "七月甲木，丁火为尊，庚金次之。"
    assert out[0]["quote"] == "七月甲木，丁火为尊，庚金次之。"
    assert out[0]["plain"] == "七月甲木先看丁火调候，再看庚金成器。"
    assert out[0]["match"] == "本盘甲木生申月，庚透月干，丁火只藏支内。"
    assert out[0]["original_text"] == RAW_HITS[0]["text"]
    assert out[0]["chars"] == len(out[0]["text"])
    assert out[1]["source"] == RAW_HITS[1]["source"]
    assert out[1]["file"] == RAW_HITS[1]["file"]
    prompt = "\n".join(m["content"] for m in seen_messages)
    assert "可以加标点" in prompt
    assert "不要把意译冒充逐字原文" in prompt


@pytest.mark.asyncio
async def test_polish_classics_keeps_dropped_books_via_fallback(monkeypatch):
    """If the LLM drops every hit from a chapter_file that was in input,
    the dropped book must come back via local fallback so the panel stays
    representative of the retrieval anchors."""
    from app.services import classics_polisher

    async def fake_chat_once_with_fallback(**kwargs):
        return json.dumps({
            "items": [
                {
                    "id": "0",
                    "quote": "七月甲木，丁火为尊，庚金次之。",
                    "plain": "申月先丁后庚。",
                    "match": "本盘甲木生申月，庚透月干。",
                }
            ]
        }, ensure_ascii=False), "fake-model"

    monkeypatch.setattr(classics_polisher, "chat_once_with_fallback", fake_chat_once_with_fallback)

    out = await classics_polisher.polish_classics_for_chart(
        {"sizhu": {"month": "庚申", "day": "甲戌"}},
        RAW_HITS,
    )

    files_in_out = {item.get("file") for item in out}
    assert {RAW_HITS[0]["file"], RAW_HITS[1]["file"]} <= files_in_out


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
    # LLM 的 wrong-source plain/match 不应该挂到 fallback 上 — 应该被替换成
    # 通用 fallback 文案,告诉用户"白话翻译生成失败,刷新重试",而不是把
    # 错误归因的评注留在错误源下。
    from app.services.classics_polisher import _FALLBACK_PLAIN, _FALLBACK_MATCH
    assert out[0]["plain"] == _FALLBACK_PLAIN
    assert out[0]["match"] == _FALLBACK_MATCH
    assert "这句来自别的候选" not in out[0].get("plain", "")
    assert "不应被挂到三命通会名下" not in out[0].get("match", "")


@pytest.mark.asyncio
async def test_polish_classics_recovers_items_with_missing_plain(monkeypatch):
    """LLM 偶尔输出"光秃秃"item (有 quote 但 plain 或 match 留空)。
    这种 item 不应该被原样接受 — 以前会让前端渲染出"古籍原文上面没解释"
    的空白态,看起来像 bug。新行为:把这类 item 踢回 missing,触发 recovery
    LLM 重 polish 一遍,确保所有展示态都带 plain + match。
    """
    from app.services import classics_polisher

    call_count = 0

    async def fake_chat_once_with_fallback(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # 首轮: id=0 完整,id=1 缺 plain 和 match (光秃秃)
            return json.dumps({
                "items": [
                    {
                        "id": "0",
                        "quote": "七月甲木，丁火为尊，庚金次之。",
                        "plain": "七月甲木调候用丁火,成器看庚金。",
                        "match": "本盘庚金透月干,丁火藏支。",
                    },
                    {
                        "id": "1",
                        "quote": "甲日申月为偏官，喜身旺合制。",
                        # 故意没有 plain 和 match
                    },
                ]
            }, ensure_ascii=False), "fake-model"
        # Recovery 轮: 给缺的那条补上 plain/match
        return json.dumps({
            "items": [
                {
                    "id": "0",   # recovery 是只针对 missing,id 在 missing 列表里重排
                    "quote": "甲日申月为偏官，喜身旺合制。",
                    "plain": "甲木日主生在申月,庚金当令成偏官,需要身旺。",
                    "match": "本盘甲木在申月偏官透,日主身弱,要看制化。",
                },
            ]
        }, ensure_ascii=False), "fake-model"

    monkeypatch.setattr(classics_polisher, "chat_once_with_fallback", fake_chat_once_with_fallback)

    out = await classics_polisher.polish_classics_for_chart(
        {"sizhu": {"month": "庚申", "day": "甲戌"}, "dayStrength": "身弱"},
        RAW_HITS,
    )

    # 两条都应该带 plain + match,没有"光秃秃"漏过去。
    assert len(out) == 2
    for item in out:
        assert item.get("plain"), f"item missing plain: {item}"
        assert item.get("match"), f"item missing match: {item}"
    # 而且至少触发了 recovery (否则 call_count 应该只是 1)
    assert call_count >= 2, "缺 plain 的 item 应该触发 recovery 重 polish"
