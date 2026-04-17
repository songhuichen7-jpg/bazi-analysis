# 系统架构文档

> 版本：MVP (2026-04)
> 本文根据现有代码重新整理，替换旧版本。目标是让新加入的人能在 15 分钟内理解整个系统是怎么跑起来的。

---

## 1. 项目定位

一款面向个人用户的八字分析 Web App：

- **输入**：出生年月日时 + 出生地 + 性别。
- **输出**：结构化命盘（四柱、十神、力量、大运流年）+ 流式文字解读 + 基于命盘的多轮对话 + 梅花易数起卦。
- **风格**：古籍有据、口吻克制、承认不确定性；命不是判决书，是一张地形图。

MVP 范围内**不做**：多人账号、云端持久化、付费、移动端适配、AI 画像生成。

---

## 2. 仓库结构

```
bazi-analysis/
├── frontend/              # React + Vite 前端
├── server/                # Node 原生 HTTP 后端（port 3101）
│   ├── server.js          # 所有路由 + SSE 逻辑
│   ├── prompts.js         # 所有 LLM 提示词构造器
│   ├── llm.js             # MiMo 客户端 + 分层/回退策略
│   ├── retrieval.js       # 古籍检索
│   ├── verdicts.js        # 总论单段流式生成
│   ├── gua.js             # 时间起卦
│   └── data/              # 5 部古籍片段 + verdicts 模板
├── paipan-engine/         # 纯计算模块：真太阳时 + 干支 + 十神 + 力量 + 格局
├── classics/              # 完整古籍原文（检索语料来源）
├── shards/                # 按意图切分的提示词片段
├── scripts/               # 数据预处理、索引构建
├── docs/                  # 文档（本文）
├── SKILL.md               # 基础分析准则（每次 LLM 调用都会带上）
├── conversation-guide.md  # 对话口吻与排版约束
├── classical-references.md  # 古籍锚点选择指南
├── advanced-techniques.md   # 高级技法补充
└── synthesizer-bug-prevention.md  # 避免常见合成性错误
```

顶层没有 monorepo 工具，`frontend/`、`server/`、`paipan-engine/` 各自有独立 `package.json`，通过相对路径 `require('../paipan-engine/...')` 在 server 中引用。

---

## 3. 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 前端 | React 19 + Vite 8 | 无路由库，单屏切换；Zustand 5 管状态 |
| 状态持久化 | `localStorage` v3 schema | 多命盘 + 每命盘多对话 |
| 后端 | Node.js 原生 `http` | 无框架，所有路由写在 `server.js` 里 |
| LLM | MiMo API（OpenAI 协议兼容） | `mimo-v2-pro`（主）+ `mimo-v2-flash`（快/回退） |
| 流式 | SSE（`text/event-stream`） | 自定义事件：`delta` / `done` / `error` / `model` / `intent` / `retrieval` / `gua` / `redirect` |
| 排盘 | 纯 JS 计算 | `lunar-javascript` 生成干支，自己实现力量、格局、大运流年 |
| 起卦 | 梅花易数·时间起卦 | 同样基于 `lunar-javascript` |

---

## 4. 前端架构

### 4.1 屏幕流

```
FormScreen  ──填完出生信息──▶  POST /api/paipan  ──▶  Shell
                                                   │
                                                   ├── 左栏：命盘视图 / 流年视图（view switch）
                                                   └── 右栏：聊天 + 多对话切换
```

只有两个"屏"：`FormScreen`（首屏输入表单）和 `Shell`（主工作区）。切屏靠 Zustand 的 `screen` 字段控制；无 React Router。

### 4.2 组件清单

位置：`frontend/src/components/`

| 组件 | 职责 |
|---|---|
| `FormScreen.jsx` | 出生信息表单：日期、时辰、城市选择、性别 |
| `Shell.jsx` | 主布局：左右双栏 + 可拖拽 resize handle；管理 `view` 切换 |
| `Chart.jsx` | 四柱命盘主图（年月日时） |
| `Meta.jsx` | `BirthHeader` / `MetaGrid` / `ReadingHeader` 三个小块 |
| `Force.jsx` | 十神力量条 + `GuardList`（结构提示） |
| `Sections.jsx` | 七个分析板块（性格、事业、财运、感情、健康、相貌、特殊格局） |
| `VerdictsPanel.jsx` | 总论面板（单段流式） |
| `Dayun.jsx` | 大运表 |
| `DayunStepBody.jsx` | 单个大运展开后的流式分析 |
| `LiunianBody.jsx` | 单个流年展开后的流式分析 |
| `Chat.jsx` | 右栏对话，含默认 chips、CTA 气泡、卦象卡片、错误气泡 |
| `ConversationSwitcher.jsx` | 当前命盘下的多对话下拉（新建/切换/重命名/删除） |
| `ChartSwitcher.jsx` | 多命盘切换下拉 |
| `Gua.jsx` / `GuaCard.jsx` | 卦象起卦与展示 |
| `RefChip.jsx` | 古籍引用小标签 + `RichText`（内联 markdown 解析） |
| `ErrorState.jsx` | 统一错误气泡，含可重试按钮 |
| `Skeleton.jsx` | 加载态占位 |

