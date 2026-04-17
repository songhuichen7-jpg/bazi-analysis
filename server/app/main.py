"""FastAPI entry point — foundation layer.

Only route: GET /api/health. Lifespan loads KEK (fails loudly on sentinel).
Business routes come in later plans.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)

    # KEK is loaded inside lifespan so tests that don't need it (e.g. health
    # smoke) can override via monkeypatch before import. The actual load_kek
    # function lands in Task 8; for now we stash the raw hex to prove the
    # lifespan path wires up.
    try:
        from app.core.crypto import load_kek
        app.state.kek = load_kek()
    except ImportError:
        # Task 8 not yet complete; health check still needs to work.
        app.state.kek = None
    yield


app = FastAPI(
    title="bazi-analysis backend",
    version=settings.version,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env == "dev" else None,
    redoc_url=None,
)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": settings.version, "env": settings.env}
