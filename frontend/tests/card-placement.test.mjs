import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('root route opens the visitor landing home; product shell lives at /app', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assert.match(source, /path="\/"\s+element=\{<LandingHome\s*\/>\}/);
  assert.match(source, /path="\/app\/\*"\s+element=\{<AppShell\s*\/>\}/);
  // The /app shell must not also claim "/" — that was the old funnel
  assert.doesNotMatch(source, /path="\/"\s+element=\{<AppShell\s*\/>\}/);
});

test('share card is placed as a first-class shell view', () => {
  const source = fs.readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8');

  assert.match(source, /view !== 'card'/);
  assert.match(source, /setView\('card'\)/);
  assert.match(source, />卡 片</);
});

test('card workspace frames sharing as a desktop preview surface', () => {
  const source = fs.readFileSync(new URL('../src/components/card/CardWorkspace.jsx', import.meta.url), 'utf8');

  assert.match(source, /card-stage-rail/);
  assert.match(source, /card-stage-mat/);
  assert.match(source, /card-side-kicker/);
});

// Spec: PM/specs/03_卡片与分享系统.md v4.0 §二
//   传播名(大字) + 十神后缀(小字) + 一句话 + 3 子标签 + 1 金句 + 品牌
test('share card front matches spec wireframe: cosmic name + suffix + subtags + golden line', () => {
  const source = fs.readFileSync(new URL('../src/components/card/Card.jsx', import.meta.url), 'utf8');

  assert.match(source, /share-card-head/);
  assert.match(source, /share-card-typeid/);          // 头部 03 / 20
  assert.match(source, /share-card-illustration/);    // 中央大图
  assert.match(source, /share-card-name/);            // 传播名 (最大字)
  assert.match(source, /share-card-suffix/);          // 十神后缀 (· … ·)
  assert.match(source, /share-card-oneliner/);        // 一句话
  assert.match(source, /share-card-subtags/);         // 3 子标签 chip
  assert.match(source, /share-card-golden/);          // 金句
  assert.match(source, /share-card-foot/);            // 底部品牌
});

// Spec 质检 #4: 卡片正面无裸命理术语
test('share card front carries no raw bazi terminology (spec quality check #4)', () => {
  const source = fs.readFileSync(new URL('../src/components/card/Card.jsx', import.meta.url), 'utf8');

  // 这些术语字段不应被渲染成可见文字 (data-* 属性允许保留作为 CSS hook)
  assert.doesNotMatch(source, /\{card\.day_stem\}/);
  assert.doesNotMatch(source, /\{card\.ge_ju\}/);
  assert.doesNotMatch(source, /\{card\.precision\}/);

  // 中文术语不出现在 JSX 文本中 (允许 base_name 等带'命'字的字段，
  // 但严格的'日主/格局/三柱/四柱'不应作为视觉标签出现)
  assert.doesNotMatch(source, /[>\s]日主[<\s]/);
  assert.doesNotMatch(source, /[>\s]格局[<\s]/);
  assert.doesNotMatch(source, /[三四]柱/);
});

// Spec §二 技术规格: 3:4 portrait, 1080×1440 @2x
test('share card uses 3:4 portrait aspect ratio (export 1080×1440)', () => {
  const css = fs.readFileSync(new URL('../src/styles/card.css', import.meta.url), 'utf8');

  assert.match(css, /\.share-card[\s\S]*aspect-ratio:\s*3\s*\/\s*4/);
  // 主题色驱动 — 暖色锚点
  assert.match(css, /--card-accent:\s*var\(--theme/);
  // 圆角符合 spec: 12-16px (我们用 18 在外层 + 12 在 chip)
  assert.match(css, /\.share-card[\s\S]*border-radius:\s*1[2-8]px/);
});

test('share card subtags render as 3 stable chips, allowing 2-line wrap', () => {
  // 02c 子标签矩阵实际字数中位数 7 字、最长 10 字 (与 spec #6 ≤5 字
  // 既存偏差)。chip 必须允许换行，否则会被 ellipsis 截断丢信息。
  const css = fs.readFileSync(new URL('../src/styles/card.css', import.meta.url), 'utf8');

  assert.match(css, /\.share-card-subtags[\s\S]*display:\s*grid/);
  assert.match(css, /\.share-card-subtags[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.share-card-subtags li[\s\S]*min-height:\s*42px/);
  assert.match(css, /\.share-card-subtags li[\s\S]*white-space:\s*normal/);
  assert.match(css, /\.share-card-subtags li[\s\S]*overflow-wrap:\s*anywhere/);
  // 不应再有 ellipsis 截断
  assert.doesNotMatch(css, /\.share-card-subtags li[\s\S]*text-overflow:\s*ellipsis/);
});

test('save image targets 1080-wide PNG to match spec export size', () => {
  const source = fs.readFileSync(new URL('../src/lib/saveImage.js', import.meta.url), 'utf8');

  assert.match(source, /TARGET_WIDTH\s*=\s*1080/);
});

test('invalid share card links render a designed recovery page', () => {
  const source = fs.readFileSync(new URL('../src/components/card/CardScreen.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/card.css', import.meta.url), 'utf8');

  assert.match(source, /card-error-screen/);
  assert.match(source, /这张命盘摘录暂时看不到/);
  assert.match(source, /回到首页/);
  assert.match(css, /\.card-error-screen/);
});

test('landing and auth screens avoid developer-only wording while previewing the product', () => {
  const formSource = fs.readFileSync(new URL('../src/components/FormScreen.jsx', import.meta.url), 'utf8');
  const authSource = fs.readFileSync(new URL('../src/components/AuthScreen.jsx', import.meta.url), 'utf8');

  assert.match(formSource, /landing-product-peek/);
  assert.match(formSource, /命盘档案/);
  assert.match(authSource, /先体验一下/);
  assert.doesNotMatch(authSource, /开发测试用|游客登录/);
});