### 4.3 状态 (`store/useAppStore.js`)

单个 Zustand store，关键片段：

```js
// 当前命盘的字段（会随命盘切换整体替换）
const CHART_FIELDS = [
  'meta', 'paipan', 'force', 'guards', 'dayun',
  'sections', 'verdicts',
  'conversations', 'currentConversationId',  // ← 多对话
  'gua',
];

// 命盘集合
charts: [{ id, label, ...CHART_FIELDS, ts }, ...],
currentChartId,

// 单命盘内部的多对话
conversations: [
  {
    id, label,               // label 会根据第一条用户消息自动改写
    messages: [...],         // { role: 'user'|'assistant'|'gua'|'cta', content }
    ts,
  },
  ...
],
currentConversationId,
```

**多对话的关键设计**：

- 每个命盘独立持有 `conversations` 数组。切命盘 = 整组对话换掉。
- 所有聊天 mutation（`pushChat` / `replaceLastAssistant` / `pushGuaCard` / `clearChat` …）走一个叫 `syncActive()` 的辅助函数——既写入 `chatHistory`（兼容旧代码），也写回 `conversations[current].messages`，并在首条用户消息出现时把 "默认对话"/"新对话" 自动改名成问题前几字。
- `clearChat` 只清当前对话，不清其他对话。
- `newConversation()` / `switchConversation()` / `deleteConversation()` / `renameConversation()` 在 store 里实现；UI 由 `ConversationSwitcher` 提供。
- 旧数据（只有 `chatHistory` 无 `conversations` 的命盘）通过 `hydrateConversations()` 在恢复时自动迁移成单对话。

### 4.4 持久化 (`lib/persistence.js` + `lib/constants.js`)

```js
export const STORAGE_KEY = 'bazi_session_v1';
export const SESSION_VERSION = 3;
export const MAX_CHARTS = 10;
```

- 策略：写回 `localStorage[STORAGE_KEY]`，JSON 序列化整个 store 的可持久化子集。
- 保留最近 **10** 张命盘；超过按时间淘汰。
- 每次 store mutation 触发（useAppStore 内部订阅）。版本不匹配会清空并弹出提示。

### 4.5 API 客户端 (`lib/api.js`)

- `postJSON(url, body)`：普通 JSON 请求，统一错误处理。
- `streamSSE(url, body, handlers)`：SSE 流式调用，解析 `data: ...` 行并分发到 `onDelta` / `onDone` / `onError` / `onModel` / `onIntent` / `onRedirect` / `onRetrieval` / `onGua`。
- 所有对 `/api/...` 的请求都经过这里。

### 4.6 Markdown 解析

`RefChip.jsx` 内的 `RichText` 做内联 markdown：`**bold**` / `*italic*` / `` `code` ``；行首的 `#`、`-`、`*` 等标记被剥除，避免 LLM 吐出裸 markdown 符号。

---

## 5. 后端架构

### 5.1 路由表

入口 `server/server.js`，10 个路由，全部裸 Node HTTP + 手写 router：

| Method | Path | 响应 | 说明 |
|---|---|---|---|
| GET | `/api/health` | JSON | 探活 |
| GET | `/api/cities` | JSON | 已知城市列表（本地 `cities.js`） |
| POST | `/api/paipan` | JSON | 排盘入口。body: 出生信息。返回 `{ paipan, analyze, ui, meta }` |
| POST | `/api/sections` | SSE | 七板块解读，按板块分段流式；事件包含 `section` + `delta` + `done` |
| POST | `/api/verdicts` | SSE | **总论**。单段流式，一次到底，不再分 pick/explain |
| POST | `/api/dayun-step` | SSE | 单个大运展开 |
| POST | `/api/liunian` | SSE | 单个流年展开 |
| POST | `/api/chips` | JSON | 生成聊天区默认建议问题（第一人称） |
| POST | `/api/chat` | SSE | 主对话。含意图识别 → 占卜重定向 / 普通回答 |
| POST | `/api/gua` | SSE | 时间起卦 + 流式解卦 |

所有 LLM 路由走 SSE；返回头：`Content-Type: text/event-stream`。

### 5.2 LLM 客户端 (`server/llm.js`)

