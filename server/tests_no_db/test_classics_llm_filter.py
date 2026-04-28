from __future__ import annotations

import pytest
import os
import asyncio
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://placeholder:placeholder@localhost:1/placeholder")
os.environ.setdefault("ENCRYPTION_KEK", "00" * 32)


def sample_paipan() -> dict:
    return {
        "sizhu": {"year": "癸酉", "month": "己未", "day": "丁酉", "hour": "丁未"},
        "rizhu": "丁",
        "geju": "食神格",
        "dayStrength": "身弱",
        "yongshen": "甲木",
        "yongshenDetail": {
            "primary": "甲木",
            "primaryReason": "以调候为主",
            "candidates": [
                {"method": "格局", "name": "财（食神生财）", "source": "子平真诠·论食神"},
            ],
        },
    }


def sample_hits() -> list[dict]:
    return [
        {"source": "穷通宝鉴 · 三夏丁火", "scope": "六月丁火", "chars": 80, "text": "六月丁火，阴柔退气，专取甲木。"},
        {"source": "子平真诠·论食神", "scope": "full", "chars": 50, "text": "食神生财，美格也。"},
        {"source": "滴天髓·衰旺", "scope": "full", "chars": 50, "text": "能知衰旺之真机。"},
        {"source": "子平真诠·论阳刃", "scope": "full", "chars": 50, "text": "阳刃者，劫财之极。"},
    ]


def autumn_jia_paipan() -> dict:
    return {
        "sizhu": {"year": "壬午", "month": "庚申", "day": "甲子", "hour": "丁卯"},
        "rizhu": "甲",
        "geju": "七杀格",
        "dayStrength": "身弱",
        "yongshen": "丁火",
        "geJu": {"mainCandidate": {"name": "七杀格", "shishen": "七杀"}},
        "yongshenDetail": {
            "primary": "丁火",
            "primaryReason": "以调候为主",
            "candidates": [
                {"method": "格局", "name": "七杀（无制无化）", "source": "子平真诠·论偏官"},
                {"method": "扶抑", "name": "印 / 比劫", "source": "滴天髓·衰旺"},
            ],
        },
    }


def seven_killings_hit() -> dict:
    return {
        "source": "子平真诠·论偏官（七杀）",
        "scope": "full",
        "chars": 280,
        "text": "\n".join([
            "煞以攻身，似非美物，百大贵之格，多存七煞。",
            "有七煞用印者，印能护煞，本非所宜，而印有情，便为贵格。",
            "亦有煞重身轻，用食则身不能当，不若转而就印，虽不通根月令，亦为无情而有情。",
        ]),
    }


def liqi_hit() -> dict:
    text = (
        "甲木休困已极，庚金禄旺克之，一点丁火，难以相对，加之两财生杀，似乎杀重身轻，"
        "不知九月甲木进气，壬水贴身相生，不伤丁火。丁火虽弱，通根身库，戌乃燥土，"
        "火之本根，辰乃湿土，木之余气。天干一生一制，地支又遇长生，四柱生化有情，"
        "五行不争不妒。至丁运科甲连登，用火敌杀明矣。"
    )
    return {"source": "滴天髓·理气", "scope": "full", "chars": len(text), "text": text}


def long_case_hit() -> dict:
    return {
        "source": "滴天髓·衰旺",
        "scope": "full",
        "chars": 420,
        "text": "\n\n".join([
            "能知衰旺之真机，其于三命之奥，思过半矣。",
            "原注：旺则宜泄宜伤，衰则喜帮喜助，子平之理也。",
            "甲辰",
            "丁卯",
            "甲子",
            "此造四支皆木，又逢水生，六木两水，别无他气。",
        ]),
    }


def foreign_case_hit() -> dict:
    return {
        "source": "滴天髓·衰旺",
        "scope": "full",
        "chars": 180,
        "text": "\n\n".join([
            "任氏曰；得时俱为旺论，失令便作衰看，虽是至理，亦死法也。",
            "丁火生于八月，秋金秉令，又全金局。火衰者，似木也。初运己未甲午，火木并旺。",
            "戊土生于巳月，日主未尝不旺，然地支两辰，木之余气亦足。",
        ]),
    }


