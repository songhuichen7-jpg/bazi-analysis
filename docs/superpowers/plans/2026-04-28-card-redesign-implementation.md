# 卡片视觉重设计实施计划

> **给 agentic workers：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行本计划。所有步骤使用 checkbox（`- [ ]`）追踪。

**目标：** 落地已确认的个人分享卡重设计：系列封套卡版式 + 5 张五行微场景绘本样板插图。

**架构：** 不改现有卡片 API payload，不改 `/static/cards/illustrations/` 静态资源合同。前端只重写卡片 DOM/CSS 和 landing 预览；后端数据层只新增一份非运行时的插图 prompt manifest，用来固定 5 张样板图的生成方向，后续再扩展到 20 张。

**技术栈：** React 19、Vite、纯 CSS、Node `node:test`、FastAPI 静态文件服务。

---

## 文件职责

- `frontend/src/components/card/Card.jsx`
  运行时个人分享卡 DOM。必须继续渲染 `card.illustration_url`、`card.cosmic_name`、`card.suffix`、`card.one_liner`、`card.subtags`、`card.golden_line`，避免后端 payload 变更。

- `frontend/src/styles/card.css`
  分享卡、桌面卡片工作区、保存浮层、预览页、卡片 skeleton 的样式。重点改 `share-card` 视觉系统、空态、skeleton 和移动端尺寸。

- `frontend/src/components/card/CardWorkspace.jsx`
  App 内卡片工作区。需要同步空态卡片 DOM，避免未生成卡片时仍显示旧圆形插图结构。

- `frontend/src/components/card/CardSkeleton.jsx`
  卡片加载态。需要从旧的普通横条 skeleton 改成带拱窗插图区的封套卡 skeleton。

- `frontend/src/components/landing/CosmicCardPreview.jsx`
  Landing 页静态人格卡预览。需要模拟新版系列封套卡，而不是旧 SVG 头像卡。

- `frontend/src/components/landing/LandingHome.jsx`
  Landing 展示样板列表。需要展示 5 张已确认样板：`01`、`08`、`11`、`16`、`19`。

- `frontend/src/styles/landing.css`
  Landing 图鉴区布局和静态预览卡 CSS。需要从四张 flex row 改成五张响应式 collector grid。

- `server/app/data/cards/illustration_prompts.json`
  新增非运行时 prompt manifest，用来记录 5 张样板插图的目标文件、场景描述和统一 prompt。

- `server/app/data/cards/illustrations/{01-chunsun.png,08-xiaoyedeng.png,11-duorou.png,16-mao.png,19-shuimu.png}`
  用新生成的微场景插图替换这 5 张当前样板图，其余 15 张暂不动。

- `frontend/tests/card-placement.test.mjs`
  卡片 DOM/CSS 的源码级契约测试。

- `frontend/tests/landing-home.test.mjs`
  Landing 页 5 张样板和微场景预览的源码级契约测试。

- `server/tests/unit/test_card_illustration_prompts.py`
  新增 prompt manifest 测试，验证 5 张样板覆盖完整且包含风格护栏。

---

### 任务 1：添加卡片重设计契约测试

**文件：**
- 修改：`frontend/tests/card-placement.test.mjs`

- [ ] **步骤 1：为新版卡片 DOM 写失败测试**

在现有 `share card front matches spec wireframe` 测试后追加：

```js
test('share card uses the series-cover micro-scene structure', () => {
  const source = fs.readFileSync(new URL('../src/components/card/Card.jsx', import.meta.url), 'utf8');

  assert.match(source, /share-card-edition/);
  assert.match(source, /COLLECTOR EDITION/);
  assert.match(source, /share-card-scene/);
  assert.match(source, /share-card-scene-frame/);
  assert.match(source, /share-card-title-block/);
  assert.match(source, /share-card-caption/);

  const goldenIndex = source.indexOf('share-card-golden');
  const subtagsIndex = source.indexOf('share-card-subtags');
  assert.ok(goldenIndex > -1, 'expected share-card-golden in Card.jsx');
  assert.ok(subtagsIndex > -1, 'expected share-card-subtags in Card.jsx');
  assert.ok(goldenIndex < subtagsIndex, 'golden line should appear before subtags in the cover layout');
});

test('share card CSS renders a collector cover instead of a circular avatar card', () => {
  const css = fs.readFileSync(new URL('../src/styles/card.css', import.meta.url), 'utf8');

  assert.match(css, /\.share-card::after[\s\S]*border:\s*1px solid/);
  assert.match(css, /\.share-card-scene[\s\S]*border-radius:\s*999px 999px/);
  assert.match(css, /\.share-card-scene-frame[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.share-card-golden[\s\S]*border-top:\s*1px solid/);
  assert.match(css, /\.share-card-subtags[\s\S]*display:\s*grid/);

  const illustrationBlock = css.match(/\.share-card-illustration\s*\{[\s\S]*?\n\}/);
  assert.ok(illustrationBlock, 'expected .share-card-illustration block');
  assert.doesNotMatch(illustrationBlock[0], /border-radius:\s*50%/);
});
```

- [ ] **步骤 2：更新子标签布局测试**

在现有 `share card subtags render as 3 chips...` 测试中，把 flex 断言替换成 grid 断言：