MiMo API 走 OpenAI 兼容协议。环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MIMO_API_KEY` | —（必填） | API Key |
| `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | 接入点 |
| `LLM_MODEL` | `mimo-v2-pro` | 默认主模型 |
| `LLM_FAST_MODEL` | `mimo-v2-flash` | 快模型（chips 等轻任务） |
| `LLM_FALLBACK_MODEL` | `mimo-v2-flash` | 主模型超时时回退 |
| `STREAM_FIRST_DELTA_MS` | 未设 | 首个 delta 超时毫秒，到点就触发 fallback |

导出：`chat` / `chatStream` / `chatWithFallback` / `chatStreamWithFallback` / `hasKey` / `DEFAULT_MODEL` / `FAST_MODEL` / `FALLBACK_MODEL`。

**分层策略**：

- 重型任务（sections / verdicts / dayun-step / liunian / chat）走 `chatStreamWithFallback`：优先 pro；若首个 delta 超时，无缝切 flash。
- 轻型任务（chips、意图分类）直接走 `FAST_MODEL`。
- SSE 会发 `model` 事件告诉前端实际用的是哪个模型（**不再**把 "主模型反应慢" 提示渲染给用户——前端吞下该事件仅用于埋点）。

### 5.3 提示词 (`server/prompts.js`)

单文件承载所有提示词构造器，约 1000 行。核心函数：

| 函数 | 用途 |
|---|---|
| `compactChartContext(ui)` | 把命盘数据压缩成 LLM 可读的紧凑上下文；**每次调用都会注入**，保证模型知道在算的是哪张盘 |
| `buildSectionsMessages` | 七板块解读 |
| `buildVerdictsMessages` | 总论单段（古籍锚点 → 一生的形状 → 几重张力 → 一生的课题 → 收尾） |
| `buildDayunStepMessages` / `buildLiunianMessages` | 运程展开 |
| `buildChatMessages` | 主对话（含意图 shard 注入） |
| `buildIntentClassifierMessages` | LLM 意图分类器（chat / divination / meta / …） |
| `buildChipsMessages` | 建议问题。强制**第一人称**："我七杀这么重……" / "我丁卯大运……"；不允许出现 "你"、"您"、"这张盘" |
| `buildGuaMessages` | 梅花易数解卦 |

**提示词资产加载顺序**：`SKILL.md`（基础准则） + `conversation-guide.md`（口吻排版） + 意图对应 shard（`shards/core.md`、`career.md`、`relationship.md` …） + 可选古籍检索结果。`classical-references.md` / `advanced-techniques.md` / `synthesizer-bug-prevention.md` 作为背景知识按需引用。

### 5.4 意图路由（chat）

`POST /api/chat` 两阶段：

1. **关键词兜底路由**：常见占卜触发词（"卦"、"占"、"算一下"、"该不该" + 具体事件）直接判为 `divination`。
2. **LLM 分类器**：关键词未命中时，用 `FAST_MODEL` 跑一次轻量分类（chat / divination / meta / smalltalk 等），返回 `{ intent, reason, source }`。

路由完成后：

- `intent === 'divination'` → 通过 SSE `redirect` 事件告诉前端跳 `/api/gua`，并在聊天气泡位置插入 CTA 卡片（"起一卦 / 用命盘直接分析"）。
- 其它意图 → 按 intent 选 shard，拼 `buildChatMessages`，`chatStreamWithFallback` 流出 `delta`。
- 前端可传 `bypassDivination: true` 强制走命盘路径（"用命盘直接分析" 按钮就是这样）。

### 5.5 古籍检索 (`server/retrieval.js`)

- 数据源：`server/data/` 下预切好的 5 部古籍片段（子平真诠 / 滴天髓 / 穷通宝鉴 / 三命通会 / 渊海子平）。原始全文在顶层 `classics/`，切分脚本在 `scripts/`。
- `retrieveForChart(chart, intent)`：按意图（meta / career / relationship / …）挑相关片段，返回锚点引用。被 sections / verdicts / chat 调用。
- 失败不阻塞主流：best-effort，检索挂了也继续走 LLM，只是少了古籍锚点。

### 5.6 总论单流 (`server/verdicts.js`)

旧版把 verdicts 拆成 "pick" + "explain" 两次调用；现在合并：

- 一次 `chatStreamWithFallback(buildVerdictsMessages(chart, retrieved))`，`max_tokens: 5000`；
- 事件流：`model` → `delta` × N → `done`；
- 模板（由 prompt 里的结构建议驱动）：**古籍锚点 → 一生的形状 → 几重张力 → 一生的课题 → 收尾**。
- `verdicts-pick` / `verdicts-explain` 两个旧 builder 仍在 prompts.js 里但不再被路由调用。

### 5.7 起卦 (`server/gua.js`)

