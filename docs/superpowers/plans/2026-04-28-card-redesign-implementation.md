# Card Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the confirmed personal share-card redesign: a premium series-cover card layout with five micro-scene illustration samples.

**Architecture:** Keep the existing card API payload and static illustration URL contract. Update the React card markup and CSS to render a collector-style cover card, update the landing preview to match, and add a small prompt manifest for the five AI illustration samples so full 20-type generation can later follow the same rules.

**Tech Stack:** React 19, Vite, plain CSS, Node `node:test`, FastAPI static files for `/static/cards/illustrations/`.

---

## File Structure

- `frontend/src/components/card/Card.jsx`  
  Owns the runtime personal share card DOM. It must keep rendering `card.illustration_url`, `card.cosmic_name`, `card.suffix`, `card.one_liner`, `card.subtags`, and `card.golden_line`; no backend payload change.

- `frontend/src/styles/card.css`  
  Owns the share card, desktop card workspace, save overlay, preview page, and card skeleton styling. Only the `share-card` visual section and related empty/skeleton responsive styles should be changed.

- `frontend/src/components/landing/CosmicCardPreview.jsx`  
  Owns static landing card previews. It should mirror the new series-cover composition without depending on card API data.

- `frontend/src/components/landing/LandingHome.jsx`  
  Owns the landing showcase list. It should show the five confirmed sample types: `01`, `08`, `11`, `16`, `19`.

- `frontend/src/styles/landing.css`  
  Owns landing gallery layout and static preview card CSS. It should move the showcase from the current four-card row to a five-card responsive collector grid.

- `server/app/data/cards/illustration_prompts.json`  
  New non-runtime prompt manifest for the five sample illustrations. It makes the AI asset direction explicit and testable.

- `server/app/data/cards/illustrations/{01-chunsun.png,08-xiaoyedeng.png,11-duorou.png,16-mao.png,19-shuimu.png}`  
  Replace these five current sample files with generated micro-scene illustrations. Leave the other 15 image files untouched.

- `frontend/tests/card-placement.test.mjs`  
  Source-level contract tests for the new card DOM and CSS.

- `frontend/tests/landing-home.test.mjs`  
  Source-level contract tests for the five sample landing preview and micro-scene illustration kinds.

- `server/tests/unit/test_card_illustration_prompts.py`  
  New test that validates the prompt manifest covers the five sample images and avoids forbidden style directions.

---

### Task 1: Add Card Redesign Contract Tests

**Files:**
- Modify: `frontend/tests/card-placement.test.mjs`

- [ ] **Step 1: Add failing tests for the new card DOM contract**

Append these tests after the existing `share card front matches spec wireframe` test:

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

- [ ] **Step 2: Update the existing subtags test expectation**

In the existing `share card subtags render as 3 chips...` test, replace the flex expectations with grid expectations:

```js
assert.match(css, /\.share-card-subtags[\s\S]*display:\s*grid/);
assert.match(css, /\.share-card-subtags[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /\.share-card-subtags li[\s\S]*min-width:\s*0/);
assert.match(css, /\.share-card-subtags li[\s\S]*white-space:\s*normal/);
```

Remove these old assertions from that test:

```js
assert.match(css, /\.share-card-subtags[\s\S]*display:\s*flex/);
assert.match(css, /\.share-card-subtags[\s\S]*flex-wrap:\s*nowrap/);
assert.match(css, /\.share-card-subtags li[\s\S]*flex:\s*1\s*1\s*0/);
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd frontend && node --test tests/card-placement.test.mjs
```

Expected: FAIL. The new tests should complain about missing `share-card-edition`, `share-card-scene`, and/or collector-cover CSS.

- [ ] **Step 4: Commit the failing test**

```bash
git add frontend/tests/card-placement.test.mjs
git commit -m "test(cards): lock collector cover card contract"
```

---

### Task 2: Update Runtime Card Markup

**Files:**
- Modify: `frontend/src/components/card/Card.jsx`
- Modify: `frontend/src/components/card/CardWorkspace.jsx`

- [ ] **Step 1: Replace `Card.jsx` with the collector-cover structure**

Replace the component body in `frontend/src/components/card/Card.jsx` with this implementation, keeping the existing imports and `forwardRef` wrapper:

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

This keeps `share-card-illustration`, `share-card-name`, `share-card-suffix`, `share-card-oneliner`, `share-card-golden`, `share-card-subtags`, and `share-card-foot` so existing tests and save/export hooks still understand the card.

- [ ] **Step 2: Update the empty card preview markup**

In `frontend/src/components/card/CardWorkspace.jsx`, replace the empty-card figure and title/golden section with:

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

Also replace the empty footer with:

```jsx
<footer className="share-card-foot">
  <span className="share-card-edition">COLLECTOR EDITION</span>
  <span>youshi.app</span>
</footer>
```