def weak_general_hit() -> dict:
    return {
        "source": "滴天髓·通关",
        "scope": "full",
        "chars": 24,
        "text": "关内有织女，关外有牛郎，此关若通也，相邀入洞房。",
    }


def test_parse_classics_filter_selection_accepts_json_and_dedupes():
    from app.retrieval.llm_filter import parse_classics_filter_selection

    selected = parse_classics_filter_selection(
        '```json\n{"selected":[{"index":2},{"index":1},{"index":2},{"index":99}]}\n```',
        max_index=4,
        limit=3,
    )

    assert selected == [2, 1]


def test_filter_prompt_surfaces_focused_passages_before_chapter_openers():
    from app.retrieval.llm_filter import build_classics_filter_messages

    messages = build_classics_filter_messages(autumn_jia_paipan(), [seven_killings_hit()], limit=4)
    system = messages[0]["content"]
    content = messages[1]["content"]

    assert "不要复制章节开头总论" in system
    assert "煞重身轻" in content
    assert "行运（对照命局用神" not in content
    assert content.index("亦有煞重身轻") < content.index("煞以攻身")
    assert "可以自由判断" in system
    assert "fit_type" not in system
    assert "direct|principle|analogy" not in system


def test_focus_keeps_conceptual_paragraphs_even_when_they_contain_examples():
    from app.retrieval.service import _chart_search_terms, focus_classic_text, read_classic

    focused = focus_classic_text(
        read_classic("ziping-zhenquan/35_lun-yin-shou.md"),
        _chart_search_terms(autumn_jia_paipan()),
        450,
        include_anchor=False,
    )

    assert "有用偏官者" in focused
    assert "身轻印重" in focused


def test_display_filter_keeps_model_selected_case_tail_with_reason():
    from app.retrieval.llm_filter import parse_classics_display_selection

    source = (
        "有用偏官者，偏官本非美物，藉其生印，不得已而用之。"
        "故必身重印轻，或身轻印重，有所不足，始为有性。"
        "如茅状元命，己巳、癸酉、癸未、庚申，此身轻印重也。"
    )
    out = parse_classics_display_selection(
        '{"selected":[{"index":1,"reason":"这一段把七杀借印的条件和后面的命例连在一起，适合让模型自行判断轻重。","excerpt":"%s"}]}' % source,
        [{"source": "子平真诠·论印绶", "scope": "full", "chars": len(source), "text": source}],
        paipan=autumn_jia_paipan(),
    )

    assert out
    assert "有用偏官者" in out[0]["text"]
    assert "如茅状元命" in out[0]["text"]
    assert "fit_type" not in out[0]
    assert out[0]["match"] == "这一段把七杀借印的条件和后面的命例连在一起，适合让模型自行判断轻重。"


def test_display_filter_keeps_same_day_master_wrong_month_when_llm_explains_relevance():
    from app.retrieval.llm_filter import parse_classics_display_selection

    source = (
        "甲木休困已极，庚金禄旺克之，一点丁火，难以相对。"
        "不知九月甲木进气，壬水贴身相生，不伤丁火。"
    )
    out = parse_classics_display_selection(
        '{"selected":[{"index":1,"reason":"不是七月甲木直断，但同为甲木受庚金压制、以丁火转化，可以保留给模型作深读。","excerpt":"%s"}]}' % source,
        [{"source": "滴天髓·理气", "scope": "full", "chars": len(source), "text": source}],
        paipan=autumn_jia_paipan(),
    )

    assert out
    assert "九月甲木" in out[0]["text"]
    assert "fit_type" not in out[0]
    assert "庚金压制" in out[0]["match"]


def test_display_filter_still_drops_pure_ganzhi_lists():
    from app.retrieval.llm_filter import parse_classics_display_selection

    source = "甲辰\n\n丁卯\n\n甲子"
    out = parse_classics_display_selection(
        '{"selected":[{"index":1,"reason":"模型误选纯排盘。","excerpt":"%s"}]}' % source,
        [{"source": "滴天髓·衰旺", "scope": "full", "chars": len(source), "text": source}],
        paipan=autumn_jia_paipan(),
    )

    assert out == []


