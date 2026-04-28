from __future__ import annotations

import pytest


def chart_with_food_god_frame() -> dict:
    return {
        "sizhu": {"year": "癸酉", "month": "己未", "day": "丁酉", "hour": "丁未"},
        "rizhu": "丁",
        "shishen": {"year": "七杀", "month": "食神", "hour": "比肩"},
        "dayStrength": "身弱",
        "geju": "食神格",
        "geJu": {
            "mainCandidate": {
                "name": "食神格",
                "shishen": "食神",
            },
        },
        "force": {
            "scores": {
                "食神": 10.0,
                "偏财": 4.4,
                "七杀": 3.3,
                "偏印": 0.3,
            },
        },
        "yongshen": "甲木",
        "yongshenDetail": {
            "primary": "甲木",
            "primaryReason": "以调候为主",
            "candidates": [
                {
                    "method": "调候",
                    "name": "甲木",
                    "supporting": "壬水",
                    "source": "穷通宝鉴·论丁火·六月",
                },
                {
                    "method": "格局",
                    "name": "财（食神生财）",
                    "sub_pattern": "食神生财",
                    "source": "子平真诠·论食神",
                },
                {
                    "method": "扶抑",
                    "name": "印 / 比劫",
                    "source": "滴天髓·衰旺",
                },
            ],
        },
    }


def chart_with_autumn_jia_seven_killings() -> dict:
    return {
        "sizhu": {"year": "壬午", "month": "庚申", "day": "甲子", "hour": "丁卯"},
        "rizhu": "甲",
        "shishen": {"year": "偏印", "month": "七杀", "hour": "伤官"},
        "dayStrength": "身弱",
        "geju": "七杀格",
        "geJu": {
            "mainCandidate": {
                "name": "七杀格",
                "shishen": "七杀",
            },
        },
        "force": {
            "scores": {
                "七杀": 9.6,
                "偏印": 5.2,
                "偏财": 3.1,
            },
        },
        "yongshen": "丁火",
        "yongshenDetail": {
            "primary": "丁火",
            "primaryReason": "七月甲木，以调候兼制杀为先",
            "candidates": [
                {
                    "method": "调候",
                    "name": "丁火",
                    "supporting": "庚金",
                    "source": "穷通宝鉴·论甲木·七月",
                },
                {
                    "method": "格局",
                    "name": "七杀",
                    "source": "子平真诠·论偏官",
                },
                {
                    "method": "扶抑",
                    "name": "印 / 食伤制杀",
                    "source": "滴天髓·衰旺",
                },
            ],
        },
    }


def chart_with_anonymous_autumn_jia_killing() -> dict:
    return {
        "sizhu": {"year": "壬午", "month": "庚申", "day": "甲子", "hour": "丁卯"},
        "rizhu": "甲",
        "shishen": {"year": "偏印", "month": "七杀", "hour": "伤官"},
        "dayStrength": "身弱",
        "geju": "七杀格",
        "geJu": {
            "mainCandidate": {
                "name": "七杀格",
                "source": "月令本气透出",
                "via": "庚",
                "shishen": "七杀",
            },
        },
        "force": {
            "scores": {
                "七杀": 10.0,
                "偏印": 4.1,
                "伤官": 2.9,
                "正印": 1.8,
                "偏财": 0.9,
            },
        },
        "yongshen": "丁火",
        "yongshenDetail": {
            "primary": "丁火",
            "primaryReason": "以调候为主",
            "candidates": [
                {
                    "method": "调候",
                    "name": "丁火",
                    "supporting": "庚金",
                    "note": "木性枯槁，丁火为尊，庚金不可少",
                    "source": "穷通宝鉴·论甲木·七月",
                },
                {
                    "method": "格局",
                    "name": "七杀（无制无化）",
                    "sub_pattern": "裸杀",
                    "note": "七杀失制失化，偏烈为忧",
                    "source": "子平真诠·论偏官",
                },
                {
                    "method": "扶抑",
                    "name": "印 / 比劫",
                    "note": "身衰喜帮助，取印比中有根者为先",
                    "source": "滴天髓·衰旺",
                },
            ],
        },
    }


@pytest.mark.asyncio
async def test_meta_retrieval_uses_chart_structure_beyond_day_master_month_branch():
    from app.retrieval.service import retrieve_for_chart

    hits = await retrieve_for_chart(chart_with_food_god_frame(), "meta")
    sources = [hit["source"] for hit in hits]

    assert sources[0] == "穷通宝鉴 · 三夏丁火"
    assert "子平真诠·论食神" in sources
    assert "滴天髓·衰旺" in sources
    assert any("气候" in source or "寒暖" in source or "燥湿" in source for source in sources)
    if "子平真诠·论用神" in sources:
        assert sources.index("子平真诠·论食神") < sources.index("子平真诠·论用神")


@pytest.mark.asyncio
async def test_user_message_guides_special_geju_excerpt_selection():
    from app.retrieval.service import retrieve_for_chart

    hits = await retrieve_for_chart(
        chart_with_food_god_frame(),
        "special_geju",
        user_message="魁罡格到底要不要看",
    )

    sanming = next(hit for hit in hits if hit["source"] == "三命通会·卷六·特殊格局")
    assert sanming["scope"] == "heading:魁罡"
    assert "魁罡" in sanming["text"]


@pytest.mark.asyncio
async def test_meta_retrieval_keeps_broad_classic_chapters_for_llm_screening():
    from app.retrieval.service import retrieve_for_chart

    hits = await retrieve_for_chart(chart_with_autumn_jia_seven_killings(), "meta")

    ditian = next(hit for hit in hits if hit["source"] == "滴天髓·衰旺")
    assert ditian["chars"] > 1200
    assert "能知衰旺之真机" in ditian["text"]
    assert "甲辰\n\n丁卯" in ditian["text"]
    assert ditian["scope"] == "full"


@pytest.mark.asyncio
async def test_meta_retrieval_adds_exact_lexical_evidence_for_autumn_jia_killing():
    from app.retrieval.service import retrieve_for_chart

    hits = await retrieve_for_chart(chart_with_anonymous_autumn_jia_killing(), "meta")
    sources = [hit["source"] for hit in hits]

    assert "滴天髓·理气" in sources
    assert "子平真诠·论印绶" in sources

    liqi = next(hit for hit in hits if hit["source"] == "滴天髓·理气")
    assert "甲木休困已极" in liqi["text"]
    assert "用火敌杀明矣" in liqi["text"]

    if "子平真诠·论财" in sources:
        assert sources.index("子平真诠·论印绶") < sources.index("子平真诠·论财")


@pytest.mark.asyncio
async def test_qiongtong_extracts_season_frame_before_month_detail():
    from app.retrieval.service import retrieve_for_chart

    hits = await retrieve_for_chart(chart_with_anonymous_autumn_jia_killing(), "meta")
    qiongtong = hits[0]

    assert qiongtong["source"] == "穷通宝鉴 · 三秋甲木"
    assert "三秋甲木，木性枯藁" in qiongtong["text"]
    assert "七月甲木，丁火为尊，庚金次之，庚金不可少" in qiongtong["text"]
    assert qiongtong["text"].index("三秋甲木") < qiongtong["text"].index("七月甲木")
