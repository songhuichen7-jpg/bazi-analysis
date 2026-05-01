"""Pydantic request/response schemas for /api/auth/*.

Schemas are the HTTP-layer contract. They do NOT share fields with
``app/models/*`` (ORM). Fields like ``phone`` (raw) never appear in responses —
only ``phone_last4`` does.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ---- request bodies ---------------------------------------------------

SmsPurpose = Literal["register", "login", "bind"]


class SmsSendRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    purpose: SmsPurpose


class RegisterRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    code: str = Field(pattern=r"^\d{6}$")
    invite_code: str | None = Field(default=None, min_length=4, max_length=16)
    nickname: str | None = Field(default=None, max_length=40)
    agreed_to_terms: bool


class LoginRequest(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{11,15}$")
    code: str = Field(pattern=r"^\d{6}$")


class GuestLoginRequest(BaseModel):
    """前端可选传入 guest_token（来自 localStorage）；后端按 token 找回
    已绑定的访客账号，否则创建一个新访客并把 token 存下来。"""
    guest_token: str | None = Field(default=None, max_length=64)


class AccountDeleteRequest(BaseModel):
    # NOTE: must match literal — protects against accidental account loss.
    confirm: Literal["DELETE MY ACCOUNT"]


# ---- response bodies --------------------------------------------------


class SmsSendResponse(BaseModel):
    expires_in: int = 300
    # Dev-only field; only present when settings.env == "dev".
    # Using a double-underscore prefix so any accidental logger + toJSON
    # pass through obvious grep filters.
    devCode: str | None = Field(default=None, alias="__devCode")

    model_config = {"populate_by_name": True}


class UserResponse(BaseModel):
    id: UUID
    phone_last4: str
    nickname: str | None
    role: Literal["user", "admin"]
    plan: Literal["free", "pro"]
    plan_expires_at: datetime | None
    created_at: datetime


class MeResponse(BaseModel):
    user: UserResponse
    # Plan 3 returns {} placeholder; Plan 4 fills {kind: {used, limit, reset_at}}.
    quota_snapshot: dict = Field(default_factory=dict)


class SessionResponse(BaseModel):
    id: UUID
    user_agent: str | None
    ip: str | None
    created_at: datetime
    last_seen_at: datetime
    is_current: bool


class AccountDeleteResponse(BaseModel):
    shredded_at: datetime


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