```js
assert.match(css, /\.share-card-subtags[\s\S]*display:\s*grid/);
assert.match(css, /\.share-card-subtags[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /\.share-card-subtags li[\s\S]*min-width:\s*0/);
assert.match(css, /\.share-card-subtags li[\s\S]*white-space:\s*normal/);
```

删除这些旧断言：

```js
assert.match(css, /\.share-card-subtags[\s\S]*display:\s*flex/);
assert.match(css, /\.share-card-subtags[\s\S]*flex-wrap:\s*nowrap/);
assert.match(css, /\.share-card-subtags li[\s\S]*flex:\s*1\s*1\s*0/);
```

- [ ] **步骤 3：运行测试，确认失败**

```bash
cd frontend && node --test tests/card-placement.test.mjs
```

预期：失败，原因应包含缺少 `share-card-edition`、`share-card-scene` 或新版 collector-cover CSS。

- [ ] **步骤 4：提交失败测试**

```bash
git add frontend/tests/card-placement.test.mjs
git commit -m "test(cards): lock collector cover card contract"
```

---

### 任务 2：更新运行时卡片 DOM

**文件：**
- 修改：`frontend/src/components/card/Card.jsx`
- 修改：`frontend/src/components/card/CardWorkspace.jsx`

- [ ] **步骤 1：替换 `Card.jsx` 为系列封套卡结构**

保留文件顶部 import 和 `forwardRef` 包装，把组件实现替换为：

```jsx
export const Card = forwardRef(function Card({ card }, ref) {
  const totalTypes = '20';
  return (
    <article
      ref={ref}
      className="share-card"
      data-state={card.state}
      data-type-id={card.type_id}
      style={{ '--theme': card.theme_color }}
    >
      <header className="share-card-head">
        <span className="share-card-brand">有时</span>
        <span className="share-card-typeid">
          {card.type_id} <em>/ {totalTypes}</em>
        </span>
      </header>

      <figure className="share-card-illustration share-card-scene">
        <div className="share-card-scene-frame">
          <img src={card.illustration_url} alt={card.cosmic_name} />
        </div>
      </figure>

      <section className="share-card-title-block">
        <h1 className="share-card-name">{card.cosmic_name}</h1>
        <p className="share-card-suffix">· {card.suffix} ·</p>
        <p className="share-card-oneliner share-card-caption">{card.one_liner}</p>
      </section>

      <blockquote className="share-card-golden">
        <span className="share-card-quote">"</span>
        {card.golden_line}
      </blockquote>

      <ul className="share-card-subtags">
        {card.subtags.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>

      <footer className="share-card-foot">
        <span className="share-card-edition">COLLECTOR EDITION</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
});
```

说明：保留 `share-card-illustration`、`share-card-name`、`share-card-suffix`、`share-card-oneliner`、`share-card-golden`、`share-card-subtags`、`share-card-foot`，让现有测试和保存导出逻辑继续能识别卡片。

- [ ] **步骤 2：同步 CardWorkspace 空态卡片**

在 `frontend/src/components/card/CardWorkspace.jsx` 中，把空态卡片里的旧 figure、标题和金句区域替换为：

```jsx
<figure className="share-card-illustration share-card-scene share-card-illustration-empty" aria-hidden="true">
  <div className="share-card-scene-frame" />
</figure>
<section className="share-card-title-block">
  <h1 className="share-card-name">待生成</h1>
  <p className="share-card-suffix">· 等你的卡片 ·</p>
  <p className="share-card-oneliner share-card-caption">输入生日，3 秒生成你的人格卡片。</p>
</section>
<blockquote className="share-card-golden share-card-golden-empty" aria-hidden="true" />
```

把空态 footer 替换为：

```jsx
<footer className="share-card-foot">
  <span className="share-card-edition">COLLECTOR EDITION</span>
  <span>youshi.app</span>
</footer>
```

- [ ] **步骤 3：运行聚焦测试**

```bash
cd frontend && node --test tests/card-placement.test.mjs
```

预期：仍失败，因为 CSS 还没更新；DOM 相关断言应已通过。

- [ ] **步骤 4：提交 DOM 更新**

```bash
git add frontend/src/components/card/Card.jsx frontend/src/components/card/CardWorkspace.jsx
git commit -m "feat(cards): render collector cover card markup"
```

---

### 任务 3：重写运行时卡片 CSS

**文件：**
- 修改：`frontend/src/styles/card.css`
- 修改：`frontend/src/components/card/CardSkeleton.jsx`

- [ ] **步骤 1：替换 share-card 视觉系统**

在 `frontend/src/styles/card.css` 中，用下面的 CSS 替换从 `/* ── Share card (3:4 portrait)` 到 `.share-card-foot` 结束的整段旧样式：

