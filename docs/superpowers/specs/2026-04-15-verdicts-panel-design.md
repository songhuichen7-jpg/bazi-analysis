# Verdicts Panel Design

**Goal:** Add an independent "古籍判词" panel that runs in parallel with `sections`, selects 3-5 relevant classical verdicts for a chart, and streams them to the frontend without affecting any existing endpoint.

**Scope:**
- Add a verdict-only chunk index builder from a strict whitelist of classical files.
- Add a verdict-only backend module and SSE endpoint.
- Add per-chart verdict state, streaming API client, and a new panel below `Sections`.
- Preserve all existing `retrieval.js`, heading routing, sections/chat/dayun/liunian/gua behavior.

## Architecture

The feature is isolated into three layers:

1. **Offline chunk index**
   `scripts/build-verdicts.mjs` scans a whitelist of classics, slices content by `H2` when available, falls back to whole-file chunks otherwise, and emits `server/data/verdicts/tree.json`.

2. **Online verdict generation**
   `server/verdicts.js` loads the tree, asks MiMo to pick 3-5 chunk headings, resolves the original lines by offset, asks MiMo for `baihua` and `duiying`, then streams structured verdict events back over SSE.

3. **Frontend consumption**
   `streamVerdicts()` parses SSE, `useAppStore` stores verdict state per chart, and `VerdictsPanel.jsx` renders loading/progress/error/done states under the existing `Sections` area.

## Data Model

Each verdict chunk will look like:

```json
{
  "id": "sanming-tonghui/juan-09.md#六已日甲子時斷",
  "book": "sanming-tonghui",
  "file": "juan-09.md",
  "heading": "六已日甲子時斷",
  "preview": "六已日生時甲子 明見官星暗有財 ...",
  "offset": { "line_start": 10, "line_end": 35 },
  "mode": "h2-section"
}
```

The frontend will store per chart:

```js
verdicts: {
  status: 'idle' | 'streaming' | 'done' | 'error',
  picks: [],
  items: [],
  lastError: null
}
```

This stays inside each chart payload so current persistence naturally restores it without bumping schema version.

## Backend Flow

`POST /api/verdicts` accepts `{ chart }` and uses SSE throughout.

Flow:

1. Validate `MIMO_API_KEY` and `server/data/verdicts/tree.json`.
2. Build a compact chart summary from `chart.META`, `chart.FORCE`, and current `DAYUN`.
3. Run **pick pass** with `buildVerdictsPickMessages(summary, tree)` and parse strict JSON.
4. Emit `pick_done`.
5. Resolve each pick to exact source lines using `offset`, trim `yuanwen` to at most 200 chars, preserving original text.
6. Run **explain pass** with `buildVerdictsExplainMessages(summary, picksWithYuanwen)`.
7. Emit one `verdict` event per item.
8. Emit `done`.

Any failure emits `error` and terminates only this stream.

## Frontend Flow

On successful paipan:

- existing `sections` request still runs as-is
- new `loadVerdicts(chartId)` starts in parallel

`VerdictsPanel` states:

- `idle`: render nothing before first request
- `streaming`: skeleton card + progress text
- `done`: render source / original text / baihua / duiying
- `error`: soft failure card + retry button

`baihua` and `duiying` use the existing `RichText` renderer so references remain clickable.

## Error Handling

- Missing `tree.json`: backend returns SSE `error`; panel shows graceful error state.
- Bad API key / MiMo failure: backend emits `error`; panel degrades independently.
- Partial pick/explain parse failure: treat as verdict stream failure, do not affect `sections`.
- Old saved charts with no `verdicts`: UI treats them as undefined/idle.

## Testing Strategy

1. Script-level tests for chunk extraction and offset/preview correctness.
2. Backend unit tests for verdict tree loading and exact line extraction from offsets.
3. Runtime checks for:
   - `node scripts/build-verdicts.mjs`
   - `node server/server.js`
   - `/api/verdicts` SSE event order and payload shape
   - frontend build
4. Manual acceptance with three target chart archetypes from the task spec.
