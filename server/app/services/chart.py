"""Chart CRUD service.

Layer boundaries:
- In:  (AsyncSession, User, Pydantic request)
- Out: ORM Chart row (or list thereof)
- Errors: raise typed ServiceError subclasses; api/ maps to HTTP.

DEK contextvar is assumed already set by the current_user dep at route
entry — service code never touches it explicitly.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import column, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.quotas import MAX_CHARTS_PER_USER
from app.models.chart import Chart, ChartCache
from app.models.user import User
from app.schemas.chart import CacheSlot, ChartCreateRequest
from app.services import paipan_adapter
from app.services.exceptions import ChartLimitExceeded, ChartNotFound


SOFT_DELETE_WINDOW = timedelta(days=30)


async def create_chart(
    db: AsyncSession,
    user: User,
    req: ChartCreateRequest,
) -> tuple[Chart, list[str]]:
    """Create a new chart for ``user``.

    Pipeline:
      1. Normalize city (write canonical name back to birth_input if resolved).
      2. Run paipan.compute → (paipan_dict, warnings, engine_version).
      3. INSERT chart; flush to get row.
      4. Post-check active-count ≤ MAX_CHARTS_PER_USER; over-limit raises
         ChartLimitExceeded (caller's transaction rolls back).
    """
    # NOTE: spec §3.2 step 1 — canonicalize before persisting.
    birth = req.birth_input.model_copy()
    if birth.city:
        resolved = paipan_adapter.resolve_city(birth.city)
        if resolved is not None:
            birth = birth.model_copy(update={"city": resolved["canonical"]})

    # NOTE: spec §3.1 — paipan call; ValueError → InvalidBirthInput (400).
    paipan_dict, warnings, engine_version = paipan_adapter.run_paipan(birth)

    chart = Chart(
        user_id=user.id,
        label=req.label,
        birth_input=birth.model_dump(),  # EncryptedJSONB transparent
        paipan=paipan_dict,
        engine_version=engine_version,
    )
    db.add(chart)
    await db.flush()  # obtain chart.id + verify schema constraints

    # NOTE: spec §2.4 — post-check 15-chart ceiling; soft-deleted charts don't count.
    active_count = (await db.execute(
        select(func.count(Chart.id)).where(
            Chart.user_id == user.id,
            Chart.deleted_at.is_(None),
        )
    )).scalar_one()
    if active_count > MAX_CHARTS_PER_USER:
        raise ChartLimitExceeded(limit=MAX_CHARTS_PER_USER)

    return chart, warnings


async def list_charts(db: AsyncSession, user: User) -> list[Chart]:
    """Active charts for ``user``, newest first.

    Secondary sort on ctid DESC breaks ties when created_at stamps are identical
    (e.g. multiple inserts within the same PostgreSQL transaction where now() is
    transaction-stable); ctid is assigned monotonically per insert so it
    reliably reflects insertion order within a page.
    """
    rows = (await db.execute(
        select(Chart).where(
            Chart.user_id == user.id,
            Chart.deleted_at.is_(None),
        ).order_by(Chart.created_at.desc(), column("ctid").desc())
    )).scalars().all()
    return list(rows)


async def get_chart(
    db: AsyncSession,
    user: User,
    chart_id: UUID,
    *,
    include_soft_deleted: bool = False,
) -> Chart:
    """Owner-scoped lookup. Raises ChartNotFound for any miss.

    include_soft_deleted=False (default): WHERE deleted_at IS NULL.
    include_soft_deleted=True: allow soft-deleted rows within 30d window;
        rows deleted_at <= now() - 30d still raise ChartNotFound (out-of-window).
    """
    stmt = select(Chart).where(
        Chart.id == chart_id,
        Chart.user_id == user.id,
    )
    if not include_soft_deleted:
        stmt = stmt.where(Chart.deleted_at.is_(None))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise ChartNotFound()

    if include_soft_deleted and row.deleted_at is not None:
        # Window check using DB clock to match deleted_at timezone semantics.
        # NOTE: spec §0.3 decision #5 — 30d window; beyond this → 404.
        cutoff = (await db.execute(
            text("SELECT now() - INTERVAL '30 days'")
        )).scalar_one()
        if row.deleted_at <= cutoff:
            raise ChartNotFound()

    return row


async def get_cache_slots(db: AsyncSession, chart_id: UUID) -> list[CacheSlot]:
    """Return all chart_cache rows as CacheSlot schema objects.

    Plan 4: chart_cache table is never written; this function returns [].
    Plan 5 LLM routes write cache → function returns non-empty automatically.
    """
    rows = (await db.execute(
        select(ChartCache).where(ChartCache.chart_id == chart_id)
    )).scalars().all()
    return [
        CacheSlot(
            kind=r.kind,
            key=r.key,
            has_cache=r.content is not None,
            model_used=r.model_used,
            regen_count=r.regen_count,
            generated_at=r.generated_at,
        )
        for r in rows
    ]
