"""Stage 1+2 orchestrator. NOTE: spec §5.

Pattern mirrors app.services.chart_llm.stream_chart_llm: commit-before-done.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.client import chat_stream_with_fallback
from app.llm.events import sse_pack
from app.llm.logs import insert_llm_usage_log
from app.models.user import User
from app.prompts import expert as prompts_expert
from app.prompts.router import classify_by_keywords, looks_like_followup
from app.retrieval2.service import retrieve_for_chart
from app.services import message as msg_svc
from app.services import conversation_memory as memory_svc
from app.services.chat_router import classify
from app.services.exceptions import UpstreamLLMError
from app.services.quota import QuotaTicket


# 跨标签 / 跨请求并发保护：同一个 conversation_id 同一时间只允许一条
# stream 在跑。多标签场景（用户两标签同时发同一 conv 的消息）以前会
# 在服务端交错插 user/assistant 行，DB 里就出现 [u1, u2, a2, a1] 这种
# 错位顺序。锁是 in-memory 进程级 — 单 worker 完美防护，多 worker 兜
# 不住但场景非常少见（同一用户跨标签发同一对话，且两个请求落到不同
# worker 上）。要做到完美需要 redis lock 或 db row lock，复杂度跟价
# 值不成比例，先用 asyncio.Lock 就够。
_CONV_LOCKS: dict[UUID, asyncio.Lock] = {}


def _conv_lock(conversation_id: UUID) -> asyncio.Lock:
    lock = _CONV_LOCKS.get(conversation_id)
    if lock is None:
        lock = asyncio.Lock()
        _CONV_LOCKS[conversation_id] = lock
    return lock


async def stream_message(
    *, db: AsyncSession, user: User, conversation_id: UUID,
    chart, message: str, bypass_divination: bool,
    ticket: QuotaTicket,
    client_context: dict | None = None,
) -> AsyncIterator[bytes]:
    """Generator yielding SSE-encoded bytes. NOTE: spec §5."""
    lock = _conv_lock(conversation_id)
    if lock.locked():
        # 已经有一条 stream 在跑这个 conv — 拒绝并发，避免 DB 错位写入
        yield sse_pack({
            "type": "error",
            "code": "CONVERSATION_BUSY",
            "message": "这条对话另一个回答正在生成中，请等它完成或停止后再发。",
        })
        return

    async with lock:
        async for chunk in _stream_message_locked(
            db=db, user=user, conversation_id=conversation_id,
            chart=chart, message=message,
            bypass_divination=bypass_divination,
            ticket=ticket, client_context=client_context,
        ):
            yield chunk


async def _stream_message_locked(
    *, db: AsyncSession, user: User, conversation_id: UUID,
    chart, message: str, bypass_divination: bool,
    ticket: QuotaTicket,
    client_context: dict | None = None,
) -> AsyncIterator[bytes]:
    """主流程 — 假设外面已经拿到 conv lock。"""
    router_history = await msg_svc.recent_chat_history(db, conversation_id=conversation_id, limit=4)
    history = await msg_svc.context_chat_history(db, conversation_id=conversation_id)
    memory_summary = await memory_svc.get_summary(db, conversation_id=conversation_id)

    # Resolution order — first match wins:
    #   1. keyword fast-path  ("我的财运怎么样" → wealth)
    #         · A clear topic word ALWAYS beats a follow-up cue. "那财运呢"
    #           contains the cue 那 but is a topic switch, so we route as
    #           wealth (re-retrieve), not as a follow-up.
    #   2. follow-up fast-path ("再来一部" / "具体讲讲" / "嗯,继续")
    #         · Only fires when the message has no recognised topic keyword.
    #         · Inherits the previous assistant turn's intent and skips
    #           retrieval so the conversation feels continuous.
    #   3. LLM router fallback (anything left)
    inherited_intent: str | None = None
    keyword_routed = classify_by_keywords(message)
    if not keyword_routed and looks_like_followup(message):
        inherited_intent = await msg_svc.latest_assistant_intent(
            db, conversation_id=conversation_id,
        )

    await msg_svc.insert(db, conversation_id=conversation_id, role="user", content=message)

    if keyword_routed:
        routed = keyword_routed
    elif inherited_intent:
        routed = {
            "intent": inherited_intent,
            "reason": "follow-up of previous turn",
            "source": "follow-up",
        }
    else:
        routed = await classify(
            db=db, user=user, chart_id=chart.id,
            message=message, history=router_history,
        )
    yield sse_pack({"type": "intent", "intent": routed["intent"],
                     "reason": routed["reason"], "source": routed["source"]})

    intent = routed["intent"]

    if intent == "divination" and not bypass_divination:
        await msg_svc.insert(db, conversation_id=conversation_id, role="cta",
                              content=None, meta={"question": message})
        yield sse_pack({"type": "redirect", "to": "gua", "question": message})
        try:
            await ticket.commit()
        except Exception as e:  # noqa: BLE001 — quota race or other commit failure
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
            return
        yield sse_pack({"type": "done", "full": ""})
        return

    effective_intent = "other" if intent == "divination" else intent

    if bypass_divination:
        await msg_svc.delete_last_cta(db, conversation_id=conversation_id)

    retrieved: list[dict] = []
    # Skip retrieval on follow-ups: history already carries the previous turn's
    # 古籍 quotes inside the LLM context, so a fresh retrieval would just
    # introduce drift and force the UI to show "翻阅古籍 6 段" twice in a
    # short exchange. The model can still cite the earlier classics through
    # conversation history.
    skip_retrieval = bool(inherited_intent)
    if effective_intent != "chitchat" and not skip_retrieval:
        try:
            paipan_for_retrieval = dict(chart.paipan or {})
            paipan_for_retrieval["gender"] = (chart.birth_input or {}).get("gender", "")
            retrieved = await retrieve_for_chart(
                paipan_for_retrieval, effective_intent, user_message=message,
            )
        except Exception:  # noqa: BLE001 — retrieval is best-effort
            retrieved = []
    if retrieved:
        sources = " + ".join(h.get("source", "?") for h in retrieved)
        yield sse_pack({"type": "retrieval", "source": sources})

    # Hepan-aware context — 给 LLM 注入 "你跟过谁合过盘" 的简表，方便用户在
    # chart 对话里引用合盘关系。没合过盘的用户拿空串，跳过 inject。
    from app.services.hepan.context import recent_hepan_summaries_for_user
    hepan_summary = await recent_hepan_summaries_for_user(db, user.id)

    messages_llm = prompts_expert.build_messages(
        paipan=chart.paipan, history=history,
        user_message=message, intent=effective_intent,
        retrieved=retrieved,
        client_context=client_context,
        memory_summary=memory_summary,
        hepan_summary=hepan_summary,
    )

    accumulator = ""
    model_used: str | None = None
    prompt_tok = completion_tok = total_tok = 0
    t_start = time.monotonic()
    err: UpstreamLLMError | None = None
    # exited_normally=True 时（success / LLM 错 / quota race 三类显式 return
    # 路径），finally 不会落 partial。只有走 GeneratorExit / CancelledError
    # 这种 abort 路径才会 partial 持久化 — LLM 错 / quota race 是 "billing
    # 公平性 + 未完成的回答"语义上不该留 assistant 行（test 也明确要求 no
    # assistant on quota race）。
    exited_normally = False

    try:
        try:
            async for ev in chat_stream_with_fallback(
                messages=messages_llm, tier="primary",
                temperature=0.7, max_tokens=9000,
                first_delta_timeout_ms=settings.llm_stream_first_delta_ms,
            ):
                t = ev["type"]
                if t == "model":
                    model_used = ev["modelUsed"]
                    yield sse_pack(ev)
                elif t == "delta":
                    accumulator += ev["text"]
                    yield sse_pack(ev)
                elif t == "done":
                    prompt_tok = ev.get("prompt_tokens", 0)
                    completion_tok = ev.get("completion_tokens", 0)
                    total_tok = ev.get("tokens_used", 0)
        except UpstreamLLMError as e:
            err = e
            yield sse_pack({"type": "error", "code": e.code, "message": e.message})

        duration_ms = int((time.monotonic() - t_start) * 1000)

        if err is not None:
            await insert_llm_usage_log(
                db, user_id=user.id, chart_id=chart.id,
                endpoint="chat:expert", model=model_used,
                prompt_tokens=None, completion_tokens=None,
                duration_ms=duration_ms, error=f"{err.code}: {err.message}",
            )
            exited_normally = True
            return

        try:
            await ticket.commit()
        except Exception as e:  # noqa: BLE001 — quota race or other commit failure
            yield sse_pack({"type": "error", "code": "QUOTA_EXCEEDED", "message": str(e)})
            await insert_llm_usage_log(
                db, user_id=user.id, chart_id=chart.id,
                endpoint="chat:expert", model=model_used,
                prompt_tokens=None, completion_tokens=None,
                duration_ms=duration_ms, error=f"QUOTA_EXCEEDED: {e}",
            )
            exited_normally = True
            return

        await msg_svc.insert(
            db, conversation_id=conversation_id, role="assistant",
            content=accumulator,
            meta={
                "intent": effective_intent,
                "model_used": model_used,
                "retrieval_source": (
                    " + ".join(h.get("source", "?") for h in retrieved) if retrieved else None
                ),
            },
        )
        await insert_llm_usage_log(
            db, user_id=user.id, chart_id=chart.id,
            endpoint="chat:expert", model=model_used,
            prompt_tokens=prompt_tok, completion_tokens=completion_tok,
            duration_ms=duration_ms,
        )
        yield sse_pack({"type": "done", "full": accumulator, "tokens_used": total_tok})
        await memory_svc.maybe_refresh_summary(
            db,
            user=user,
            chart=chart,
            conversation_id=conversation_id,
        )
        exited_normally = True
    finally:
        # 这里的语义：
        #   · exited_normally=True → success / LLM 错 / quota race 三种正常退
        #     出，不动 partial（quota race 路径 test 明确要求 no assistant）
        #   · exited_normally=False + accumulator 非空 → 客户端 abort
        #     (GeneratorExit/CancelledError)。用户已经看到屏幕上几百字了，
        #     落一条 interrupted=True 的 assistant 行避免下次刷历史看到悬空
        #     的 user message
        # commit 也在这里 — caller 的 await db.commit() 在 abort 路径不会执
        # 行，user message 的 INSERT 也会被回滚。完成路径 caller 会再 commit
        # 一遍，SQLAlchemy 二次 commit 是 no-op，安全。
        if not exited_normally and accumulator:
            try:
                await msg_svc.insert(
                    db, conversation_id=conversation_id, role="assistant",
                    content=accumulator,
                    meta={
                        "intent": effective_intent,
                        "model_used": model_used,
                        "interrupted": True,
                    },
                )
            except Exception:  # noqa: BLE001 — best-effort persistence
                pass
        try:
            await db.commit()
        except Exception:  # noqa: BLE001 — db 可能已经被 caller 关掉
            pass
