# Tech Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清掉旧的 dayun 全局副作用、补 REF 输出约束、并把 chat history 上限收口到 append 路径。

**Architecture:** `parseRef` 直接从 Zustand store 读取当前盘 `dayun`，不再依赖全局变量；`core.md` 只追加一条禁止包裹 REF 标记的规则；chat history 新增一个集中裁剪 helper，`pushChat` 走 helper，`snapshotChart` 停止隐式裁剪，以满足“老盘仅在下次 append 时触发裁剪”。

**Tech Stack:** React、Zustand、Node built-in test、Vite

---

### Task 1: 先写失败测试

**Files:**
- Create: `frontend/tests/tech-debt-cleanup.test.mjs`

- [ ] 写 `scrollAndFlash` 的 liunian rescue 测试，验证它读取 store 中当前盘的 `dayun`，而不是旧的全局 dayun 缓存
- [ ] 写 `trimChatHistory` 测试，覆盖普通截尾、保留 pinned/system 首条、老盘首次 append 时裁到 100、多盘互不影响
- [ ] 写 `core.md` 文案测试，验证新增“不要用反引号/引号/书名号包裹 REF 标记”规则存在

### Task 2: 最小实现

**Files:**
- Create: `frontend/src/lib/chatHistory.js`
- Modify: `frontend/src/lib/parseRef.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/store/useAppStore.js`
- Modify: `frontend/src/lib/constants.js`
- Modify: `shards/core.md`

- [ ] 在 `parseRef.js` 里改为 `useAppStore.getState()` 读取当前盘 `dayun`
- [ ] 删除 `App.jsx` 里的旧 dayun 全局订阅
- [ ] 新增 chat history 裁剪 helper，并让 `pushChat` 使用它
- [ ] 把 `snapshotChart()` 的 `slice(-100)` 去掉，避免恢复老盘时被动裁剪
- [ ] 在 `core.md` 的 REF 段末尾追加禁止包裹 REF 标记的规则

### Task 3: 验证

**Files:**
- Verify only

- [ ] 运行 `node --test frontend/tests/tech-debt-cleanup.test.mjs`
- [ ] 运行 dayun 全局残留 grep
- [ ] 运行 `npm run build`
- [ ] 运行 `npm run lint`
