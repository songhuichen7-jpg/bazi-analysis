"""HTTP layer for /api/auth/*. Thin wrapper over services/*."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import current_user
from app.core.config import settings
from app.core.db import get_db
from app.models.user import User
from app.schemas.auth import (
    AccountDeleteRequest,
    AccountDeleteResponse,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    SmsSendRequest,
    SmsSendResponse,
    UserResponse,
)
from app.services import auth as auth_service
from app.services import sms as sms_service
from app.services.exceptions import ServiceError
from app.sms import get_sms_provider

router = APIRouter(prefix="/api/auth", tags=["auth"])

# NOTE: spec §3 — 30-day cookie.
_COOKIE_NAME = "session"
_COOKIE_MAX_AGE = 30 * 24 * 3600


def _set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=_COOKIE_NAME,
        value=raw_token,
        max_age=_COOKIE_MAX_AGE,
        path="/",
        httponly=True,
        secure=(settings.env != "dev"),
        samesite="lax",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(_COOKIE_NAME, path="/")


def _user_response(user: User) -> UserResponse:
    # Defensive: shredded users have phone_last4=None; never surface.
    return UserResponse(
        id=user.id,
        phone_last4=user.phone_last4 or "",
        nickname=user.nickname,
        role=user.role,
        plan=user.plan,
        plan_expires_at=user.plan_expires_at,
        created_at=user.created_at,
    )


def _http_error(err: ServiceError) -> HTTPException:
    detail = err.to_dict()
    headers = None
    if "retry_after" in err.details:
        headers = {"Retry-After": str(err.details["retry_after"])}
    return HTTPException(status_code=err.status, detail=detail, headers=headers)


@router.post("/sms/send", response_model=SmsSendResponse, response_model_by_alias=True)
async def sms_send_endpoint(
    body: SmsSendRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SmsSendResponse:
    try:
        result = await sms_service.send_sms_code(
            db,
            phone=body.phone,
            purpose=body.purpose,
            ip=request.client.host if request.client else None,
            provider_send=get_sms_provider().send,
        )
    except ServiceError as e:
        raise _http_error(e)

    response = SmsSendResponse(expires_in=300)
    if settings.env == "dev":
        # NOTE: dev echo only. Prod never exposes this field.
        response = SmsSendResponse(expires_in=300, devCode=result.code)
    return response


@router.post("/register")
async def register_endpoint(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await auth_service.register(
            db,
            phone=body.phone,
            code=body.code,
            invite_code=body.invite_code,
            nickname=body.nickname,
            agreed_to_terms=body.agreed_to_terms,
            user_agent=request.headers.get("user-agent"),
            ip=request.client.host if request.client else None,
            kek=request.app.state.kek,
        )
    except ServiceError as e:
        raise _http_error(e)

    _set_session_cookie(response, result.raw_token)
    return {"user": _user_response(result.user).model_dump(mode="json")}


@router.post("/login")
async def login_endpoint(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await auth_service.login(
            db,
            phone=body.phone,
            code=body.code,
            user_agent=request.headers.get("user-agent"),
            ip=request.client.host if request.client else None,
        )
    except ServiceError as e:
        raise _http_error(e)

    _set_session_cookie(response, result.raw_token)
    return {"user": _user_response(result.user).model_dump(mode="json")}


@router.post("/guest")
async def guest_login_endpoint(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    if settings.env != "dev":
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Not found"})

    result = await auth_service.login_guest(
        db,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
        kek=request.app.state.kek,
    )
    _set_session_cookie(response, result.raw_token)
    return {"user": _user_response(result.user).model_dump(mode="json")}


@router.post("/logout")
async def logout_endpoint(
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = request.state.session
    await auth_service.logout(db, session.id)
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
async def me_endpoint(
    user: User = Depends(current_user),
) -> MeResponse:
    return MeResponse(user=_user_response(user), quota_snapshot={})


@router.delete("/account", response_model=AccountDeleteResponse)
async def delete_account_endpoint(
    body: AccountDeleteRequest,
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> AccountDeleteResponse:
    # `confirm` is typed Literal["DELETE MY ACCOUNT"] in the schema, so pydantic
    # already rejects any other value at the schema layer.
    shredded_at = await auth_service.shred_account(db, user)
    _clear_session_cookie(response)
    return AccountDeleteResponse(shredded_at=shredded_at)
