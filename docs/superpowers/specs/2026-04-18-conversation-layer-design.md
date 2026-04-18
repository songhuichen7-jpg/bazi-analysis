# Plan 6 — Conversation Layer (chat / gua / chips)

**Status**: design  
**Date**: 2026-04-18  
**Base**: main @ 937703b (Plan 5 cleanup) — 309 tests green  
**Depends on**: Plan 4 (Charts CRUD + paipan), Plan 5 (chart LLM SSE + quota)  
**Spec deviation note**: gua endpoint is moved from `POST /api/charts/:id/gua`
(user-accounts spec §3.2) to `POST /api/conversations/:id/gua`. Reason: with
CTA persistence (§3 below), every gua casts must attach to a conversation;
URL shape now reflects domain.

---

## 1. Goal

Add the conversation layer on top of the chart-LLM foundation:

- `conversations` / `messages` CRUD over the existing models (Plan 4 schema).
- Two-stage chat SSE (router → expert) at `POST /api/conversations/:id/messages`.
- Gua SSE at `POST /api/conversations/:id/gua` (timing-cast + LLM analysis).
- Chips wired to use real conversation history.
- Frontend `Chat.jsx` / `ConversationSwitcher.jsx` switched to the new
  endpoints; UI/CSS unchanged.

No schema changes. The `Conversation` and `Message` models already exist
(role enum: `user|assistant|gua|cta`). All Plan 6 work is service + route +
frontend wiring.

## 2. Non-goals

- No PATCH/DELETE for individual messages (no "edit your past message" UX).
- No per-message admin audit columns (`message_id` on logs deferred to
  Plan 7+).
- No localStorage→server migration for legacy frontend conversations
  (silent drop with a one-line release note; see §7.D).
- No application-layer rate-limit on chat/gua (Plan 7 Nginx).
- No chat response caching (every user message is unique).

## 3. Architecture

### 3.1 Routes (7 new + 1 modified)

```
GET    /api/charts/:cid/conversations            list (hide soft-deleted)
POST   /api/charts/:cid/conversations            {label?} → 201 + full obj

GET    /api/conversations/:id                    full obj (incl. message_count)
PATCH  /api/conversations/:id                    {label}
DELETE /api/conversations/:id                    soft-delete, 30d window
POST   /api/conversations/:id/restore            within 30d → 200; else 410
GET    /api/conversations/:id/messages           ?before=<msg_id>&limit=50
POST   /api/conversations/:id/messages           [check_quota('chat_message')]
                                                 SSE router→expert
POST   /api/conversations/:id/gua                [check_quota('gua')]
                                                 SSE cast+LLM; body{question}

POST   /api/charts/:cid/chips                    body adds {conversation_id?}
                                                 (existing route, body extended)
```

Owner check helper `_get_owned_conversation(db, user, cid)` joins
`conversations → charts → user_id` once. Soft-deleted rows return 404
everywhere except GET (allowed) and `/restore` (allowed within 30d).
404 (not 403) on cross-user / non-existent — matches chart routes
(prevents enumeration).

### 3.2 New service modules

```
server/app/services/
  conversation.py            CRUD + ownership + soft-delete/restore
  message.py                 INSERT helpers + keyset pagination
  chat_router.py             classify_by_keywords + router LLM call
  chat_expert.py             stream_chat (Stage 2 expert SSE generator)
  conversation_chat.py       stream_message (orchestrates Stage 1 + 2,
                             quota, message persistence)
  conversation_gua.py        stream_gua (cast + LLM SSE generator)
  gua_cast.py                cast_gua(at) → dict (pure function)

server/app/api/
  conversations.py           all 7 conversation/message/gua routes;
                             included from app/main.py

server/app/prompts/
  router.py                  intent classifier prompts
  expert.py                  intent-specific expert prompts + chart slice
  gua.py                     gua interpretation prompts

server/app/data/zhouyi/
  gua64.json                 copied verbatim from archive/server-mvp/data/
```

### 3.3 Reused infrastructure (no changes needed)

