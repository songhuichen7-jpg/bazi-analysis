"""Hepan-aware context for the main chart chat.

主 chart 对话里 LLM 默认只看到当前命盘 + retrieval 段。如果用户跟 阿谷 / rzy
有过合盘，那些关系就 sit 在数据库里 — 但 chat 不知道。结果：用户问 "我跟
阿谷一起做事顺不顺" 时 LLM 只能回 "需要更多信息"。

这一层负责把用户最近的几条已完成合盘转成一行 system prompt 提示，让 LLM
"记得" 用户跟谁合过盘以及关系底色。Token 成本：每条 ~30 字，最多 5 条
~150 字 / 1000 token 远低于 chat history 本身的预算。

调用方在 conversation_chat.stream_message 里调一次，结果作为
``hepan_summary`` 参数传给 prompts.expert.build_messages。
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hepan_invite import HepanInvite
from app.services.card.loader import TYPES
from app.services.hepan.loader import find_pair


async def recent_hepan_summaries_for_user(
    db: AsyncSession, user_id: UUID, *, limit: int = 5,
) -> str:
    """返回最多 ``limit`` 条已完成合盘的 system prompt 段落。

    没有任何已完成 invite → 返回空串（调用方 falsy check 跳过 inject）。
    每行格式：``跟 @{B 昵称}（{B cosmic_name}）— {label}（{category}）``。

    pending 的不算 — 用户可能邀请过但 B 没回，那段关系还没建立。软删的
    在 SQL where 里就过滤掉了，看不到。
    """
    rows = (await db.execute(
        select(HepanInvite)
        .where(
            HepanInvite.user_id == user_id,
            HepanInvite.deleted_at.is_(None),
            HepanInvite.status == "completed",
        )
        .order_by(desc(HepanInvite.created_at))
        .limit(limit)
    )).scalars().all()

    if not rows:
        return ""

    lines: list[str] = ["【你跟过谁合过盘（聊到相关话题可以参考）】"]
    for r in rows:
        if not r.b_day_stem or not r.b_type_id:
            # 已 completed 应该都有 b_day_stem，防御一下
            continue
        b_info = TYPES.get(r.b_type_id) or {}
        pair, _ = find_pair(r.a_day_stem, r.b_day_stem)
        b_name = r.b_nickname or "对方"
        b_cosmic = b_info.get("cosmic_name", "?")
        label = pair.get("label", "?")
        category = pair.get("category", "?")
        lines.append(f"- 跟 @{b_name}（{b_cosmic}）— {label}（{category}）")

    # 全靠 has-completed 行触发，但 for-loop 防御性 skip 了脏行；如果都被
    # skip 了，head + 0 行 — 直接 return 空串避免 "你跟过谁合过盘:\n" 孤悬。
    if len(lines) == 1:
        return ""
    return "\n".join(lines)
