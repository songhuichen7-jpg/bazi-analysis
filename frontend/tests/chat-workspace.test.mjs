import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildChatWorkspace, mergePromptChips } from '../src/lib/chatWorkspace.js';


test('buildChatWorkspace summarizes the chart and provides a textual opening guide', () => {
  const workspace = buildChatWorkspace({
    meta: {
      rizhu: '甲戌',
      dayStrength: '身弱',
      geju: '食神格',
      yongshen: '木',
    },
    dayun: [],
    dayunOpenIdx: null,
    liunianOpenKey: null,
    verdicts: { status: 'done' },
  });

  assert.equal(workspace.contextLabel, null);
  assert.equal(workspace.title, '命盘已经排好了');
  assert.deepEqual(workspace.badges, ['甲戌 · 身弱', '食神格', '用神 木']);
  assert.equal(workspace.openingGuide.intro, '你想从哪个方向聊起？比如：');
  assert.equal(workspace.openingGuide.items[0].label, '整体');
  assert.equal(workspace.openingGuide.items[0].detail, '这盘命的底色是什么，核心结构长什么样');
  assert.match(workspace.openingGuide.closing, /我先从整体聊起/);
  assert.deepEqual(workspace.starterQuestions.slice(0, 3), [
    '这张盘的核心矛盾是什么',
    '我最该先补哪一块',
    '接下来两年重点看什么',
  ]);
});


test('buildChatWorkspace follows the open dayun context when a step is selected', () => {
  const workspace = buildChatWorkspace({
    meta: { rizhu: '甲戌' },
    dayun: [
      { age: 8, gz: '己未', ss: '正财/正财', years: [] },
      { age: 18, gz: '戊午', ss: '偏财/伤官', years: [] },
    ],
    dayunOpenIdx: 1,
    liunianOpenKey: null,
    verdicts: { status: 'done' },
  });

  assert.equal(workspace.contextLabel, '戊午大运');
  assert.equal(workspace.title, '戊午大运');
  assert.deepEqual(workspace.badges, ['18岁起', '偏财/伤官']);
  assert.equal(workspace.starterQuestions[0], '这步大运的主线是什么');
});


test('buildChatWorkspace prioritizes the open liunian context over the wider dayun', () => {
  const workspace = buildChatWorkspace({
    meta: { rizhu: '甲戌' },
    dayun: [
      { age: 18, gz: '戊午', ss: '偏财/伤官', years: [{ year: 2014, gz: '甲午', ss: '比肩' }] },
    ],
    dayunOpenIdx: 0,
    liunianOpenKey: '0-0',
    verdicts: { status: 'done' },
  });

  assert.equal(workspace.contextLabel, '2014 甲午');
  assert.equal(workspace.title, '2014 甲午');
  assert.deepEqual(workspace.badges, ['所属 戊午大运', '比肩']);
  assert.equal(workspace.starterQuestions[0], '这一年最该抓住什么机会');
});


test('mergePromptChips keeps context-first ordering and removes duplicates', () => {
  const chips = mergePromptChips(
    ['这张盘的核心矛盾是什么', '接下来两年重点看什么'],
    ['接下来两年重点看什么', '我适合什么伴侣', '先看整体主线'],
    4,
  );

  assert.deepEqual(chips, [
    '这张盘的核心矛盾是什么',
    '接下来两年重点看什么',
    '我适合什么伴侣',
    '先看整体主线',
  ]);
});


test('empty chat welcome renders text instead of question cards', () => {
  const source = fs.readFileSync(new URL('../src/components/Chat.jsx', import.meta.url), 'utf8');

  assert.match(source, /chat-opening-guide/);
  assert.doesNotMatch(source, /chat-guide-grid/);
  assert.doesNotMatch(source, /chat-guide-btn/);
});


test('chat turns expose edit and regenerate controls', () => {
  const source = fs.readFileSync(new URL('../src/components/Chat.jsx', import.meta.url), 'utf8');

  assert.match(source, /prepareChatRegeneration/);
  assert.match(source, /editingUserIndex/);
  assert.match(source, /修改问题/);
  assert.match(source, /重新回答/);
});
