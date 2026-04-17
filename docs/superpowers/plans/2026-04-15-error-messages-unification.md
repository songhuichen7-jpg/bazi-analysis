# Error Messages Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一前端可见错误文案，让网络、LLM、流式中断、资源缺失和本地存储问题都显示成口语化中文，并补齐重试入口与全局 toast。

**Architecture:** 保持现有 SSE 协议和后端 fallback 不变，只在展示层新增 `friendlyError()` 分类函数和 `ErrorState` 组件。各 panel、Chat、Gua、FormScreen 和 persistence 统一走同一套友好文案与重试规则；本地存储与 ChartSwitcher 限制走 App 级 notice toast。

**Tech Stack:** React、Zustand、Node built-in test、Vite

---

### Task 1: 先写失败测试

**Files:**
- Create: `frontend/tests/error-messages.test.mjs`

- [ ] 写 `friendlyError()` 的分类测试，覆盖网络、鉴权、限流、模型 5xx、格式错、资源缺失、排盘输入错、本地存储写满
- [ ] 写 `subscribeSave()` 的存储失败通知测试，确认仍会 `console.warn` 且会抛出友好 notice

### Task 2: 实现统一错误层

**Files:**
- Create: `frontend/src/lib/errorMessages.js`
- Create: `frontend/src/components/ErrorState.jsx`
- Modify: `frontend/src/store/useAppStore.js`
- Modify: `frontend/src/lib/persistence.js`
- Modify: `frontend/src/components/Sections.jsx`
- Modify: `frontend/src/components/VerdictsPanel.jsx`
- Modify: `frontend/src/components/Chat.jsx`
- Modify: `frontend/src/components/DayunStepBody.jsx`
- Modify: `frontend/src/components/LiunianBody.jsx`
- Modify: `frontend/src/components/Gua.jsx`
- Modify: `frontend/src/components/FormScreen.jsx`
- Modify: `frontend/src/components/ChartSwitcher.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

- [ ] 新增 `friendlyError(error, context)`，返回 `{ title, detail, retryable }`
- [ ] 新增 `ErrorState`，支持 inline / toast 两种承载、可选“详情”折叠和“再试一次”
- [ ] 在 store 增加非持久化 `appNotice`，用于存储告警和 ChartSwitcher 提示
- [ ] persistence 读写失败时继续 `console.warn`，同时推送全局友好 toast
- [ ] 各 panel / Chat / Gua / FormScreen 改为展示友好文案，raw detail 放折叠区

### Task 3: 验证

**Files:**
- Verify only

- [ ] 运行 `node --test frontend/tests/error-messages.test.mjs`
- [ ] 运行 `npm run build`
- [ ] 运行 `npm run lint`
- [ ] grep 确认主要 raw-error UI 已被统一错误组件替换
