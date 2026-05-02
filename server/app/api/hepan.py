"""Hepan (合盘) API. Mostly public — mirrors card.py's anonymous flow.

Flow:
  POST /api/hepan/invite                — A creates an invitation
                                          (optional_user：登录态会绑 user_id 到这条邀请)
  POST /api/hepan/{slug}/complete       — B opens link + submits their birth
  GET  /api/hepan/{slug}                — read current state (pending or completed)
  GET  /api/hepan/mine                  — list invites I've created (auth required)
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import check_quota, current_user, optional_user
from app.core.db import get_db
from app.models.hepan_invite import HepanInvite
from app.models.user import User
from app.schemas.hepan import (
    HepanCompleteRequest,
    HepanInviteRequest,
    HepanInviteResponse,
    HepanMineItem,
    HepanMineResponse,
    HepanResponse,
)
from app.services.card.loader import TYPES, load_all as load_card_data
from app.services.card.payload import build_card_payload
from app.services.card.slug import birth_hash
from app.services.exceptions import PlanUpgradeRequiredError, ServiceError
from app.services.hepan.llm import stream_reading
from app.services.hepan.loader import find_pair, load_all as load_hepan_data
from app.services.hepan.payload import (
    _blend_hex,                      # 复用：列表项要返回 pair_theme_color
    build_completed_payload,
    build_pending_payload,
)
from app.services.hepan.slug import generate_slug
from app.services.quota import QuotaTicket

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _http_error(err: ServiceError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.to_dict())

router = APIRouter(prefix="/api/hepan", tags=["hepan"])


def _ensure_data_loaded() -> None:
    """Belt-and-braces: data is already eagerly loaded at module import time,
    but this stays robust if someone reloads modules in tests."""
    load_card_data()
    load_hepan_data()


@router.post("/invite", response_model=HepanInviteResponse)
async def post_invite(
    req: HepanInviteRequest,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> HepanInviteResponse:
    """A creates an invitation. Persists A's snapshot only (no birthdate).

    optional_user：登录态时绑 user_id 到 invite 行；匿名调用（老的分享卡链路 /
    没登录就发起的合盘）user_id 留 NULL，行为不变。"""
    _ensure_data_loaded()

    # Reuse the personal-card payload to derive type_id / state / day_stem.
    a_card = build_card_payload(req.birth, req.nickname)

    slug = generate_slug()
    row = HepanInvite(
        slug=slug,
        a_birth_hash=birth_hash(
            req.birth.year, req.birth.month, req.birth.day,
            req.birth.hour, req.birth.minute,
        ),
        a_type_id=a_card.type_id,
        a_state=a_card.state,
        a_day_stem=a_card.day_stem,
        a_nickname=a_card.nickname,
        status="pending",
        user_id=user.id if user is not None else None,
    )
    db.add(row)

    pending = build_pending_payload(
        slug=slug,
        a_type_id=a_card.type_id,
        a_state=a_card.state,
        a_day_stem=a_card.day_stem,
        a_nickname=a_card.nickname,
    )
    return HepanInviteResponse(
        slug=slug,
        a=pending.a,
        invite_url=f"/hepan/{slug}",
    )


@router.get("/mine", response_model=HepanMineResponse)
async def get_mine(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> HepanMineResponse:
    """登录用户创建过的合盘列表。最近创建在前。

    每行只回轻量元数据 — 列表 UI 不展开完整解读 / 角色对照，进 detail
    页（``GET /api/hepan/{slug}``）才有完整 HepanResponse。"""
    _ensure_data_loaded()

    rows = (await db.execute(
        select(HepanInvite)
        .where(HepanInvite.user_id == user.id)
        .order_by(desc(HepanInvite.created_at))
        .limit(200)
    )).scalars().all()

    items: list[HepanMineItem] = []
    for r in rows:
        a_info = TYPES.get(r.a_type_id) or {}
        b_info = TYPES.get(r.b_type_id) if r.b_type_id else None
        category: str | None = None
        label: str | None = None
        pair_theme: str | None = None
        if r.status == "completed" and r.b_day_stem:
            pair, swapped = find_pair(r.a_day_stem, r.b_day_stem)
            category = pair["category"]
            label = pair["label"]
            if a_info and b_info:
                pair_theme = _blend_hex(a_info["theme_color"], b_info["theme_color"])
        items.append(HepanMineItem(
            slug=r.slug,
            status=r.status,                       # type: ignore[arg-type]
            a_nickname=r.a_nickname,
            b_nickname=r.b_nickname,
            a_cosmic_name=a_info.get("cosmic_name", ""),
            b_cosmic_name=(b_info or {}).get("cosmic_name") if b_info else None,
            category=category,
            label=label,
            pair_theme_color=pair_theme,
            created_at=r.created_at,
            completed_at=r.completed_at,
            share_count=r.share_count,
        ))
    return HepanMineResponse(items=items)


@router.post("/{slug}/complete", response_model=HepanResponse)
async def post_complete(
    slug: str,
    req: HepanCompleteRequest,
    db: AsyncSession = Depends(get_db),
) -> HepanResponse:
    """B submits their birth → fills in the row → returns the full reading."""
    _ensure_data_loaded()

    row = (await db.execute(
        select(HepanInvite).where(HepanInvite.slug == slug)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="invite not found")

    if row.status == "completed":
        # Idempotent: re-completing returns the existing reading
        return _row_to_response(row)

    b_card = build_card_payload(req.birth, req.nickname)

    row.b_birth_hash = birth_hash(
        req.birth.year, req.birth.month, req.birth.day,
        req.birth.hour, req.birth.minute,
    )
    row.b_type_id = b_card.type_id
    row.b_state = b_card.state
    row.b_day_stem = b_card.day_stem
    row.b_nickname = b_card.nickname
    row.status = "completed"
    row.completed_at = datetime.now(timezone.utc)

    return _row_to_response(row)


@router.get("/{slug}", response_model=HepanResponse)
async def get_hepan(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> HepanResponse:
    _ensure_data_loaded()

    row = (await db.execute(
        select(HepanInvite).where(HepanInvite.slug == slug)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="invite not found")

    row.share_count += 1
    return _row_to_response(row)


@router.post("/{slug}/reading")
async def post_reading(
    slug: str,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """SSE 流式生成完整解读（500-900 字）。

    Plan 5+ 计费：
      · lite     → 直接 402 PLAN_UPGRADE_REQUIRED，前端 paywall toast
      · standard → 走 chat_message 配额（150/天）
      · pro      → 同上但 600/天，事实上不限

    缓存：reading_text + reading_version 命中时不消耗配额，replay_cached
    重放整段。force=true 时无视缓存重新生成（也消耗配额）。

    幂等保证：commit-before-done 模式 — race 超额时 emit error 而不是 done，
    cache 不写。
    """
    _ensure_data_loaded()

    if user.plan == "lite":
        raise _http_error(PlanUpgradeRequiredError(
            feature="合盘完整解读", required_plan="standard",
        ))

    row = (await db.execute(
        select(HepanInvite).where(HepanInvite.slug == slug)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="invite not found")
    if row.status != "completed" or not row.b_day_stem:
        raise HTTPException(status_code=409, detail={
            "code": "HEPAN_NOT_COMPLETED",
            "message": "对方还没填生日，等 TA 完成后再读完整解读。",
        })

    # 缓存命中分支：不发配额 ticket，直接 replay。让缓存重读永远免费。
    expected_version_match = (
        row.reading_text
        and row.reading_version
        and not force
    )
    ticket: QuotaTicket | None = None
    if not expected_version_match:
        # 需要走 LLM —— 先预检 chat_message 配额
        check_dep = check_quota("chat_message")
        ticket = await check_dep(user=user, db=db)

    async def _gen():
        async for raw in stream_reading(
            db, user, row, force=force, ticket=ticket,
        ):
            yield raw
        await db.commit()

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


def _row_to_response(row: HepanInvite) -> HepanResponse:
    """Compose HepanResponse from a DB row, dispatching on status."""
    if row.status == "completed" and row.b_type_id and row.b_state and row.b_day_stem:
        return build_completed_payload(
            slug=row.slug,
            a_type_id=row.a_type_id, a_state=row.a_state,
            a_day_stem=row.a_day_stem, a_nickname=row.a_nickname,
            b_type_id=row.b_type_id, b_state=row.b_state,
            b_day_stem=row.b_day_stem, b_nickname=row.b_nickname,
        )
    return build_pending_payload(
        slug=row.slug,
        a_type_id=row.a_type_id,
        a_state=row.a_state,
        a_day_stem=row.a_day_stem,
        a_nickname=row.a_nickname,
    )