```css
/* ── Share card (3:4 portrait) ─────────────────────────────────────── */
.share-card {
  --card-accent: var(--theme, #6f5c8f);
  --card-accent-soft: color-mix(in srgb, var(--card-accent) 12%, #fbfaf6);
  --card-ink: #221914;
  --card-muted: #817467;
  --card-line: color-mix(in srgb, var(--card-accent) 22%, #ddd4c4);
  --card-paper: #fbfaf6;

  width: min(540px, 100%);
  aspect-ratio: 3 / 4;
  padding: 28px 30px 22px;
  border-radius: 16px;
  background:
    linear-gradient(90deg, rgba(31, 22, 16, .035) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(180deg, rgba(31, 22, 16, .035) 1px, transparent 1px) 0 0 / 24px 24px,
    radial-gradient(130% 72% at 50% 0%, var(--card-accent-soft) 0%, transparent 56%),
    var(--card-paper);
  color: var(--card-ink);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Noto Sans SC", sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  position: relative;
  box-shadow:
    0 22px 46px rgba(42, 28, 14, .14),
    0 1px 0 rgba(255, 255, 255, .88) inset;
  overflow: hidden;
}

.share-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 18%, color-mix(in srgb, var(--card-accent) 10%, transparent), transparent 38%);
  pointer-events: none;
  z-index: 0;
}

.share-card::after {
  content: "";
  position: absolute;
  inset: 12px;
  border: 1px solid var(--card-line);
  border-radius: 10px;
  pointer-events: none;
  z-index: 1;
}

.share-card > * {
  position: relative;
  z-index: 2;
}

.share-card-head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: var(--card-muted);
  font-size: 10px;
  letter-spacing: .18em;
  line-height: 1.2;
}

.share-card-brand {
  font-weight: 500;
}

.share-card-typeid {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 13px;
  letter-spacing: .04em;
  color: var(--card-accent);
}

.share-card-typeid em {
  color: #a99b8a;
  font-style: normal;
  font-size: 11px;
}

.share-card-illustration,
.share-card-scene {
  margin: 24px 0 0;
  width: min(68%, 300px);
  aspect-ratio: 1 / 1.12;
  border-radius: 999px 999px 18px 18px;
  border: 1px solid var(--card-line);
  background:
    radial-gradient(circle at 50% 34%, color-mix(in srgb, var(--card-accent) 18%, #fff), transparent 44%),
    rgba(255, 255, 255, .54);
  padding: 8px;
  display: block;
}

.share-card-scene-frame {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 999px 999px 14px 14px;
  background: color-mix(in srgb, var(--card-accent) 8%, #fffdf8);
}

.share-card-illustration img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: saturate(1.02);
}

.share-card-title-block {
  width: 100%;
  margin-top: 18px;
}

.share-card-name {
  margin: 0;
  font-family: "Songti SC", "STSong", "Noto Serif SC", "SimSun", Georgia, serif;
  font-size: 46px;
  font-weight: 500;
  line-height: 1.05;
  letter-spacing: .04em;
  color: var(--card-ink);
}

.share-card-suffix {
  margin: 8px 0 0;
  color: var(--card-accent);
  font-size: 13px;
  letter-spacing: .1em;
  line-height: 1.4;
}

.share-card-oneliner,
.share-card-caption {
  margin: 8px auto 0;
  max-width: 18em;
  color: #4a3b2f;
  font-size: 13px;
  line-height: 1.6;
  letter-spacing: .03em;
}

.share-card-golden {
  position: relative;
  width: calc(100% - 20px);
  margin: 16px 0 0;
  padding: 10px 12px;
  border-top: 1px solid var(--card-line);
  border-bottom: 1px solid var(--card-line);
  color: var(--card-ink);
  font-family: "Songti SC", "STSong", "Noto Serif SC", "SimSun", Georgia, serif;
  font-size: 13px;
  line-height: 1.55;
  letter-spacing: .02em;
}

.share-card-quote {
  display: inline-block;
  margin-right: 4px;
  color: var(--card-accent);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 22px;
  line-height: 0;
  vertical-align: -6px;
}

.share-card-subtags {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 14px 0 0;
  width: 100%;
  align-items: stretch;
}

.share-card-subtags li {
  min-width: 0;
  min-height: 34px;
  padding: 7px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, .58);
  border: 1px solid var(--card-line);
  color: #2a1d10;
  font-size: 10px;
  line-height: 1.35;
  letter-spacing: 0;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: normal;
  word-break: break-word;
  hyphens: none;
}

.share-card-foot {
  width: 100%;
  margin-top: auto;
  padding-top: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--card-muted);
  font-size: 10px;
  letter-spacing: .14em;
}

.share-card-edition {
  font-family: Georgia, "Times New Roman", serif;
  letter-spacing: .12em;
}
```

- [ ] **步骤 2：替换空态样式**

把现有 `.share-card-illustration-empty`、`.share-card-subtags-empty`、`.share-card-golden-empty` 替换为：

```css
.share-card-illustration-empty .share-card-scene-frame,
.share-card-illustration-empty {
  background:
    repeating-linear-gradient(45deg, #f1e6cd 0 6px, #f7eedb 6px 12px);
}

.share-card-subtags-empty li {
  background: repeating-linear-gradient(90deg, #f5ebd5 0 8px, #f9f0dc 8px 16px);
  border-color: transparent;
  color: transparent;
  min-height: 34px;
}

.share-card-golden-empty {
  min-height: 44px;
  background: repeating-linear-gradient(90deg, #f5ebd5 0 6px, #f9f0dc 6px 12px);
  opacity: .45;
}
```

- [ ] **步骤 3：更新 skeleton**

把 `.card-skeleton` 子元素尺寸改成：

