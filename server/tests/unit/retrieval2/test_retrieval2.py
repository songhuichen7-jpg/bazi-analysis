"""Core unit tests for retrieval2.

Compact and focused — tokenizer, splitter, BM25, KG, intents, selector
parsing, service round-trip — all mocked LLM where needed.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.retrieval2 import (
    QueryIntent,
    bazi_chart_to_intents,
    book_label,
    build_bm25,
    build_kg,
    canonical,
    encode,
    encode_query,
    expand,
    iter_classics,
    load_bm25,
    normalize,
    save_bm25,
    split_chapter,
)
from app.retrieval2.tagger import VOCAB, parse_response
from app.retrieval2.selector import Candidate, parse_picks, select as selector_select
from app.retrieval2.types import ClaimTags, ClaimUnit
from app.retrieval2 import service, storage

REPO_ROOT = Path(__file__).resolve().parents[4]
CLASSICS = REPO_ROOT / "classics"


# ── normalize / synonyms ───────────────────────────────────────────────────


def test_variant_char_fold():
    assert normalize("七煞") == "七杀"


def test_synonym_expansion_煞_to_杀():
    cls = expand("煞")
    assert "杀" in cls


def test_canonical_form():
    assert canonical("煞") == "七杀"
    assert canonical("身轻") == "身弱"


def test_book_label_mapping():
    assert book_label("ziping-zhenquan") == "子平真诠"


# ── tokenizer ──────────────────────────────────────────────────────────────


def test_tokenizer_emits_ngrams_and_synonyms():
    toks = set(encode("七煞重身"))
    assert "煞" not in toks  # variant-folded
    assert "杀" in toks
    assert "七杀" in toks


def test_query_side_includes_synonym_class_members():
    qtoks = set(encode_query("身轻"))
    assert "身弱" in qtoks or "失令" in qtoks


# ── splitter ───────────────────────────────────────────────────────────────


def test_split_known_chapter_yields_well_shaped_claims():
    raw = (CLASSICS / "ziping-zhenquan/35_lun-yin-shou.md").read_text(encoding="utf-8")
    claims = split_chapter("ziping-zhenquan", "ziping-zhenquan/35_lun-yin-shou.md", raw)
    assert claims
    assert all(c.id.startswith("ziping-zhenquan.") for c in claims)
    # NOTE: this chapter has principle+case mixed in every paragraph (the
    # author wrote it that way), so the splitter's coarse kind detector
    # marks everything 'case'. The LLM tagger fixes this via refined_kind.
    assert all(c.kind in {"principle", "case", "heuristic"} for c in claims)
    assert all(18 <= len(c.text) <= 260 for c in claims)


def test_split_pure_principle_paragraph_marked_principle():
    """A paragraph without ganzhi case strings should remain principle."""
    raw = ("# 论用神\n\n用神在月令，配以日干而生克变化，定其格局之高低；"
           "故格局成则贵，败则贱，岂可不细察焉。\n")
    claims = split_chapter("zpzq", "zpzq/test.md", raw)
    assert claims
    assert claims[0].kind == "principle"


def test_split_is_deterministic():
    raw = (CLASSICS / "ziping-zhenquan/35_lun-yin-shou.md").read_text(encoding="utf-8")
    a = split_chapter("ziping-zhenquan", "ziping-zhenquan/35_lun-yin-shou.md", raw)
    b = split_chapter("ziping-zhenquan", "ziping-zhenquan/35_lun-yin-shou.md", raw)
    assert [c.id for c in a] == [c.id for c in b]


def test_iter_classics_covers_all_books():
    seen = {rel.split("/", 1)[0] for rel, _ in iter_classics(CLASSICS)}
    assert seen == {
        "ditian-sui", "qiongtong-baojian", "sanming-tonghui",
        "yuanhai-ziping", "ziping-zhenquan",
    }


# ── BM25 ───────────────────────────────────────────────────────────────────


def _toy_claims() -> list[ClaimUnit]:
    return [
        ClaimUnit(id="a.1", book="x", chapter_file="x/a.md", chapter_title="A",
                  section=None, text="七杀重而身轻者宜用印化煞",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="a.2", book="x", chapter_file="x/a.md", chapter_title="A",
                  section=None, text="正官清纯而身旺乃富贵之造",
                  paragraph_idx=1, kind="principle"),
        ClaimUnit(id="a.3", book="x", chapter_file="x/a.md", chapter_title="A",
                  section=None, text="财格须身强方能任财",
                  paragraph_idx=2, kind="principle"),
    ]


def test_bm25_query_matches_target_claim():
    idx = build_bm25(_toy_claims())
    hits = idx.query("七杀身轻用印", k=3)
    assert hits[0][0] == "a.1"


def test_bm25_synonym_query():
    idx = build_bm25(_toy_claims())
    hits = idx.query("七煞身轻", k=3)
    assert hits and hits[0][0] == "a.1"


def test_bm25_pickle_round_trip(tmp_path):
    idx = build_bm25(_toy_claims())
    p = tmp_path / "bm25.pkl"
    save_bm25(idx, p)
    loaded = load_bm25(p)
    assert loaded is not None
    assert loaded.doc_ids == idx.doc_ids


# ── KG ─────────────────────────────────────────────────────────────────────


def test_kg_constraint_match():
    tags = [
        ClaimTags(claim_id="a", shishen=("七杀",), day_strength=("身弱",)),
        ClaimTags(claim_id="b", shishen=("正官",), day_strength=("身强",)),
        ClaimTags(claim_id="c", shishen=("七杀", "正印"), day_strength=("身弱",)),
    ]
    idx = build_kg(tags)
    matches = idx.match({"shishen": ("七杀",), "day_strength": ("身弱",)})
    assert set(matches) == {"a", "c"}
    assert all(s >= 1.0 for s in matches.values())


def test_kg_constraint_match_requires_all_fields():
    tags = [
        ClaimTags(claim_id="a", shishen=("七杀",), day_strength=("身弱",)),
        ClaimTags(claim_id="partial-shishen", shishen=("七杀",)),
        ClaimTags(claim_id="partial-strength", day_strength=("身弱",)),
    ]
    idx = build_kg(tags)
    matches = idx.match({"shishen": ("七杀",), "day_strength": ("身弱",)})
    assert set(matches) == {"a"}


def test_kg_synonym_term():
    tags = [ClaimTags(claim_id="a", shishen=("七杀",))]
    idx = build_kg(tags)
    assert "a" in idx.match({"shishen": ("煞",)})


# ── intents ────────────────────────────────────────────────────────────────


def _chart_jia_qisha() -> dict:
    return {
        "rizhu": "甲木", "geju": "七杀格", "dayStrength": "身弱",
        "sizhu": {"year": "壬寅", "month": "丁卯", "day": "甲申", "hour": "庚午"},
        "geJu": {"mainCandidate": {"shishen": "七杀"}},
        "yongshenDetail": {
            "candidates": [
                {"method": "扶抑", "name": "印", "source": "滴天髓·衰旺"},
            ],
        },
    }


def _chart_jia_shen_qisha() -> dict:
    return {
        "rizhu": "甲木", "geju": "七杀格", "dayStrength": "身弱",
        "sizhu": {"year": "癸未", "month": "庚申", "day": "甲戌", "hour": "戊辰"},
        "geJu": {
            "mainCandidate": {"name": "七杀格", "shishen": "七杀"},
            "decisionNote": "四孟月 申，庚 透干（本气优先），取七杀格",
        },
        "yongshen": "丁火",
        "yongshenDetail": {
            "primary": "丁火",
            "candidates": [
                {"method": "扶抑", "name": "丁火", "source": "用神"},
            ],
        },
    }


def test_intents_chitchat_returns_empty():
    assert bazi_chart_to_intents(_chart_jia_qisha(), "chitchat") == []


def test_intents_meta_emits_full_axis_set():
    intents = bazi_chart_to_intents(_chart_jia_qisha(), "meta", "杀重身轻怎么办")
    kinds = [i.kind for i in intents]
    assert "tiaohou" in kinds
    assert "main_geju" in kinds
    assert any(k.startswith("yongshen.") for k in kinds)
    assert "domain.meta" in kinds
    assert "combo.shaqing_yinzhong" in kinds  # 七杀 + 身弱
    assert "user_msg" in kinds


def test_intents_main_geju_carries_constraints():
    intents = bazi_chart_to_intents(_chart_jia_qisha(), "meta")
    main = next(i for i in intents if i.kind == "main_geju")
    assert main.constraints["shishen"] == ("七杀",)
    assert main.constraints["day_strength"] == ("身弱",)


def test_intents_liunian_keeps_timing_domain():
    intents = bazi_chart_to_intents(_chart_jia_qisha(), "liunian")
    assert "tiaohou" in [i.kind for i in intents]
    domain = next(i for i in intents if i.kind == "domain.liunian")
    assert domain.constraints["domain"] == ("行运",)


# ── tagger parser ──────────────────────────────────────────────────────────


def test_tagger_response_parser_with_fence_and_extras():
    text = """```json
{"shishen":["七杀"],"yongshen_method":["扶抑","made-up"],
 "authority":0.8,"confidence":0.7,"future":"ok"}
```"""
    parsed = parse_response(text, "x.1")
    assert parsed["shishen"] == ("七杀",)
    assert parsed["yongshen_method"] == ("扶抑",)  # "made-up" filtered out
    assert parsed["authority"] == 0.8
    assert parsed["tagger_confidence"] == 0.7


def test_tagger_response_parser_garbage():
    assert parse_response("not json", "x") == {}
    assert parse_response("[1,2,3]", "x") == {}


def test_vocab_no_duplicates():
    for k, v in VOCAB.items():
        assert len(v) == len(set(v)), f"duplicate in VOCAB[{k}]"


# ── selector parser ────────────────────────────────────────────────────────


def test_selector_picks_parser():
    text = '{"picks":[{"id":"a.1","reason":"直接对题"},{"id":"a.2","reason":""}]}'
    picks = parse_picks(text, valid_ids={"a.1", "a.2", "a.3"})
    assert picks == [("a.1", "直接对题"), ("a.2", "")]


def test_selector_picks_drops_invalid_ids():
    text = '{"picks":[{"id":"unknown","reason":"x"},{"id":"a.1","reason":"y"}]}'
    picks = parse_picks(text, valid_ids={"a.1"})
    assert picks == [("a.1", "y")]


def test_selector_picks_handles_garbage():
    assert parse_picks("not json", valid_ids={"a"}) == []
    assert parse_picks('{"foo": "bar"}', valid_ids={"a"}) == []


def test_selector_successful_partial_pick_is_not_padded(monkeypatch):
    candidates = [
        Candidate(
            claim=ClaimUnit(
                id="good", book="ditian-sui",
                chapter_file="ditian-sui/liu-qin-lun_01_fu-qi.md",
                chapter_title="夫妻", section=None,
                text="夫财以妻论，夫妻之法须看喜忌。",
                paragraph_idx=0, kind="principle",
            ),
            tags=ClaimTags(claim_id="good", domain=("六亲",)),
            fused_score=0.9,
        ),
        Candidate(
            claim=ClaimUnit(
                id="padding", book="qiongtong-baojian",
                chapter_file="qiongtong-baojian/02_lun-jia-mu.md",
                chapter_title="论甲木", section="三春甲木",
                text="甲木调候取用，与婚姻问题不直接相关。",
                paragraph_idx=0, kind="principle",
            ),
            tags=ClaimTags(claim_id="padding", domain=("调候",)),
            fused_score=0.8,
        ),
    ]

    async def fake_call(messages, *, timeout):
        return '{"picks":[{"id":"good","reason":"直接谈夫妻"}]}'

    monkeypatch.setattr("app.retrieval2.selector._call_deepseek", fake_call)
    hits = asyncio.run(selector_select({}, [], "婚姻正缘怎么看", candidates, k=3))
    assert [h.claim.id for h in hits] == ["good"]


def test_selector_llm_failure_still_falls_back_to_fused(monkeypatch):
    candidates = [
        Candidate(
            claim=ClaimUnit(
                id="a", book="ditian-sui",
                chapter_file="ditian-sui/liu-qin-lun_28_sui-yun.md",
                chapter_title="岁运", section=None,
                text="太岁管一年否泰。",
                paragraph_idx=0, kind="principle",
            ),
            tags=ClaimTags(claim_id="a", domain=("行运",)),
            fused_score=0.9,
        ),
        Candidate(
            claim=ClaimUnit(
                id="b", book="ziping-zhenquan",
                chapter_file="ziping-zhenquan/25_lun-xing-yun.md",
                chapter_title="论行运", section=None,
                text="论运与看命无二法。",
                paragraph_idx=0, kind="principle",
            ),
            tags=ClaimTags(claim_id="b", domain=("行运",)),
            fused_score=0.8,
        ),
    ]

    async def fake_call(messages, *, timeout):
        raise TimeoutError("boom")

    monkeypatch.setattr("app.retrieval2.selector._call_deepseek", fake_call)
    hits = asyncio.run(selector_select({}, [], "流年", candidates, k=2))
    assert [h.claim.id for h in hits] == ["a", "b"]


# ── service round-trip with stub selector ─────────────────────────────────


def _build_mini_index(root: Path) -> None:
    p = storage.paths(root)
    claims = [
        ClaimUnit(id="zpzq.35.0007", book="ziping-zhenquan",
                  chapter_file="ziping-zhenquan/35_lun-yin-shou.md",
                  chapter_title="论印绶", section=None,
                  text="有用偏官者，偏官本非美物，藉其生印，不得已而用之。"
                       "故必身重印轻，或身轻印重，有所不足，始为有性。",
                  paragraph_idx=4, kind="principle"),
        ClaimUnit(id="dts.tg.1", book="ditian-sui",
                  chapter_file="ditian-sui/tong-shen-lun_20_tong-guan.md",
                  chapter_title="通关", section=None,
                  text="官煞两停身轻者，喜印通关化煞使日主得用。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="qt.甲.卯月", book="qiongtong-baojian",
                  chapter_file="qiongtong-baojian/02_lun-jia-mu.md",
                  chapter_title="论甲木", section="卯月",
                  text="甲木生于卯月，气候渐和，用丁火洩秀以庚金为佐。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="qt.甲.申月", book="qiongtong-baojian",
                  chapter_file="qiongtong-baojian/02_lun-jia-mu.md",
                  chapter_title="论甲木", section="三秋甲木",
                  text="七月甲木，丁火为尊，庚金次之，庚金不可少。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="smt.甲申月", book="sanming-tonghui",
                  chapter_file="sanming-tonghui/juan-04.md",
                  chapter_title="三命通会 · 卷四", section="申月",
                  text="甲日申月为偏官，喜身旺合制，忌身弱正官运，尤忌再见七杀。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="smt.甲申时", book="sanming-tonghui",
                  chapter_file="sanming-tonghui/juan-08.md",
                  chapter_title="三命通会 · 卷八", section="六甲日申时断",
                  text="甲日壬申时，甲木绝在申，明枭暗鬼，须丙戊制化。",
                  paragraph_idx=0, kind="heuristic"),
        ClaimUnit(id="zpzq.偏官", book="ziping-zhenquan",
                  chapter_file="ziping-zhenquan/39_lun-pian-guan.md",
                  chapter_title="论偏官", section=None,
                  text="煞以攻身，控制得宜，煞为我用；煞重身轻，用食则身不能当，不若转而就印。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="dts.fuqi.1", book="ditian-sui",
                  chapter_file="ditian-sui/liu-qin-lun_01_fu-qi.md",
                  chapter_title="夫妻", section=None,
                  text="夫财以妻论，财神清者不争不妒，四柱配合须分日主衰旺喜忌。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="dts.zinv.1", book="ditian-sui",
                  chapter_file="ditian-sui/liu-qin-lun_02_zi-nv.md",
                  chapter_title="子女", section=None,
                  text="杀重身轻，只要印比，喜神看与杀相连，子女之论不可执一。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="dts.hezhizhang.rich", book="ditian-sui",
                  chapter_file="ditian-sui/liu-qin-lun_05_he-zhi-zhang.md",
                  chapter_title="何知章", section=None,
                  text="何知其人富，财气通门户。身旺财弱无官者，必要有食伤。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="smt.generic.money", book="sanming-tonghui",
                  chapter_file="sanming-tonghui/juan-12.md",
                  chapter_title="三命通会 · 卷十二", section="四言独步",
                  text="喜茂财源，冬天水木泛，名利总虚浮，财官气候须详。",
                  paragraph_idx=0, kind="heuristic"),
        ClaimUnit(id="zpzq.xingyun", book="ziping-zhenquan",
                  chapter_file="ziping-zhenquan/25_lun-xing-yun.md",
                  chapter_title="论行运", section=None,
                  text="论运与看命无二法，岁运干支须配原局喜忌，成格变格各有所宜。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="dts.ganzhi.generic", book="ditian-sui",
                  chapter_file="ditian-sui/tong-shen-lun_09_gan-zhi-zong-lun.md",
                  chapter_title="干支总论", section=None,
                  text="甲申日坐杀印，亦须论岁运太岁，但此为干支泛论不可替代行运专章。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="qt.壬.子月", book="qiongtong-baojian",
                  chapter_file="qiongtong-baojian/10_lun-ren-shui.md",
                  chapter_title="论壬水", section="三冬壬水",
                  text="十一月壬水，阳刃帮身，较前更旺，先取戊土，次用丙火。",
                  paragraph_idx=0, kind="principle"),
        ClaimUnit(id="qt.丙.子月", book="qiongtong-baojian",
                  chapter_file="qiongtong-baojian/04_lun-bing-huo.md",
                  chapter_title="论丙火", section="三冬丙火",
                  text="十一月丙火，冬至一阳生，弱中复强，壬水为最，戊土佐之。",
                  paragraph_idx=0, kind="principle"),
    ]
    tags = [
        ClaimTags(claim_id="zpzq.35.0007", shishen=("七杀", "正印"),
                  day_strength=("身轻",), yongshen_method=("扶抑",), authority=0.95),
        ClaimTags(claim_id="dts.tg.1", shishen=("七杀", "正印"),
                  day_strength=("身轻",), yongshen_method=("通关",), authority=0.9),
        ClaimTags(claim_id="qt.甲.卯月", day_gan=("甲",), month_zhi=("卯",),
                  yongshen_method=("调候",), authority=0.85),
        ClaimTags(claim_id="qt.甲.申月", domain=("调候", "用神取舍", "格局成败"),
                  shishen=("七杀", "伤官"), yongshen_method=("调候", "扶抑"),
                  season=("秋",), day_gan=("甲",), month_zhi=("申",),
                  geju=("七杀格",), authority=0.9),
        ClaimTags(claim_id="smt.甲申月", domain=("格局成败", "用神取舍", "财官"),
                  shishen=("七杀",), yongshen_method=("扶抑", "格局"),
                  day_strength=("身弱",), season=("秋",), day_gan=("甲",),
                  month_zhi=("申",), authority=0.85),
        ClaimTags(claim_id="smt.甲申时", domain=("格局成败",), shishen=("七杀", "偏印"),
                  day_gan=("甲",), month_zhi=("申",), authority=0.7),
        ClaimTags(claim_id="zpzq.偏官", domain=("格局成败",), shishen=("七杀",),
                  day_strength=("身弱",), geju=("七杀格",), authority=0.95),
        ClaimTags(claim_id="dts.fuqi.1", domain=("六亲",), shishen=("正财",),
                  authority=0.95),
        ClaimTags(claim_id="dts.zinv.1", domain=("六亲",), shishen=("七杀", "正印"),
                  day_strength=("身轻",), authority=0.9),
        ClaimTags(claim_id="dts.hezhizhang.rich", domain=("财官",),
                  shishen=("正财", "食神"), day_strength=("身旺",), authority=0.95),
        ClaimTags(claim_id="smt.generic.money", domain=("财官", "调候"),
                  shishen=("正财", "正官"), authority=0.5),
        ClaimTags(claim_id="zpzq.xingyun", domain=("行运",), authority=0.95),
        ClaimTags(claim_id="dts.ganzhi.generic", domain=("行运",), shishen=("七杀",),
                  authority=0.9),
        ClaimTags(claim_id="qt.壬.子月", domain=("调候", "用神取舍"),
                  day_gan=("壬",), month_zhi=("子",), season=("冬",),
                  yongshen_method=("调候",), authority=0.95),
        ClaimTags(claim_id="qt.丙.子月", domain=("调候",),
                  day_gan=("丙",), month_zhi=("子",), season=("冬",),
                  yongshen_method=("调候",), authority=0.85),
    ]
    storage.write_claims(p.claims, claims)
    storage.write_tags(p.tags, tags)
    save_bm25(build_bm25(claims), p.bm25)
    storage.write_manifest(p.manifest, classics_root=Path("/no/such"),
                           file_hashes={}, stats={})


@pytest.fixture
def mini_index(tmp_path, monkeypatch):
    """Builds a tiny on-disk index and patches the selector to a no-LLM stub
    so service tests don't need an API key.

    Stub returns top-K by fused_score (== fallback path)."""
    root = tmp_path / "idx"
    root.mkdir()
    _build_mini_index(root)

    async def stub_select(chart, intents, user_msg, candidates, *, k=6,
                          max_candidates=30, timeout_seconds=20.0, policy_hint=""):
        from app.retrieval2.types import RetrievalHit
        return [
            RetrievalHit(claim=c.claim, tags=c.tags,
                         score=c.fused_score, reason="stub")
            for c in list(candidates)[:k]
        ]

    monkeypatch.setattr("app.retrieval2.selector.select", stub_select)
    service.reset_cache()
    return root


def test_service_returns_v1_shape(mini_index):
    chart = _chart_jia_qisha()
    hits = asyncio.run(service.retrieve_for_chart(
        chart, kind="meta", user_message="杀重身轻怎么办",
        index_root=mini_index,
    ))
    assert hits
    h0 = hits[0]
    assert {"source", "file", "scope", "chars", "text"} <= h0.keys()
    assert h0["chars"] == len(h0["text"])
    assert not h0["scope"].startswith("claim:")


def test_service_returns_display_scope_not_internal_claim_id(mini_index):
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_qisha(), kind="meta", index_root=mini_index,
        use_selector=False,
    ))
    by_file = {h["file"]: h for h in hits}
    assert by_file["qiongtong-baojian/02_lun-jia-mu.md"]["scope"] == "卯月"


def test_service_chitchat_returns_empty(mini_index):
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_qisha(), kind="chitchat", index_root=mini_index,
    ))
    assert hits == []


def test_service_use_selector_false_returns_top_fused(mini_index):
    """use_selector=False is the deterministic fallback path."""
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_qisha(), kind="meta", index_root=mini_index,
        use_selector=False,
    ))
    assert hits


def test_relationship_prefers_spouse_not_children(mini_index):
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_qisha(), kind="relationship", user_message="我的婚姻正缘怎么看",
        index_root=mini_index, use_selector=False, final_k=4,
    ))
    assert hits[0]["file"] == "ditian-sui/liu-qin-lun_01_fu-qi.md"
    assert all("zi-nv" not in h["file"] for h in hits[:3])


def test_wealth_prefers_wealth_authority_over_generic_verse(mini_index):
    chart = {
        "rizhu": "戊土", "geju": "正财格", "dayStrength": "身强",
        "sizhu": {"year": "甲子", "month": "癸亥", "day": "戊午", "hour": "庚申"},
        "geJu": {"mainCandidate": {"shishen": "正财"}},
        "yongshenDetail": {"candidates": [{"method": "扶抑", "name": "财"}]},
    }
    hits = asyncio.run(service.retrieve_for_chart(
        chart, kind="section:wealth", user_message="我的财运和赚钱方式怎么看",
        index_root=mini_index, use_selector=False, final_k=4,
    ))
    assert hits[0]["file"] == "ditian-sui/liu-qin-lun_05_he-zhi-zhang.md"
    assert all("juan-12" not in h["file"] for h in hits[:3])


def test_liunian_prefers_xingyun_authority(mini_index):
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_qisha(), kind="liunian", user_message="今年流年要注意什么",
        index_root=mini_index, use_selector=False, final_k=3,
    ))
    assert hits[0]["file"] == "ziping-zhenquan/25_lun-xing-yun.md"
    assert all("gan-zhi-zong-lun" not in h["file"] for h in hits)


def test_tiaohou_prefers_matching_qiongtong_day_and_month(mini_index):
    chart = {
        "rizhu": "壬水", "geju": "建禄格", "dayStrength": "身强",
        "sizhu": {"year": "癸亥", "month": "壬子", "day": "壬寅", "hour": "丙午"},
        "geJu": {"mainCandidate": {"shishen": "建禄"}},
        "yongshenDetail": {"candidates": [{"method": "调候", "name": "火"}]},
    }
    hits = asyncio.run(service.retrieve_for_chart(
        chart, kind="meta", user_message="冬天壬水调候用什么",
        index_root=mini_index, use_selector=False, final_k=3,
    ))
    assert hits[0]["file"] == "qiongtong-baojian/10_lun-ren-shui.md"
    assert all("juan-12" not in h["file"] for h in hits)


def test_meta_jia_shen_qisha_prefers_core_chart_authorities(mini_index):
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_shen_qisha(), kind="meta",
        index_root=mini_index, use_selector=False, final_k=6,
    ))
    first_files = [h["file"] for h in hits[:6]]
    first_text = "\n".join(h["text"] for h in hits[:6])
    assert any("七月甲木" in h["text"] for h in hits[:3])
    assert any("甲日申月" in h["text"] for h in hits[:4])
    assert "ziping-zhenquan/39_lun-pian-guan.md" in first_files
    assert "sanming-tonghui/juan-08.md" not in first_files
    assert "甲木生于卯月" not in first_text


def test_anchor_priority_combo_day_hour_beats_user_msg():
    """Regression for the 三命通会·六甲日戊辰時斷 disappearance.

    Setup: a 甲日戊辰時 chart asking about 财运. The intents include both
    a `combo.day_hour` BM25 anchor (specific to 甲日戊辰時) and a generic
    `user_msg` BM25 anchor ("我的财运怎么样"). With wealth policy's 4
    `preferred_files`, only ~2 slots remain for non-preferred hits — so
    if `user_msg` anchors are placed before `combo.day_hour` anchors,
    the day-hour-specific 三命通会 chunks get pushed out of the final K.

    The fix ensures combo.day_hour anchors come first in the candidate
    pool, so the day-hour catalog entry survives the preferred-files cut.
    """
    from app.retrieval2.service import _anchor_kind_rank, _is_bm25_anchor_kind

    # The kinds we care about: combo.day_hour ranks lower (= higher priority)
    # than user_msg.
    assert _is_bm25_anchor_kind("combo.day_hour")
    assert _is_bm25_anchor_kind("user_msg")
    assert _anchor_kind_rank("combo.day_hour") < _anchor_kind_rank("user_msg"), (
        "combo.day_hour must outrank user_msg, otherwise generic chat-message "
        "BM25 hits will displace specific 日时诀文 anchors from the final K"
    )
    # All other anchor kinds (combo.*, liu_qin.*, shen_sha.*) should also
    # rank above user_msg.
    for kind in ("combo.gan_xiang", "combo.nv_ming", "combo.current_yun",
                 "liu_qin.specific", "shen_sha.overview", "shen_sha.魁罡"):
        assert _anchor_kind_rank(kind) < _anchor_kind_rank("user_msg"), (
            f"specific anchor {kind!r} must outrank generic user_msg"
        )


def test_meta_jia_shen_qisha_reinserts_preferred_anchors(mini_index, monkeypatch):
    async def stub_select(chart, intents, user_msg, candidates, *, k=6,
                          max_candidates=30, timeout_seconds=20.0, policy_hint=""):
        from app.retrieval2.types import RetrievalHit
        picked = next(c for c in candidates if c.claim.id == "qt.甲.申月")
        return [RetrievalHit(claim=picked.claim, tags=picked.tags,
                             score=picked.fused_score, reason="stub")]

    monkeypatch.setattr("app.retrieval2.selector.select", stub_select)
    hits = asyncio.run(service.retrieve_for_chart(
        _chart_jia_shen_qisha(), kind="meta",
        index_root=mini_index, use_selector=True, final_k=6,
    ))
    files = [h["file"] for h in hits]
    assert "qiongtong-baojian/02_lun-jia-mu.md" in files
    assert "sanming-tonghui/juan-04.md" in files
    assert "ziping-zhenquan/39_lun-pian-guan.md" in files
