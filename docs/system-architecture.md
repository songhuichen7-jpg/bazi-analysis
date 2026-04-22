# 系统架构文档

> 版本：Plan 7.x 完整体（2026-04-22）
> 本文反映当前主线代码，目标是新加入的人能在 30 分钟内理解整个系统。
> 旧版本（描述 Node.js MVP）见 git history。

---

## 1. 项目定位

一款面向个人用户的八字分析 Web App：

- **输入**：出生年月日时 + 出生地 + 性别
- **输出**：结构化命盘（四柱、十神力量、三法用神、行运评分、大运/流年 transmutation）+ 流式文字解读 + 基于命盘的多轮对话 + 梅花易数起卦
- **风格**：古籍有据、口吻克制；命理引擎给 LLM 注入结构化信号 + 古籍出处，LLM 做 ZPZQ-style 二阶推理

不在当前范围：移动端适配、AI 画像生成、付费体系。

---

## 2. 仓库结构

```
bazi-analysis/
├── frontend/                # React 19 + Vite 8
│   ├── src/
│   │   ├── components/      # FormScreen / Shell / Chart / Chat / ...
│   │   ├── store/           # Zustand store
│   │   └── lib/             # api / persistence / formatting
│   └── tests/               # 51 tests (node:test)
├── server/                  # FastAPI + SQLAlchemy 2.0
│   ├── app/
│   │   ├── api/             # 路由（auth / charts / conversations / chat / gua）
│   │   ├── core/            # config / db / auth / quotas
│   │   ├── llm/             # MIMO client + streaming
│   │   ├── models/          # SQLAlchemy models (User / Chart / Conversation / Message / QuotaUsage)
│   │   ├── prompts/         # context / expert / router / loader / gua
│   │   ├── retrieval/       # 古籍检索 (loader + service)
│   │   ├── schemas/         # Pydantic schemas
│   │   └── services/        # auth / chart / conversation / gua_cast / sms_service
│   └── tests/               # 439 tests
├── paipan/                  # 排盘 + 命理分析引擎（纯 Python）
│   ├── paipan/
│   │   ├── compute.py       # 主入口
│   │   ├── ganzhi.py        # 干支基础表
│   │   ├── cang_gan.py      # 地支藏干
│   │   ├── shi_shen.py      # 十神
│   │   ├── li_liang.py      # 力量评分 + dayStrength 5-bin (Plan 7.6)
│   │   ├── ge_ju.py         # 格局识别
│   │   ├── he_ke.py         # 干支合冲三合三会
│   │   ├── analyzer.py      # 命局分析合成器
│   │   ├── yongshen.py      # 用神 engine (Plan 7.3 三法 + 7.5a 静态 transmutation)
│   │   ├── yongshen_data.py # 120 TIAOHOU + ~30 GEJU_RULES + 5 FUYI_CASES
│   │   ├── xingyun.py       # 行运 engine (Plan 7.4 评分 + 7.5b 动态 transmutation + 7.7 cross)
│   │   ├── xingyun_data.py  # GAN_HE / ZHI_LIUHE / weights / thresholds
│   │   ├── mechanism_tags.py # mechanism 词汇表 (Plan 7.5a.1)
│   │   ├── dayun.py         # 大运 + 流年起运
│   │   ├── china_dst.py     # 中国历史夏令时
│   │   └── ...
│   ├── scripts/
│   │   └── sample_day_strength.py  # Plan 7.6 sampling pre-task
│   └── tests/               # 632 tests
├── classics/                # 古籍真本 (穷通宝鉴/子平真诠/滴天髓/三命通会/渊海子平/周易)
├── shards/                  # 主题 prompt 片段 (10 个)
├── docs/
│   ├── superpowers/         # spec / plan / 实施过程 (Plan 6 → 7.7)
│   ├── release-notes/       # 各 Plan 发布说明
│   ├── skills/              # 命理方法论 (SKILL.md / conversation-guide.md / classical-references.md / advanced-techniques.md / synthesizer-bug-prevention.md) — runtime 加载 + LLM 引用
│   ├── bazi-analysis/       # 早期 anthropic-skill packaging 历史 import (含独立 SKILL.md / classics 索引)
│   ├── system-architecture.md   # 本文
│   └── paipan-port-inventory.md # JS→Python port 清单
├── archive/                 # 历史 JS 实现 (paipan-engine / server-mvp)，Python 代码 reference 作为 source-of-truth
└── pyproject.toml           # workspace 根 (uv)
```