- 梅花易数·时间起卦：以当前时间的年月日时数转成上下两卦 + 动爻。计算用 `lunar-javascript`。
- 流程：`computeGua(now) → 本卦/变卦/动爻 → buildGuaMessages → chatStreamWithFallback`。
- SSE 事件序列：`gua`（带卦象数据给前端渲染卡片） → `delta` × N → `done`。
- `birthContext`（日主 / 当前大运 / 流年）被可选注入 prompt，让解卦能"顺带看一眼命盘"。

---

## 6. 排盘引擎 (`paipan-engine/`)

纯计算库。输入出生信息，输出：

```js
{
  paipan: { year, month, day, hour },       // 每柱 { gan, zhi, ganWuxing, zhiWuxing, shiShen, zhiCangGan }
  force: { bi, shi, cai, guan, yin, ... },  // 十神力量分数
  guards: [...],                             // 结构提示：从格、格局、用神方向
  dayun: [{ startYear, endYear, gz, years: [{year, gz}, ...], current? }, ...],
  meta: {
    rizhu, rizhuGan,
    solarTime, trueSolarTime,
    geJu,                                    // 格局判断
    today: { ymd, yearGz, monthGz, dayGz, hourGz },
    ...
  },
  ui: { ... },                               // 给前端/LLM 的压缩视图
}
```

内部模块：

| 文件 | 职责 |
|---|---|
| `paipan.js` | 入口 + 主流程 |
| `solarTime.js` | 经度换算真太阳时 |
| `chinaDst.js` | 中国历史夏令时表 |
| `ziHourAndJieqi.js` | 子时处理 + 节气换月 |
| `cities.js` | 已知城市经纬度 |

引擎不依赖 server/frontend；纯函数。server 通过 `require('../paipan-engine/src/paipan')` 调用。

---

## 7. 关键设计决定

### 7.1 多命盘 + 每命盘多对话

用户可能同时给家人、朋友排盘；同一张盘又可能想分别问"事业"、"姻缘"。两层分离：

- **命盘切换**由 `ChartSwitcher` 控制，会整体替换所有 `CHART_FIELDS`；
- **对话切换**由 `ConversationSwitcher` 控制，只换 `conversations[currentConversationId].messages`；
- 每张命盘至少有一个对话（删完最后一个会自动新建）；
- 切换对话后会重新调 `/api/chips` 基于该对话历史刷新建议问题。

### 7.2 总论单段流式

早期分两次调用容易出现"挑的要点"和"展开的正文"口径不一致。现在单次流式一次性铺完，prompt 里用结构建议（古籍锚点 / 一生的形状 / 几重张力 / 一生的课题 / 收尾）代替硬编码章节，模型可按实际情况增删标题。

### 7.3 回退模型对用户不可见

之前流年面板会弹出"主模型反应慢，已切到 ...flash"——这对用户没价值只制造焦虑。现在前端只收 `model` 事件埋点，不渲染任何提示。若需排查，后端日志里能看到。

### 7.4 Chips 强制第一人称

用户更愿意点"像自己会问的话"的问题。prompt 硬性约束："你在为一位命主准备他想问命理师的 4 个问题"、"第一人称：用'我'指代命主自己；不要用'你'、'您'、'这张盘'这种第三方口吻"，并给出示范。

### 7.5 命盘上下文每次注入

每次 LLM 调用（除纯分类器外）都在 system 里 inline 一份 `compactChartContext(ui)`。不依赖"上次对话里提过"——保证即便切对话、切模型、跨越上下文窗口，模型仍然知道要分析的是哪张盘。

### 7.6 内联 Markdown 而非块级

LLM 偶尔会吐出 `##` 标题和 `- ` 列表符号；在对话气泡里这些显得生硬。前端只解析**内联**加粗/斜体/行内代码，行首符号剥掉。如果真的需要结构化输出（总论、运程展开），由 prompt 的分段指引驱动视觉分隔。

### 7.7 后端不用框架

单文件 `server.js` 手写 router 的好处：部署简单（`node server.js`）、无中间件黑盒、改起来快。代价是所有路由写在一起——等超过 20 个路由再考虑拆。

---

## 8. 运行与开发

```bash
# 后端
cd server
cp .env.example .env   # 填入 MIMO_API_KEY
npm install
node server.js         # http://localhost:3101

# 前端
cd frontend
npm install
npm run dev            # http://localhost:5173，vite 代理 /api → 3101
```

健康检查：`curl http://localhost:3101/api/health`。

---

## 9. 下一步（非本 MVP 范围）

留给未来版本的候选：

- 用户账号与云端同步（目前只靠 localStorage）；
- 分享功能（把一张命盘 + 对话导出为只读链接）；
- 移动端适配（当前左右双栏在窄屏下会挤）；
- 更细的检索（从片段级升到句级，配合 embedding）；
- 自定义提示词（允许用户上传自己的流派偏好）。

以上都**不在当前 MVP 讨论范围内**，写在这里只是做方向记录。
