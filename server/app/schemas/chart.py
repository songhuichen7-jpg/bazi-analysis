"""Pydantic request/response schemas for /api/charts/*.

Separate from app/models/chart.py (ORM). Encrypted fields (birth_input /
paipan / label) are encoded as plain dicts/strings here; the ORM layer
handles actual encryption transparently.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ---- request bodies ---------------------------------------------------


class BirthInput(BaseModel):
    """paipan.compute() kwargs 的 1:1 映射。字段名/类型完全沿用 paipan。"""

    # NOTE: spec §2.1 / paipan.compute() signature
    year: int = Field(..., ge=1900, le=2100)
    month: int = Field(..., ge=1, le=12)
    day: int = Field(..., ge=1, le=31)
    # hour=-1 表示时辰未知；其余 0..23
    hour: int = Field(..., ge=-1, le=23)
    minute: int = Field(0, ge=0, le=59)
    city: str | None = Field(None, max_length=40)
    longitude: float | None = Field(None, ge=-180, le=180)
    gender: Literal["male", "female"]
    ziConvention: Literal["early", "late"] = "early"
    useTrueSolarTime: bool = True


class ChartCreateRequest(BaseModel):
    birth_input: BirthInput
    label: str | None = Field(None, max_length=40)


class ChartLabelUpdateRequest(BaseModel):
    label: str | None = Field(None, max_length=40)


# ---- response bodies --------------------------------------------------


class CacheSlot(BaseModel):
    kind: Literal["verdicts", "section", "dayun_step", "liunian"]
    key: str
    has_cache: bool
    model_used: str | None = None
    regen_count: int = 0
    generated_at: datetime | None = None


class ChartListItem(BaseModel):
    id: UUID
    label: str | None
    engine_version: str
    cache_stale: bool
    created_at: datetime
    updated_at: datetime


class ChartDetail(BaseModel):
    id: UUID
    label: str | None
    birth_input: BirthInput
    paipan: dict
    engine_version: str
    created_at: datetime
    updated_at: datetime


class ChartResponse(BaseModel):
    chart: ChartDetail
    cache_slots: list[CacheSlot] = Field(default_factory=list)
    cache_stale: bool
    # POST 时含 paipan.warnings；其他路由为空
    warnings: list[str] = Field(default_factory=list)


class ChartListResponse(BaseModel):
    items: list[ChartListItem]