`paipan/`、`server/`、`frontend/` 是相对独立的 sub-projects；通过 `pyproject.toml` workspace 关联。Python 部分用 `uv` 管理。

---

## 3. 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 前端 | React 19 + Vite 8 | 无路由库，screen 字段切屏；Zustand 5 管状态 |
| 后端 | FastAPI + SQLAlchemy 2.0 (async) + asyncpg | Python 3.12, uvicorn `:3101` |
| DB | PostgreSQL | 服务端持久化（Plan 6 取代 localStorage） |
| 认证 | 手机号 + SMS 验证码 | DEV mode 在 UI surface code |
| LLM | MIMO API（OpenAI 协议兼容） | `mimo-v2-pro` 主 + `mimo-v2-flash` 快/回退 |
| 流式 | SSE (`text/event-stream`) | 自定义事件: `delta` / `done` / `error` / `model` / `intent` / `retrieval` / `gua` / `redirect` |
| 命理引擎 | 纯 Python | 完整 Plan 7.x 系列：用神三法 + 行运 5-bin + transmutation 双层 |
| 起卦 | 梅花易数·时间起卦 | 基于 lunar-python |
| 测试 | pytest (paipan + server) + node:test (frontend) | 632 + 439 + 51 = 1122 全绿 |

---

## 4. 前端架构

### 4.1 屏幕流

```
LandingScreen ─登录入口─▶  AuthScreen  ──短信验证码──▶
FormScreen    ──填出生信息──▶  POST /api/charts/paipan  ──▶  Shell
                                                          │
                                                          ├── 左栏: 命盘视图 / 行运视图
                                                          └── 右栏: Chat + 多对话 switcher
```

由 Zustand 的 `screen` 字段控制（`landing` / `auth` / `input` / `loading` / `shell`）；无 React Router。

### 4.2 关键 component（`frontend/src/components/`）

| 组件 | 职责 |
|---|---|
| `LandingScreen` | 首页（介绍 + 登录入口） |
| `AuthScreen` | 手机号 + 短信验证码登录 |
| `FormScreen` | 出生信息表单 |
| `Shell` | 主布局：左右双栏 + resize handle + 视图切换 |
| `Chart` | 四柱命盘主图 |
| `Force` | 十神力量条 |
| `Sections` | 七板块解读 |
| `VerdictsPanel` | 总论面板（单段流式） |
| `Dayun` / `DayunStepBody` / `LiunianBody` | 大运 / 流年展开 |
| `Chat` | 主对话区（含 chips / CTA / 卦象卡 / 错误气泡） |
| `ConversationSwitcher` | 当前命盘下的多对话下拉 |
| `Gua` / `GuaCard` | 卦象起卦与展示 |
| `UserMenu` | 左上角用户头像 + 登出 |

### 4.3 状态 (`store/useAppStore.js`)

```js
// 命盘+对话来自服务端，本地缓存以加速切换
charts: [{ id, label, paipan, dayun, conversations: [...], ... }, ...]
currentChartId
currentConversationId
user: { phone, ... } | null
screen: 'landing'|'auth'|'input'|'loading'|'shell'
```

Plan 6 之后：所有 conversation/messages 服务端持久化，前端只缓存 hot 数据。切命盘/对话调 API 拉新数据，不依赖 localStorage。

---

## 5. 后端架构

