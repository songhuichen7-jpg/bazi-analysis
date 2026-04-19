"""Plan 7.1: analyzer parity with JS reference.

Loads server/tests/data/golden_analyzer.json (6 cases captured from the JS
archive/paipan-engine/src/ming/analyze.js). For each case, run paipan.compute()
and assert the output matches the JS output exactly (within rounding tolerance
for floats).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from paipan import compute


GOLDEN = Path(__file__).parent.parent.parent / "server/tests/data/golden_analyzer.json"


@pytest.fixture(scope="module")
def golden():
    return json.loads(GOLDEN.read_text())


@pytest.mark.parametrize("case_id", ["A", "B", "C", "D", "E", "F"])
def test_analyzer_parity(golden, case_id):
    case = golden[case_id]
    inp = case["input"]
    out = compute(
        year=inp["year"],
        month=inp["month"],
        day=inp["day"],
        hour=inp["hour"],
        minute=inp["minute"],
        gender=inp["gender"],
        city=inp["city"],
    )

    assert out["dayStrength"] == case["dayStrength"], f"{case_id}: dayStrength"

    expected_scores = case["scores"]
    actual_scores = out["force"]["scores"]
    for ss_name, expected_val in expected_scores.items():
        actual_val = actual_scores.get(ss_name, 0)
        assert abs(actual_val - expected_val) < 0.05, (
            f"{case_id}: scores[{ss_name}] {actual_val} vs {expected_val}"
        )

    assert out["geJu"]["mainCandidate"]["name"] == case["geju"], f"{case_id}: geju"
    assert out["geJu"]["decisionNote"] == case["gejuNote"], f"{case_id}: gejuNote"

    actual_lh = sorted((x["a"], x["b"]) for x in out["zhiRelations"]["liuHe"])
    expected_lh = sorted((x["a"], x["b"]) for x in case["liuHe"])
    assert actual_lh == expected_lh, f"{case_id}: liuHe"

    actual_ch = sorted((x["a"], x["b"]) for x in out["zhiRelations"]["chong"])
    expected_ch = sorted((x["a"], x["b"]) for x in case["chong"])
    assert actual_ch == expected_ch, f"{case_id}: chong"

    expected_notes = sorted(
        [n for n in case["notes"] if n["type"] == "pair_mismatch"],
        key=lambda x: x["group"],
    )
    actual_notes = sorted(
        [n for n in out["notes"] if n["type"] == "pair_mismatch"],
        key=lambda x: x["group"],
    )
    assert len(actual_notes) == len(expected_notes), f"{case_id}: notes count"
    for actual, expected in zip(actual_notes, expected_notes):
        assert actual["group"] == expected["group"]
        assert actual["dominant"] == expected["dominant"]
