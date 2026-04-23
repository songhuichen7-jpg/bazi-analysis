# 分享卡片 MVP 设计文档（Phase 1 — 个人卡片）

> 文档版本：v1.0 | 创建日期：2026-04-24
> 作者：brainstorming session
> 依赖：PM/specs/03_卡片与分享系统.md v4.0、PM/specs/02 / 02a / 02b / 02c、PM/specs/01 用户旅程
> 范围：Phase 1 仅实现个人卡片；合盘卡片（Phase 2）另出 spec
> 目标：3 周 MVP，验证分享传播 K 因子

---

## 一、背景与动机

PM 文件夹已有完整 v4.0 规格（03_卡片与分享系统.md），20 型人格系统（02）、格局标签（02a v2.0）、传播名（02b v1.0-final）、200 组子标签矩阵（02c v6.2）都已审核定稿。但所有内容还是 markdown 散文格式，未提取成机器可读 JSON；前端和后端也都未实现任何卡片相关组件或端点。

本文档的目标：将 PM v4.0 个人卡片部分落地为可运行的 MVP。**合盘（Phase 2）因依赖 04b v1.0 初稿定稿，暂缓**。

### 已锁定的六项决策（brainstorming 产出）

| # | 决策 | 选择 |
|---|------|------|
| Q1 | MVP 范围 | **先个人卡片（2-3 周），验证 K 因子后再做合盘** |
| Q2 | 匿名 vs 登录 | **完全匿名**；登录仅用于深度报告/对话/保存历史 |
| Q3 | JSON 数据提取 | **Claude 提取，用户审核**；提取后 commit 到 `server/app/data/cards/` |
| Q4 | 排盘算法位置 | **后端**；新端点 `POST /api/card`，前端只渲染 |
| Q5 | 时辰缺失处理 | **时辰选填**，支持精确时刻或 6 档时段；不填走三柱算法，不在卡片上标注 |
| Q6 | 插画 | **MVP 并行生成 20 张 AI 插画**；延期时用 emoji 占位上线 |

### 默认决策（可后期调整）

| 项 | 默认值 | 说明 |
|---|---|---|
| 力量"中和" | 归**绽放** | 中和偏阳；若后续用户反馈不准可调 |
| 子标签顺序 | 固化 **[性格, 关系命势, 事业命势]** | 支持卡片三列固定类目视觉 |
| 分享链接行为 | **不展示原命盘**，仅作引流钩子 | 隐私 + 防尴尬 + 符合 03 spec 双方主动输入 |

---

## 二、架构概览

裂变入口（匿名，公开）与现有产品（登录，深度）分两条路径，彼此隔离。

```
┌──── 裂变层（新增） ──────────────┐     ┌── 现有产品（不动） ──┐
│                                 │     │                      │
│   /          ← 匿名落地页         │     │   /app   (AuthScreen) │
│     ↓ 填生日+（可选）时辰         │     │   /chart              │
│   /card/<slug>  ← 卡片结果页      │     │   /chat               │
│     ↓                           │     │                      │
│   [保存] [分享] [邀请合盘(灰)]   │     │                      │
│     ↓                           │     │                      │
│   CTA:「注册解锁深度报告」 ──────→│ / 注册 → 带 type_id 跳 /app    │
└─────────────────────────────────┘     └──────────────────────┘

后端：
POST /api/card （公开，无 auth）       ┌ 现有 /api/charts, /api/chat... ┐
  → paipan.compute()                    │ 完全不动                        │
  → services/card/ 映射 + 查 JSON       └────────────────────────────────┘
  → return card JSON

数据：
server/app/data/cards/
  types.json, formations.json, subtags.json,
  state_thresholds.json, card_version.json, illustrations/
```

**三条关键边界**

1. **`/` 路由替换**：当前 `App.jsx` 直接是 AuthScreen，改成根路径 = 匿名卡片落地页；现有产品挪到 `/app/*`
2. **`/api/card` 不走 auth**：新端点，纯函数式，同输入同输出，可 CDN 缓存
3. **数据层独立**：`server/app/data/cards/` 和现有 `server/app/data/`、`shards/`、`classics/` 平级但独立——卡片 JSON 是产品文案资产，不混在典籍/RAG 数据里