```css
.card-skeleton .shimmer-scene {
  width: 58%;
  aspect-ratio: 1 / 1.12;
  border-radius: 999px 999px 18px 18px;
}

.card-skeleton .shimmer-name {
  width: 48%;
  height: 48px;
}

.card-skeleton .shimmer-tags {
  width: 86%;
  height: 34px;
}

.card-skeleton .shimmer-line {
  width: 70%;
  height: 18px;
}
```

同时把 `frontend/src/components/card/CardSkeleton.jsx` 改成：

```jsx
export function CardSkeleton() {
  return (
    <div className="card-skeleton" aria-busy="true">
      <div className="shimmer shimmer-scene" />
      <div className="shimmer shimmer-name" />
      <div className="shimmer shimmer-line" />
      <div className="shimmer shimmer-tags" />
    </div>
  );
}
```

- [ ] **步骤 4：调整移动端尺寸**

在现有 `@media (max-width: 820px)` 中保留：

```css
.share-card {
  width: min(420px, 100%);
}
```

并把名称和插图区尺寸改成：

```css
.share-card-name {
  font-size: 42px;
}

.share-card-illustration,
.share-card-scene {
  width: min(70%, 260px);
}
```

- [ ] **步骤 5：运行聚焦测试**

```bash
cd frontend && node --test tests/card-placement.test.mjs
```

预期：通过。

- [ ] **步骤 6：提交卡片样式**

```bash
git add frontend/src/styles/card.css frontend/src/components/card/CardSkeleton.jsx
git commit -m "style(cards): apply collector cover visual system"
```

---

### 任务 4：同步 Landing 预览卡

**文件：**
- 修改：`frontend/tests/landing-home.test.mjs`
- 修改：`frontend/src/components/landing/LandingHome.jsx`
- 修改：`frontend/src/components/landing/CosmicCardPreview.jsx`
- 修改：`frontend/src/styles/landing.css`

- [ ] **步骤 1：先更新 landing 测试**

把现有 `CosmicCardPreview renders 5 illustration kinds...` 测试替换为：

```js
test('CosmicCardPreview renders the five micro-scene sample kinds without raw bazi terms', () => {
  const source = fs.readFileSync(new URL('../src/components/landing/CosmicCardPreview.jsx', import.meta.url), 'utf8');
  assert.match(source, /chunsun/);
  assert.match(source, /xiaoyedeng/);
  assert.match(source, /duorou/);
  assert.match(source, /mao/);
  assert.match(source, /shuimu/);
  assert.match(source, /landing-card-scene/);
  assert.match(source, /COLLECTOR EDITION/);
  assert.doesNotMatch(source, /[>\s]日主[<\s]/);
  assert.doesNotMatch(source, /[>\s]格局[<\s]/);
});

test('LandingHome showcases the five confirmed card redesign samples', () => {
  const source = fs.readFileSync(new URL('../src/components/landing/LandingHome.jsx', import.meta.url), 'utf8');
  assert.match(source, /id:\s*'01'[\s\S]*name:\s*'春笋'/);
  assert.match(source, /id:\s*'08'[\s\S]*name:\s*'小夜灯'/);
  assert.match(source, /id:\s*'11'[\s\S]*name:\s*'多肉'/);
  assert.match(source, /id:\s*'16'[\s\S]*name:\s*'猫'/);
  assert.match(source, /id:\s*'19'[\s\S]*name:\s*'水母'/);
});
```

- [ ] **步骤 2：运行 landing 测试，确认失败**

```bash
cd frontend && node --test tests/landing-home.test.mjs
```

预期：失败，因为静态预览仍使用旧插图 key，且 showcase 仍只有 4 张。

- [ ] **步骤 3：更新 showcase 数据**

把 `frontend/src/components/landing/LandingHome.jsx` 中的 `SHOWCASE_TYPES` 替换为：

```js
const SHOWCASE_TYPES = [
  { id: '01', name: '春笋', suffix: '反脆弱型', oneLiner: '越压越往上长', theme: '#2D6A4F', illust: 'chunsun' },
  { id: '08', name: '小夜灯', suffix: '灵感深潜者', oneLiner: '光不大，但一直亮着', theme: '#2B6CB0', illust: 'xiaoyedeng' },
  { id: '11', name: '多肉', suffix: '慢热养成系', oneLiner: '慢慢长，急不来的', theme: '#D4A574', illust: 'duorou' },
  { id: '16', name: '猫', suffix: '隐形学霸', oneLiner: '不是冷，是在挑人', theme: '#6B4E99', illust: 'mao' },
  { id: '19', name: '水母', suffix: '边界感艺术家', oneLiner: '随波不逐流', theme: '#4AC4C0', illust: 'shuimu' },
];
```

- [ ] **步骤 4：替换 `CosmicCardPreview.jsx` 为微场景预览**

保留文件开头注释，把后续内容替换为：