@pytest.mark.asyncio
async def test_filter_classics_for_display_uses_llm_copied_excerpts(monkeypatch):
    from app.retrieval import llm_filter

    async def _fake_llm(**kwargs):
        assert kwargs["tier"] == "fast"
        assert kwargs["disable_thinking"] is True
        assert kwargs["max_tokens"] >= 1800
        content = "\n".join(m["content"] for m in kwargs["messages"])
        assert "命盘上下文" in content
        assert "[1] 穷通宝鉴 · 三夏丁火" in content
        assert "excerpt" in content
        return (
            '{"selected":['
            '{"index":3,"excerpt":"能知衰旺之真机。"},'
            '{"index":1,"excerpt":"六月丁火，阴柔退气，专取甲木。"}'
            ']}'
        ), "deepseek-v4-pro"

    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _fake_llm)

    out = await llm_filter.filter_classics_for_display(sample_paipan(), sample_hits())

    assert [hit["source"] for hit in out] == ["滴天髓·衰旺", "穷通宝鉴 · 三夏丁火"]
    assert out[0]["text"] == "能知衰旺之真机。"
    assert out[0]["chars"] == len("能知衰旺之真机。")
    assert out[0]["match"]


@pytest.mark.asyncio
async def test_filter_keeps_explained_foreign_case_examples_when_llm_selects_them(monkeypatch):
    from app.retrieval import llm_filter

    async def _fake_llm(**kwargs):
        return (
            '{"selected":['
            '{"index":1,"reason":"虽非甲木本盘，但用于对照秋金秉令下火弱的气候问题。","excerpt":"丁火生于八月，秋金秉令，又全金局。火衰者，似木也。初运己未甲午，火木并旺。"},'
            '{"index":2,"reason":"本盘为七月甲木，先看调候。","excerpt":"七月甲木，丁火为尊，庚金次之。"}'
            ']}'
        ), "deepseek-v4-pro"

    candidates = [
        foreign_case_hit(),
        {"source": "穷通宝鉴 · 三秋甲木", "scope": "七月甲木", "chars": 18, "text": "七月甲木，丁火为尊，庚金次之。"},
    ]
    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _fake_llm)

    out = await llm_filter.filter_classics_for_display(autumn_jia_paipan(), candidates)
    joined = "\n".join(hit["text"] for hit in out)

    assert "丁火生于八月" in joined
    assert "七月甲木" in joined
    assert all("fit_type" not in hit for hit in out)


@pytest.mark.asyncio
async def test_filter_does_not_supplement_short_llm_selection_with_extra_candidate(monkeypatch):
    from app.retrieval import llm_filter

    async def _fake_llm(**kwargs):
        return (
            '{"selected":['
            '{"index":1,"reason":"本盘为七月甲木，先看调候。","excerpt":"七月甲木，丁火为尊，庚金次之。"},'
            '{"index":3,"reason":"说明煞重身轻时转而用印。","excerpt":"亦有煞重身轻，用食则身不能当，不若转而就印，虽不通根月令，亦为无情而有情。"}'
            ']}'
        ), "deepseek-v4-pro"

    candidates = [
        {"source": "穷通宝鉴 · 三秋甲木", "scope": "七月甲木", "chars": 18, "text": "七月甲木，丁火为尊，庚金次之。"},
        liqi_hit(),
        seven_killings_hit(),
    ]
    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _fake_llm)

    out = await llm_filter.filter_classics_for_display(autumn_jia_paipan(), candidates)

    assert [hit["source"] for hit in out] == [
        "穷通宝鉴 · 三秋甲木",
        "子平真诠·论偏官（七杀）",
    ]
    assert "滴天髓·理气" not in [hit["source"] for hit in out]


