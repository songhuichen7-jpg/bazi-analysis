# Verdicts Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated verdicts pipeline that builds a classical chunk tree, streams 3-5 structured verdicts for each chart, and renders them in a new frontend panel.

**Architecture:** Build verdicts as a completely separate feature path: offline `tree.json` builder, independent backend SSE generator, and per-chart frontend verdict state/UI. Existing retrieval, sections, chat, timing, and gua flows remain untouched.

**Tech Stack:** Node.js scripts + pure HTTP server + React + Zustand + native SSE parsing + existing MiMo client.

---

### Task 1: Add failing backend tests for verdict tree extraction

**Files:**
- Create: `server/tests/verdicts.test.mjs`
- Test: `server/tests/verdicts.test.mjs`

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement minimal shared helpers for chunk slicing and source extraction**
- [ ] **Step 4: Run the tests to verify they pass**

### Task 2: Build verdict chunk index

**Files:**
- Create: `scripts/build-verdicts.mjs`
- Create: `server/data/verdicts/tree.json` (generated)

- [ ] **Step 1: Implement whitelist scanning, frontmatter stripping, H2 slicing, preview generation, and offset capture**
- [ ] **Step 2: Run `node scripts/build-verdicts.mjs` and confirm chunk count / file size**
- [ ] **Step 3: Spot-check one命例 / one赋文 / one格局总论 chunk against source lines**

### Task 3: Add verdict prompt builders and backend generator

**Files:**
- Modify: `server/prompts.js`
- Create: `server/verdicts.js`

- [ ] **Step 1: Add failing tests for exact line extraction and event sequencing helpers where practical**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement pick/explain prompt builders and verdict generation pipeline**
- [ ] **Step 4: Run tests to verify pass**

### Task 4: Add `/api/verdicts` SSE endpoint

**Files:**
- Modify: `server/server.js`

- [ ] **Step 1: Wire independent SSE route without touching existing endpoints**
- [ ] **Step 2: Run server and verify missing-tree / missing-key graceful behavior**

### Task 5: Add frontend verdict streaming and per-chart state

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/store/useAppStore.js`
- Modify: `frontend/src/lib/persistence.js`

- [ ] **Step 1: Add failing store/API tests or minimal reproducible checks for verdict event handling**
- [ ] **Step 2: Run them to verify failure**
- [ ] **Step 3: Implement `streamVerdicts` and `loadVerdicts(chartId)`**
- [ ] **Step 4: Verify verdict state persists per chart without schema bump**

### Task 6: Add `VerdictsPanel` and hook concurrent loading

**Files:**
- Create: `frontend/src/components/VerdictsPanel.jsx`
- Modify: `frontend/src/components/Shell.jsx`
- Modify: `frontend/src/components/FormScreen.jsx`
- Modify: `frontend/src/App.jsx` (restore path for saved charts missing verdicts)

- [ ] **Step 1: Render loading / streaming / done / error states using existing `RichText`**
- [ ] **Step 2: Trigger verdict loading in parallel with sections after paipan**
- [ ] **Step 3: Ensure refresh restores cached verdicts and does not re-call LLM when already done**

### Task 7: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run `node scripts/build-verdicts.mjs`**
- [ ] **Step 2: Verify chunk count is 400-600 and `tree.json` is under 400KB**
- [ ] **Step 3: Run backend server and hit `/api/verdicts`, `/api/sections`, `/api/chat` smoke checks**
- [ ] **Step 4: Run frontend build**
- [ ] **Step 5: Run three chart acceptance cases and capture verdict output + SSE trace**
