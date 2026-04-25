import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChatWorkspace, mergePromptChips } from '../src/lib/chatWorkspace.js';


test('buildChatWorkspace summarizes the chart and suggests guided opening questions', () => {
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
  assert.equal(workspace.title, '先看哪一块');
  assert.deepEqual(workspace.badges, ['甲戌 · 身弱', '食神格', '用神 木']);
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
