from __future__ import annotations

import os
import asyncio

import pytest

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://placeholder:placeholder@localhost:1/placeholder")
os.environ.setdefault("ENCRYPTION_KEK", "00" * 32)


def anonymous_autumn_jia_chart() -> dict:
    return {
        "sizhu": {"year": "壬午", "month": "庚申", "day": "甲子", "hour": "丁卯"},
        "rizhu": "甲",
        "shishen": {"year": "偏印", "month": "七杀", "hour": "伤官"},
        "dayStrength": "身弱",
        "geju": "七杀格",
        "geJu": {"mainCandidate": {"name": "七杀格", "shishen": "七杀"}},
        "force": {"scores": {"七杀": 10.0, "偏财": 4.1, "正印": 1.8}},
        "yongshen": "丁火",
        "yongshenDetail": {
            "primary": "丁火",
            "primaryReason": "以调候为主",
            "candidates": [
                {"method": "调候", "name": "丁火", "supporting": "庚金", "source": "穷通宝鉴·论甲木·七月"},
                {"method": "格局", "name": "七杀（无制无化）", "source": "子平真诠·论偏官"},
                {"method": "扶抑", "name": "印 / 比劫", "source": "滴天髓·衰旺"},
            ],
        },
    }


def test_parse_llm_retrieval_plan_accepts_queries_and_sources():
    from app.retrieval.llm_plan import parse_llm_retrieval_plan

    plan = parse_llm_retrieval_plan(
        """
        ```json
        {
          "ids": ["C001", "C039", "C001"],
          "queries": ["甲木 庚金 丁火 用火敌杀", "煞重身轻 身轻印重", "甲木 庚金 丁火 用火敌杀"],
          "sources": ["滴天髓·理气", "子平真诠·论印绶"]
        }
        ```
        """
    )

    assert plan["ids"] == ["C001", "C039"]
    assert plan["queries"] == ["甲木 庚金 丁火 用火敌杀", "煞重身轻 身轻印重"]
    assert plan["sources"] == ["滴天髓·理气", "子平真诠·论印绶"]


def test_classics_index_table_lets_llm_pick_chapters_by_id():
    from app.retrieval.classics_index import build_classics_index_table, entry_for_file

    table = build_classics_index_table()
    liqi = entry_for_file("ditian-sui/tong-shen-lun_05_li-qi.md")
    pian_guan = entry_for_file("ziping-zhenquan/39_lun-pian-guan.md")
    guan_sha = entry_for_file("ditian-sui/tong-shen-lun_21_guan-sha.md")
    jia = entry_for_file("qiongtong-baojian/02_lun-jia-mu.md")

    assert liqi is not None
    assert pian_guan is not None
    assert guan_sha is not None
    assert jia is not None
    assert f"[{liqi.id}] 滴天髓·理气" in table
    assert f"[{pian_guan.id}] 子平真诠·论偏官" in table
    assert f"[{guan_sha.id}] 滴天髓·官杀" in table
    assert f"[{jia.id}] 穷通宝鉴·论甲木" in table
    assert "三秋甲木" in table
    assert "领域:官杀处理 / 七杀格 / 制化" in table
    assert "领域:官杀处理 / 制杀 / 财星坏印" in table
    assert "领域:调候用神 / 日干月令" in table


def test_retrieval_plan_prompt_includes_docs_bazi_reading_method():
    from app.retrieval.classics_guidance import build_skill_direct_index_table
    from app.retrieval.classics_index import entry_for_file
    from app.retrieval.llm_plan import build_llm_retrieval_plan_messages

    guan_sha = entry_for_file("ditian-sui/tong-shen-lun_21_guan-sha.md")
    pian_guan = entry_for_file("ziping-zhenquan/39_lun-pian-guan.md")
    assert guan_sha is not None
    assert pian_guan is not None

    messages = build_llm_retrieval_plan_messages(
        anonymous_autumn_jia_chart(),
        "meta",
        "古籍判词",
    )
    prompt = "\n".join(message["content"] for message in messages)

    assert "docs/bazi-analysis/classical-references.md" in prompt
    assert "先判断命盘问题域，再翻目录" in prompt
    assert "skill 常用章节直查索引" in prompt
    assert "七杀格 ->" in prompt
    assert "skill旧路径:ziping-zhenquan/29_lun-pian-guan.md" in prompt
    assert "官杀处理=子平真诠·论偏官 + 滴天髓·官杀" in prompt
    assert "穷通宝鉴的读法" in prompt
    assert f"[{pian_guan.id}] 子平真诠·论偏官 | 领域:官杀处理" in prompt
    assert f"[{guan_sha.id}] 滴天髓·官杀 | 领域:官杀处理" in prompt

    skill_index = build_skill_direct_index_table()
    assert "寒暖（调候） ->" in skill_index
    assert "文件:ditian-sui/tong-shen-lun_29_han-nuan.md" in skill_index
    assert "skill旧路径:ditian-sui/tong-shen-lun_26_han-nuan.md" in skill_index


