# Retrieval2 Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve classical retrieval precision so each question type reliably surfaces the most relevant book/chapter excerpts before the LLM writes an answer.

**Architecture:** Add a lightweight policy layer on top of existing BM25 + KG retrieval. The policy layer boosts authoritative books/chapters per intent, rejects obvious wrong-domain candidates, and gives the selector enough tag/source context to choose better final hits.

**Tech Stack:** Python 3.12, FastAPI server package, pure-Python retrieval2 index, pytest.

**Status:** Implemented and verified on 2026-04-29.

---

### Task 1: Regression Cases

**Files:**
- Modify: `server/tests/unit/retrieval2/test_retrieval2.py`

- [x] Add a compact in-memory index with intentionally competing candidates for relationship, wealth, timing, and tiaohou.
- [x] Write failing tests that prove:
  - relationship queries prefer `滴天髓·夫妻` over `子女`
  - wealth queries prefer wealth/cai authorities over generic verses
  - liunian queries prefer 行运/岁运 chapters
  - tiaohou queries prefer matching `穷通宝鉴` day-gan/month chapter
- [ ] Run:

```bash
ENV=test ENCRYPTION_KEK=0000000000000000000000000000000000000000000000000000000000000000 DATABASE_URL=postgresql+asyncpg://placeholder:placeholder@localhost:1/placeholder PYTHONPATH=server uv run --package server pytest --confcutdir=server/tests/unit/retrieval2 server/tests/unit/retrieval2 -q
```

Expected before implementation: at least one new precision test fails.

### Task 2: Retrieval Policy Layer

**Files:**
- Create: `server/app/retrieval2/policy.py`
- Modify: `server/app/retrieval2/service.py`

- [x] Implement `RetrievalPolicy` with:
  - `boost(claim, tags) -> float`
  - `reject(claim, tags) -> bool`
  - `selector_hint` text
- [x] Map intent kinds to authority preferences:
  - `relationship`: prefer 夫妻/夫星/妻星; reject 子女 for spouse questions
  - `wealth`: prefer 财星/财气/财格 authority chapters
  - `dayun_step`, `liunian`, `timing`: prefer 行运/岁运/取运 chapters
  - `health`: prefer 疾病/偏枯 chapters
  - `appearance`: prefer 三命通会性情相貌
  - tiaohou-like `meta`: prefer matching 穷通宝鉴 day-gan/month-zhi claims
- [x] Add a policy channel into `_gather_candidates()` and normalized `_fuse()`.
- [x] Keep fallback behavior: no policy match still returns BM25/KG candidates.

### Task 3: Selector Context

**Files:**
- Modify: `server/app/retrieval2/selector.py`
- Modify: `server/app/retrieval2/service.py`

- [x] Include candidate tags and source path in the selector prompt.
- [x] Include the policy hint and hard reject guidance.
- [x] Preserve current JSON output contract.
- [x] Keep selector failure fallback deterministic.

### Task 4: Verification

**Files:**
- No production files unless tests expose a final issue.

- [x] Run retrieval2 unit tests.
- [x] Run prompt anchor tests.
- [x] Run frontend classics/API node tests.
- [x] Run several live sample retrievals with `use_selector=False` and `use_selector=True`.
- [x] Report remaining weak areas separately from verified fixes.
