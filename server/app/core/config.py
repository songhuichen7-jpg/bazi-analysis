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

    # TMDB — optional, used by /api/media/cover for movie posters.
    # No key configured → endpoint falls back to iTunes Movies entity only.
    tmdb_api_key: str = ""

    # Plan 5+ 计费。'manual' 是默认 — 用户在前端点"立即升级"会显示作者
    # 邮箱，作者通过 /api/admin/subscriptions/grant 人工开通。
    # 接入真实渠道时把这里改成 'wechat' / 'alipay'，并把对应的商户号、
    # API key、签名密钥填到下面的字段；同一进程里只能有一个活动 provider，
    # 想 A/B 多个渠道得各起一份服务（足够的隔离）。
    payment_provider: Literal["manual", "wechat", "alipay"] = "manual"

    # 微信支付商户号 + API v3 私钥 + 回调签名 platform-cert / API key v3.
    # 留空时 wechat provider 在初始化阶段直接抛 NotImplementedError。
    wechat_pay_mch_id: str = ""
    wechat_pay_api_v3_key: str = ""
    wechat_pay_private_key_path: str = ""        # PEM 路径
    wechat_pay_serial_no: str = ""
    wechat_pay_notify_url: str = ""              # 回调对外地址（含 https://）

    # 支付宝商户应用 ID + RSA 密钥 / 公钥（PEM 路径或字符串均可）。
    alipay_app_id: str = ""
    alipay_app_private_key: str = ""
    alipay_public_key: str = ""
    alipay_notify_url: str = ""

    # cron loop（lifespan task）每多少秒扫一次到期订阅；0 = 禁用，单元测试用。
    subscription_expire_loop_seconds: int = 3600

    @property
    def mimo_api_key(self) -> str:
        """Backward-compatible alias for older call sites and docs."""
        return self.llm_api_key

    @property
    def mimo_base_url(self) -> str:
        """Backward-compatible alias for older call sites and docs."""
        return self.llm_base_url


settings = Settings()
