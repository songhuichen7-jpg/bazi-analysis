"""Account-side tables: users, invite_codes, sessions, sms_codes."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, SmallInteger,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import INET, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("status IN ('active','disabled')", name="status_enum"),
        CheckConstraint("role IN ('user','admin')", name="role_enum"),
        CheckConstraint("plan IN ('free','pro')", name="plan_enum"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    phone: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    phone_hash: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, unique=True)
    phone_last4: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    nickname: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'user'"))
    plan: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'free'"))
    plan_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True,
    )
    used_invite_code_id: Mapped[Optional[UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("invite_codes.id", ondelete="RESTRICT"), nullable=True,
    )
    wechat_openid: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    wechat_unionid: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    # KEK-encrypted per-user DEK (not itself DEK-encrypted; users has no DEK context yet).
    dek_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    dek_key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    created_by: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))


class UserSession(Base):
    # NOTE: class renamed from Session to avoid shadowing sqlalchemy.orm.Session
    # in downstream imports. Table name stays "sessions".
    __tablename__ = "sessions"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=text("now()"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SmsCode(Base):
    __tablename__ = "sms_codes"
    __table_args__ = (
        CheckConstraint("purpose IN ('register','login','bind')", name="purpose_enum"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
