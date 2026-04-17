# Front Skeleton Design

## Goal
在不改 store、SSE 协议、后端和其他 panel 的前提下，为 `Sections` 与 `VerdictsPanel` 提供首屏骨架屏、进度文案、淡入切换和错误态占位。

## Scope
- 新增通用骨架组件 `frontend/src/components/Skeleton.jsx`
- 追加骨架动画与样式到 `frontend/src/index.css`
- 改造 `frontend/src/components/Sections.jsx`
- 改造 `frontend/src/components/VerdictsPanel.jsx`

## State Strategy
- `Sections` 继续使用现有 `sectionsLoading + sections[] + sectionsError`。
- 因为 sections 不是逐段 SSE，不能知道真实第几段完成；前端只做“估算进度”，根据已完成段数与加载状态显示第 `X/5` 段。
- `VerdictsPanel` 使用真实 `verdicts.status / picks / items / lastError`，按真实进度显示。
- `done` 态直接渲染真实内容，不闪骨架；恢复态若 store 已有完成内容，保持直接显示。

## UI Rules
- 初始 streaming：显示 `SkeletonProgress`
- 部分完成：显示已有内容，底部再补一块 `SkeletonProgress`
- done：整体加 `fade-in`
- error：显示错误提示；`VerdictsPanel` 保留重试按钮，`Sections` 仅保留现有错误提示

## Mobile
- 375px 下骨架条高度和间距略缩小
- 骨架宽度使用百分比与容器适配，禁止横向溢出
