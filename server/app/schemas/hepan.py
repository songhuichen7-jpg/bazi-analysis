"""Pydantic request/response schemas for the hepan (合盘) API."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.card import BirthInput, State


# ── Request bodies ──────────────────────────────────────────────────────

class HepanInviteRequest(BaseModel):
    """A creates an invitation. A's birth is hashed/排盘 server-side; only
    the resulting type_id + state + nickname are persisted."""
    birth: BirthInput
    nickname: Optional[str] = Field(default=None, max_length=10)


class HepanCompleteRequest(BaseModel):
    """B opens the invitation link and submits their own birth + nickname."""
    birth: BirthInput
    nickname: Optional[str] = Field(default=None, max_length=10)


# ── Per-side card snapshot ──────────────────────────────────────────────

class HepanSide(BaseModel):
    type_id: str
    cosmic_name: str
    state: State
    state_icon: str
    day_stem: str
    theme_color: str
    illustration_url: str
    nickname: Optional[str] = None
    role: str = ""  # 04a 的 A角色 / B角色


# ── Full hepan reading ──────────────────────────────────────────────────

Category = Literal[
    "天作搭子", "镜像搭子", "同频搭子", "滋养搭子", "火花搭子", "互补搭子"
]


class HepanResponse(BaseModel):
    slug: str
    status: Literal["pending", "completed"]

    # Sides — invitee may be None when status == "pending"
    a: HepanSide
    b: Optional[HepanSide] = None

    # Pair reading (only when completed)
    category: Optional[Category] = None
    label: Optional[str] = None
    subtags: list[str] = Field(default_factory=list)
    description: Optional[str] = None
    modifier: Optional[str] = None  # 04b 动态修饰句
    cta: Optional[str] = None

    # State pair icon ⚡⚡/⚡🔋/🔋⚡/🔋🔋
    state_pair: Optional[str] = None
    state_pair_label: Optional[str] = None

    # Theme color for the hepan card — blended from both sides
    pair_theme_color: Optional[str] = None

    version: str = ""

    # 当前请求者是不是这条邀请的创建者（A）— 用 optional_user 注入；登录态
    # + user_id 匹配才 true。前端用这个决定是否展示 chat 区块 / "导出全文"
    # 按钮里的对话段。匿名 / B 一律 false。
    is_creator: bool = False


class HepanInviteResponse(BaseModel):
    """Returned from POST /api/hepan/invite — gives A back a slug + share link."""
    slug: str
    a: HepanSide
    invite_url: str  # e.g. /hepan/{slug}


# ── 我的合盘列表（GET /api/hepan/mine） ───────────────────────────────

class HepanMineItem(BaseModel):
    """单条合盘记录的列表展示。比 HepanResponse 轻 — 列表上不还原完整解读。"""
    slug: str
    status: Literal["pending", "completed"]
    a_nickname: Optional[str] = None
    b_nickname: Optional[str] = None
    a_cosmic_name: str
    b_cosmic_name: Optional[str] = None
    category: Optional[str] = None
    label: Optional[str] = None
    pair_theme_color: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    share_count: int
    # True = 已经跑过完整解读 (reading_text 在缓存里)。Mine 列表 + 邀请弹窗
    # 历史用这个标"已读" / "未读" 区分。reading_generated_at 不直接暴露 —
    # bool 够 UI 用了，时间戳是后台分析数据。
    has_reading: bool = False
    # 这条邀请下的对话总数（user + assistant 都算）。Mine 行展示"X 轮对话"
    # 当大于 0；为 0 时不显示，避免给用户增加紧迫感。
    message_count: int = 0


class HepanMineResponse(BaseModel):
    items: list[HepanMineItem]


# ── Multi-turn chat (Plan 5+) ───────────────────────────────────────────

class HepanChatMessageRequest(BaseModel):
    """POST /api/hepan/{slug}/messages 的 body — 用户问的下一句话。"""
    message: str = Field(..., min_length=1, max_length=2000)


class HepanChatMessageItem(BaseModel):
    """聊天历史里的单条消息。content 已经在 service 层 from-bytes 解过密。"""
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class HepanChatMessagesResponse(BaseModel):
    items: list[HepanChatMessageItem]
