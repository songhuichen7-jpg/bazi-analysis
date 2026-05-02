"""Hepan multi-turn chat — 邀请创建者 ↔ LLM 围绕这段关系连续追问。

跟 services.hepan.llm 的一次性"完整解读"互补：那一条是 LLM 自己写的
600-900 字结构化散文（核心动力 / 摩擦点 / 调和方法 / 总结）；这一条
让用户拿到 reading 后继续问更具体的事 — "我们做项目谁该主导"、"吵架
后该怎么和好"、"三年后还能在一起吗"。

System prompt 包含双方完整 invite 信息 + 上次的 reading（如果生成过）—
LLM 已经"知道"这段关系，不需要用户每次重新解释背景。

只有创建者（A）能进对话；B 只是被邀请方，没账号绑定，没法进 chat。
要求自己一份 chat 就自己创建一条新的合盘邀请。
"""
from __future__ import annotations

import time
from typing import AsyncIterator, Optional

from sqlalchemy import asc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.client import chat_stream_with_fallback
from app.llm.events import sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.hepan_invite import HepanInvite
from app.models.hepan_message import HepanMessage
from app.models.user import User
from app.services.card.loader import TYPES
from app.services.exceptions import UpstreamLLMError
from app.services.hepan.loader import DYNAMICS, find_pair
from app.services.hepan.mapping import (
    classify, state_pair_icon_key, state_pair_key,
)


# 上下文里塞多少历史消息进 LLM。再老的对话由 LLM 用 reading 兜底，
# 不影响"为什么我们老吵架"这种连续追问。每条 ~150 字均估，30 条 ~ 4500 token。
MAX_HISTORY_TURNS = 30


def _build_system_prompt(invite: HepanInvite, reading_text: Optional[str]) -> str:
    """把 invite 的派生信息 + 一次性 reading（如果有）拼成 system message。

    LLM 知道：双方 cosmic_name / day_stem / state / role + pair 类别 / label /
    subtags / description / modifier。+ reading 全文作为"我之前已经写过的
    完整解读"。这样后续追问，LLM 不会跟之前的解读冲突，而是延伸 / 补充。"""
    a_info = TYPES.get(invite.a_type_id) or {}
    b_info = TYPES.get(invite.b_type_id) if invite.b_type_id else {}

    pair, swapped = find_pair(invite.a_day_stem, invite.b_day_stem or "")
    a_role = pair["b_role"] if swapped else pair["a_role"]
    b_role = pair["a_role"] if swapped else pair["b_role"]

    category, a_direction = classify(invite.a_day_stem, invite.b_day_stem or "")
    icon_key = state_pair_icon_key(invite.a_state, invite.b_state or "")
    state_pair_label = DYNAMICS["state_pair_labels"][icon_key]
    modifier_key = state_pair_key(
        invite.a_state, invite.b_state or "", category, a_direction,
    )
    modifier = DYNAMICS["modifiers"][category].get(modifier_key) or ""

    a_name = invite.a_nickname or "A"
    b_name = invite.b_nickname or "B"

    base = f"""你是「有时」的命理顾问。下面这段对话是 {a_name} 在跟你聊一段具体的关系。
你已经知道双方的命理底色 — 用这些信息做基础回答 {a_name} 的问题，但不要每次都
长篇大论复述底色。每条回复短而具体，像跟朋友聊天一样：300-500 字，分 1-3 段。
不要 markdown 标题，可以用粗体 / 斜体强调。不算命，不预言时间，不打"建议你..."套话。

【这段关系的底色】
- {a_name}: {a_info.get('cosmic_name', '?')}（日主 {invite.a_day_stem}，状态 {invite.a_state}），在关系里是「{a_role}」
- {b_name}: {b_info.get('cosmic_name', '?')}（日主 {invite.b_day_stem}，状态 {invite.b_state}），在关系里是「{b_role}」
- 类别: {category} / {pair.get('label', '')}（{' / '.join(pair.get('subtags', []))}）
- 动态: {state_pair_label}{('，' + modifier) if modifier else ''}
- 一句话感受: {pair.get('description', '')}"""

    if reading_text:
        base += f"""

【你之前已经写过这段关系的完整解读，对话里要保持一致 — 用户能看到这段】
---
{reading_text}
---

继续追问时不要重复解读里说过的话；用户问到了再展开 / 举例 / 给具体方法。"""

    return base.strip()