### 5.1 路由表（FastAPI）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/health` | 探活（含 LLM 配置状态） |
| POST | `/api/auth/sms-send` | 发送短信验证码 |
| POST | `/api/auth/sms-verify` | 验证码登录/注册 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/cities` | 城市列表 |
| POST | `/api/charts/paipan` | 排盘+持久化 |
| GET | `/api/charts/{id}` | 拉命盘详情 |
| GET | `/api/charts` | 用户命盘列表 |
| DELETE | `/api/charts/{id}` | 删命盘 |
| POST | `/api/charts/{id}/sections` (SSE) | 七板块流式解读 |
| POST | `/api/charts/{id}/verdicts` (SSE) | 总论流式 |
| POST | `/api/charts/{id}/dayun-step` (SSE) | 单大运展开 |
| POST | `/api/charts/{id}/liunian` (SSE) | 单流年展开 |
| POST | `/api/charts/{id}/chips` | 建议问题 |
| GET | `/api/charts/{id}/conversations` | 对话列表 |
| POST | `/api/charts/{id}/conversations` | 新建对话 |
| PATCH | `/api/conversations/{id}` | 重命名 |
| DELETE | `/api/conversations/{id}` | 删除 |
| GET | `/api/conversations/{id}/messages` | 拉消息 |
| POST | `/api/conversations/{id}/chat` (SSE) | 主对话 |
| POST | `/api/charts/{id}/gua` (SSE) | 起卦 + 解卦 |
| GET | `/api/quota` | 当日 quota 用量 |

所有 LLM 路由走 SSE。

### 5.2 LLM 客户端 (`server/app/llm/`)

MIMO API 走 OpenAI 兼容协议。同样是分层策略：
- 重型任务 (sections / verdicts / dayun-step / liunian / chat) → `chat_stream_with_fallback` (pro 优先, 首 delta 超时切 flash)
- 轻型任务 (chips / 意图分类) → 直接 `FAST_MODEL`
- SSE 事件 `model` 告诉前端实际模型，**不渲染给用户**

### 5.3 提示词 (`server/app/prompts/`)

| 模块 | 用途 |
|---|---|
| `loader.py` | runtime 加载 docs/skills/SKILL.md + docs/skills/conversation-guide.md + shards/*.md |
| `context.py` | `compact_chart_context(paipan)` — 把命盘压缩成 LLM 紧凑上下文（含 Plan 7.3 用神块 + Plan 7.4 行运块 + Plan 7.5a/7.5b transmutation 段） |
| `expert.py` | 主对话 + 各 section 解读 prompt 构造 |
| `router.py` | 意图分类（chat / divination / meta / smalltalk） |
| `anchor.py` | 古籍锚点构造 |
| `gua.py` | 卦象解卦 prompt |

`compact_chart_context` 是**Plan 7.x 的核心成果**——LLM 每次都看到结构化用神 + 评分 + transmutation + 古籍出处，不再依赖通用命理知识 hedge。

### 5.4 古籍检索 (`server/app/retrieval/`)

- `loader.py` — 加载 `classics/` 真本，per-source helper
- `service.py` — `retrieve_for_chart(chart, intent)` 按意图选片段，返回锚点引用
- 失败不阻塞主流：best-effort

---

## 6. 命理引擎 (`paipan/`) — Plan 7.x 完整体

这是 Plan 7.3-7.7 的工作面，从 4 行启发式跃升为完整子系统。

### 6.1 排盘层（Plan 7.0 之前已存在）

```
compute() ──▶  {sizhu, rizhu, shishen, cangGan, naYin, dayun, lunar, ...}
```

- `compute.py` — 入口
- `china_dst.py` + `cities.py` — 真太阳时 + 经度校正
- `ganzhi.py` — TIAN_GAN / DI_ZHI / GAN_WUXING / ZHI_WUXING / WUXING_SHENG / WUXING_KE
- `cang_gan.py` — 地支藏干 + 本气获取
- `dayun.py` — 大运 8 条 + 每条 10 流年（基于 lunar-python `getYun`）

### 6.2 分析层（Plan 7.1 + 7.2 完成）

```
compute() ──▶  analyzer.analyze() ──▶  {force, geJu, ganHe, zhiRelations, notes}
```

- `li_liang.py` — 十神力量评分；输出 `same_ratio` (Plan 7.6 5-bin: 极弱/身弱/中和/身强/极强)
- `ge_ju.py` — 格局识别（四仲/四孟/四库 + 建禄月劫别名 normalize）
- `he_ke.py` — 干合 + 六合 + 六冲 + 三合 + 三会 + 半合
- `analyzer.py` — 合成器，最后调用 yongshen + xingyun 引擎

### 6.3 用神 engine (Plan 7.3 + 7.5a 静态 transmutation)

```
build_yongshen(rizhu_gan, month_zhi, force, geju, gan_he, day_strength, mingju_zhis)
  ──▶ {primary, primaryReason, candidates, warnings, transmuted?}