```jsx
const SCENES = {
  chunsun: () => (
    <div className="landing-scene landing-scene-bamboo">
      <span className="landing-scene-sprout" />
      <span className="landing-scene-rain landing-rain-a" />
      <span className="landing-scene-rain landing-rain-b" />
    </div>
  ),
  xiaoyedeng: () => (
    <div className="landing-scene landing-scene-lamp">
      <span className="landing-scene-window" />
      <span className="landing-scene-lampbody" />
    </div>
  ),
  duorou: () => (
    <div className="landing-scene landing-scene-succulent">
      <span className="landing-scene-pot" />
      <span className="landing-scene-leaf landing-leaf-a" />
      <span className="landing-scene-leaf landing-leaf-b" />
      <span className="landing-scene-leaf landing-leaf-c" />
    </div>
  ),
  mao: () => (
    <div className="landing-scene landing-scene-cat">
      <span className="landing-scene-shelf" />
      <span className="landing-scene-catbody" />
    </div>
  ),
  shuimu: () => (
    <div className="landing-scene landing-scene-jellyfish">
      <span className="landing-scene-water" />
      <span className="landing-scene-jelly" />
    </div>
  ),
};

export function CosmicCardPreview({
  id,
  name,
  suffix,
  oneLiner,
  subtags,
  golden,
  theme,
  illustKind,
  size = 'small',
}) {
  const Scene = SCENES[illustKind] || SCENES.chunsun;
  return (
    <article
      className={`landing-card-preview landing-card-${size}`}
      style={{ '--theme': theme }}
    >
      <header className="landing-card-head">
        <span>有时</span>
        <span className="landing-card-typeid">
          {id} <em>/ 20</em>
        </span>
      </header>
      <div className="landing-card-illustration landing-card-scene" aria-hidden="true">
        <div className="landing-card-scene-frame">
          <Scene />
        </div>
      </div>
      <div className="landing-card-title-block">
        <h3 className="landing-card-name">{name}</h3>
        <p className="landing-card-suffix">· {suffix} ·</p>
        <p className="landing-card-oneliner">{oneLiner}</p>
      </div>
      {golden ? (
        <blockquote className="landing-card-golden">
          <span className="landing-card-quote">"</span>{golden}
        </blockquote>
      ) : null}
      {subtags && subtags.length === 3 ? (
        <ul className="landing-card-subtags">
          {subtags.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      ) : null}
      <footer className="landing-card-foot">
        <span>COLLECTOR EDITION</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
}
```

- [ ] **步骤 5：更新 Landing 预览 CSS**

在 `frontend/src/styles/landing.css` 中找到旧的 landing card preview 样式。如果存在 `.landing-card-illustration svg`，用下面的 preview 样式块替换旧 preview 样式：

```css
.landing-gallery-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
  margin-top: 24px;
}

.landing-gallery-item {
  min-width: 0;
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.landing-card-preview {
  --card-accent: var(--theme, #6f5c8f);
  aspect-ratio: 3 / 4;
  padding: 16px 14px 12px;
  border: 1px solid color-mix(in srgb, var(--card-accent) 18%, var(--landing-rule));
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(31, 22, 16, .03) 1px, transparent 1px) 0 0 / 18px 18px,
    linear-gradient(180deg, rgba(31, 22, 16, .03) 1px, transparent 1px) 0 0 / 18px 18px,
    radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--card-accent) 10%, #fff), transparent 58%),
    #fffdf8;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  overflow: hidden;
}

.landing-card-preview::after {
  content: "";
  position: absolute;
  inset: 8px;
  border: 1px solid color-mix(in srgb, var(--card-accent) 20%, var(--landing-rule));
  border-radius: 5px;
  pointer-events: none;
}

.landing-card-preview > * {
  position: relative;
  z-index: 1;
}

.landing-card-head,
.landing-card-foot {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: #8a8176;
  font-size: 8px;
  letter-spacing: .12em;
}

.landing-card-typeid {
  color: var(--card-accent);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 10px;
}

.landing-card-typeid em {
  color: #aaa199;
  font-style: normal;
  font-size: 8px;
}

.landing-card-illustration,
.landing-card-scene {
  width: 66%;
  aspect-ratio: 1 / 1.12;
  margin-top: 14px;
  padding: 5px;
  border: 1px solid color-mix(in srgb, var(--card-accent) 22%, var(--landing-rule));
  border-radius: 999px 999px 12px 12px;
  background: rgba(255, 255, 255, .58);
}

.landing-card-scene-frame {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 999px 999px 9px 9px;
}

.landing-scene {
  width: 100%;
  height: 100%;
  position: relative;
  background: color-mix(in srgb, var(--card-accent) 10%, #fffdf8);
}

.landing-card-title-block {
  margin-top: 12px;
}

.landing-card-name {
  margin: 0;
  font-family: "Songti SC", "STSong", serif;
  font-size: 24px;
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: .04em;
}

.landing-card-suffix {
  margin: 5px 0 0;
  color: var(--card-accent);
  font-size: 9px;
  letter-spacing: .08em;
}

.landing-card-oneliner {
  margin: 6px 0 0;
  color: #62584e;
  font-size: 9px;
  line-height: 1.45;
}

.landing-card-foot {
  margin-top: auto;
  padding-top: 10px;
  font-family: Georgia, "Times New Roman", serif;
}
```

在其后追加 5 种微场景小图形：