async def _load_recent_messages(
    db: AsyncSession, slug: str, limit: int = MAX_HISTORY_TURNS,
) -> list[HepanMessage]:
    """最近 ``limit`` 条消息，按时间正序返回。"""
    rows = (await db.execute(
        select(HepanMessage)
        .where(HepanMessage.hepan_slug == slug)
        .order_by(asc(HepanMessage.created_at))
        .limit(limit)
    )).scalars().all()
    return list(rows)


async def list_messages(db: AsyncSession, slug: str) -> list[HepanMessage]:
    return await _load_recent_messages(db, slug, limit=200)


async def stream_chat(
    db: AsyncSession,
    user: User,
    invite: HepanInvite,
    user_message: str,
    *,
    ticket,                # QuotaTicket | None
) -> AsyncIterator[bytes]:
    """SSE generator. 写 user message → LLM 流 → commit ticket → 写 assistant
    message → emit done. 同样 commit-before-done：race 超额时 emit error，
    assistant message 不落库。

    user message 的 INSERT 在 stream 开始前 flush — 即便 LLM 报错，user 也
    能在历史里看到自己刚发的那条（保留意图，不掉消息）。"""
    # 1) 先落 user message — flush 但不 commit (caller 全责 commit)
    user_row = HepanMessage(
        hepan_slug=invite.slug,
        role="user",
        content=user_message,
    )
    db.add(user_row)
    await db.flush()
    # 通知前端 user msg 落地，让"刚发的消息"立刻出现在聊天历史里
    yield sse_pack({"type": "user_saved", "id": str(user_row.id)})

    # 2) 拼上下文 — 历史里已经包括了刚 flush 的 user message
    history = await _load_recent_messages(db, invite.slug)
    system = _build_system_prompt(invite, invite.reading_text)
    messages = [{"role": "system", "content": system}]
    for m in history:
        messages.append({"role": m.role, "content": m.content or ""})

    accumulated = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err: UpstreamLLMError | None = None

    try:
        async for ev in chat_stream_with_fallback(
            messages=messages, tier="primary",
            temperature=0.75, max_tokens=1600,
            first_delta_timeout_ms=0,
        ):
            if ev["type"] == "model":
                model_used = ev["modelUsed"]
                yield sse_pack(ev)
            elif ev["type"] == "delta":
                accumulated += ev["text"]
                yield sse_pack(ev)
            elif ev["type"] == "done":
                prompt_tok = ev.get("prompt_tokens", 0)
                completion_tok = ev.get("completion_tokens", 0)
                total_tok = ev.get("tokens_used", 0)
    except UpstreamLLMError as e:
        err = e
        yield sse_pack({"type": "error", "code": e.code, "message": e.message})

    duration_ms = int((time.monotonic() - t_start) * 1000)

    if err is not None:
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=None,
            endpoint="hepan_chat", model=model_used,
            prompt_tokens=None, completion_tokens=None,
            duration_ms=duration_ms, error=f"{err.code}: {err.message}",
        )
        return

    # 3) Commit-before-done — race 超额则 emit error 不写 assistant
    if ticket is not None:
        try:
            await ticket.commit()
        except Exception as e:  # noqa: BLE001
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
            await insert_llm_usage_log(
                db, user_id=user.id, chart_id=None,
                endpoint="hepan_chat", model=model_used,
                prompt_tokens=None, completion_tokens=None,
                duration_ms=duration_ms, error=f"QUOTA_EXCEEDED: {e}",
            )
            return

    # 4) 落 assistant message
    asst_row = HepanMessage(
        hepan_slug=invite.slug,
        role="assistant",
        content=accumulated,
        model_used=model_used,
        tokens_used=total_tok,
    )
    db.add(asst_row)
    await db.flush()

    await insert_llm_usage_log(
        db, user_id=user.id, chart_id=None,
        endpoint="hepan_chat", model=model_used,
        prompt_tokens=prompt_tok, completion_tokens=completion_tok,
        duration_ms=duration_ms,
    )
    yield sse_pack({
        "type": "done",
        "full": accumulated,
        "tokens_used": total_tok,
        "assistant_id": str(asst_row.id),
    })
