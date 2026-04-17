"""QuotaTicket: pre-check + atomic commit + rollback.

Pattern (Plan 4+ will use this heavily):
    ticket = await check_quota("chat_message")(user, db)   # 429 if already full
    result = await do_business()
    await ticket.commit()   # atomic increment; may raise if race pushes over limit
    return result
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.quotas import today_beijing
from app.models.user import User
from app.services.exceptions import QuotaExceededError


@dataclass
class QuotaTicket:
    user: User
    kind: str
    limit: int
    _db: AsyncSession
    _committed: bool = field(default=False)

    async def commit(self) -> int:
        """Atomic: INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit.

        Returns new count. Raises QuotaExceededError if a concurrent commit
        pushed the count over the limit between pre-check and now.
        """
        if self._committed:
            # Defensive: prevent double-commit.
            raise RuntimeError("ticket already committed")

        period = today_beijing()
        result = await self._db.execute(text("""
            INSERT INTO quota_usage (user_id, period, kind, count, updated_at)
            VALUES (:uid, :period, :kind, 1, now())
            ON CONFLICT (user_id, period, kind)
            DO UPDATE SET count = quota_usage.count + 1, updated_at = now()
            WHERE quota_usage.count < :limit
            RETURNING count
        """), {
            "uid": self.user.id,
            "period": period,
            "kind": self.kind,
            "limit": self.limit,
        })
        row = result.first()
        if row is None:
            raise QuotaExceededError(kind=self.kind, limit=self.limit)
        self._committed = True
        return row[0]

    async def rollback(self) -> None:
        """Decrement by 1 (if committed). No-op otherwise."""
        if not self._committed:
            return
        period = today_beijing()
        await self._db.execute(text("""
            UPDATE quota_usage
               SET count = count - 1, updated_at = now()
             WHERE user_id = :uid
               AND period = :period
               AND kind = :kind
               AND count > 0
        """), {
            "uid": self.user.id,
            "period": period,
            "kind": self.kind,
        })
        self._committed = False