- `app.llm.client.chat_stream_with_fallback` / `chat_with_fallback`
- `app.llm.events.sse_pack`
- `app.llm.logs.insert_llm_usage_log`
- `app.retrieval.service.retrieve_for_chart` (already supports intent kinds)
- `app.prompts.loader` (shard loader; already used by chips/sections)
- `app.prompts.context.compact_chart_context` (chart summary builder)
- `app.prompts.anchor.build_classical_anchor`
- `app.services.quota.QuotaTicket` + `app.auth.deps.check_quota`
- `app.db_types.{EncryptedText, EncryptedJSONB}` (Message.content/meta
  already encrypted via DEK contextvar)

### 3.4 Frontend changes (UI/CSS unchanged)

```
frontend/src/lib/api.js                +9 functions (conversations + SSE)
frontend/src/store/useAppStore.js      lazy-load actions; drop localStorage
                                       persistence for chat data
frontend/src/components/Chat.jsx       repoint streamSSE calls
frontend/src/components/
  ConversationSwitcher.jsx             actions → server endpoints
frontend/src/components/{GuaCard,
  RefChip, ErrorState}.jsx             unchanged
```

`currentConversationId` persists in **sessionStorage** (page-tab scope),
not localStorage. All chat/conversation/message/gua data is
**ephemeral in store, durable on server**.

## 4. Conversation/Message CRUD (§4)

### 4.1 List + create

`GET /api/charts/:cid/conversations`:

```json
{ "items": [
    { "id": "...", "label": "对话 1", "position": 0,
      "created_at": "...", "updated_at": "...",
      "last_message_at": "...", "message_count": 12 }
] }
```

Order: `position ASC, created_at ASC`. Hide rows where `deleted_at IS NOT NULL`.

`POST /api/charts/:cid/conversations {label?}`:

- `position = COALESCE(MAX(position WHERE chart_id=:cid AND deleted_at IS NULL), -1) + 1`
- Default label = `"对话 N"` where N = `count(active)+1`. Empty string allowed.
- 201 + full object.
- No per-chart conversation cap (user prunes via DELETE).

### 4.2 Get / patch / delete / restore

- `GET /api/conversations/:id`: returns object even if soft-deleted (so
  restore UI can show metadata).
- `PATCH /api/conversations/:id {label}`: 200 + full obj. Empty label →
  422. Soft-deleted → 404.
- `DELETE /api/conversations/:id`: `UPDATE conversations SET
  deleted_at=now()`. Messages **not cascade-deleted** (preserved for
  restore). 204.
