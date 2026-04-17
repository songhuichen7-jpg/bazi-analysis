# server

FastAPI backend for bazi-analysis. Provides the HTTP/DB/encryption
foundation used by downstream plans (auth, charts, LLM).

## Dev quickstart

    # from repo root
    cp server/.env.example server/.env
    # edit .env: set DATABASE_URL and ENCRYPTION_KEK
    uv sync --package server --extra dev

    # run migrations (once a Postgres is up)
    uv run --package server alembic -c server/alembic.ini upgrade head

    # run tests (testcontainers will start its own Postgres)
    uv run --package server pytest server/tests/

    # run the app locally
    uv run --package server uvicorn app.main:app --reload
