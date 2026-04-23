"""Pydantic request/response schemas for the share-card API."""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

_HTML_TAG_RE = re.compile(r"<[^>]+>")


class BirthInput(BaseModel):
    year: int = Field(ge=1900, le=2100)
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    hour: int = Field(ge=-1, le=23, description="-1 indicates 'time unknown'")
    minute: int = Field(ge=0, le=59, default=0)
    city: Optional[str] = Field(default=None, max_length=20)


class CardRequest(BaseModel):
    birth: BirthInput
    nickname: Optional[str] = Field(default=None, max_length=10)

    @field_validator("nickname", mode="before")
    @classmethod
    def _strip_html(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        cleaned = _HTML_TAG_RE.sub("", str(v)).strip()
        return cleaned or None


Precision = Literal["4-pillar", "3-pillar"]
State = Literal["绽放", "蓄力"]


class CardResponse(BaseModel):
    type_id: str
    cosmic_name: str
    base_name: str
    state: State
    state_icon: str
    day_stem: str
    one_liner: str
    ge_ju: str
    suffix: str
    subtags: list[str] = Field(min_length=3, max_length=3)
    golden_line: str
    theme_color: str
    illustration_url: str
    precision: Precision
    borderline: bool
    share_slug: str
    nickname: Optional[str]
    version: str