```css
.landing-scene-sprout,
.landing-scene-lampbody,
.landing-scene-pot,
.landing-scene-catbody,
.landing-scene-jelly {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.landing-scene-sprout {
  bottom: 20%;
  width: 42%;
  height: 50%;
  border-radius: 50% 50% 10% 10%;
  background: linear-gradient(160deg, #74c69d, #2d6a4f);
}

.landing-scene-window {
  position: absolute;
  inset: 14% 18%;
  border-radius: 999px 999px 8px 8px;
  background: linear-gradient(180deg, #1f3f67, #101a2a);
}

.landing-scene-lampbody {
  bottom: 18%;
  width: 34%;
  height: 36%;
  border-radius: 8px 8px 14px 14px;
  background: #ffe8a3;
  box-shadow: 0 0 28px rgba(255, 232, 163, .72);
}

.landing-scene-pot {
  bottom: 18%;
  width: 46%;
  height: 24%;
  border-radius: 0 0 16px 16px;
  background: #b9835a;
}

.landing-scene-leaf {
  position: absolute;
  bottom: 34%;
  width: 28%;
  height: 30%;
  border-radius: 999px 999px 40px 40px;
  background: #8fbf88;
}

.landing-leaf-a { left: 32%; transform: rotate(-24deg); }
.landing-leaf-b { left: 45%; transform: rotate(4deg); }
.landing-leaf-c { right: 28%; transform: rotate(28deg); }

.landing-scene-shelf {
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 24%;
  height: 2px;
  background: rgba(34, 25, 20, .22);
}

.landing-scene-catbody {
  bottom: 26%;
  width: 46%;
  height: 44%;
  border-radius: 48% 48% 42% 42%;
  background: linear-gradient(145deg, #efe8fb, #6b4e99);
}

.landing-scene-water {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 34%, rgba(255,255,255,.5), transparent 32%), #d9fbf8;
}

.landing-scene-jelly {
  top: 25%;
  width: 42%;
  height: 32%;
  border-radius: 999px 999px 40px 40px;
  background: rgba(74, 196, 192, .62);
  box-shadow: 0 0 24px rgba(74, 196, 192, .42);
}
```

在现有 `@media (max-width: 900px)` 中追加：

```css
.landing-gallery-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

在更窄移动端 media block 中追加：

```css
.landing-gallery-row {
  grid-template-columns: 1fr;
}
```

- [ ] **步骤 6：运行 landing 测试**

```bash
cd frontend && node --test tests/landing-home.test.mjs
```

预期：通过。

- [ ] **步骤 7：提交 Landing 预览更新**

```bash
git add frontend/tests/landing-home.test.mjs frontend/src/components/landing/LandingHome.jsx frontend/src/components/landing/CosmicCardPreview.jsx frontend/src/styles/landing.css
git commit -m "style(landing): preview collector cover cards"
```

---

### 任务 5：添加 AI 插图 Prompt Manifest 与 5 张样板资产

**文件：**
- 新建：`server/tests/unit/test_card_illustration_prompts.py`
- 新建：`server/app/data/cards/illustration_prompts.json`
- 修改：`server/app/data/cards/illustrations/01-chunsun.png`
- 修改：`server/app/data/cards/illustrations/08-xiaoyedeng.png`
- 修改：`server/app/data/cards/illustrations/11-duorou.png`
- 修改：`server/app/data/cards/illustrations/16-mao.png`
- 修改：`server/app/data/cards/illustrations/19-shuimu.png`

- [ ] **步骤 1：写 prompt manifest 测试**

创建 `server/tests/unit/test_card_illustration_prompts.py`：

```python
import json
from pathlib import Path


PROMPTS_PATH = Path("server/app/data/cards/illustration_prompts.json")


def test_prompt_manifest_covers_five_redesign_samples():
    data = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    assert set(data) == {"01", "08", "11", "16", "19"}

    expected_files = {
        "01": "01-chunsun.png",
        "08": "08-xiaoyedeng.png",
        "11": "11-duorou.png",
        "16": "16-mao.png",
        "19": "19-shuimu.png",
    }
    for type_id, filename in expected_files.items():
        assert data[type_id]["target_file"] == filename
        assert data[type_id]["cosmic_name"]
        assert data[type_id]["micro_scene"]
        assert data[type_id]["prompt"]


def test_prompt_manifest_preserves_style_guardrails():
    data = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    forbidden = ["tarot", "zodiac", "crystal ball", "game card", "watermark"]

    for item in data.values():
        prompt = item["prompt"].lower()
        assert "no words in the image" in prompt
        assert "premium collectible personality card illustration" in prompt
        assert "miniature storybook scene" in prompt
        for word in forbidden:
            assert word in prompt
