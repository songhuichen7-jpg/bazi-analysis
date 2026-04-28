# 卡片系统视觉重设计

> 日期：2026-04-28  
> 状态：设计已确认，待实施计划  
> 范围：个人分享卡视觉系统、AI 插图方向、首批 5 张五行样板

## 1. 背景

当前个人分享卡已经完成基础信息架构：品牌、类型编号、插图、传播名、十神后缀、一句话、三枚子标签、金句和底部水印。问题不在信息缺失，而在视觉记忆点不足：卡片更像普通结果页截图，插图没有撑起“20 型人格图鉴”的收藏感。

本轮设计目标不是增加内容，而是重新定义卡片第一眼气质：让用户觉得这是可以保存、比较、分享的一套人格收藏卡。

## 2. 已确认方向

用户选择的主方向是 **B + D，更偏 B**：

- **B：收藏级人格图鉴** 为主。20 型要像同一套卡，有编号、封套、系列感和可收集感。
- **D：治愈神秘绘本** 为辅。插图提供小世界和情绪，不把整体做成传统玄学海报。

最终确认的视觉方案：

- 版式采用 **系列封套卡**：克制、精装、可信，有“Collector Edition”的气质。
- 插图采用 **微场景绘本**：每个类型不是单一头像或装饰物，而是在一个小场景里出现。
- 生产策略采用 **先做 5 张五行样板**：木、火、土、金、水各一张，确认世界观和生成规则后再扩展 20 张。

## 3. 卡片版式

卡片仍保持现有 3:4 竖版比例，适配朋友圈保存和分享。新版结构从上到下为：

1. 顶部：品牌名 `有时` + 类型编号 `08 / 20`
2. 中上：微场景插图窗口，占卡片视觉重心
3. 中部：传播名大字，例如 `小夜灯`
4. 副标题：十神后缀，例如 `· 隐形学霸 ·`
5. 金句条：一句高传播文案
6. 三枚子标签：保留现有 3 个标签，但视觉上更像收藏卡参数
7. 底部：系列标识 + `youshi.app`

设计原则：

- 插图不能只是圆形头像，必须是有空间关系的“微场景”。
- 传播名仍然是最大文本，不能被插图抢掉识别权。
- 金句作为情绪锚点，视觉权重高于子标签。
- 三枚子标签用于差异化，但不能堆成信息噪音。
- 卡片正面继续不出现裸命理术语，如日主、身强、格局、五行生克。

## 4. 插图系统

### 4.1 总体风格

插图关键词：

- premium collectible card
- miniature storybook scene
- soft paper grain
- warm mystical but not tarot
- gentle Chinese editorial illustration
- clean negative space
- not childish, not game UI, not fortune-telling poster

插图应像“每个类型住在自己的小世界里”。画面可以温柔、神秘、有一点夜光感，但要保持现代和克制。

### 4.2 统一规则

- 构图：主体位于中上 45% 区域，保留传播名文字空间。
- 背景：纸张底色、细网格或极淡纹理，避免大面积复杂渐变。
- 形状：插图窗口可用拱窗、圆角框、藏书票式边框或小剧场框。
- 线条：手绘但干净，避免过重描边。
- 光感：允许柔光、微微发光、窗边/月光/水下漫射光。
- 颜色：每张使用对应 `theme_color` 做主锚点，但必须加入中性色和少量互补色，避免 20 张变成单色主题。
- 系列一致性：边框、纸纹、卡面层级、插图窗口比例保持一致；场景内容可差异化。

### 4.3 禁止项

- 不要塔罗牌、占卜桌、水晶球、星座符号堆砌。
- 不要过度国潮、祥云、卷轴、古风边框。
- 不要纯头像贴纸、Q 版表情包、儿童绘本风。
- 不要暗黑、恐怖、赛博、游戏卡牌、盲盒包装感。
- 不要把文字放进 AI 插图里，所有文字由前端排版渲染。

## 5. 五行样板

首批只生成 5 张，用来检验整套系统边界。

