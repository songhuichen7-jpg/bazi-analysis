"""Application settings loaded from environment.

Settings are instantiated at module import time — tests must set env vars
BEFORE importing any app module. See server/tests/conftest.py.
"""
from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["dev", "prod", "test"] = "dev"
    version: str = "0.1.0"
    log_level: str = "INFO"

    # Postgres (asyncpg driver)
    database_url: PostgresDsn

    # 32 字节 KEK，以 64 hex 字符传入；load_kek() 校验并转 bytes
    encryption_kek: str

    # B 阶段邀请制开关；C 阶段设 false 开放注册
    require_invite: bool = True

    # Plan 3+ 预留；Plan 2 不使用
    aliyun_sms_access_key: str | None = None
    aliyun_sms_secret: str | None = None
    aliyun_sms_template: str | None = None

    # Plan 5 LLM config. DeepSeek uses the OpenAI-compatible API.
    llm_api_key: str = Field(
        "",
        validation_alias=AliasChoices("LLM_API_KEY", "DEEPSEEK_API_KEY", "MIMO_API_KEY"),
    )
    llm_base_url: str = Field(
        "https://api.deepseek.com",
        validation_alias=AliasChoices("LLM_BASE_URL", "DEEPSEEK_BASE_URL", "MIMO_BASE_URL"),
    )
    llm_model: str = "deepseek-v4-pro"
    llm_fast_model: str = "deepseek-v4-pro"
    llm_fallback_model: str = "deepseek-v4-pro"
    llm_stream_first_delta_ms: int = 0           # 0 = 禁用；B 阶段生产调 8000

    bazi_repo_root: str = ""                     # 空字符串 = 运行时推断

    # Share-card analytics + WeChat JS-SDK config.
    admin_token: str = ""
    wx_app_id: str = ""
    wx_app_secret: str = ""

    @property
    def mimo_api_key(self) -> str:
        """Backward-compatible alias for older call sites and docs."""
        return self.llm_api_key

    @property
    def mimo_base_url(self) -> str:
        """Backward-compatible alias for older call sites and docs."""
        return self.llm_base_url


settings = Settings()