- [ ] **Step 3: Run the focused test**

Run:

```bash
cd frontend && node --test tests/card-placement.test.mjs
```

Expected: still FAIL, because CSS is not updated yet. DOM-related assertions should now pass.

- [ ] **Step 4: Commit the markup**

```bash
git add frontend/src/components/card/Card.jsx frontend/src/components/card/CardWorkspace.jsx
git commit -m "feat(cards): render collector cover card markup"
```

---

### Task 3: Rewrite Runtime Card CSS

**Files:**
- Modify: `frontend/src/styles/card.css`

- [ ] **Step 1: Replace the share-card visual section**

In `frontend/src/styles/card.css`, replace the block from `/* ── Share card (3:4 portrait)` through the end of `.share-card-foot` with this CSS:

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

- [ ] **Step 2: Replace empty-state styles**

Replace the existing `.share-card-illustration-empty`, `.share-card-subtags-empty`, and `.share-card-golden-empty` rules with:

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

- [ ] **Step 3: Update the card skeleton for the cover shape**

Replace the `.card-skeleton` children sizing rules with:

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

Then update `frontend/src/components/card/CardSkeleton.jsx` in this same task so it includes a scene shimmer:

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

Add `frontend/src/components/card/CardSkeleton.jsx` to this task's file list when committing.

- [ ] **Step 4: Adjust mobile sizing**

In the existing `@media (max-width: 820px)` block, keep `.share-card { width: min(420px, 100%); }` and replace the name sizing rule with:

```css
.share-card-name {
  font-size: 42px;
}

.share-card-illustration,
.share-card-scene {
  width: min(70%, 260px);
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
cd frontend && node --test tests/card-placement.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit runtime card styling**

```bash
git add frontend/src/styles/card.css frontend/src/components/card/CardSkeleton.jsx
git commit -m "style(cards): apply collector cover visual system"
```

---

### Task 4: Update Landing Preview To Match The New Card System

**Files:**
- Modify: `frontend/tests/landing-home.test.mjs`
- Modify: `frontend/src/components/landing/LandingHome.jsx`
- Modify: `frontend/src/components/landing/CosmicCardPreview.jsx`
- Modify: `frontend/src/styles/landing.css`

- [ ] **Step 1: Update landing tests first**

In `frontend/tests/landing-home.test.mjs`, replace the existing `CosmicCardPreview renders 5 illustration kinds...` test with:

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

- [ ] **Step 2: Run landing test to verify it fails**

Run:

```bash
cd frontend && node --test tests/landing-home.test.mjs
```

Expected: FAIL because the static preview still uses old illustration keys and only four showcase cards.

- [ ] **Step 3: Update the showcase data**

In `frontend/src/components/landing/LandingHome.jsx`, replace `SHOWCASE_TYPES` with:

```js
const SHOWCASE_TYPES = [
  { id: '01', name: '春笋', suffix: '反脆弱型', oneLiner: '越压越往上长', theme: '#2D6A4F', illust: 'chunsun' },
  { id: '08', name: '小夜灯', suffix: '灵感深潜者', oneLiner: '光不大，但一直亮着', theme: '#2B6CB0', illust: 'xiaoyedeng' },
  { id: '11', name: '多肉', suffix: '慢热养成系', oneLiner: '慢慢长，急不来的', theme: '#D4A574', illust: 'duorou' },
  { id: '16', name: '猫', suffix: '隐形学霸', oneLiner: '不是冷，是在挑人', theme: '#6B4E99', illust: 'mao' },
  { id: '19', name: '水母', suffix: '边界感艺术家', oneLiner: '随波不逐流', theme: '#4AC4C0', illust: 'shuimu' },
];
```

- [ ] **Step 4: Replace `CosmicCardPreview.jsx` with micro-scene preview markup**

Replace the file contents after the comment header with:

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

- [ ] **Step 5: Update landing preview CSS**

In `frontend/src/styles/landing.css`, find the existing landing card preview rules and update them to match the runtime card structure. If the file has old `.landing-card-illustration svg` rules, replace that preview block with:

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

Then add the small CSS scene shapes below it:

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

In the existing `@media (max-width: 900px)` block, add:

```css
.landing-gallery-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

In the existing narrow mobile block, add:

```css
.landing-gallery-row {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 6: Run landing tests**

Run:

```bash
cd frontend && node --test tests/landing-home.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit landing preview update**

```bash
git add frontend/tests/landing-home.test.mjs frontend/src/components/landing/LandingHome.jsx frontend/src/components/landing/CosmicCardPreview.jsx frontend/src/styles/landing.css
git commit -m "style(landing): preview collector cover cards"
```

---

