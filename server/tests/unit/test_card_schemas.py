from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.card import BirthInput, CardRequest, CardResponse


def test_birth_input_accepts_hour_minus_one_for_unknown():
    b = BirthInput(year=1998, month=7, day=15, hour=-1, minute=0)
    assert b.hour == -1


def test_birth_input_rejects_year_out_of_range():
    with pytest.raises(ValidationError):
        BirthInput(year=1800, month=1, day=1, hour=-1, minute=0)


def test_birth_input_rejects_invalid_month():
    with pytest.raises(ValidationError):
        BirthInput(year=1998, month=13, day=1, hour=-1, minute=0)


def test_birth_input_rejects_hour_24():
    with pytest.raises(ValidationError):
        BirthInput(year=1998, month=7, day=15, hour=24, minute=0)


def test_card_request_nickname_optional_and_length_capped():
    r = CardRequest(birth=BirthInput(year=1998, month=7, day=15, hour=14, minute=0))
    assert r.nickname is None
    with pytest.raises(ValidationError):
        CardRequest(
            birth=BirthInput(year=1998, month=7, day=15, hour=14, minute=0),
            nickname="x" * 11,
        )


def test_card_request_strips_html_from_nickname():
    r = CardRequest(
        birth=BirthInput(year=1998, month=7, day=15, hour=14, minute=0),
        nickname="<script>小满</script>",
    )
    assert r.nickname == "小满"


def test_card_response_all_required_fields_present():
    resp = CardResponse(
        type_id="01",
        cosmic_name="春笋",
        base_name="参天木命",
        state="绽放",
        state_icon="⚡",
        day_stem="甲",
        one_liner="越压越往上长",
        ge_ju="食神",
        suffix="天生享乐家",
        subtags=["冲上去再说", "人缘自己来", "会吃会玩也会赚"],
        golden_line="我不卷，但我什么都不缺",
        theme_color="#2D6A4F",
        illustration_url="/static/cards/illustrations/01-chunsun.png",
        precision="4-pillar",
        borderline=False,
        share_slug="c_a9f3b2k1xx",
        nickname="小满",
        version="v4.0-2026-04",
    )
    assert resp.type_id == "01"