```

- [ ] **步骤 2：运行测试，确认失败**

```bash
uv run --package server pytest -q server/tests/unit/test_card_illustration_prompts.py
```

预期：失败，因为 `illustration_prompts.json` 尚不存在。

- [ ] **步骤 3：创建 prompt manifest**

创建 `server/app/data/cards/illustration_prompts.json`：

```json
{
  "01": {
    "target_file": "01-chunsun.png",
    "cosmic_name": "春笋",
    "theme_color": "#2D6A4F",
    "one_liner": "越压越往上长",
    "micro_scene": "a fresh bamboo shoot breaking through soft paper-like soil in a quiet morning courtyard after rain, tiny droplets catching pale green light",
    "prompt": "Create a premium collectible personality card illustration. Subject: 春笋, representing 越压越往上长. Scene: a fresh bamboo shoot breaking through soft paper-like soil in a quiet morning courtyard after rain, tiny droplets catching pale green light. Style: miniature storybook scene, gentle Chinese editorial illustration, soft paper grain, clean composition, warm mystical atmosphere, modern and refined. Composition: centered subject in the upper half, framed like a small stage or arched window, clear negative space below for title text, no words in the image. Color: use #2D6A4F as the main accent, balanced with warm off-white paper, muted neutrals, and one subtle complementary color. Avoid: tarot cards, zodiac symbols, crystal balls, heavy ancient Chinese ornament, childish cartoon, game card UI, dark horror, text, logos, watermark."
  },
  "08": {
    "target_file": "08-xiaoyedeng.png",
    "cosmic_name": "小夜灯",
    "theme_color": "#2B6CB0",
    "one_liner": "光不大，但一直亮着",
    "micro_scene": "a small warm night lamp glowing beside a deep blue window, a quiet room with paper texture, gentle shadows and a feeling of steady company",
    "prompt": "Create a premium collectible personality card illustration. Subject: 小夜灯, representing 光不大，但一直亮着. Scene: a small warm night lamp glowing beside a deep blue window, a quiet room with paper texture, gentle shadows and a feeling of steady company. Style: miniature storybook scene, gentle Chinese editorial illustration, soft paper grain, clean composition, warm mystical atmosphere, modern and refined. Composition: centered subject in the upper half, framed like a small stage or arched window, clear negative space below for title text, no words in the image. Color: use #2B6CB0 as the main accent, balanced with warm off-white paper, muted neutrals, and one subtle complementary color. Avoid: tarot cards, zodiac symbols, crystal balls, heavy ancient Chinese ornament, childish cartoon, game card UI, dark horror, text, logos, watermark."
  },
  "11": {
    "target_file": "11-duorou.png",
    "cosmic_name": "多肉",
    "theme_color": "#D4A574",
    "one_liner": "慢慢长，急不来的",
    "micro_scene": "a small succulent on a greenhouse windowsill, sunlight falling across an open paper page, warm earthy ceramic pot, slow growth and calm patience",
    "prompt": "Create a premium collectible personality card illustration. Subject: 多肉, representing 慢慢长，急不来的. Scene: a small succulent on a greenhouse windowsill, sunlight falling across an open paper page, warm earthy ceramic pot, slow growth and calm patience. Style: miniature storybook scene, gentle Chinese editorial illustration, soft paper grain, clean composition, warm mystical atmosphere, modern and refined. Composition: centered subject in the upper half, framed like a small stage or arched window, clear negative space below for title text, no words in the image. Color: use #D4A574 as the main accent, balanced with warm off-white paper, muted neutrals, and one subtle complementary color. Avoid: tarot cards, zodiac symbols, crystal balls, heavy ancient Chinese ornament, childish cartoon, game card UI, dark horror, text, logos, watermark."
  },
  "16": {
    "target_file": "16-mao.png",
    "cosmic_name": "猫",
    "theme_color": "#6B4E99",
    "one_liner": "不是冷，是在挑人",
    "micro_scene": "a quiet cat sitting on a bookshelf by a window, observant eyes, refined purple shadows, warm paper grain, selective closeness rather than coldness",
    "prompt": "Create a premium collectible personality card illustration. Subject: 猫, representing 不是冷，是在挑人. Scene: a quiet cat sitting on a bookshelf by a window, observant eyes, refined purple shadows, warm paper grain, selective closeness rather than coldness. Style: miniature storybook scene, gentle Chinese editorial illustration, soft paper grain, clean composition, warm mystical atmosphere, modern and refined. Composition: centered subject in the upper half, framed like a small stage or arched window, clear negative space below for title text, no words in the image. Color: use #6B4E99 as the main accent, balanced with warm off-white paper, muted neutrals, and one subtle complementary color. Avoid: tarot cards, zodiac symbols, crystal balls, heavy ancient Chinese ornament, childish cartoon, game card UI, dark horror, text, logos, watermark."
  },
  "19": {
    "target_file": "19-shuimu.png",
    "cosmic_name": "水母",
    "theme_color": "#4AC4C0",
    "one_liner": "随波不逐流",
    "micro_scene": "a translucent jellyfish floating in a tiny underwater theater, soft cyan glow, drifting fabric-like currents, serene movement with clear boundaries",
    "prompt": "Create a premium collectible personality card illustration. Subject: 水母, representing 随波不逐流. Scene: a translucent jellyfish floating in a tiny underwater theater, soft cyan glow, drifting fabric-like currents, serene movement with clear boundaries. Style: miniature storybook scene, gentle Chinese editorial illustration, soft paper grain, clean composition, warm mystical atmosphere, modern and refined. Composition: centered subject in the upper half, framed like a small stage or arched window, clear negative space below for title text, no words in the image. Color: use #4AC4C0 as the main accent, balanced with warm off-white paper, muted neutrals, and one subtle complementary color. Avoid: tarot cards, zodiac symbols, crystal balls, heavy ancient Chinese ornament, childish cartoon, game card UI, dark horror, text, logos, watermark."
  }
}
```

- [ ] **步骤 4：运行 prompt manifest 测试**

```bash
uv run --package server pytest -q server/tests/unit/test_card_illustration_prompts.py
```

预期：通过。

- [ ] **步骤 5：生成 5 张 AI 插图**

逐条使用 manifest 中的 `prompt` 原文生成方形 PNG，并保存到：

```text
server/app/data/cards/illustrations/01-chunsun.png
server/app/data/cards/illustrations/08-xiaoyedeng.png
server/app/data/cards/illustrations/11-duorou.png
server/app/data/cards/illustrations/16-mao.png
server/app/data/cards/illustrations/19-shuimu.png
```

资产要求：

- PNG 格式。
- 尺寸至少 `1024 × 1024`。
- 图片内不能有文字、logo、水印、星座符号、塔罗牌、水晶球、重古风装饰。
- 主体位于画面中上部，被前端拱窗裁切后仍能清楚识别。

- [ ] **步骤 6：本地验证图片尺寸**

```bash
sips -g pixelWidth -g pixelHeight \
  server/app/data/cards/illustrations/01-chunsun.png \
  server/app/data/cards/illustrations/08-xiaoyedeng.png \
  server/app/data/cards/illustrations/11-duorou.png \
  server/app/data/cards/illustrations/16-mao.png \
  server/app/data/cards/illustrations/19-shuimu.png
