"""Drop stale users.plan CHECK left behind by 0008.

Revision ID: 0010_drop_stale_plan_enum
Revises: 0009_subscriptions_payments
Create Date: 2026-05-01 00:00:00

0008 加了 ``plan_enum CHECK plan IN ('lite','standard','pro')`` 但原始基线
迁移用的命名约定（ck_<table>_<name>）让原 free/pro CHECK 在数据库里叫
``ck_users_ck_users_plan_enum``（双前缀，是 SQLAlchemy 把 ``name='plan_enum'``
里的 ck_users_ 前缀又拼了一次）。0008 的 DROP IF EXISTS 用的简名 ``plan_enum``
没匹配上，留了一条孤儿约束在那里挡新值（standard / lite）的写入。

这里直接删掉那条 stale 约束，新的 ``plan_enum`` 约束保留，model 里的
CheckConstraint 名同步改成不依赖命名约定的形式（避免再被双前缀）。
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "0010_drop_stale_plan_enum"
down_revision: Union[str, Sequence[str], None] = "0009_subscriptions_payments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 老 free/pro CHECK 的实际名字（被命名约定双前缀过）
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_ck_users_plan_enum")
    # 顺手把 status / role 那两个一起规范化 — 它们没在 0008 改过，但同样是双前缀。
    # 当前内容仍然正确（active/disabled & user/admin），所以重建：
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_ck_users_status_enum")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_ck_users_role_enum")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT status_enum "
        "CHECK (status IN ('active','disabled'))"
    )
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT role_enum "
        "CHECK (role IN ('user','admin'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS status_enum")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS role_enum")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_ck_users_status_enum "
        "CHECK (status IN ('active','disabled'))"
    )
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_ck_users_role_enum "
        "CHECK (role IN ('user','admin'))"
    )
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_ck_users_plan_enum "
        "CHECK (plan IN ('free','pro'))"
    )