---

## 三、数据模型（JSON Schema）

所有数据文件放 `server/app/data/cards/`。命名和 key 用英文 + snake_case，中文只在 value 里。

### `types.json` — 20 型基础信息

```json
{
  "01": {
    "id": "01",
    "day_stem": "甲",
    "state": "绽放",
    "cosmic_name": "春笋",
    "base_name": "参天木命",
    "one_liner": "越压越往上长",
    "personality_tag": "参天型",
    "theme_color": "#2D6A4F",
    "illustration": "01-chunsun.png"
  },
  "02": {
    "id": "02",
    "day_stem": "甲",
    "state": "蓄力",
    "cosmic_name": "橡子",
    "...": "..."
  }
}
```

- key = 两位编号 `"01"` - `"20"`（分享链接 `?type=04` 直接用）
- `(day_stem, state)` 是唯一索引，但编号才是对外标识

### `formations.json` — 10 十神后缀 + 20 金句

```json
{
  "食神": {
    "name": "食神",
    "suffix": "天生享乐家",
    "golden_lines": {
      "绽放": "我不卷，但我什么都不缺",
      "蓄力": "慢慢来，快乐不赶时间"
    }
  },
  "伤官": { "...": "..." }
}
```

- key 是中文十神名（对齐 `paipan/ge_ju.py` 返回值）
- 金句按 state 分两条

### `subtags.json` — 200 组子标签矩阵

```json
{
  "春笋": {
    "食神": ["冲上去再说", "人缘自己来", "会吃会玩也会赚"],
    "伤官": ["嘴比长得快", "桃花体质", "才华能变现"]
  },
  "萨摩耶": { "...": "..." }
}
```

- 嵌套：`传播名 → 十神 → [性格, 关系, 事业]`
- 必须满足：20 传播名 × 10 十神 = 200 组，每组 3 条；提取后跑校验脚本

### `state_thresholds.json` — 5 档同类比 → 绽放/蓄力

```json
{
  "thresholds": {
    "strong_upper": 0.76,
    "strong_lower": 0.55,
    "neutral_lower": 0.35,
    "weak_lower": 0.12
  },
  "mapping": {
    "极强": "绽放",
    "身强": "绽放",
    "中和": "绽放",
    "身弱": "蓄力",
    "极弱": "蓄力"
  },
  "borderline_band": 0.05
}
```

- 把现有 `li_liang.py` 的 5 档分类塌缩成二值
- borderline：评分落在 strong_lower ± 0.05 带内时标记，MVP 不展示，留给 Phase 2 "补时辰解锁精准版"钩子

### `card_version.json` — 版本号

```json
{ "version": "v4.0-2026-04", "last_updated": "2026-04-24" }
```

用于文案迭代时做缓存失效。

### 数据完整性校验

提取后必须通过以下校验：

- `types.json` 恰好 20 条，id 从 "01" 到 "20"，每条 day_stem × state 组合唯一
- `formations.json` 恰好 10 条十神，每条两条金句（绽放/蓄力）
- `subtags.json` 20 传播名 × 10 十神 = 200 组，每组 3 条非空字符串
- 传播名集合与 `types.json` 的 cosmic_name 集合完全一致

---

## 四、后端设计

### 目录结构（新增）

```
server/app/
├── api/
│   └── card.py             ← 新增：public 端点
├── services/
│   └── card/               ← 新增：卡片业务逻辑
│       ├── __init__.py
│       ├── mapping.py      ← 20 型映射 + 十神查 formations
│       ├── loader.py       ← 启动加载并缓存 4 份 JSON
│       └── payload.py      ← 组装 card payload
├── schemas/
│   └── card.py             ← Pydantic: CardRequest / CardResponse
└── data/
    └── cards/
        ├── types.json
        ├── formations.json
        ├── subtags.json
        ├── state_thresholds.json
        ├── card_version.json
        └── illustrations/  ← 静态资源（后期补齐）
```

### API 端点

**POST /api/card** — 生成卡片