```

预期：每个文件的 `pixelWidth` 和 `pixelHeight` 都至少为 `1024`。

- [ ] **步骤 7：提交 prompt manifest 和样板资产**

```bash
git add server/tests/unit/test_card_illustration_prompts.py server/app/data/cards/illustration_prompts.json \
  server/app/data/cards/illustrations/01-chunsun.png \
  server/app/data/cards/illustrations/08-xiaoyedeng.png \
  server/app/data/cards/illustrations/11-duorou.png \
  server/app/data/cards/illustrations/16-mao.png \
  server/app/data/cards/illustrations/19-shuimu.png
git commit -m "feat(cards): add micro-scene illustration samples"
```

---

### 任务 6：完整验证与视觉 QA

**文件：**
- 无计划内源码改动。只修复验证中发现的问题。

- [ ] **步骤 1：运行聚焦前端测试**

```bash
cd frontend && node --test tests/card-placement.test.mjs tests/landing-home.test.mjs tests/save-image.test.mjs
```

预期：通过。

- [ ] **步骤 2：运行新增服务端 prompt 测试**

```bash
uv run --package server pytest -q server/tests/unit/test_card_illustration_prompts.py
```

预期：通过。

- [ ] **步骤 3：运行前端构建**

```bash
cd frontend && npm run build
```

预期：Vite build 通过，没有 CSS/JS 编译错误。

- [ ] **步骤 4：运行前端 lint**

```bash
cd frontend && npm run lint
```

预期：通过。

- [ ] **步骤 5：启动本地应用做浏览器 QA**

一个终端启动后端：

```bash
npm run dev:back
```

另一个终端启动前端：

```bash
npm run dev:front
```

预期：

- 后端在 `http://127.0.0.1:3101`
- 前端在 `http://localhost:5173`

- [ ] **步骤 6：浏览器检查 Landing**

打开 `http://localhost:5173/`，检查：

- “二十种命盘人格”区域展示 5 张 collector-cover 预览卡。
- 可见的 5 个样板名为 `春笋`、`小夜灯`、`多肉`、`猫`、`水母`。
- 桌面宽度下预览卡不溢出。
- 约 `390px` 移动端宽度下 gallery 垂直堆叠，没有横向滚动。

- [ ] **步骤 7：浏览器检查生成后的卡片**

通过现有 landing 流程生成一张卡，或使用已有本地测试卡片路由。检查：

- `/card/:slug` 和 App 内 `卡片` 工作区都使用 collector-cover 布局。
- 插图显示在拱窗式微场景窗口中。
- 传播名 1 秒内可读。
- 金句位于三个参数 chip 之前。
- 导出图片仍为 3:4 PNG，卡片没有被裁掉。

- [ ] **步骤 8：提交验证修复**

如果验证中需要修复，只允许 stage 下面这组重设计相关文件：

```bash
git add \
  frontend/tests/card-placement.test.mjs \
  frontend/tests/landing-home.test.mjs \
  frontend/src/components/card/Card.jsx \
  frontend/src/components/card/CardWorkspace.jsx \
  frontend/src/components/card/CardSkeleton.jsx \
  frontend/src/styles/card.css \
  frontend/src/components/landing/LandingHome.jsx \
  frontend/src/components/landing/CosmicCardPreview.jsx \
  frontend/src/styles/landing.css \
  server/tests/unit/test_card_illustration_prompts.py \
  server/app/data/cards/illustration_prompts.json \
  server/app/data/cards/illustrations/01-chunsun.png \
  server/app/data/cards/illustrations/08-xiaoyedeng.png \
  server/app/data/cards/illustrations/11-duorou.png \
  server/app/data/cards/illustrations/16-mao.png \
  server/app/data/cards/illustrations/19-shuimu.png
git commit -m "fix(cards): address collector cover QA"
```

如果没有修复，不要创建空 commit。

---

## 自检记录

规格覆盖：

- 系列封套卡版式：Task 1-3。
- 微场景绘本插图方向：Task 5。
- 5 张样板 `01`、`08`、`11`、`16`、`19`：Task 4-5。
- 不改后端 payload：Task 2-3 继续使用 `card.illustration_url` 与现有字段。
- Landing 与结果卡视觉一致：Task 4 和 Task 6。
- 导出、构建、lint 验证：Task 6。

明确不包含：

- 不一次性生成全部 20 张插图。
- 不改卡片文案、子标签矩阵或后端类型映射。
- 不重设计合盘卡片。
- 不引入新的 UI 框架。
