"""Auth dependencies — skeleton only.

All functions raise NotImplementedError; Plan 3 will replace the raises.
Signatures and names are STABLE — Plan 3 must not change them.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Request

from app.core.db import get_db


async def current_user(
    request: Request,
    db=Depends(get_db),
):
    """Must-be-logged-in dependency. → User. Plan 3."""
    raise NotImplementedError("auth is implemented in Plan 3")


async def optional_user(
    request: Request,
    db=Depends(get_db),
) -> Optional[object]:
    """Optional login. → User | None. Plan 3."""
    raise NotImplementedError("auth is implemented in Plan 3")


async def require_admin(user=Depends(current_user)):
    """Admin-only. → User. Plan 3."""
    raise NotImplementedError("auth is implemented in Plan 3")


def check_quota(kind: str):
    """Quota-ticket factory. Returns a dependency that raises on exhaustion.

    Signature contract: returns a dependency callable; the dependency itself
    yields a QuotaTicket (Plan 3 defines QuotaTicket).
    """
    async def _dep(user=Depends(current_user), db=Depends(get_db)):
        raise NotImplementedError("quota is implemented in Plan 3")
    return _dep
