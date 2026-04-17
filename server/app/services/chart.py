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

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.quotas import MAX_CHARTS_PER_USER
from app.models.chart import Chart
from app.models.user import User
from app.schemas.chart import ChartCreateRequest
from app.services import paipan_adapter
from app.services.exceptions import ChartLimitExceeded


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
