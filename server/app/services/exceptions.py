"""Service-layer exceptions. API layer catches these and maps to HTTP responses.

Defining exceptions in services/ (not api/) keeps services HTTP-agnostic — a
service can be reused from a non-HTTP caller (e.g., a management script) and
still raise meaningful typed errors.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


class ServiceError(Exception):
    """Base for all service-layer errors.

    ``code`` is machine-readable (SCREAMING_SNAKE_CASE); ``message`` is the
    user-visible Chinese text. ``details`` is optional structured context for
    the UI (retry_after, limit, etc.). ``status`` suggests the HTTP status
    code but API layer makes the final call.
    """

    code: str = "INTERNAL"
    message: str = "服务异常"
    status: int = 500

    def __init__(self, message: str | None = None, *, details: dict | None = None):
        super().__init__(message or self.message)
        self.message = message or self.message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "details": self.details}


class SmsRateLimitError(ServiceError):
    code = "SMS_RATE_LIMIT"
    message = "短信发送过于频繁"
    status = 429


class SmsCooldownError(SmsRateLimitError):
    code = "SMS_COOLDOWN"
    message = "短信发送冷却中，请稍后再试"


class SmsHourlyLimitError(SmsRateLimitError):
    code = "SMS_HOURLY_LIMIT"
    message = "1 小时内短信发送已达上限，请稍后再试"


class SmsCodeInvalidError(ServiceError):
    code = "SMS_CODE_INVALID"
    message = "验证码错误或已过期"
    status = 400


class TermsNotAgreedError(ServiceError):
    code = "TERMS_NOT_AGREED"
    message = "需要同意用户协议和隐私政策"
    status = 400


class InviteCodeError(ServiceError):
    code = "INVITE_CODE_INVALID"
    message = "邀请码无效"
    status = 400


class PhoneAlreadyRegisteredError(ServiceError):
    code = "PHONE_ALREADY_REGISTERED"
    message = "手机号已注册"
    status = 409


class UserNotFoundError(ServiceError):
    code = "USER_NOT_FOUND"
    message = "该手机号未注册"
    status = 404


class AccountDisabledError(ServiceError):
    code = "ACCOUNT_DISABLED"
    message = "账号已停用"
    status = 403


class AccountShreddedError(ServiceError):
    code = "ACCOUNT_SHREDDED"
    message = "账号已注销"
    status = 401


class SessionNotFoundError(ServiceError):
    code = "SESSION_NOT_FOUND"
    message = "会话不存在或已过期"
    status = 404


class QuotaExceededError(ServiceError):
    code = "QUOTA_EXCEEDED"
    message = "配额已用完"
    status = 429

    def __init__(self, kind: str, limit: int):
        super().__init__(
            message=f"今日 {kind} 配额已用完",
            details={"kind": kind, "limit": limit},
        )


# ---- Plan 4: charts ---------------------------------------------------


class InvalidBirthInput(ServiceError):
    code = "INVALID_BIRTH_INPUT"
    message = "出生信息无效"
    status = 400


class ChartNotFound(ServiceError):
    code = "CHART_NOT_FOUND"
    message = "命盘不存在"
    status = 404


class ChartLimitExceeded(ServiceError):
    code = "CHART_LIMIT_EXCEEDED"
    message = "命盘数量已达上限"
    status = 409

    def __init__(self, limit: int):
        super().__init__(
            message=f"已达 {limit} 盘上限",
            details={"limit": limit},
        )


class ChartAlreadyDeleted(ServiceError):
    code = "CHART_ALREADY_DELETED"
    message = "命盘已在软删状态"
    status = 409


# ---- Plan 6: conversations --------------------------------------------


class ConversationGoneError(ServiceError):
    """Soft-deleted conversation outside the 30-day restore window."""

    status = 410
    code = "GONE"

    def __init__(self, message: str = "已超过 30 天恢复期"):
        super().__init__(message=message)


# ---- Plan 5: LLM / SSE ------------------------------------------------


class UpstreamLLMError(Exception):
    """Raised by app.llm.client when both primary and fallback models fail.

    Not a ServiceError — this is sent as an in-band SSE error event rather
    than mapped to HTTP status (SSE 200 already on wire by the time we know).
    """
    def __init__(self, *, code: Literal["UPSTREAM_LLM_FAILED", "UPSTREAM_LLM_TIMEOUT"],
                 message: str):
        super().__init__(message)
        self.code = code
        self.message = message
