import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildChartVisibility } from '../src/lib/chartVisibility.js';
import { buildGenerationStatus, getWelcomeMessageState } from '../src/lib/chatStatus.js';
import { buildUserMenuProfile, reduceUserMenuOpen } from '../src/lib/userMenu.js';
import { getShellTopbarClassName } from '../src/lib/shellChrome.js';

test('buildChartVisibility hides engine fields that are absent and drops dangling separators', () => {
  const result = buildChartVisibility({
    meta: {
      rizhu: '甲戌',
      dayStrength: '',
      geju: '—',
      gejuNote: '',
      yongshen: '',
    },
    force: [],
    guards: [],
  });

  assert.deepEqual(result, {
    showDayStrengthDetails: false,
    showGeju: false,
    showYongshen: false,
    showForce: false,
    showGuards: false,
    dayMasterText: '甲戌',
    readingHeadline: '甲戌',
    readingSummary: '日主 甲戌',
  });
});

test('buildChartVisibility suppresses internal guard hints even when engine data exists', () => {
  const result = buildChartVisibility({
    meta: {
      rizhu: '甲戌',
      dayStrength: '身弱',
      geju: '食神格',
      yongshen: '木',
    },
    force: [{ name: '比肩', val: 4.4 }],
    guards: [{ type: 'liuhe', note: '子丑 六合 化 土' }],
  });

  assert.equal(result.showForce, true);
  assert.equal(result.showGuards, false);
});

test('buildGenerationStatus only surfaces background verdict generation in chat', () => {
  const result = buildGenerationStatus({
    verdicts: { status: 'streaming', body: '正在生成中' },
    dayunStreaming: true,
    liunianStreaming: true,
  });

  assert.deepEqual(result, {
    visible: true,
    text: '后台还在生成：古籍判词 ⏳',
  });
});

test('buildGenerationStatus stays hidden for timing-page generation alone', () => {
  const result = buildGenerationStatus({
    dayunStreaming: true,
    liunianStreaming: true,
  });

  assert.deepEqual(result, {
    visible: false,
    text: '',
  });
});

test('getWelcomeMessageState prepends an in-flight hint while classical verdicts are still generating', () => {
  const result = getWelcomeMessageState({
    verdicts: { status: 'streaming' },
  });

  assert.equal(
    result.lead,
    '我正在为你研读古籍判词。你现在就可以先提问，我会继续在后台把依据补齐。',
  );
  assert.equal(result.showDefaultGuidance, true);
});

test('reduceUserMenuOpen toggles open and closes on outside interactions', () => {
  assert.equal(reduceUserMenuOpen(false, { type: 'toggle' }), true);
  assert.equal(reduceUserMenuOpen(true, { type: 'toggle' }), false);
  assert.equal(reduceUserMenuOpen(true, { type: 'outside' }), false);
  assert.equal(reduceUserMenuOpen(true, { type: 'logout' }), false);
});

test('buildUserMenuProfile prefers nickname initial and masks known phone digits', () => {
  const result = buildUserMenuProfile({
    nickname: '测试用户',
    phone_last4: '1833',
    phone: '+8613800131833',
  });

  assert.deepEqual(result, {
    avatarLabel: '测',
    displayName: '测试用户',
    maskedPhone: '+86 138 *** 1833',
  });
});

test('getShellTopbarClassName adds user-menu offset only when avatar is shown in shell', () => {
  assert.equal(getShellTopbarClassName(false), 'left-topbar-inner');
  assert.equal(getShellTopbarClassName(true), 'left-topbar-inner with-user-menu');
});

test('avatar trigger stays chrome-free so only the circular avatar is visible', () => {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(css, /\.user-menu-trigger\s*\{[^}]*border:\s*none;/s);
  assert.match(css, /\.user-menu-trigger\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /\.user-menu-trigger\s*\{[^}]*box-shadow:\s*none;/s);
});

test('assistant replies stay visually plain instead of sitting inside a bordered card', () => {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(css, /\.msg-ai-card\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.msg-ai-card\s*\{[^}]*border:\s*none;/s);
  assert.match(css, /\.msg-ai-card\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /\.msg-ai-card\s*\{[^}]*box-shadow:\s*none;/s);
});

test('primary shell navigation and icon-only controls expose button semantics', () => {
  const shell = fs.readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8');
  const chartSwitcher = fs.readFileSync(new URL('../src/components/ChartSwitcher.jsx', import.meta.url), 'utf8');
  const conversationSwitcher = fs.readFileSync(new URL('../src/components/ConversationSwitcher.jsx', import.meta.url), 'utf8');
  const form = fs.readFileSync(new URL('../src/components/FormScreen.jsx', import.meta.url), 'utf8');

  assert.match(shell, /<button[\s\S]*aria-pressed=\{view === 'chart'\}[\s\S]*>命 盘<\/button>/);
  assert.match(shell, /aria-label="清空所有命盘和聊天记录"/);
  assert.match(chartSwitcher, /aria-label="重命名命盘"/);
  assert.match(chartSwitcher, /aria-label="删除命盘"/);
  assert.match(conversationSwitcher, /aria-label="重命名对话"/);
  assert.match(conversationSwitcher, /aria-label="删除对话"/);
  assert.match(form, /<button[\s\S]*className="back-link"[\s\S]*>← 返回<\/button>/);
});
