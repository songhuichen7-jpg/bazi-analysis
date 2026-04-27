import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('root route opens the main product shell instead of the standalone card funnel', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assert.match(source, /path="\/"\s+element=\{<AppShell\s*\/>\}/);
  assert.doesNotMatch(source, /path="\/"\s+element=\{<LandingScreen\s*\/>\}/);
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

test('share card uses an editorial archive structure', () => {
  const source = fs.readFileSync(new URL('../src/components/card/Card.jsx', import.meta.url), 'utf8');

  assert.match(source, /share-card-index/);
  assert.match(source, /share-card-title-row/);
  assert.match(source, /share-card-stamp/);
  assert.match(source, /subtag-index/);
});

test('share card preview is constrained to a desktop viewport', () => {
  const source = fs.readFileSync(new URL('../src/styles/card.css', import.meta.url), 'utf8');

  assert.match(source, /\.card-stage-mat[\s\S]*min-height:\s*0/);
  assert.match(source, /\.share-card[\s\S]*height:\s*clamp\(500px,\s*calc\(100vh - 280px\),\s*560px\)/);
  assert.match(source, /\.share-card \.subtags[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(source, /\.share-card \.subtags strong[\s\S]*white-space:\s*nowrap/);
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
