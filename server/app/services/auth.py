"""Core auth flows: register / login / logout / shred_account.

All functions take an AsyncSession and return Python-native types or raise
ServiceError subclasses. The api/ layer maps errors to HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import encrypt_dek, generate_dek
from app.core.quotas import QUOTAS
from app.models.user import InviteCode, SmsCode, User, UserSession
from app.services.exceptions import (
    AccountDisabledError,
    AccountShreddedError,
    InviteCodeError,
    PhoneAlreadyRegisteredError,
    TermsNotAgreedError,
    UserNotFoundError,
)
from app.services.quota import QuotaTicket
from app.services.session import create_session, revoke_all_sessions
from app.services.sms import verify_sms_code


@dataclass(frozen=True)
class AuthResult:
    user: User
    raw_token: str   # caller sets it as Set-Cookie


async def register(
    db: AsyncSession,
    *,
    phone: str,
    code: str,
    invite_code: str,
    nickname: str | None,
    agreed_to_terms: bool,
    user_agent: str | None,
    ip: str | None,
    kek: bytes,
) -> AuthResult:
    """Transactional register flow. Caller wraps in a transaction.

    Flow (spec §3.1):
      1. verify_sms_code
      2. agreed_to_terms must be True
      3. phone must not already be registered
      4. if settings.require_invite: validate invite_code (and increment atomically)
      5. generate DEK, encrypt with KEK
      6. INSERT users
      7. atomic UPDATE invite_codes SET used_count = used_count + 1 WHERE used_count < max_uses
      8. create session, return (user, raw_token)
    """
    await verify_sms_code(db, phone, code, "register")

    if not agreed_to_terms:
        raise TermsNotAgreedError()

    existing = await db.execute(select(User).where(User.phone == phone))
    if existing.scalar_one_or_none() is not None:
        raise PhoneAlreadyRegisteredError()

    invite_row: InviteCode | None = None
    if settings.require_invite:
        stmt = select(InviteCode).where(
            InviteCode.code == invite_code,
            InviteCode.disabled.is_(False),
        )
        invite_row = (await db.execute(stmt)).scalar_one_or_none()
        if invite_row is None:
            raise InviteCodeError("邀请码不存在或已禁用")
        if invite_row.expires_at is not None and invite_row.expires_at <= datetime.now(tz=timezone.utc):
            raise InviteCodeError("邀请码已过期")
        if invite_row.used_count >= invite_row.max_uses:
            raise InviteCodeError("邀请码已用完")

    dek = generate_dek()
    dek_ciphertext = encrypt_dek(dek, kek)

    user = User(
        phone=phone,
        phone_last4=phone[-4:],
        nickname=nickname,
        invited_by_user_id=invite_row.created_by if invite_row is not None else None,
        used_invite_code_id=invite_row.id if invite_row is not None else None,
        dek_ciphertext=dek_ciphertext,
        dek_key_version=1,
        agreed_to_terms_at=datetime.now(tz=timezone.utc),
    )
    db.add(user)
    await db.flush()

    if invite_row is not None:
        # NOTE: spec §3.3 — atomic used_count++; if concurrent caller raced us
        # past max_uses, result.rowcount == 0 and we raise.
        result = await db.execute(
            update(InviteCode)
            .where(
                InviteCode.id == invite_row.id,
                InviteCode.used_count < invite_row.max_uses,
            )
            .values(used_count=InviteCode.used_count + 1)
        )
        if result.rowcount == 0:
            raise InviteCodeError("邀请码并发竞争失败，请重试")

    # NOTE: charge sms_send quota for the SMS that was sent before registration.
    sms_limit = QUOTAS.get(user.plan, QUOTAS["free"])["sms_send"]
    ticket = QuotaTicket(user=user, kind="sms_send", limit=sms_limit, _db=db)
    await ticket.commit()

    _, raw_token = await create_session(db, user.id, user_agent=user_agent, ip=ip)
    return AuthResult(user=user, raw_token=raw_token)


async def login(
    db: AsyncSession,
    *,
    phone: str,
    code: str,
    user_agent: str | None,
    ip: str | None,
) -> AuthResult:
    """Login flow (spec §3.2). Does NOT generate DEK (that's registration-only)."""
    await verify_sms_code(db, phone, code, "login")

    user: User | None = (await db.execute(
        select(User).where(User.phone == phone)
    )).scalar_one_or_none()
    if user is None:
        raise UserNotFoundError()
    if user.status != "active":
        raise AccountDisabledError()
    if user.dek_ciphertext is None:
        # Account was crypto-shredded (phone should have been cleared too,
        # so this branch is theoretical, but belt-and-suspenders).
        raise AccountShreddedError()

    _, raw_token = await create_session(db, user.id, user_agent=user_agent, ip=ip)
    return AuthResult(user=user, raw_token=raw_token)


async def logout(db: AsyncSession, session_id) -> None:
    """Delete the current session (caller provides session_id from current_user)."""
    await db.execute(delete(UserSession).where(UserSession.id == session_id))


async def shred_account(db: AsyncSession, user: User) -> datetime:
    """Crypto-shred user account. Returns the shred timestamp.

    Flow (spec §5.3):
      1. DELETE sessions for this user
      2. DELETE sms_codes for this phone
      3. UPDATE users SET
           status='disabled', phone=NULL, phone_last4=NULL, nickname=NULL,
           invited_by_user_id=NULL, wechat_openid=NULL, wechat_unionid=NULL,
           dek_ciphertext=NULL
      4. Caller commits.
    """
    phone = user.phone
    await revoke_all_sessions(db, user.id)

    if phone is not None:
        await db.execute(delete(SmsCode).where(SmsCode.phone == phone))

    shredded_at = datetime.now(tz=timezone.utc)
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            status="disabled",
            phone=None,
            phone_last4=None,
            nickname=None,
            invited_by_user_id=None,
            wechat_openid=None,
            wechat_unionid=None,
            dek_ciphertext=None,
        )
    )
    return shredded_at
