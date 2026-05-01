"""Cache classics polish output + persistent guest_token

Revision ID: 0006_classics_cache_and_guest_token
Revises: 0005_conversation_summaries
Create Date: 2026-05-01 00:00:00

Two changes bundled because they're both for the beta-tester flow:

1. ``chart_cache.kind`` enum: add ``'classics'`` so we can cache the
   30–40s LLM polish output of ``GET /charts/{id}/classics`` instead of
   re-running it on every page load.

2. ``users.guest_token`` (nullable, unique): a stable opaque token the
   browser stores in localStorage. Same device → same guest account →
   charts and history persist across sessions, instead of every visit
   creating a fresh user.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_classics_cache_guest"
down_revision: Union[str, Sequence[str], None] = "0005_conversation_summaries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. chart_cache: relax kind enum to include 'classics'
    op.drop_constraint("ck_chart_cache_kind_enum", "chart_cache", type_="check")
    op.create_check_constraint(
        "ck_chart_cache_kind_enum",
        "chart_cache",
        "kind IN ('verdicts','section','dayun_step','liunian','classics')",
    )

    # 2. users.guest_token: stable opaque per-device key for guest accounts
    op.add_column(
        "users",
        sa.Column("guest_token", sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_users_guest_token",
        "users",
        ["guest_token"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_users_guest_token", "users", type_="unique")
    op.drop_column("users", "guest_token")

    op.drop_constraint("ck_chart_cache_kind_enum", "chart_cache", type_="check")
    op.create_check_constraint(
        "ck_chart_cache_kind_enum",
        "chart_cache",
        "kind IN ('verdicts','section','dayun_step','liunian')",
    )
