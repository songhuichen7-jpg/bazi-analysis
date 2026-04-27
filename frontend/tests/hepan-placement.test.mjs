import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('app routes register /hepan/:slug', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /path="\/hepan\/:slug"/);
  assert.match(source, /HepanScreen/);
  assert.match(source, /\/hepan\/:slug/);
});

// Spec 03 §三 + 04b §四: hepan card front structure
test('hepan card surfaces label, subtags, dual roles, modifier, cta', () => {
  const source = fs.readFileSync(new URL('../src/components/hepan/HepanCard.jsx', import.meta.url), 'utf8');

  assert.match(source, /hepan-card-head/);
  assert.match(source, /hepan-state-pair/);          // ⚡⚡/⚡🔋
  assert.match(source, /hepan-card-illustration/);   // 6 大类占位插画
  assert.match(source, /hepan-card-label/);          // 关系标签 (大字)
  assert.match(source, /hepan-card-subtags/);        // 3 chip
  assert.match(source, /hepan-roles/);               // A/B 角色对照
  assert.match(source, /hepan-description/);
  assert.match(source, /hepan-modifier/);            // 04b 动态修饰
  assert.match(source, /hepan-cta/);
  assert.match(source, /hepan-card-foot/);
});

// Spec 质检 #4: hepan card front carries no raw bazi terminology
test('hepan card front carries no raw bazi terminology', () => {
  const source = fs.readFileSync(new URL('../src/components/hepan/HepanCard.jsx', import.meta.url), 'utf8');
  // Field references — only allow the high-level relationship/role fields
  assert.doesNotMatch(source, /hepan\.day_stem/);
  assert.doesNotMatch(source, /hepan\.ge_ju/);
  assert.doesNotMatch(source, /\.day_stem/);
  // Visible Chinese terms
  assert.doesNotMatch(source, /[>\s]日主[<\s]/);
  assert.doesNotMatch(source, /[>\s]格局[<\s]/);
});

test('hepan card uses 3:4 portrait aspect ratio', () => {
  const css = fs.readFileSync(new URL('../src/styles/hepan.css', import.meta.url), 'utf8');
  assert.match(css, /\.hepan-card[\s\S]*aspect-ratio:\s*3\s*\/\s*4/);
  // Pair theme color drives accent
  assert.match(css, /--card-accent:\s*var\(--theme/);
});

test('hepan invite landing page guides B with inviter context', () => {
  const source = fs.readFileSync(new URL('../src/components/hepan/HepanScreen.jsx', import.meta.url), 'utf8');
  assert.match(source, /邀请你来合盘/);
  assert.match(source, /hepan-invite/);
  assert.match(source, /看我们是哪种搭子/);
  assert.match(source, /原始日期不会被保存/);
});

test('CardActions invite-pair button is no longer disabled', () => {
  const source = fs.readFileSync(new URL('../src/components/card/CardActions.jsx', import.meta.url), 'utf8');
  // The hard-coded disabled / title="合盘功能即将开放" was removed
  assert.doesNotMatch(source, /合盘功能即将开放/);
  assert.match(source, /邀请合盘/);
});

test('CardWorkspace wires invite-pair button to /api/hepan/invite', () => {
  const source = fs.readFileSync(new URL('../src/components/card/CardWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /postHepanInvite/);
  assert.match(source, /\/hepan\//);
  assert.match(source, /handleInvitePair/);
});

test('relationIllustrations exports 6 category SVGs', () => {
  const source = fs.readFileSync(new URL('../src/components/hepan/relationIllustrations.jsx', import.meta.url), 'utf8');
  assert.match(source, /天作搭子/);
  assert.match(source, /镜像搭子/);
  assert.match(source, /同频搭子/);
  assert.match(source, /滋养搭子/);
  assert.match(source, /火花搭子/);
  assert.match(source, /互补搭子/);
});
