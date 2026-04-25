import test from 'node:test';
import assert from 'node:assert/strict';

import { applyChatProgressEvent, createChatProgress } from '../src/lib/chatProgress.js';

test('createChatProgress starts empty so fast questions do not show invented steps', () => {
  const progress = createChatProgress({ contextLabel: '戊午大运' });

  assert.equal(progress.phase, 'idle');
  assert.deepEqual(progress.receipts, []);
});

test('chat progress only records real intent and retrieval receipts', () => {
  let progress = createChatProgress();

  progress = applyChatProgressEvent(progress, {
    type: 'intent',
    intent: 'timing',
  });
  assert.equal(progress.phase, 'routing');
  assert.deepEqual(progress.receipts, [
    { key: 'intent', text: '方向：流年' },
  ]);

  progress = applyChatProgressEvent(progress, {
    type: 'retrieval',
    source: '穷通宝鉴 · 三秋甲木 + 子平真诠·论用神',
  });
  assert.equal(progress.phase, 'streaming');
  assert.deepEqual(progress.receipts, [
    { key: 'intent', text: '方向：流年' },
    { key: 'retrieval', text: '查阅：穷通宝鉴、子平真诠' },
  ]);

  progress = applyChatProgressEvent(progress, {
    type: 'delta',
  });
  assert.equal(progress.phase, 'streaming');
  assert.deepEqual(progress.receipts, [
    { key: 'intent', text: '方向：流年' },
    { key: 'retrieval', text: '查阅：穷通宝鉴、子平真诠' },
    { key: 'streaming', text: '输出中' },
  ]);
});

test('chat progress can record redirect and stop receipts without inventing extra stages', () => {
  let progress = createChatProgress();
  progress = applyChatProgressEvent(progress, { type: 'redirect', to: 'gua' });
  progress = applyChatProgressEvent(progress, { type: 'abort' });

  assert.equal(progress.phase, 'stopped');
  assert.deepEqual(progress.receipts, [
    { key: 'redirect', text: '转入起卦' },
    { key: 'abort', text: '已停止' },
  ]);
});

test('chat progress skips noisy default intent receipts when there is nothing worth surfacing yet', () => {
  let progress = createChatProgress();
  progress = applyChatProgressEvent(progress, { type: 'intent', intent: 'meta' });
  progress = applyChatProgressEvent(progress, { type: 'delta' });

  assert.equal(progress.phase, 'streaming');
  assert.deepEqual(progress.receipts, []);
});