```jsonc
// Request
{
  "birth": {
    "year": 1998,
    "month": 7,
    "day": 15,
    "hour": 14,        // 可选，-1 = 不知道
    "minute": 0,       // 可选
    "city": "北京"     // 可选，影响真太阳时
  },
  "nickname": "小满"   // 可选，最多 10 字
}

// Response 200
{
  "type_id": "01",
  "cosmic_name": "春笋",
  "base_name": "参天木命",
  "state": "绽放",
  "state_icon": "⚡",
  "day_stem": "甲",
  "one_liner": "越压越往上长",
  "ge_ju": "食神",
  "suffix": "天生享乐家",
  "subtags": ["冲上去再说", "人缘自己来", "会吃会玩也会赚"],
  "golden_line": "我不卷，但我什么都不缺",
  "theme_color": "#2D6A4F",
  "illustration_url": "/static/cards/illustrations/01-chunsun.png",
  "precision": "4-pillar",    // 或 "3-pillar"
  "borderline": false,
  "share_slug": "c_a9f3b2k1",
  "nickname": "小满",
  "version": "v4.0-2026-04"
}

// Response 400
{ "error": "invalid_birth_date", "detail": "year must be 1900-2100" }
```

**GET /api/card/:slug** — 分享链接打开时查快照

返回：发起分享者的 `cosmic_name` + `suffix` + `illustration_url`（**不返回完整命盘**）——仅用于生成「这是 @小满 的卡」预览，主 CTA 仍是引导访问者自己填生日。

**POST /api/track** — 匿名埋点（详见 §六）

**GET /api/wx/jsapi-ticket** — 签发微信 JS-SDK 签名

**GET /api/admin/metrics** — 只读指标查询（简单 admin token 保护）

### 计算管道

```python
def build_card(birth: BirthInput, nickname: str | None) -> CardPayload:
    # 1. 排盘（复用 paipan/）
    paipan_result = paipan.compute(birth, use_true_solar_time=True)

    # 2. 提取关键字段
    day_stem = paipan_result.ri_zhu_gan
    force_result = li_liang.analyze_force(paipan_result.bazi_dict())
    #   ↑ 整合细节：从 analyze_force 返回值中提取"同类比"（same_ratio），
    #     调用 _classify_day_strength 拿到 5 档分类
    ge_ju_result = ge_ju.identify_ge_ju(paipan_result)

    # 3. 5 档 → 绽放/蓄力（含 borderline 检测）
    state, borderline = classify_state(force_result, THRESHOLDS)

    # 4. 查 20 型编号
    type_id = lookup_type(day_stem, state)   # types.json
    type_info = TYPES[type_id]

    # 5. 查十神后缀 + 金句
    formation = FORMATIONS[ge_ju_result.shi_shen]
    suffix = formation["suffix"]
    golden_line = formation["golden_lines"][state]

    # 6. 查子标签
    subtags = SUBTAGS[type_info["cosmic_name"]][ge_ju_result.shi_shen]

    # 7. 组装 + 签发 slug
    return CardPayload(
        type_id=type_id,
        cosmic_name=type_info["cosmic_name"],
        state=state,
        state_icon="⚡" if state == "绽放" else "🔋",
        suffix=suffix,
        golden_line=golden_line,
        subtags=subtags,
        precision="4-pillar" if birth.hour >= 0 else "3-pillar",
        borderline=borderline,
        share_slug=generate_slug(birth, nickname),
        version=VERSION,
    )
```

### `share_slug` 快照

- 10 位随机字符 `c_xxxxxxxxxx`
- 落到新表 `card_shares`：

```sql
CREATE TABLE card_shares (
  slug         VARCHAR(12) PRIMARY KEY,
  birth_hash   VARCHAR(64) NOT NULL,  -- SHA256(birth_fields)
  type_id      VARCHAR(2) NOT NULL,
  cosmic_name  VARCHAR(20) NOT NULL,
  suffix       VARCHAR(30) NOT NULL,
  nickname     VARCHAR(10),
  user_id      BIGINT NULL,            -- 如果请求带 token
  created_at   TIMESTAMPTZ NOT NULL,
  share_count  INT NOT NULL DEFAULT 0  -- 被打开多少次
);
CREATE INDEX idx_card_shares_birth_hash ON card_shares(birth_hash);
```

