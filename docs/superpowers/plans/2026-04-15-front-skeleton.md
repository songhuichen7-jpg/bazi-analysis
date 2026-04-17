# Front Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `Sections` 和 `VerdictsPanel` 增加首屏骨架屏、进度文案与淡入切换。

**Architecture:** 新增一个无状态 `Skeleton` 组件承载共用占位 UI；`Sections` 继续基于现有 loading/error/items 推导骨架；`VerdictsPanel` 直接基于真实 verdicts 流式状态显示骨架与局部完成态。

**Tech Stack:** React、Vite、Zustand、原生 CSS

---

### Task 1: 通用骨架组件

**Files:**
- Create: `frontend/src/components/Skeleton.jsx`
- Modify: `frontend/src/index.css`

- [ ] 新建 `SkeletonLines` 和 `SkeletonProgress`
- [ ] 追加骨架动画、基础类名与移动端缩放样式

### Task 2: Sections 骨架

**Files:**
- Modify: `frontend/src/components/Sections.jsx`

- [ ] 用 `SkeletonProgress` 替换当前硬编码 loading 占位
- [ ] 支持“部分内容 + 底部骨架”的组合态
- [ ] 完成态整体加 `fade-in`

### Task 3: Verdicts 骨架

**Files:**
- Modify: `frontend/src/components/VerdictsPanel.jsx`

- [ ] 把当前骨架改成通用 `SkeletonProgress`
- [ ] 支持 pick 阶段、逐条生成阶段和 done/error 阶段
- [ ] 完成态整体加 `fade-in`

### Task 4: 验证

**Files:**
- Verify only

- [ ] 运行 `npm run build`
- [ ] 运行 `npm run lint`
- [ ] 用浏览器抓桌面端 3 张截图：初始 streaming / 部分完成 / done
- [ ] 用浏览器抓移动端 3 张截图：初始 streaming / 部分完成 / done
