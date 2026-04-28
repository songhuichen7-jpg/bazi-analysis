# 有时（bazi-analysis）

> **品牌名**：有时 — 双关「命有其时」与「有时间」。
> **域名**：`youshi.app`（占位，正式域名锁定后一行 `sed` 替换全仓库）。

理性的命理工具：八字排盘 + 多经检索 LLM 解读 + 梅花易数起卦。

- **八字主线**：排盘 → 三法用神（调候/格局/扶抑）→ 行运评分（大运/流年 5-bin）→ router→expert 聊天
- **卦象主线**：时间起卦 → 64 卦本卦原文 + 白话解
- **反幻觉**：所有古籍引用走 `classics/` 真本检索（穷通宝鉴/子平真诠/滴天髓/三命通会/渊海子平/周易）

## Plan 7.x — 命理引擎完整体（2026-04-22 完结）

完整命理引擎从 4 行启发式跃升到完整子系统：

| Plan | 主题 | Release notes |
|---|---|---|
| 7.3 | 用神 engine v1（三法合成） | [`docs/release-notes/2026-04-21-plan-7.x-yongshen-xingyun.md`](docs/release-notes/2026-04-21-plan-7.x-yongshen-xingyun.md) |
| 7.4 | 行运 engine（5-bin 评分） | 同上 |
| 7.5a | 静态用神变化（命局合局触发） | [`docs/release-notes/2026-04-21-plan-7.5a-yongshen-transmutation.md`](docs/release-notes/2026-04-21-plan-7.5a-yongshen-transmutation.md) |
| 7.5b | 动态用神变化（大运/流年触发） | [`docs/release-notes/2026-04-21-plan-7.5b-xingyun-transmutation.md`](docs/release-notes/2026-04-21-plan-7.5b-xingyun-transmutation.md) |
| 7.6 | engine polish deep（5-bin 极弱/极强 + weighted avg） | [`docs/release-notes/2026-04-22-plan-7.6-engine-polish-deep.md`](docs/release-notes/2026-04-22-plan-7.6-engine-polish-deep.md) |
| 7.7 | 大运/流年 cross interaction | [`docs/release-notes/2026-04-22-plan-7.7-cross-interaction.md`](docs/release-notes/2026-04-22-plan-7.7-cross-interaction.md) |

实质改变：LLM chat 输出从 "推测/可能/或许" 充斥的 hedging，变成 byte-level 引经据典 + ZPZQ-style 二阶推理。

## 启动

```bash
# 开发（两个终端）
npm run dev:back     # http://localhost:3101  后端 + LLM
npm run dev:front    # http://localhost:5173  Vite HMR，/api 代理到后端

# 一键跑（构建前端 + 起后端）
npm run start        # http://localhost:3101
```

## 环境变量（`server/.env`）

```
# DeepSeek（OpenAI-compatible API）
DEEPSEEK_API_KEY=...                      # https://platform.deepseek.com
DEEPSEEK_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro                 # 主模型
LLM_FAST_MODEL=deepseek-v4-pro            # 快模型（router/liunian）
LLM_FALLBACK_MODEL=deepseek-v4-pro        # 失败兜底
PORT=3101
```

## 项目结构

```
.
├── paipan/               # 排盘 + 命理分析引擎（Python）
│   ├── paipan/           # core engine: ganzhi / li_liang / ge_ju / yongshen / xingyun / ...
│   └── tests/            # 632 tests, all green
├── server/               # FastAPI 后端 + LLM 编排
│   ├── app/              # API / DB / prompts / services
│   └── tests/            # 439 tests
├── frontend/             # Vite + React 19 前端
│   └── tests/            # 51 tests (node:test)
├── classics/             # 古籍真本（穷通宝鉴/子平真诠/滴天髓/...）
├── shards/               # 主题 prompt 片段（appearance/career/health/relationship/...）
├── docs/
│   ├── superpowers/      # spec / plan / 实施过程
│   ├── release-notes/    # Plan 7.x 各版本发布说明
│   ├── skills/           # 命理方法论 companion docs
│   ├── bazi-analysis/    # 系统设计文档
│   ├── system-architecture.md     # 架构总览
│   └── paipan-port-inventory.md   # JS→Python port 清单
├── archive/              # 旧 JS 引擎源码（被 Python 引擎 port 时的 source-of-truth）
└── .claire/              # browser smoke screenshots
```

## 文档

- [`docs/skills/SKILL.md`](docs/skills/SKILL.md) — 命理方法论（runtime 加载到 LLM prompt）
- [`docs/skills/conversation-guide.md`](docs/skills/conversation-guide.md) — 对话节奏（runtime 加载）
- [`docs/skills/classical-references.md`](docs/skills/classical-references.md) — 古籍检索路径表
- [`docs/skills/`](docs/skills/) — 命理 skill companion docs（含 advanced-techniques / synthesizer-bug-prevention）
- [`docs/system-architecture.md`](docs/system-architecture.md) — 系统架构
- [`docs/release-notes/`](docs/release-notes/) — 各 Plan 发布说明
- [`docs/superpowers/`](docs/superpowers/) — spec / plan 实施过程
- [`server/README.md`](server/README.md) — API 端点
- [`paipan/README.md`](paipan/README.md) — 排盘引擎 API

## 测试

```bash
uv run --package paipan pytest -n auto -q paipan/tests/    # 632 paipan
uv run --package server pytest -n auto -q server/tests/    # 439 server
cd frontend && node --test tests/*.mjs                      # 51 frontend
```
