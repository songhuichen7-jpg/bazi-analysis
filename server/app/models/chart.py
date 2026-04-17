"""Chart + chart_cache tables."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Chart(Base):
    __tablename__ = "charts"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    # Task 11 will swap these three to EncryptedText / EncryptedJSONB.
    label: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    birth_input: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    paipan: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    engine_version: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                  server_default=text("now()"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ChartCache(Base):
    __tablename__ = "chart_cache"
    __table_args__ = (
        CheckConstraint("kind IN ('verdicts','section','dayun_step','liunian')", name="kind_enum"),
        UniqueConstraint("chart_id", "kind", "key", name="uq_chart_cache_slot"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True,
                                      server_default=text("gen_random_uuid()"))
    chart_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("charts.id", ondelete="CASCADE"), nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    key: Mapped[str] = mapped_column(String(40), nullable=False, server_default=text("''"))
    # Task 11 → EncryptedText
    content: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    model_used: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=text("now()"))
    regen_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
