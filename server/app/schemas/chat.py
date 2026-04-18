"""Plan 6: POST /api/conversations/:id/messages request body."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1)
    bypass_divination: bool = False

    @field_validator("message")
    @classmethod
    def _strip(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("message must not be blank")
        return s