- **不存生日明文**，只存哈希 + 已计算出的类型信息（便于 GET /api/card/:slug 快速返回预览）
- 同一 birth_hash 已有 slug 的情况下，复用或新发（MVP 方案：每次新发，便于追踪）

### 幂等 + 缓存

- 同一 birth → 同一 card payload 主体（slug/nickname 除外）
- 响应头 `Cache-Control: public, max-age=3600`
- 未来可加 Redis 缓存 `birth_hash → payload`

### 输入校验（Pydantic）

- year ∈ [1900, 2100]
- month ∈ [1, 12]，day 按月份合法
- hour ∈ {-1, 0..23}（-1 = 不知道）
- minute ∈ [0, 59]
- nickname 最多 10 字，做 XSS 清洗（剥离 HTML 标签，保留纯文本）

### 不依赖 auth

- 整个端点不看 token
- 可选：如果请求带合法 token，把 `user_id` 关联到 `card_shares` 行（用于日后"我的命盘"，MVP 不展示）

### 排盘引擎复用

现有 `paipan/` 模块**不改动**。`services/card/mapping.py` 只做薄映射层：

```python
# li_liang 5 档 → 绽放/蓄力
# 注：ratio 来自 analyze_force 返回的"同类比"字段；实施时从返回 dict 中取具体 key
def classify_state(force_result: dict, thresholds: dict) -> tuple[str, bool]:
    ratio = extract_same_ratio(force_result)      # 具体字段在 Phase 1 Day 3-4 落地时确认
    category = _classify_day_strength(ratio)      # 复用 li_liang._classify_day_strength
    state = thresholds["mapping"][category]
    borderline = abs(ratio - thresholds["thresholds"]["strong_lower"]) < thresholds["borderline_band"]
    return state, borderline

# 日主 × state → 20 型编号
def lookup_type(day_stem: str, state: str) -> str:
    for type_id, info in TYPES.items():
        if info["day_stem"] == day_stem and info["state"] == state:
            return type_id
    raise ValueError(f"no type for {day_stem} × {state}")
```

---

## 五、前端设计

### 路由（引入 react-router-dom）

```
/                      ← LandingScreen（匿名落地页）
/card/:slug            ← CardScreen（卡片结果页）
/pair/:invite          ← 预留给 Phase 2 合盘
/app/*                 ← 现有登录产品（AuthScreen + Shell 不动）
```

`/app/*` 下保留现有所有行为，代码零改动。

### 新增组件 `frontend/src/components/card/`

```
components/card/
├── LandingScreen.jsx       ← /  匿名落地页
├── BirthForm.jsx           ← 生日 + 时辰可选表单
├── TimeSegmentPicker.jsx   ← 时段 6 档
├── CardScreen.jsx          ← /card/:slug  结果页
├── Card.jsx                ← 卡片本体（html2canvas 目标节点）
├── CardActions.jsx         ← [保存][分享][邀请合盘] 按钮
├── CardSkeleton.jsx        ← 骨架屏
└── UpgradeCTA.jsx          ← 「注册解锁深度报告」底部模块
```

### 时段 6 档（无精确时辰时用）

中心 hour 刻意避开十二时辰边界（每时辰 2 小时，子时横跨 23-01），确保映射值落在某个时辰中段：

| 时段 | 时间范围 | 映射到 hour | 落入时辰 |
|------|----------|-------------|----------|
| 凌晨 | 00:00 - 04:59 | 02:00 | 丑时 (01-03) |
| 早上 | 05:00 - 08:59 | 06:00 | 卯时 (05-07) |
| 上午 | 09:00 - 12:59 | 10:00 | 巳时 (09-11) |
| 下午 | 13:00 - 16:59 | 14:00 | 未时 (13-15) |
| 傍晚 | 17:00 - 20:59 | 18:00 | 酉时 (17-19) |
| 深夜 | 21:00 - 23:59 | 22:00 | 亥时 (21-23) |

