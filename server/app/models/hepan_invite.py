"""Hepan (合盘) invite record. One row per A-creates-invitation event.

Privacy notes:
  - We do NOT store either side's raw birthdate. Only the derived
    (type_id, state, day_stem) snapshot needed to reconstruct the
    composed reading. (Matches CardShare's privacy posture.)
  - birth_hash columns are stored for de-duplication / abuse signals
    only — they are SHA-256 of the local birth tuple, not reversible.

Lifecycle:
  - status='pending' when A creates the invite (B not in yet).
  - status='completed' when B opens the link and submits their birth.
  - share_count tracks GET /api/hepan/{slug} hits for analytics.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class HepanInvite(Base):
    __tablename__ = "hepan_invites"

    slug: Mapped[str] = mapped_column(String(12), primary_key=True)

    # ── A side (always present) ────────────────────────────────────────
    a_birth_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    a_type_id: Mapped[str] = mapped_column(String(2), nullable=False)
    a_state: Mapped[str] = mapped_column(String(4), nullable=False)  # 绽放/蓄力
    a_day_stem: Mapped[str] = mapped_column(String(2), nullable=False)
    a_nickname: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    # ── B side (filled in after invitee submits) ───────────────────────
    b_birth_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    b_type_id: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    b_state: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    b_day_stem: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    b_nickname: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")

    # ── Bookkeeping ────────────────────────────────────────────────────
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    share_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
