"""FastAPI entry point — foundation layer.

Only route: GET /api/health. Lifespan loads KEK (fails loudly on sentinel).
Business routes come in later plans.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.charts import router as charts_router
from app.api.sessions import router as sessions_router
from app.api.public import router as public_router
from app.core.config import settings
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)

    # KEK is loaded inside lifespan so tests that don't need it (e.g. health
    # smoke) can override via monkeypatch before import.
    from app.core.crypto import load_kek
    app.state.kek = load_kek()
    yield
    from app.core.db import dispose_engine
    await dispose_engine()


app = FastAPI(
    title="bazi-analysis backend",
    version=settings.version,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env == "dev" else None,
    redoc_url=None,
)

app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(charts_router)
app.include_router(public_router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": settings.version, "env": settings.env}