def test_query_routes_prefer_structural_prose_over_generic_aphorisms():
    from app.retrieval.llm_plan import _query_routes

    routes = _query_routes(["甲木 七月 庚金 丁火", "煞重身轻 用火敌杀", "七杀 身弱 用印"], limit=5)
    labels = [route["label"] for route in routes]

    assert labels[0] == "滴天髓·理气"
    assert "渊海子平·渊源集说、子平百章论科甲歌" not in labels
    assert "滴天髓·干支总论" not in labels


@pytest.mark.asyncio
async def test_meta_retrieval_uses_llm_plan_before_rule_routes(monkeypatch):
    from app.retrieval import llm_plan, service
    from app.retrieval.classics_index import entry_for_file

    liqi = entry_for_file("ditian-sui/tong-shen-lun_05_li-qi.md")
    yin = entry_for_file("ziping-zhenquan/35_lun-yin-shou.md")
    assert liqi is not None
    assert yin is not None

    async def _fake_llm(**kwargs):
        assert kwargs["disable_thinking"] is False
        assert kwargs["max_tokens"] >= 1800
        content = "\n".join(message["content"] for message in kwargs["messages"])
        assert "命盘上下文" in content
        assert "古籍查阅法" in content
        assert "官杀处理=子平真诠·论偏官 + 滴天髓·官杀" in content
        assert "古籍索引表" in content
        assert f"[{liqi.id}] 滴天髓·理气" in content
        assert "只输出 JSON" in content
        return f'{{"ids":["{liqi.id}","{yin.id}"]}}', "deepseek-v4-pro"

    monkeypatch.setattr(llm_plan.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_plan, "chat_once_with_fallback", _fake_llm)
    monkeypatch.setattr(service, "_context_routes", lambda *args: [])
    monkeypatch.setattr(llm_plan, "_query_routes", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("keyword search should not run")))

    hits = await service.retrieve_for_chart(anonymous_autumn_jia_chart(), "meta")
    sources = [hit["source"] for hit in hits]

    assert "滴天髓·理气" in sources
    assert "子平真诠·论印绶" in sources
    liqi = next(hit for hit in hits if hit["source"] == "滴天髓·理气")
    assert "甲木休困已极" in liqi["text"]
    assert "用火敌杀明矣" in liqi["text"]


@pytest.mark.asyncio
async def test_meta_retrieval_does_not_duplicate_qiongtong_full_chapter(monkeypatch):
    from app.retrieval import llm_plan, service
    from app.retrieval.classics_index import entry_for_file

    jia = entry_for_file("qiongtong-baojian/02_lun-jia-mu.md")
    liqi = entry_for_file("ditian-sui/tong-shen-lun_05_li-qi.md")
    assert jia is not None
    assert liqi is not None

    async def _fake_llm(**kwargs):
        return f'{{"ids":["{jia.id}","{liqi.id}"]}}', "deepseek-v4-pro"

    monkeypatch.setattr(llm_plan.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_plan, "chat_once_with_fallback", _fake_llm)
    monkeypatch.setattr(service, "_context_routes", lambda *args: [])

    hits = await service.retrieve_for_chart(anonymous_autumn_jia_chart(), "meta")
    sources = [hit["source"] for hit in hits]

    assert "穷通宝鉴 · 三秋甲木" in sources
    assert "穷通宝鉴·论甲木" not in sources
    assert "滴天髓·理气" in sources


@pytest.mark.asyncio
async def test_llm_planned_routes_timeout_returns_empty(monkeypatch):
    from app.retrieval import llm_plan

    async def _slow(**kwargs):
        await asyncio.sleep(0.05)
        return '{"ids":["C001"]}', "deepseek-v4-pro"

    monkeypatch.setattr(llm_plan.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm_plan, "PLAN_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(llm_plan, "chat_once_with_fallback", _slow)

    assert await llm_plan.llm_planned_routes(anonymous_autumn_jia_chart(), "meta") == []