用户选时段 → 前端映射到具体 hour → 传给后端按 4 柱算。
用户不选任何时辰 → 传 hour=-1 → 后端按 3 柱算。

### 页面流

```
落地页 /
┌─────────────────────────────┐
│  查八字 · 3 秒看你的人格图鉴    │
│                             │
│  年: [1998]  月: [07]  日: [15] │
│  ▸ + 出生时间（可选，更准）      │
│     ○ 精确时间 14:00           │
│     ● 选时段：下午              │
│  昵称（可选）: [小满]           │
│                             │
│         [查看我的类型]          │
└─────────────────────────────┘
         ↓ POST /api/card
         ↓ 1-2s（骨架屏）
         ↓ 拿到 payload + slug
         ↓ navigate(`/card/${slug}`)

结果页 /card/c_a9f3b2k1
┌─────────────────────────────┐
│   [Card 组件，按 03 spec 渲染]  │
│   传播名 + 后缀 + 一句话        │
│   + 3 子标签 + 金句           │
├─────────────────────────────┤
│  [💾 保存] [🔗 分享]          │
│  [💞 邀请合盘 (灰化)]          │
├─────────────────────────────┤
│  🔒 你的命盘还有更多未解密...   │
│  4 份深度报告 + AI 命盘对话     │
│         [注册解锁 →]           │  ← 引流 /app
└─────────────────────────────┘
```

### 状态管理

新建 `frontend/src/store/useCardStore.js`（不扩展现有 `useAppStore.js`，避免登录/匿名耦合）：

```js
{
  // 表单状态
  birth: { year, month, day, hour, minute, useTimeSegment, timeSegment },
  nickname: string,

  // 结果状态
  loading: boolean,
  error: string | null,
  card: CardPayload | null,

  // 动作
  submitBirth(): Promise,       // POST /api/card
  loadCard(slug): Promise,      // GET /api/card/:slug
}
```

### `Card.jsx` 组件结构（html2canvas 抓这个）

```jsx
<article
  ref={cardRef}
  className="card"
  data-state={card.state}
  data-type-id={card.type_id}
  style={{'--theme': card.theme_color}}
>
  <header>
    <span className="brand">查八字</span>
    <span className="type-id">{card.type_id} / 20</span>
  </header>

  <figure className="illustration">
    <img src={card.illustration_url} alt={card.cosmic_name} />
  </figure>

  <h1 className="cosmic-name">{card.cosmic_name}</h1>
  <p className="suffix">· {card.suffix} ·</p>
  <p className="one-liner">{card.one_liner}</p>

  <ul className="subtags">
    {card.subtags.map((t, i) => (
      <li key={i} data-category={CATEGORIES[i]}>{t}</li>
    ))}
  </ul>
  {/* CATEGORIES = ["性格", "关系", "事业"] */}

  <blockquote className="golden-line">" {card.golden_line}</blockquote>

  <footer>
    <span>查八字 · chabazi.com</span>
  </footer>
</article>
```

### 样式策略

- CSS variables + `[data-state="绽放|蓄力"]` + `data-type-id` 驱动 20 种主题差异
- 尺寸严格按 03 spec：**3:4 比例**
  - 逻辑尺寸 540×720px
  - html2canvas `scale: 2` → 导出 1080×1440（03 spec 要求的 @2x）
- 字体：标题系统中文圆体（`"PingFang SC", "Hiragino Sans GB", sans-serif`），正文无衬线
- 所有字号 `rem`，根字号固定 16px 保证截图一致

### SSR / OG 预览：不做

当前是 Vite SPA，`/card/:slug` 点进来是空白 HTML → JS 拉数据渲染。微信/小红书爬虫抓 OG meta 时抓不到富预览。**MVP 不做 SSR**——微信分享用 JS-SDK 主动设 share meta（覆盖主要场景），小红书/公众号场景靠用户贴卡片 PNG 图。

### AuthScreen 处理

- 不保留挂在 `/`
- `/` 永远是匿名落地页
- 已有 token 的用户访问 `/` 时，右上角显示「进入产品 →」快捷入口跳 `/app`
- App.jsx 从"判断 auth 渲染"改成"路由驱动"（改动最小）

