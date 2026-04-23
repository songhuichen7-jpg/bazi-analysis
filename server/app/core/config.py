"""Application settings loaded from environment.

Settings are instantiated at module import time — tests must set env vars
BEFORE importing any app module. See server/tests/conftest.py.
"""
from __future__ import annotations

from typing import Literal

from pydantic import PostgresDsn
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

    # Plan 5 LLM config
    mimo_api_key: str = ""                       # dev/test 留空 OK（集成测试 mock client）
    mimo_base_url: str = "https://api.xiaomimimo.com/v1"
    llm_model: str = "mimo-v2-pro"
    llm_fast_model: str = "mimo-v2-flash"
    llm_fallback_model: str = "mimo-v2-flash"
    llm_stream_first_delta_ms: int = 0           # 0 = 禁用；B 阶段生产调 8000

    bazi_repo_root: str = ""                     # 空字符串 = 运行时推断

    # Plan 8 (share card MVP): admin analytics endpoint
    admin_token: str = ""  # empty disables admin endpoint entirely


settings = Settings()
