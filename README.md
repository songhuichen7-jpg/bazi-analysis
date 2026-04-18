# bazi-analysis

理性的命理工具：八字排盘 + 多经检索 LLM 解读 + 梅花易数起卦。

- 八字主线：排盘 → 5 段初始解读 → router→expert 聊天 → 大运/流年下钻
- 卦象主线：时间起卦 → 64 卦本卦原文 + 白话解
- 反幻觉：所有古籍引用走 `classics/` 真本检索（穷通宝鉴/子平真诠/滴天髓/三命通会/渊海子平/周易）

### Plan 6 — Conversation Layer (2026-04-18)

对话历史现已由服务端持久化（之前为 localStorage）。升级后旧浏览器中的本地
对话会自动忽略——重新开一段即可。命盘和大运/流年缓存不受影响。

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
# 小米 MiMo（2026-04 从 OpenRouter 迁移）
MIMO_API_KEY=...                           # https://platform.xiaomimimo.com
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
LLM_MODEL=mimo-v2-pro                     # 主模型
LLM_FAST_MODEL=mimo-v2-flash              # 快模型（router/liunian）
LLM_FALLBACK_MODEL=mimo-v2-flash          # 失败兜底
PORT=3101
```
<!-- 旧 OpenRouter 配置：OPENROUTER_API_KEY / OPENROUTER_PROVIDERS / OPENROUTER_ALLOW_FALLBACKS。回滚时恢复 git history 中的 server/llm.js 和 .env。 -->

## 文档

- [`SKILL.md`](SKILL.md) — 命理方法论
- [`classical-references.md`](classical-references.md) — 古籍检索路径表
- [`server/README.md`](server/README.md) — API 端点
- [`docs/`](docs/) — 历史设计与决策记录