| 五行 | 类型 | ID | 选择理由 | 微场景方向 |
| --- | --- | --- | --- | --- |
| 木 | 春笋 | 01 | 建立图鉴开篇气质，测试向上生长构图 | 破土的新笋、清晨纸面庭院、细雨后光线 |
| 火 | 小夜灯 | 08 | 最适合治愈微场景，测试夜色与暖光 | 夜窗边的小灯、安静房间、外面有深蓝夜色 |
| 土 | 多肉 | 11 | 测温暖、慢生长和桌面/温室静物 | 温室窗台、多肉盆栽、阳光落在纸页上 |
| 金 | 猫 | 16 | 传播力强，测试角色场景会不会幼稚 | 安静猫坐在书架或窗台，眼神挑剔但温柔 |
| 水 | 水母 | 19 | 测透明、流动、发光质感，视觉上限高 | 水下小剧场、半透明水母、柔和青蓝光 |

这组覆盖植物、物件、静物、角色、水下光感。通过这 5 张后，再扩展到 20 张。

## 6. AI 插图 Prompt 模板

基础模板：

```text
Create a premium collectible personality card illustration.
Subject: {cosmic_name}, representing {one_liner}.
Scene: {micro_scene}.
Style: miniature storybook scene, gentle Chinese editorial illustration,
soft paper grain, clean composition, warm mystical atmosphere, modern and refined.
Composition: centered subject in the upper half, framed like a small stage or arched window,
clear negative space below for title text, no words in the image.
Color: use {theme_color} as the main accent, balanced with warm off-white paper,
muted neutrals, and one subtle complementary color.
Avoid: tarot cards, zodiac symbols, crystal balls, heavy ancient Chinese ornament,
childish cartoon, game card UI, dark horror, text, logos, watermark.
```

每张样板只替换 `Subject`、`Scene`、`theme_color` 和少量情绪词。不要为每张完全重写风格，否则 20 张会散。

## 7. 前端影响

主要改动会集中在：

- `frontend/src/components/card/Card.jsx`
- `frontend/src/styles/card.css`
- `frontend/src/components/landing/CosmicCardPreview.jsx`
- `frontend/src/styles/landing.css`
- `server/app/data/cards/illustrations/`

实现策略：

- 保留现有 `CardResponse` 数据结构，避免后端 payload 变更。
- 替换卡面 CSS 版式，让 `share-card` 从当前中央圆形插图改为封套卡布局。
- 插图图片仍使用 `card.illustration_url`，首批覆盖 5 张样板，其余 15 张可保留旧图或使用统一占位，直到全量生成。
- Landing 预览应同步新卡片气质，避免首页看到旧版、结果页看到新版的割裂。

## 8. 验收标准

视觉验收：

- 5 张样板放在一起时像同一套收藏卡。
- 单张截图能在 1 秒内读出传播名。
- 插图有小世界感，但不会压过传播名。
- 卡片不像塔罗、占卜海报、儿童贴纸或普通结果页截图。
- 在移动端宽度下文字不溢出，三枚子标签不挤压变形。

技术验收：

- `npm run build` 在 `frontend/` 通过。
- 保存图片仍能正常导出 3:4 PNG。
- `/card/:slug` 分享页和 App 内卡片工作区都使用新版样式。
- 未生成新图的类型有可接受的 fallback，不出现破图。

## 9. 暂不包含

- 不一次性生成全部 20 张插图。
- 不改卡片文案体系和 200 组子标签。
- 不改后端排盘和类型映射。
- 不改合盘卡片视觉系统。
- 不引入新的 UI 框架或复杂动画。

## 10. 下一步

设计确认后进入实施计划：

1. 生成 5 张样板插图，并存入临时样板目录或覆盖对应 5 个类型图。
2. 重写个人卡片 CSS 为系列封套卡。
3. 更新 Landing 示例卡，让首页和结果卡一致。
4. 本地浏览器验证桌面和移动端截图。
5. 用户确认样板后，再规划 20 张全量插图生产。
