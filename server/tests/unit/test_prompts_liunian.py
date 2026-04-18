"""app.prompts.liunian — ports prompts.js:709-758."""
from __future__ import annotations

import pytest

from tests.unit._chart_fixtures import sample_chart


def test_build_liunian_messages_happy():
    from app.prompts.liunian import build_messages
    msgs = build_messages(sample_chart(), retrieved=[], dayun_index=1, year_index=3)
    assert any(m["role"] == "system" for m in msgs)


def test_build_liunian_messages_out_of_range():
    from app.prompts.liunian import build_messages
    with pytest.raises((ValueError, IndexError)):
        build_messages(sample_chart(), retrieved=[], dayun_index=99, year_index=0)