```

**三法合成**:
- `tiaohou_yongshen()` ← 120 TIAOHOU 表（10 日干 × 12 月）from 穷通宝鉴
- `geju_yongshen()` ← ~30 GEJU_RULES from 子平真诠（含 _GEJU_ALIASES 把 建禄/月刃 normalize）
- `fuyi_yongshen()` ← 5 FUYI_CASES from 滴天髓（5 dayStrength 分支，Plan 7.6 后 极弱/极强 激活）
- `compose_yongshen()` ← voting rule（调候 == 格局 → 共指; 调候 != 格局 → 调候为主+warning; 仅格局/扶抑 → 单法; 三法皆空 → 中和）

**静态 transmutation (Plan 7.5a)**:
- `_detect_transmutation()` ← 命局自带 三合/三会 + 月令参与 → 月令性质质变
- `_compute_virtual_geju_name()` ← 五行+日主+main支阴阳 → 10 个虚拟格局名之一
- 输出附加在 `yongshenDetail.transmuted` 字段

### 6.4 行运 engine (Plan 7.4 + 7.5b 动态 transmutation + 7.7 cross interaction)

```
build_xingyun(dayun, yongshen_detail, mingju_gans, mingju_zhis, current_year, chart_context?)
  ──▶ {dayun: [...8...], liunian: {idx: [...10...]}, currentDayunIndex, yongshenSnapshot}
```

**评分核心 (Plan 7.4)**:
- `score_yun()` ← 大运/流年 ganzhi vs 命局用神 → 5-bin label (大喜/喜/平/忌/大忌) + score + note + mechanisms
- `_score_gan_to_yongshen()` + `_score_zhi_to_yongshen()` ← 干 + 支 effect (基础 ±2 + 合化/六合 modifier ±1)
- 多元素用神 weighted average (Plan 7.6)：YONGSHEN_WEIGHTS = [0.5, 0.3, 0.2]

**Cross interaction (Plan 7.7)**:
- 流年评分时 `extended_gans = mingju_gans + [大运干]` → 流年-大运 cross 合化 modifier auto-fire

**动态 transmutation (Plan 7.5b)**:
- `_detect_xingyun_transmutation()` ← 大运/流年带支 + 命局支 + 月令 凑成完整三合/三会 → 月令变
- 大运层 dedup against 命局-only baseline；流年层 dedup against 大运 transmuted
- 输出附加在 `xingyun.dayun[i].transmuted` 和 `xingyun.liunian[k][j].transmuted`

### 6.5 数据契约

`compute()` 返回的 dict shape (相关 Plan 7.x 字段)：

```python
{
    "sizhu": {"year": "癸酉", "month": "己未", ...},
    "rizhu": "丁",
    "dayun": {"list": [...]},
    "yongshen": "甲木",                  # str (chartUi.js compat, Plan 7.3)
    "yongshenDetail": {                  # dict (Plan 7.3 三法 + 7.5a 静态)
        "primary": "甲木",
        "primaryReason": "以调候为主",
        "candidates": [...3 法...],
        "warnings": [...],
        "transmuted": {                  # optional (Plan 7.5a 触发)
            "trigger": {"type": "sanHe", "wuxing": "木", ...},
            "from": "正官格", "to": "偏印格",
            "candidate": {...}, "warning": ...,
        },
    },
    "xingyun": {                          # Plan 7.4 + 7.5b + 7.7
        "dayun": [{
            "index": 1, "ganzhi": "戊午",
            "label": "平", "score": -1, "note": "...", "mechanisms": [...],
            "isCurrent": False,
            "transmuted": None | {...},  # Plan 7.5b
        }, ...],
        "liunian": {"1": [{
            "year": 1997, "ganzhi": "丁丑", "age": 5,
            "label": "喜", "score": 2, "note": "...", "mechanisms": [...],
            "transmuted": None | {...},  # Plan 7.5b
        }, ...]},
        "currentDayunIndex": 4,
        "yongshenSnapshot": "甲木",
    },
}
```

---

## 7. 关键设计决定

### 7.1 多命盘 + 每命盘多对话 + 服务端持久化

- 命盘 / 对话 / 消息全在服务端 PostgreSQL（Plan 6 之后）
- 前端只缓存 hot 数据，切换命盘/对话调 API 拉
- Quota 系统按用户限流（chat_message / section_regen / verdicts_regen / sms_send）

### 7.2 引擎分层 + LLM 二阶推理

引擎做的事：
- 给 LLM 注入**结构化信号**（5-bin label / mechanism tags / 古籍出处）
- 不做最终判断（"这十年好不好" / "用神能不能化得成"）— 这是 LLM 基于 ZPZQ 风格的二阶推理

引擎不做的事：
- 不做 LLM-style 自由发挥
- 不做古籍以外的"现代命理流派"

### 7.3 Plan 7.3 candidates 长度固定 3

- `yongshenDetail.candidates` 永远 3 条（调候/格局/扶抑），即便某法无结论也产 placeholder
- 前端 / LLM prompt 可以 stable 读 candidates[0]/[1]/[2]
- transmutation 是 optional 附加字段不挤入 candidates

### 7.4 命局用神是 contract anchor

- Plan 7.3 算出的 `yongshenDetail.primary` 是稳定锚点
- Plan 7.4 行运评分 measure against this primary
- Plan 7.5b 动态 transmutation 不重算 primary，只附加 transmuted 字段
- 这种"anchor 不动 + 附加 layer"模式贯穿 Plan 7.x

### 7.5 mechanism tag 词汇表中心化

`mechanism_tags.py` (Plan 7.5a.1) 定义 10 常量 + 4 builder：
- 改 tag 文案只改这一文件
- byte-for-byte 输出稳定（所有 score 测试不破）
- LLM prompt 可以基于 tag 字符串做 grep（虽然现在没用，留 future hook）

### 7.6 Verification-first golden case 选材

Plan 7.5a/7.5b/7.6 的 golden case 都强制 codex 先**实测验证** birth_input 真触发预期事件，再写 assertion。spec 写作时的"应该 work 的 case"经常跟真实 distribution 不符。

### 7.7 验证物料 = 古籍 source 引文 + browser smoke screenshots

每个 Plan 的 release notes 都引 LLM chat 输出 + 截图为证。质量不是 self-claim，是可观测的。

---

## 8. 运行与开发

### 8.1 启动

```bash
# 后端 (FastAPI on :3101)
cd server
cp .env.example .env   # 填入 MIMO_API_KEY + DB_URL
uv run --package server --with 'uvicorn[standard]' python -m uvicorn app.main:app --port 3101 --host 127.0.0.1

