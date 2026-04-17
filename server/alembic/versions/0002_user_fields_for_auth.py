"""user_fields_for_auth: allow dek_ciphertext NULL + add agreed_to_terms_at

Revision ID: 0002_user_fields_for_auth
Revises: 0001_baseline
Create Date: 2026-04-17 14:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_user_fields_for_auth"
down_revision: Union[str, Sequence[str], None] = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("agreed_to_terms_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("users", "dek_ciphertext", nullable=True)


def downgrade() -> None:
    op.alter_column("users", "dek_ciphertext", nullable=False)
    op.drop_column("users", "agreed_to_terms_at")