---

## 六、分享链路 + 埋点

### 三条分享通道

**1) 保存到相册（html2canvas）**

```js
async function saveCardAsImage() {
  const node = document.querySelector('.card');
  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: null,
    logging: false,
  });
  const dataUrl = canvas.toDataURL('image/png');

  if (isMobile()) {
    showLongPressOverlay(dataUrl);  // iOS Safari 不能 programmatic download
  } else {
    triggerDownload(dataUrl, `chabazi-${card.type_id}-${card.cosmic_name}.png`);
  }

  track('card_save', { type_id: card.type_id });
}
```

**2) 微信内分享（JS-SDK）**

```js
wx.ready(() => {
  wx.updateAppMessageShareData({
    title: `我是${card.cosmic_name}·${card.suffix} -- 你是什么？`,
    desc: '查八字人格图鉴，3 秒看到你的类型',
    link: `https://chabazi.com/card/${card.share_slug}?from=share_friend`,
    imgUrl: `${ORIGIN}${card.illustration_url}`,
    success: () => track('card_share', { type_id: card.type_id, channel: 'wx_friend' })
  });

  wx.updateTimelineShareData({
    title: `我是${card.cosmic_name} -- 点开看你是什么`,
    link: `https://chabazi.com/card/${card.share_slug}?from=share_timeline`,
    imgUrl: `${ORIGIN}${card.illustration_url}`,
    success: () => track('card_share', { type_id: card.type_id, channel: 'wx_timeline' })
  });
});
```

**JS-SDK 前置工作（工程）：**
- 后端 `GET /api/wx/jsapi-ticket` 端点，签发 `signature/timestamp/nonceStr/appId`，ticket 缓存 7200s
- 前端 CardScreen mount 时调 wx.config 一次

**公众号备案（非工程，用户侧推进）：**
- 域名 `chabazi.com` 购买 + 备案
- 微信公众号/服务号注册 + 备案（周期 7-15 天）
- JS 接口安全域名配置

**3) 邀请合盘链接**
- 按钮存在但 **Phase 1 灰化**，点击提示「合盘功能即将开放」
- Phase 2 变成 `POST /api/pair/invite`

### 分享链接打开行为

当别人点开 `/card/:slug`：
- **不展示分享者的完整命盘**（只显示 cosmic_name + suffix + 插画）
- 主 CTA「查看我的类型 →」跳回 `/` 让访问者自己填生日
- 符合 03 spec 「双方主动输入」原则 + 保护分享者隐私

### 埋点

**POST /api/track**（匿名 + 登录均可）

```jsonc
{
  "event": "card_view | card_save | card_share | form_start | form_submit | cta_click",
  "properties": {
    "type_id": "04",
    "channel": "wx_friend | wx_timeline | clipboard | ...",
    "from": "direct | share | share_friend | share_timeline",
    "share_slug": "c_a9f3b2k1",
    "anonymous_id": "a_xyz123",   // cookie，7 天有效
    "session_id": "s_...",
    "user_agent": "...",
    "viewport": "375x812"
  }
}
```

**events 表结构：**

```sql
CREATE TABLE events (
  id             BIGSERIAL PRIMARY KEY,
  event          VARCHAR(30) NOT NULL,
  type_id        VARCHAR(2),
  channel        VARCHAR(30),
  from_param     VARCHAR(30),
  share_slug     VARCHAR(12),
  anonymous_id   VARCHAR(40),
  session_id     VARCHAR(40),
  user_id        BIGINT,
  user_agent     TEXT,
  viewport       VARCHAR(20),
  extra          JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_event_created ON events(event, created_at);
CREATE INDEX idx_events_share_slug ON events(share_slug) WHERE share_slug IS NOT NULL;
```

### K 因子测量

```
K = 分享率 × 每次分享点击量 × 点击→填单转化率

分享率     = card_share 事件数 / card_view 事件数
点击量     = 带 from=share_* 的 landing view 数 / card_share 事件数
填单转化率  = form_submit 事件数 / 带 from 的 landing view 事件数
```

**GET /api/admin/metrics?from=...&to=...** 返回上述聚合值（admin token 保护）。

### 防封策略（承接 03 spec §五）

| 风险 | 应对 |
|------|------|
| 诱导分享 | 绝不做"分享后解锁"；UpgradeCTA 引流注册，与分享解耦 |
| JS-SDK 频繁调用 | `wx.config` 仅在 CardScreen mount 调一次；切路由不重复 |
| 域名被封 | 主 `chabazi.com` + 备用 `chabazi.xyz`；自建短链 `go.chabazi.com/<slug>` 301 |
| OG 预览被爬 | 不暴露真实命盘字段到 HTML meta |

---

## 七、时间线

### Phase 1 主线（3 周）

**Week 1 — 数据 + 后端骨架**

| 天 | 任务 |
|---|---|
| Day 1-2 | JSON 提取 + 完整性校验（types, formations, subtags, state_thresholds） |
| Day 3-4 | 后端 `POST /api/card` + services/card/（mapping, loader, payload）+ 单测（8 个典型日主 × 绽/蓄回归用例） |
| Day 5 | Alembic migration：card_shares + events 两张表；`POST /api/track`；`GET /api/card/:slug` |

**Week 2 — 前端主体**

| 天 | 任务 |
|---|---|
| Day 6-7 | 路由重构（App.jsx → react-router）；现有产品挪到 /app/* |
| Day 8-9 | LandingScreen + BirthForm + TimeSegmentPicker |
| Day 10 | CardScreen + Card 组件（emoji 占位插画版） |
| Day 11 | useCardStore + API 对接 + 骨架屏 |

**Week 3 — 分享 + 上线**

| 天 | 任务 |
|---|---|
| Day 12 | html2canvas 导出 + iOS 长按保存浮层 |
| Day 13 | 微信 JS-SDK 集成 + `/api/wx/jsapi-ticket` |
| Day 14 | 埋点铺设 + `/api/admin/metrics` |
| Day 15 | UpgradeCTA + 注册跳转携带 type_id |
| Day 16 | e2e 测试（匿名落地 → 填生日 → 卡片 → 保存/分享全链路） |
| Day 17 | 上线灰度 + 观察埋点 |

### 插画支线（并行，不阻塞主线）

| 阶段 | 内容 |
|------|------|
| Day 1-2 | 定风格锚点（mood board 3-4 版选一） |
| Day 3-5 | Prompt 迭代（以 2 个类型为样本） |
| Day 6-10 | 批量生成 20 张 + 微调 + 风格统一 |
| Day 11-12 | 尺寸适配 + 导出 @2x PNG + 放 illustrations/ |
| Day 13+ | 替换 emoji 占位（纯资源替换，无代码改动） |

**延期预案：主线 Phase 1 上线时若插画未完成，用 emoji 占位；插画就绪后热替换。**

### 非工程并行项（用户侧推进）

| 项目 | 建议启动 | 耗时 | 阻塞？ |
|------|---------|------|--------|
| 域名 `chabazi.com` 购买 + 解析 + HTTPS | Week 1 Day 1 | 1-3 天 | ✅ 阻塞上线 |
| 微信公众号/服务号备案 | Week 1 Day 1 | 7-15 天 | ⚠️ 仅阻塞微信分享功能 |
| 微信 JS 接口安全域名配置 | 备案后 | 5 分钟 | ⚠️ 同上 |
| 插画风格锚点决定 | Week 1 Day 1 | 几小时 | ❌ emoji 可顶替 |

**关键风险**：微信公众号备案周期（7-15 天）可能超出 3 周窗口。若备案未下来，MVP 先按「纯落地页 + 保存到相册」上线，微信分享按钮引导用户手动转发 PNG；备案下来后启用 JS-SDK 热升级。

### Phase 1 out-of-scope（明确不做）

- 合盘功能（Phase 2）
- 深度报告 / AI 对话新内容（现有产品不动）
- 「我的命盘历史」页（Phase 2，需打通匿名 session → 注册用户）
- SSR / OG meta 富预览
- 小程序版本
- 实时看板 UI（MVP 靠 SQL 查）
- 身强弱阈值 A/B 实验（先按 `li_liang.py` 现有值）

### Phase 2 预告（不在本 spec）

- 合盘卡片（依赖 04b v1.0 初稿 → 定稿）
- 匿名 session → 注册用户的 type_id 继承
- 「我的命盘」页
- 付费深度报告
- 运营看板 UI

---

## 八、验收清单

Phase 1 上线前逐项确认：

### 数据层
- [ ] `types.json` 20 条全，id "01"-"20"
- [ ] `formations.json` 10 十神，每条含绽放/蓄力两条金句
- [ ] `subtags.json` 200 组 × 3 标签，无空值
- [ ] `state_thresholds.json` 5 档映射齐全
- [ ] 4 份 JSON 通过完整性校验脚本

### 后端
- [ ] `POST /api/card` 接受合法输入并返回完整 payload
- [ ] 输入校验：非法日期、非法 hour 都返回 400
- [ ] 5 档同类比 → 绽放/蓄力映射正确（8 个回归用例通过）
- [ ] 日主 × state → type_id 查表正确
- [ ] 十神 → suffix + golden_line 查表正确
- [ ] 子标签 3 条顺序与 CATEGORIES 对齐
- [ ] `GET /api/card/:slug` 返回预览（不含完整命盘）
- [ ] `POST /api/track` 写入 events 表
- [ ] `GET /api/wx/jsapi-ticket` 签名正确
- [ ] 端点响应时间 p95 < 500ms
- [ ] 不带 auth token 访问 `/api/card` 通过；带合法 token 时关联 user_id

### 前端
- [ ] `/` 匿名落地页显示，无 AuthScreen
- [ ] 年月日必填，时辰可选（精确或时段两种输入）
- [ ] `/card/:slug` 卡片页渲染，样式对齐 03 spec 3:4 比例
- [ ] `/app/*` 现有产品完全不变
- [ ] 保存到相册：桌面自动下载 + iOS 长按保存浮层
- [ ] 微信分享：JS-SDK 配置的 share meta 正确（在微信环境内）
- [ ] 「邀请合盘」按钮灰化
- [ ] 「注册解锁深度报告」跳 `/app` 并携带 type_id
- [ ] html2canvas 导出 1080×1440 @2x PNG
- [ ] e2e 全链路测试通过

### 内容质量（承接 03 spec §七质检清单）
- [ ] 3 秒可读
- [ ] 截图可分享（不需额外解释）
- [ ] 底部有品牌名 + 网址
- [ ] 无裸命理术语（"参天木·绽放型"等不出现在卡片正面）
- [ ] 无负面内容
- [ ] 字数合规（标签 ≤5 字，一句话 ≤20 字，金句 ≤60 字）
- [ ] 视觉在手机屏不糊不挤

### 埋点
- [ ] card_view, card_save, card_share, form_start, form_submit, cta_click 全部上报
- [ ] `from` 参数从 URL 正确携带
- [ ] `anonymous_id` cookie 正常生成与读取
- [ ] `GET /api/admin/metrics` 返回 K 因子聚合值

---

## 九、文件索引

| 类型 | 路径 |
|------|------|
| PM 源规格 | `PM/specs/03_卡片与分享系统.md` (v4.0) |
| PM 人格系统 | `PM/specs/02_八字人格类型系统.md` (v7.0) |
| PM 格局系统 | `PM/specs/02a_格局标签系统.md` (v2.0) |
| PM 传播名 | `PM/specs/02b_传播名体系.md` (v1.0-final) |
| PM 子标签矩阵 | `PM/specs/02c_子标签矩阵.md` (v6.2) |
| 排盘引擎 | `paipan/paipan/` |
| 力量评分 | `paipan/paipan/li_liang.py` |
| 格局识别 | `paipan/paipan/ge_ju.py` |
| 现有后端 | `server/app/` |
| 现有前端 | `frontend/src/` |

---

**下一步**：本 spec 审核通过后，进入 writing-plans 阶段，产出逐项可执行的实施计划。
