"""Frontend event tracking schemas."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

TrackEvent = Literal[
    "card_view", "card_save", "card_share",
    "form_start", "form_submit", "cta_click",
]


class TrackProperties(BaseModel):
    """Known tracking properties. Extra fields are allowed and captured into `extra`."""
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    type_id: Optional[str] = None
    channel: Optional[str] = None
    from_: Optional[str] = Field(default=None, alias="from")
    share_slug: Optional[str] = None
    anonymous_id: Optional[str] = None
    session_id: Optional[str] = None
    user_agent: Optional[str] = None
    viewport: Optional[str] = None


class TrackRequest(BaseModel):
    event: TrackEvent
    properties: TrackProperties
