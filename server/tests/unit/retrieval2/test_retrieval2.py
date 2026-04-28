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
from app.retrieval2.selector import Candidate, parse_picks
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
    ]
    tags = [
        ClaimTags(claim_id="zpzq.35.0007", shishen=("七杀", "正印"),
                  day_strength=("身轻",), yongshen_method=("扶抑",), authority=0.95),
        ClaimTags(claim_id="dts.tg.1", shishen=("七杀", "正印"),
                  day_strength=("身轻",), yongshen_method=("通关",), authority=0.9),
        ClaimTags(claim_id="qt.甲.卯月", day_gan=("甲",), month_zhi=("卯",),
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
                          max_candidates=30, timeout_seconds=20.0):
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
    assert h0["scope"].startswith("claim:")


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
