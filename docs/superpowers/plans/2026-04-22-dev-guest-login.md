# Dev Guest Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only guest login path that creates a usable test account and session without SMS input.

**Architecture:** Expose a new backend `POST /api/auth/guest` endpoint guarded by `settings.env == "dev"`, return the normal auth payload plus session cookie, and surface availability via `/api/config`. Update the auth screen to show a one-click guest entry button only when the config flag is enabled.

**Tech Stack:** FastAPI, SQLAlchemy async, React 19, Zustand, node:test, pytest

---

### Task 1: Backend contract

**Files:**
- Modify: `server/tests/integration/test_public_routes.py`
- Create: `server/tests/integration/test_auth_guest.py`

- [ ] Add a failing config test that expects `guest_login_enabled` in `/api/config`.
- [ ] Add a failing guest-auth test that expects `POST /api/auth/guest` to set a session cookie and return a user payload in dev.
- [ ] Add a failing guest-auth test that expects the endpoint to be unavailable outside dev.

### Task 2: Backend implementation

**Files:**
- Modify: `server/app/schemas/config.py`
- Modify: `server/app/api/public.py`
- Modify: `server/app/api/auth.py`
- Modify: `server/app/services/auth.py`

- [ ] Extend the public config schema/route with a dev-only `guest_login_enabled` flag.
- [ ] Add a small guest-user creator in `auth.py` service that generates a unique test phone, DEK, and session.
- [ ] Add `POST /api/auth/guest` in `api/auth.py`, guard it to dev only, and reuse the normal auth cookie response shape.

### Task 3: Frontend contract

**Files:**
- Modify: `frontend/tests/auth.test.mjs`

- [ ] Add a failing API helper test that expects `guestLogin()` to `POST /api/auth/guest` with credentials and receive `{ user }`.

### Task 4: Frontend implementation

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/components/AuthScreen.jsx`
- Modify: `frontend/src/lib/authPhoneHint.js`

- [ ] Add `guestLogin()` to the API client.
- [ ] Update the auth screen to read `guest_login_enabled` from `/api/config`, render a `游客登录` button beside the existing auth toggles, and disable it while the request is in flight.
- [ ] On success, set the auth session hint, clear any saved phone hint, store the returned user, and route directly to the input screen.

### Task 5: Verification

**Files:**
- None

- [ ] Run targeted backend tests for public config and guest auth.
- [ ] Run targeted frontend auth tests.
- [ ] Run a small broader regression slice for auth/bootstrap behavior.