@pytest.mark.asyncio
async def test_filter_keeps_llm_selected_excerpts_without_program_replacement(monkeypatch):
    from app.retrieval import llm_filter

    async def _fake_llm(**kwargs):
        return (
            '{"selected":['
            '{"index":1,"reason":"本盘为七月甲木，先看调候。","excerpt":"七月甲木，丁火为尊，庚金次之。"},'
            '{"index":3,"reason":"说明煞重身轻时转而用印。","excerpt":"亦有煞重身轻，用食则身不能当，不若转而就印，虽不通根月令，亦为无情而有情。"},'
            '{"index":4,"reason":"模型认为这段可作旁证时，程序不再替它强行换掉。","excerpt":"关内有织女，关外有牛郎，此关若通也，相邀入洞房。"}'
            ']}'
        ), "deepseek-v4-pro"

    candidates = [
        {"source": "穷通宝鉴 · 三秋甲木", "scope": "七月甲木", "chars": 18, "text": "七月甲木，丁火为尊，庚金次之。"},
        liqi_hit(),
        seven_killings_hit(),
        weak_general_hit(),
    ]
    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _fake_llm)

    out = await llm_filter.filter_classics_for_display(autumn_jia_paipan(), candidates, display_limit=3)
    sources = [hit["source"] for hit in out]

    assert "滴天髓·理气" not in sources
    assert "滴天髓·通关" in sources


@pytest.mark.asyncio
async def test_filter_classics_rejects_llm_excerpts_not_copied_from_source(monkeypatch):
    from app.retrieval import llm_filter

    async def _fake_llm(**kwargs):
        return '{"selected":[{"index":1,"excerpt":"这是模型自己概括出来的话。"}]}', "deepseek-v4-pro"

    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _fake_llm)

    out = await llm_filter.filter_classics_for_display(sample_paipan(), [long_case_hit()])

    assert out[0]["text"] != "这是模型自己概括出来的话。"
    assert "能知衰旺之真机" in out[0]["text"]
    assert "甲辰\n\n丁卯" not in out[0]["text"]
    assert "此造" not in out[0]["text"]


@pytest.mark.asyncio
async def test_filter_classics_for_display_falls_back_when_llm_unavailable(monkeypatch):
    from app.retrieval import llm_filter

    async def _boom(**kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _boom)

    out = await llm_filter.filter_classics_for_display(sample_paipan(), sample_hits(), fallback_limit=3)

    assert [hit["source"] for hit in out] == [
        "穷通宝鉴 · 三夏丁火",
        "子平真诠·论食神",
        "滴天髓·衰旺",
    ]


@pytest.mark.asyncio
async def test_filter_classics_for_display_falls_back_when_llm_is_slow(monkeypatch):
    from app.retrieval import llm_filter

    async def _slow(**kwargs):
        await asyncio.sleep(0.05)
        return '{"selected":[{"index":2,"excerpt":"食神生财，美格也。"}]}', "deepseek-v4-pro"

    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "DISPLAY_FILTER_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _slow)

    out = await llm_filter.filter_classics_for_display(sample_paipan(), sample_hits(), fallback_limit=2)

    assert [hit["source"] for hit in out] == ["穷通宝鉴 · 三夏丁火", "子平真诠·论食神"]


@pytest.mark.asyncio
async def test_filter_fallback_uses_focused_excerpt_for_specific_structure(monkeypatch):
    from app.retrieval import llm_filter

    async def _boom(**kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(llm_filter.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_filter, "chat_once_with_fallback", _boom)

    out = await llm_filter.filter_classics_for_display(autumn_jia_paipan(), [seven_killings_hit()])

    assert "亦有煞重身轻" in out[0]["text"]
    assert out[0]["text"].index("亦有煞重身轻") < out[0]["text"].index("煞以攻身")


@pytest.mark.asyncio
async def test_classics_endpoint_returns_llm_filtered_items(monkeypatch):
    from app.api import charts

    chart = SimpleNamespace(paipan=sample_paipan())
    candidates = sample_hits()
    filtered = [candidates[1], candidates[0]]

    async def _get_chart(db, user, chart_id):
        return chart

    async def _retrieve(paipan, kind):
        assert paipan is chart.paipan
        assert kind == "meta"
        return candidates

    async def _filter(paipan, hits):
        assert paipan is chart.paipan
        assert hits is candidates
        return filtered

    monkeypatch.setattr(charts.chart_service, "get_chart", _get_chart)
    monkeypatch.setattr(charts.retrieval_service, "retrieve_for_chart", _retrieve)
    monkeypatch.setattr(charts, "filter_classics_for_display", _filter)

    response = await charts.get_chart_classics_endpoint(uuid4(), db=None, user=object())

    assert [item.source for item in response.items] == ["子平真诠·论食神", "穷通宝鉴 · 三夏丁火"]