### Task 5: Add AI Illustration Prompt Manifest And Five Sample Assets

**Files:**
- Create: `server/tests/unit/test_card_illustration_prompts.py`
- Create: `server/app/data/cards/illustration_prompts.json`
- Modify: `server/app/data/cards/illustrations/01-chunsun.png`
- Modify: `server/app/data/cards/illustrations/08-xiaoyedeng.png`
- Modify: `server/app/data/cards/illustrations/11-duorou.png`
- Modify: `server/app/data/cards/illustrations/16-mao.png`
- Modify: `server/app/data/cards/illustrations/19-shuimu.png`

- [ ] **Step 1: Write the prompt manifest test**

Create `server/tests/unit/test_card_illustration_prompts.py`:

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

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
uv run --package server pytest -q server/tests/unit/test_card_illustration_prompts.py
```

Expected: FAIL because `illustration_prompts.json` does not exist yet.

- [ ] **Step 3: Create the prompt manifest**

Create `server/app/data/cards/illustration_prompts.json`:

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

- [ ] **Step 4: Run prompt manifest test**

Run:

```bash
uv run --package server pytest -q server/tests/unit/test_card_illustration_prompts.py
```

Expected: PASS.

- [ ] **Step 5: Generate the five AI illustrations**

Use the prompt value from each manifest entry exactly. Generate square PNG illustrations and save them to these paths:

```text
server/app/data/cards/illustrations/01-chunsun.png
server/app/data/cards/illustrations/08-xiaoyedeng.png
server/app/data/cards/illustrations/11-duorou.png
server/app/data/cards/illustrations/16-mao.png
server/app/data/cards/illustrations/19-shuimu.png
```

Asset requirements:

- PNG format.
- At least `1024 × 1024`.
- No embedded text, logo, watermark, zodiac symbols, tarot cards, crystal balls, or heavy ancient ornament.
- Subject sits in the upper/middle of the image and still reads when cropped by an arched card window.

- [ ] **Step 6: Verify asset dimensions locally**

Run:

```bash
sips -g pixelWidth -g pixelHeight \
  server/app/data/cards/illustrations/01-chunsun.png \
  server/app/data/cards/illustrations/08-xiaoyedeng.png \
  server/app/data/cards/illustrations/11-duorou.png \
  server/app/data/cards/illustrations/16-mao.png \
  server/app/data/cards/illustrations/19-shuimu.png
```

Expected: each file reports `pixelWidth` and `pixelHeight` of at least `1024`.

- [ ] **Step 7: Commit prompt manifest and sample assets**

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

### Task 6: Full Verification And Visual QA

**Files:**
- No planned source edits. Only fix issues discovered by verification.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd frontend && node --test tests/card-placement.test.mjs tests/landing-home.test.mjs tests/save-image.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the new server prompt test**

Run:

```bash
uv run --package server pytest -q server/tests/unit/test_card_illustration_prompts.py
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS with Vite build output and no CSS/JS compile errors.

- [ ] **Step 4: Run frontend lint**

Run:

```bash
cd frontend && npm run lint
```

Expected: PASS.

- [ ] **Step 5: Start the app for browser QA**

In one terminal:

```bash
npm run dev:back
```

In another terminal:

```bash
npm run dev:front
```

Expected:

- Backend on `http://127.0.0.1:3101`
- Frontend on `http://localhost:5173`

- [ ] **Step 6: Browser-check the landing page**

Open `http://localhost:5173/`.

Check:

- The “二十种命盘人格” section shows five collector-cover previews.
- The five visible sample names are `春笋`, `小夜灯`, `多肉`, `猫`, `水母`.
- Preview cards do not overflow at desktop width.
- At mobile width around `390px`, the gallery stacks without horizontal scroll.

- [ ] **Step 7: Browser-check a generated card**

Use the existing landing flow to create a card, or hit a known local card route if test data exists.

Check:

- `/card/:slug` and the in-app `卡片` workspace both render the collector-cover layout.
- The illustration is framed in an arched micro-scene window.
- The propagation name is readable in one second.
- Golden line appears before the three parameter chips.
- Export image still produces a 3:4 PNG and the card is not clipped.

- [ ] **Step 8: Commit any verification fixes**

If verification required fixes, stage only redesign files from this exact allowlist:

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

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Series-cover layout: Tasks 1-3.
- Micro-scene illustration direction: Task 5.
- Five sample types `01`, `08`, `11`, `16`, `19`: Tasks 4-5.
- No backend payload change: Tasks 2-3 keep `card.illustration_url` and existing fields.
- Landing/result visual consistency: Task 4 and Task 6.
- Export/build verification: Task 6.

Scope kept out:

- No all-20 illustration generation.
- No card copy, subtype, or backend mapping changes.
- No hepan card redesign.
- No new UI framework.
