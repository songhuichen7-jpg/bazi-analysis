"""Migration roundtrip: upgrade head → downgrade base → upgrade head."""
from __future__ import annotations

import asyncio

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.fixture
def alembic_config(database_url):
    """Alembic config pointed at the testcontainers Postgres.

    env.py drives an async engine, so keep the asyncpg URL intact.
    """
    cfg = Config("server/alembic.ini")
    cfg.set_main_option("script_location", "server/alembic")
    cfg.set_main_option("sqlalchemy.url", str(database_url))
    return cfg, str(database_url)


EXPECTED_TABLES = {
    "users", "invite_codes", "sessions", "sms_codes",
    "charts", "chart_cache",
    "conversations", "messages",
    "quota_usage", "llm_usage_logs",
    "alembic_version",
}


def _inspect(async_url: str):
    """Return a dict with table names + per-table indexes via async inspector."""
    async def _do():
        engine = create_async_engine(async_url)
        try:
            async with engine.connect() as conn:
                def _collect(sync_conn):
                    insp = inspect(sync_conn)
                    tables = set(insp.get_table_names())
                    idx = {
                        t: {ix["name"] for ix in insp.get_indexes(t)}
                        for t in tables if t != "alembic_version"
                    }
                    return tables, idx
                return await conn.run_sync(_collect)
        finally:
            await engine.dispose()
    return asyncio.run(_do())


def test_upgrade_creates_all_tables(alembic_config):
    cfg, url = alembic_config
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    tables, _ = _inspect(url)
    assert EXPECTED_TABLES.issubset(tables)


def test_downgrade_removes_all_except_alembic_version(alembic_config):
    cfg, url = alembic_config
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    tables, _ = _inspect(url)
    assert tables == {"alembic_version"}
    # Restore head for subsequent tests.
    command.upgrade(cfg, "head")


def test_expected_indexes_present(alembic_config):
    cfg, url = alembic_config
    command.upgrade(cfg, "head")
    _, indexes_by_table = _inspect(url)
    assert "ix_charts_user_created" in indexes_by_table["charts"]
    assert "ix_messages_conv_created" in indexes_by_table["messages"]
    assert "ix_sms_phone_created" in indexes_by_table["sms_codes"]
