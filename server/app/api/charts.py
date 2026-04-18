"""HTTP layer for /api/charts/*. Thin wrapper over services/chart."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import current_user
from app.core.db import get_db
from app.models.chart import Chart
from app.models.user import User
from app.schemas.chart import (
    BirthInput,
    CacheSlot,
    ChartCreateRequest,
    ChartDetail,
    ChartLabelUpdateRequest,
    ChartListItem,
    ChartListResponse,
    ChartResponse,
)
from app.services import chart as chart_service
from app.services import paipan_adapter
from app.services.exceptions import ServiceError

router = APIRouter(
    prefix="/api/charts",
    tags=["charts"],
    dependencies=[Depends(current_user)],
)


def _http_error(err: ServiceError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.to_dict())


async def _chart_to_response(
    chart: Chart,
    *,
    db: AsyncSession,
    warnings: list[str] | None = None,
) -> ChartResponse:
    slots = await chart_service.get_cache_slots(db, chart.id)
    return ChartResponse(
        chart=ChartDetail(
            id=chart.id,
            label=chart.label,
            birth_input=BirthInput(**chart.birth_input),
            paipan=chart.paipan,
            engine_version=chart.engine_version,
            created_at=chart.created_at,
            updated_at=chart.updated_at,
        ),
        cache_slots=slots,
        cache_stale=paipan_adapter.is_cache_stale(chart.engine_version),
        warnings=warnings or [],
    )


@router.get("", response_model=ChartListResponse)
async def list_charts_endpoint(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartListResponse:
    rows = await chart_service.list_charts(db, user)
    return ChartListResponse(items=[
        ChartListItem(
            id=r.id,
            label=r.label,
            engine_version=r.engine_version,
            cache_stale=paipan_adapter.is_cache_stale(r.engine_version),
            created_at=r.created_at,
            updated_at=r.updated_at,
        ) for r in rows
    ])


@router.post("", response_model=ChartResponse, status_code=status.HTTP_201_CREATED)
async def create_chart_endpoint(
    body: ChartCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart, warnings = await chart_service.create_chart(db, user, body)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db, warnings=warnings)


@router.get("/{chart_id}", response_model=ChartResponse)
async def get_chart_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart = await chart_service.get_chart(db, user, chart_id)
    except ServiceError as e:
        raise _http_error(e)
    return await _chart_to_response(chart, db=db)


@router.patch("/{chart_id}", response_model=ChartResponse)
async def patch_chart_endpoint(
    chart_id: UUID,
    body: ChartLabelUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart = await chart_service.update_label(db, user, chart_id, body.label)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db)


@router.delete("/{chart_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chart_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> Response:
    try:
        await chart_service.soft_delete(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{chart_id}/restore", response_model=ChartResponse)
async def restore_chart_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart = await chart_service.restore(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db)


@router.post("/{chart_id}/recompute", response_model=ChartResponse)
async def recompute_endpoint(
    chart_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ChartResponse:
    try:
        chart, warnings = await chart_service.recompute(db, user, chart_id)
        await db.commit()
    except ServiceError as e:
        await db.rollback()
        raise _http_error(e)
    return await _chart_to_response(chart, db=db, warnings=warnings)