# 前端
cd frontend
npm install
npm run dev   # http://localhost:5173, vite proxy /api → :3101
```

健康检查：`curl http://localhost:3101/api/health` 应返回 `{healthy:true, llm:{hasKey:true, model:"mimo-v2-pro"}}`

### 8.2 测试

```bash
uv run --package paipan pytest -n auto -q paipan/tests/    # 632 paipan
uv run --package server pytest -n auto -q server/tests/    # 439 server
cd frontend && node --test tests/*.mjs                      # 51 frontend
```

### 8.3 工程方法学

每个 Plan 走同一流水线（Plan 7.x 系列证明可重复）：
1. Brainstorming skill — scope 决策一次 1 question
2. Spec 文档 → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
3. Writing-plans skill → `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
4. Codex 外部执行 (verification-first for golden cases)
5. Review (sanity math 预测 + byte-perfect 比对)
6. Inline plan 修正 (codex catch 我的 typo 时 commit 单独修)
7. Push to main per task

---

## 9. Plan 7.x 历史里程碑

| Plan | 日期 | 主题 |
|---|---|---|
| 7.3 | 2026-04-20 | 用神 engine v1（三法合成） |
| 7.4 | 2026-04-20 | 行运 engine（5-bin 评分） |
| 7.5a | 2026-04-21 | 静态用神变化（命局合局触发） |
| 7.5a.1 | 2026-04-21 | engine polish quick wins |
| 7.5b | 2026-04-21 | 动态用神变化（大运/流年触发） |
| 7.5c | 2026-04-22 | ch10 ② 透藏 audit (cancelled — no real gap) |
| 7.6 | 2026-04-22 | engine polish deep（5-bin 极弱/极强 + weighted avg + adjacency） |
| 7.7 | 2026-04-22 | 大运/流年 cross interaction |

测试增量：486 → 632 paipan (+146), 426 → 439 server (+13)。

详细见 `docs/release-notes/`。

---

## 10. Pre-Plan-7.x 历史

排盘引擎和后端最初是 Node.js MVP（`archive/paipan-engine/` 和 `archive/server-mvp/`），Plan 7.1 开始 port 到 Python 并扩展。Python 引擎模块的 docstring 都标注 "Port of archive/server-mvp/X.js" 作为源 reference。Plan 7.x 之后引擎已远超原 JS 实现的范围（用神 / 行运 / transmutation / cross interaction 都是 Plan 7.x 新加）。

`archive/` 内容**不删**——是 Python port 的 source-of-truth 历史。