- `POST /api/conversations/:id/restore`:
  - Allowed if `deleted_at IS NOT NULL AND deleted_at >= now() - INTERVAL '30 days'`.
  - Sets `deleted_at = NULL`.
  - Outside the 30d window → 410 GONE
    `{code:"GONE", message:"已超过 30 天恢复期"}`.
  - **Window is enforced at application level only.** Physical delete of
    soft-deleted rows past 30d is a cron/worker job deferred to Plan 7
    (same status as chart soft-delete; see Plan 5 ACCEPTANCE item #2).

### 4.3 Messages pagination

`GET /api/conversations/:id/messages?before=<msg_id>&limit=50`:

```json
{ "items": [ /* newest-first */ ],
  "next_cursor": "<msg_id|null>" }
```

- Keyset cursor: `before` is the smallest `id` already returned. SQL:
  `ORDER BY (created_at, id) DESC LIMIT :limit+1` and translate the
  cursor to `(created_at, id) < (cursor.created_at, cursor.id)`.
- `limit` ∈ [1, 100]; default 50. Out-of-range → 422.
- `next_cursor` = the `id` of the (limit+1)-th row if it exists, else
  `null`.
- Soft-deleted conversation: messages still readable (so restore is
  seamless). Cross-user → 404.

### 4.4 Message item shape

```json
{ "id": "...", "role": "user|assistant|gua|cta",
  "content": "..." | null,
  "meta": { ... } | null,
  "created_at": "..." }
```

`meta` schema by role:

- `user`: null
- `assistant`: `{intent?, model_used?, retrieval_source?}`
- `gua`: `{gua: {...castGua output...}, question, body, model_used?}`
- `cta`: `{question}` (the divination question, so frontend can
  pre-fill the cast input)

## 5. Chat SSE (§5)

`POST /api/conversations/:id/messages`

Request: `{message: str, bypass_divination?: bool=false}`.

### 5.1 Pipeline

```
1. owner check (conversation → chart → user.id); soft-deleted → 404
2. check_quota('chat_message') → ticket  (full → 429 with Retry-After)
3. history = SELECT messages WHERE conversation_id=:id
            AND role IN ('user','assistant')
            ORDER BY created_at DESC, id DESC LIMIT 8 → reverse
4. INSERT messages(conversation_id, role='user', content=message)
   (commit happens at end of generator; user msg always lands)
5. open SSE stream
```

### 5.2 Stage 1 — router

```
routed = classify_by_keywords(message)        # archive prompts.js:393-412
if routed is None:
    raw = chat_with_fallback(
        buildRouterMessages(history[-4:], message),
        tier='fast', temperature=0, max_tokens=800)
    routed = parse_router_json(raw)           # falls back to {intent:'other',
                                              # reason:'parse_failed'} on bad JSON
    log_llm_usage(endpoint='chat:router', model=routed.model_used,
                  prompt_tokens=..., completion_tokens=..., duration_ms=...)
emit {"type":"intent","intent":routed.intent,"reason":routed.reason,
      "source": "keyword"|"llm"}
```

If router LLM throws `UpstreamLLMError`, fall back to
`{intent:'other', reason:'router_error'}` and continue (do not abort
the request — user gets some answer rather than a 502).

### 5.3 Divination branch

```
if intent == 'divination' and not bypass_divination:
    INSERT messages(role='cta', content=null,
                    meta={'question': message})
    emit {"type":"redirect","to":"gua","question":message}
    emit {"type":"done","full":""}
    ticket.commit()                           # see §6
    db.commit()
    return
```

### 5.4 Stage 2 — expert

```
effective_intent = 'other' if intent == 'divination' else intent
                   # bypass case: still useful intent for shard loading
retrieved = retrieve_for_chart(chart.paipan, effective_intent)
emit {"type":"retrieval","source":...} if retrieved

if bypass_divination:
    # Atomic with the upcoming assistant INSERT (same db.commit at generator end).
    DELETE FROM messages
     WHERE id = (
       SELECT id FROM messages
        WHERE conversation_id = :id AND role = 'cta'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
     )
    # No-op if no cta exists (user may have triggered bypass via direct path).

messages_llm = build_expert_messages(
    paipan=chart.paipan, history=history,
    user_message=message, intent=effective_intent,
    retrieved=retrieved)

accumulator = ""
async for ev in chat_stream_with_fallback(
        messages_llm, tier='primary', temperature=0.7,
        max_tokens=5000,
        first_delta_timeout_ms=settings.llm_stream_first_delta_ms):
    if ev.type == 'model':   model_used = ev.modelUsed; emit ev
    if ev.type == 'delta':   accumulator += ev.text;     emit ev
    if ev.type == 'done':    prompt_tok, completion_tok, total_tok = ...
                             # NB: do NOT emit done yet (see commit-before-done)

# Error path: emit error, log, return — do not write assistant, do not commit ticket
on UpstreamLLMError as e:
    emit {"type":"error","code":e.code,"message":e.message}
    log_llm_usage(endpoint='chat:expert', error=...)
    return                                    # user msg already INSERTed in step 4

# Success path: commit-before-done
try:
    ticket.commit()                           # may raise QuotaExceededError on race
except QuotaExceededError as e:
    emit {"type":"error","code":"QUOTA_EXCEEDED","message":str(e)}
    log_llm_usage(endpoint='chat:expert', error=...)
    return                                    # do not write assistant

INSERT messages(role='assistant', content=accumulator,
                meta={'intent':effective_intent,
                      'model_used':model_used,
                      'retrieval_source':... if retrieved else None})
log_llm_usage(endpoint='chat:expert', model=model_used,
              prompt_tokens=prompt_tok, completion_tokens=completion_tok,
              duration_ms=...)
emit {"type":"done","full":accumulator}
db.commit()
```

### 5.5 Event sequence summary

| Branch              | Events                                              |
|---------------------|-----------------------------------------------------|
| Normal answer       | `intent` → (`retrieval`?) → `model` → `delta`* → `done` |
| Divination redirect | `intent` → `redirect` → `done`                      |
| Quota race          | `intent` → (`retrieval`?) → `model` → `delta`* → `error(QUOTA_EXCEEDED)` |
| LLM error           | `intent` → (`retrieval`?) → (`model`?) → `error(UPSTREAM_*)` |
| Router LLM error    | `intent(intent='other',reason='router_error')` → expert proceeds normally |

## 6. Gua SSE (§6)

`POST /api/conversations/:id/gua`

Request: `{question: str}` (non-empty; trimmed).

### 6.1 Pipeline

```
1. owner check; soft-deleted → 404
2. check_quota('gua') → ticket
3. gua = cast_gua(at=now())
4. emit {"type":"gua","data":gua}              # frontend renders hexagram immediately
5. birth_context = derive_birth_context(chart.paipan)
   # {rizhu, current_dayun_gz, current_year_gz}
6. messages_llm = build_gua_messages(question, gua, birth_context)
7. async for ev in chat_stream_with_fallback(
        messages_llm, tier='primary', temperature=0.7, max_tokens=2000):
       emit model/delta; accumulate body
8. on UpstreamLLMError:
       emit error; log; return  (no message written, ticket not committed)
9. ticket.commit()  (race → emit error, return)
10. consume CTA (atomic with INSERT in step 11):
    DELETE FROM messages
     WHERE id = (
       SELECT id FROM messages
        WHERE conversation_id = :id AND role = 'cta'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
     )
    # No-op if no cta — gua may be cast via "起一卦" manual flow.
11. INSERT messages(role='gua', content=null,
                    meta={gua, question, body, model_used})
12. log_llm_usage(endpoint='gua', ...)
13. emit {"type":"done","full":body}
14. db.commit()
```

### 6.2 cast_gua (pure function, deterministic given input timestamp)

Algorithm verbatim from `archive/server-mvp/gua.js` (梅花易数·时间起卦):

```
ZHI_INDEX = {子:1, 丑:2, ..., 亥:12}
TRIGRAM_NAMES = ['乾','兑','离','震','巽','坎','艮','坤']

solar = lunar_python.Solar.fromYmdHms(at)
lunar = solar.getLunar()
year_zhi_idx = ZHI_INDEX[lunar.getYearInGanZhi()[1]]
lunar_month  = abs(lunar.getMonth())            # 闰月暂按本月
lunar_day    = lunar.getDay()
hour_zhi_idx = hour_to_zhi_index(at.hour)       # 子时跨日特判

sum_upper = year_zhi_idx + lunar_month + lunar_day
sum_lower = sum_upper + hour_zhi_idx
upper_idx = mod(sum_upper, 8)                   # 1..8
lower_idx = mod(sum_lower, 8)
dongyao   = mod(sum_lower, 6)                   # 1..6

id_  = COMBO_INDEX[upper_idx*10 + lower_idx]
gua  = GUA64.find(g.id == id_)
return {id, name, symbol, upper, lower, guaci, daxiang, dongyao,
        drawn_at, source: {yearGz, ..., formula}}
```

Pure function → unit-testable with frozen `at`.

### 6.3 birth_context

Derive from `chart.paipan` (which already contains
`META.today.{ymd, yearGz, monthGz}` + `dayun` list with `startYear`/`endYear`):

```
today_year = int(paipan.META.today.ymd[:4])
current_dayun_gz = (find dayun where startYear <= today_year <= endYear).gz
current_year_gz  = paipan.META.today.yearGz
rizhu            = paipan.META.rizhu
```

If any field missing, omit it (build_gua_messages skips empty context).

## 7. Frontend integration (§7)

UI/CSS frozen. Changes are wiring + state-source only.

### 7.1 `lib/api.js` (new functions)

```
listConversations(chartId)         GET  /api/charts/:cid/conversations
createConversation(chartId, label) POST /api/charts/:cid/conversations
patchConversation(id, label)       PATCH /api/conversations/:id
deleteConversation(id)             DELETE /api/conversations/:id
restoreConversation(id)            POST /api/conversations/:id/restore
listMessages(id, {before, limit})  GET  /api/conversations/:id/messages
streamMessage(id, body, cbs)       POST /api/conversations/:id/messages (SSE)
streamGua(id, body, cbs)           POST /api/conversations/:id/gua (SSE)
fetchChips(chartId, convId?)       POST /api/charts/:cid/chips
```

SSE wrapper unchanged; callbacks: `onIntent / onRedirect / onModel /
onDelta / onRetrieval / onGua / onError / onDone`.

### 7.2 `store/useAppStore.js`

- Drop these from the persist whitelist:
  `chatHistory`, `conversations`, `currentConversationId`, `gua`.
- Replace with **ephemeral store + sessionStorage for `currentConversationId` only**.
- New actions:
  - `loadConversations(chartId)` → list, set `conversations`, ensure
    `currentConversationId` is in the list (else first item).
  - `loadMessages(convId)` → list (latest 50), set `chatHistory`.
  - `appendMessage(msg)` / `replaceLastAssistant(text)` /
    `replacePlaceholderWithCta(question)` /
    `replaceLastCtaWithAssistant()` / `pushGuaCard(card)` /
    `updateLastGuaCard(text, done)` — same names as today, ephemeral
    only.
  - `consumeCta()` — local optimistic remove of the trailing cta row
    (server confirms via the next SSE).

### 7.3 `Chat.jsx` flow

- On chart change: `loadConversations(chartId)`. If list empty →
  `createConversation(chartId, '对话 1')`. Then `loadMessages(currentConvId)`
  + `fetchChips(chartId, currentConvId)`.
- `send(text)`: optimistic `appendMessage({role:'user'})` +
  empty assistant placeholder. Call `streamMessage(currentConvId,
  {message:text})`. On `onIntent`/`onDelta`/`onRedirect` same as today.
  On `onDone`: `fetchChips(chartId, currentConvId)`.
- `castGuaInline(question)`: call `streamGua(currentConvId, {question})`.
  Server handles the cta consume; frontend just pushes a placeholder
  GuaCard on `onGua` and updates on deltas.
- `analyzeDirectly(question)`: optimistic `consumeCta()` +
  `streamMessage(currentConvId, {message:question, bypass_divination:true})`.
- Retry: server-side regenerate is not in v1. Client retry deletes the
  last assistant row locally (no server-side delete needed if it was
  empty/error — that row was never written) and re-POSTs the user
  message. (Server allows duplicate user messages by design.)

### 7.4 `ConversationSwitcher.jsx`

All actions use `lib/api.js`. Local state is fed by
`useAppStore.conversations`. No localStorage logic remains.

### 7.5 `lib/sse.js`

Existing `streamSSE(url, body, callbacks)` keeps its public shape.
New event handlers route through callbacks:

- `intent` → `onIntent(intent, reason, source)`
- `retrieval` → `onRetrieval(source)`
- `gua` → `onGua(data)`
- `redirect` → `onRedirect(to, question)`
- `model` → `onModel(modelUsed)`
- `delta` → `onDelta(text, accumulator)`
- `done` → resolve with `full`
- `error` → reject with `{code, message}`

### 7.6 localStorage cleanup

On first load after deploy, detect legacy keys (`chatHistory`,
`conversations`, `gua`, `gua-history`) and delete them silently.
Add a one-line entry to README/release notes:
"Plan 6 迁移：本地浏览器里旧的对话历史不再使用，对话会保存在服务端。"

## 8. Quota & logging (§8)

### 8.1 Quota timing (chart_llm pattern, sealed in Plan 5 cleanup)

| Path                     | chat_message | gua | Notes                                    |
|--------------------------|:------------:|:---:|------------------------------------------|
| Chat → expert success    | +1           |  -  | commit before INSERT assistant + emit done |
| Chat → divination redirect | +1         |  -  | commit before emit done; cta row inserted |
| Chat → router LLM error  | 0            |  -  | router falls back to 'other'; expert still runs |
| Chat → expert LLM error  | 0            |  -  | user row stays; assistant not written     |
| Chat → quota race on commit | 0         |  -  | emit `error(QUOTA_EXCEEDED)`; assistant not written |
| Gua → success            | -            | +1  | commit before INSERT gua + emit done      |
| Gua → LLM error          | -            | 0   | gua message not written                   |
| Gua → quota race on commit | -          | 0   | emit `error(QUOTA_EXCEEDED)`              |

Pre-check (`check_quota('...')`) raises 429 before any LLM call if
already at limit (no Retry-After consumption).

### 8.2 LLM usage logs

Per-row write to `llm_usage_logs` (best-effort; never blocks SSE):

| endpoint        | trigger                      | tokens                           |
|-----------------|------------------------------|----------------------------------|
| `chat:router`   | router LLM fallback finished | full prompt/completion           |
| `chat:expert`   | expert stream done or errored | full prompt/completion or error |
| `gua`           | gua LLM done or errored      | full prompt/completion or error  |
| `chips`         | (existing)                   | unchanged                        |

`chart_id` joined via conversation. `conversation_id` and `message_id`
are **not** logged in v1 (no schema change). Plan 7+ may add columns
for fine-grained audit.

## 9. Prompts & shards (§9)

`server/app/prompts/router.py`:

```
INTENTS         = ['relationship','career','wealth','timing','personality',
                   'health','meta','chitchat','other','dayun_step','liunian',
                   'appearance','special_geju','divination']
KEYWORDS        = {...}    # archive prompts.js:375-387 verbatim
PRIORITY        = ['divination','timing','relationship','appearance',
                   'career','wealth','health','special_geju',
                   'meta','personality','chitchat']

classify_by_keywords(message: str) -> dict | None
build_messages(history: list[dict], user_message: str) -> list[dict]
parse_router_json(raw: str) -> {'intent': str, 'reason': str}
```

`server/app/prompts/expert.py`:

```
INTENT_GUIDE: dict[str, str]   # archive prompts.js:564-602
FALLBACK_STYLE: str            # short style block when no shard

pick_chart_slice(paipan: dict, intent: str) -> dict | None
build_messages(paipan, history, user_message, intent, retrieved)
    -> list[dict]
```

Loads shards via existing `app.prompts.loader.load_shards_for(intent)`.
Time anchor (chart `META.today`) is prepended to the user message —
keeps highest-attention position so the LLM does not hallucinate
"current year".

`server/app/prompts/gua.py`:

```
build_messages(question: str, gua: dict, birth_context: dict | None)
    -> list[dict]
```

`server/app/data/zhouyi/gua64.json` copied verbatim from
`archive/server-mvp/data/zhouyi/gua64.json` (no transformation).

`server/app/services/chart_chips.py` (modified):

- Signature change: `stream_chips(db, user, chart, conversation_id: UUID | None = None)`.
- If `conversation_id` is provided, fetch the latest 6 user/assistant
  messages from that conversation in chronological order; pass to
  `prompts.chips.build_messages(paipan, history)` (chips already
  supports the `history` argument).

`server/app/api/charts.py::chips_endpoint` accepts
`?conversation_id=<uuid>` query param and forwards it.

## 10. Tests & acceptance (§10)

### 10.1 Unit tests (≈9 files)

```
tests/unit/test_prompts_router.py              keyword priority, JSON parse edge cases
tests/unit/test_prompts_expert.py              chart slice per intent, time anchor placement
tests/unit/test_prompts_gua.py                 classical block format
tests/unit/test_gua_cast.py                    fixed-timestamp determinism
tests/unit/test_services_conversation.py       CRUD + ownership + soft-delete
tests/unit/test_services_message.py            keyset cursor + bounds
tests/unit/test_services_chat_router.py        keyword fast-path + LLM fallback
tests/unit/test_services_chat_expert.py        history injection + retrieval wiring
tests/unit/test_services_gua.py                cast + LLM message assembly
```

### 10.2 Integration tests (≈14 files, testcontainers)

```
tests/integration/test_conversations_crud.py             7-route smoke
tests/integration/test_conversations_ownership.py        cross-user 404
tests/integration/test_conversations_soft_delete.py      30d gate, restore success
tests/integration/test_messages_pagination.py            cursor over 60 rows
tests/integration/test_chat_sse_happy_path.py            user+assistant rows + event order
tests/integration/test_chat_sse_divination_redirect.py   cta row + redirect, no assistant
tests/integration/test_chat_sse_bypass_consumes_cta.py   bypass=true → cta deleted, assistant written
tests/integration/test_chat_sse_quota_429.py             chat_message pre-check
tests/integration/test_chat_sse_quota_race.py            commit race → error event, no assistant
tests/integration/test_chat_sse_llm_error.py             expert error → user row kept, no ticket commit
tests/integration/test_gua_sse_happy_path.py             gua + role='gua' row + meta
tests/integration/test_gua_sse_consumes_cta.py           cta → DELETE + INSERT gua
tests/integration/test_gua_sse_quota_429.py              gua pre-check
tests/integration/test_chips_uses_history.py             conv_id → last 6 msgs in history arg
```

### 10.3 Frontend tests

```
frontend/tests/lib/api.test.js                 new function mocks
frontend/tests/store/useAppStore.test.js       lazy-load + consumeCta + appendMessage
frontend/tests/Chat.test.jsx                   updated mocks (server-backed)
frontend/tests/ConversationSwitcher.test.jsx   server-action mocks
```

### 10.4 Acceptance gates (sealed in `server/ACCEPTANCE.md` post-merge)

1. **All tests green in parallel**: `uv run --package server pytest -n auto`
   ≥ 309 baseline + ≈26 new server = 335+ green; frontend suite green.
2. **Coverage** `app/` ≥ 85%.
3. **Parallel CI wall time** < 60s.
4. **No new alembic migration** (Conversation + Message tables already
   exist from Plan 4; verify `alembic check` passes).
5. **9 contract assertions** covered:
   cross-user 404, soft-delete 404, chat_message 429, gua 429,
   divination redirect, bypass consumes cta, chat LLM error keeps
   user row, gua LLM error writes nothing, no chat caching
   (verify N/A by absence of cache table reads in chat path).
6. **OpenAPI** lists all 9 changed routes (7 new + 2 modified).
7. **Wheel install + boot** smoke (`uv build` + `uvicorn app.main:app
   --no-reload` + `curl /api/health`).
8. **Handoff section** in ACCEPTANCE describing what Plan 7 (deploy /
   admin / guest / message audit) inherits.

---

## 11. Risks & mitigations

| Risk                                          | Mitigation                                                                                                        |
|-----------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `lunar-python` upstream behavior shift breaks gua hash | Pin version (already 1.4.8 in lockfile); unit test asserts on a fixed timestamp + expected hexagram name.   |
| Router keyword classifier drifts from intents | Snapshot test: feed 30 fixed phrases → assert intents (covers PRIORITY ordering).                                 |
| Frontend localStorage drop angers users with long histories | One-line release note in README. Optional future "import from localStorage" plan if support tickets arrive. |
| CTA row left dangling if user closes tab mid-cast | Acceptable. Server-side cleanup not added in v1 — the next chat or gua action consumes it.                |
| Race: two concurrent POST /messages on same conversation | History snapshot is already loaded before LLM call; both go through; messages keep their server timestamps. No locking. |
| Chat history grows unbounded                  | Pagination handles it. No automatic truncation in v1. Plan 8+ may add archival.                                   |

## 12. Rollout

Single PR, single migration (none). Deploy is a normal server +
frontend rebuild. No feature flag — new routes are additive; old
`/api/chat` `/api/gua` `/api/chips` MVP routes are already gone (Plan 4
removed them).
