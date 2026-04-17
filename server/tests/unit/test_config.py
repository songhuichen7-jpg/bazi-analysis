"""Unit tests for app.core.config.Settings."""
from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_settings_requires_database_url(monkeypatch):
    """Missing DATABASE_URL → ValidationError at construction time."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ENCRYPTION_KEK", "00" * 32)
    # Clear cached settings module
    import sys
    sys.modules.pop("app.core.config", None)
    with pytest.raises(ValidationError):
        from app.core.config import Settings
        Settings()


def test_settings_requires_encryption_kek(monkeypatch):
    """Missing ENCRYPTION_KEK → ValidationError."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h/d")
    monkeypatch.delenv("ENCRYPTION_KEK", raising=False)
    import sys
    sys.modules.pop("app.core.config", None)
    with pytest.raises(ValidationError):
        from app.core.config import Settings
        Settings()


def test_settings_loads_valid_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h/d")
    monkeypatch.setenv("ENCRYPTION_KEK", "aa" * 32)
    monkeypatch.setenv("ENV", "test")
    import sys
    sys.modules.pop("app.core.config", None)
    from app.core.config import Settings
    s = Settings()
    assert s.env == "test"
    assert str(s.database_url).startswith("postgresql+asyncpg://")
    assert s.encryption_kek == "aa" * 32
