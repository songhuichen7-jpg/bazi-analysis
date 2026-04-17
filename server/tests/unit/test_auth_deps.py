"""auth.deps: all dependencies must raise NotImplementedError in Plan 2.

Plan 3 removes the raise; signature stays the same."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


@pytest.mark.asyncio
async def test_current_user_raises_not_implemented():
    from app.auth.deps import current_user
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await current_user(request=MagicMock(), db=MagicMock())


@pytest.mark.asyncio
async def test_optional_user_raises_not_implemented():
    from app.auth.deps import optional_user
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await optional_user(request=MagicMock(), db=MagicMock())


@pytest.mark.asyncio
async def test_require_admin_raises_not_implemented():
    from app.auth.deps import require_admin
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await require_admin(user=MagicMock())


@pytest.mark.asyncio
async def test_check_quota_closure_raises_not_implemented():
    from app.auth.deps import check_quota
    dep = check_quota("chat_message")
    with pytest.raises(NotImplementedError, match="Plan 3"):
        await dep(user=MagicMock(), db=MagicMock())
