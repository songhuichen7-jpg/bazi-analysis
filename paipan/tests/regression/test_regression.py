"""
Oracle-driven regression test.

For each fixture file, load the birth_input, run paipan.compute(),
and deep-diff against the Node engine's expected output.

Before compute() is implemented, all cases xfail. As modules are ported,
cases progressively pass.
"""
from __future__ import annotations
import json
import pathlib
import sys
import pytest

# Add regression directory to path so we can import deep_diff
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from deep_diff import deep_diff, format_diff

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"


def _load_fixtures() -> list[pathlib.Path]:
    return sorted(FIXTURES_DIR.glob("*.json"))


@pytest.mark.parametrize("fixture_path", _load_fixtures(), ids=lambda p: p.stem)
def test_regression(fixture_path: pathlib.Path) -> None:
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    case_id = data["case_id"]
    birth_input = data["birth_input"]
    expected = data["expected"]

    try:
        from paipan import compute
    except ImportError:
        pytest.xfail("compute() not yet implemented")

    actual = compute(**birth_input)
    actual_dict = actual.model_dump() if hasattr(actual, "model_dump") else actual

    diffs = deep_diff(actual_dict, expected, float_tolerance=1e-9)
    if diffs:
        pytest.fail(f"Regression diff for {case_id}:\n{format_diff(diffs)}")
