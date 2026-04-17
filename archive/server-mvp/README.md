# bazi-server

本地 HTTP 服务器，把 `paipan-engine` + `ming/analyze` 包成 REST API，
并静态托管 `frontend/dist/`（React + Vite 产物）。

## 开发流程（两个终端）

```bash
# 终端 1：后端 API
npm run dev:back      # http://localhost:3101

# 终端 2：前端 Vite dev server（HMR，/api 代理到 :3101）
npm run dev:front     # http://localhost:5173
```

开发期浏览器开 `http://localhost:5173`。

## 一键跑（生产预览）

```bash
npm run start    # build 前端 + 起后端，单口 http://localhost:3101
```

## 端点

| 方法  | 路径                | 说明                              |
| ---- | ------------------- | --------------------------------- |
| GET  | /                   | 静态托管 frontend/dist             |
| GET  | /api/health         | 健康检查 + LLM 状态                |
| GET  | /api/cities         | 已知城市列表                       |
| POST | /api/paipan         | 排盘 + 分析                        |
| POST | /api/sections       | 5 段初始解读（non-stream）         |
| POST | /api/chat           | 聊天（router→expert SSE）         |
| POST | /api/dayun-step     | 单步大运解读（SSE）                |
| POST | /api/liunian        | 单年流年解读（SSE）                |

### POST /api/paipan

请求体：

```json
{
  "year": 1990, "month": 5, "day": 15,
  "hour": 14, "minute": 30,
  "city": "北京",
  "gender": "female",
  "ziConvention": "early",
  "useTrueSolarTime": true
}
```

- `hour: -1` 表示时辰未知
- `city` 不在列表中时，仍可排盘，但不做真太阳时校正

返回：

```json
{
  "paipan":  { ...引擎原始输出... },
  "analyze": { ...命理分析原始输出... },
  "ui":      { "PAIPAN": {...}, "FORCE": [...], "GUARDS": [...], "DAYUN": [...], "META": {...} }
}
```

`ui` 字段是前端直接可用的形状，`paipan`/`analyze` 是原始数据，后续接 LLM 时会需要。
