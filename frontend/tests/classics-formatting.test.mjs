import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClassicsDisplayItem } from '../src/lib/classics.js';


test('buildClassicsDisplayItem splits book chapter section and keeps clean paragraphs', () => {
  const item = buildClassicsDisplayItem({
    source: '穷通宝鉴 · 三秋甲木',
    scope: '七月甲木',
    text: '### 三秋甲木\n\n七月甲木，丁火为尊。\n\n若有癸水阻隔，便灭丁火。',
  });

  assert.equal(item.book, '穷通宝鉴');
  assert.equal(item.chapter, '三秋甲木');
  assert.equal(item.section, '七月甲木');
  assert.deepEqual(item.paragraphs, ['七月甲木，丁火为尊。', '若有癸水阻隔，便灭丁火。']);
});


test('buildClassicsDisplayItem hides internal scope tokens and strips duplicate chapter headings', () => {
  const item = buildClassicsDisplayItem({
    source: '子平真诠·论用神',
    scope: 'full',
    text: '## 论用神\n八字用神，专求月令。',
  });

  assert.equal(item.book, '子平真诠');
  assert.equal(item.chapter, '论用神');
  assert.equal(item.section, null);
  assert.deepEqual(item.paragraphs, ['八字用神，专求月令。']);
});


test('buildClassicsDisplayItem hides focused internal scope suffixes', () => {
  const item = buildClassicsDisplayItem({
    source: '滴天髓·衰旺',
    scope: 'full·focused',
    text: '能知衰旺之真机。',
  });

  assert.equal(item.book, '滴天髓');
  assert.equal(item.chapter, '衰旺');
  assert.equal(item.section, null);
  assert.deepEqual(item.paragraphs, ['能知衰旺之真机。']);
});


test('buildClassicsDisplayItem keeps the chart-facing match note', () => {
  const item = buildClassicsDisplayItem({
    source: '穷通宝鉴 · 三秋甲木',
    scope: '七月甲木',
    match: '本盘是甲日主、七月生，这一段先看调候用神。',
    text: '七月甲木，丁火为尊。',
  });

  assert.equal(item.match, '本盘是甲日主、七月生，这一段先看调候用神。');
  assert.equal(Object.hasOwn(item, 'fitType'), false);
});


test('buildClassicsDisplayItem prefers polished quote and keeps plain explanation', () => {
  const item = buildClassicsDisplayItem({
    source: '穷通宝鉴 · 三秋甲木',
    scope: '七月甲木',
    text: '七月甲木丁火为尊庚金次之若有癸水阻隔便灭丁火',
    quote: '七月甲木，丁火为尊，庚金次之。',
    plain: '七月甲木先看丁火调候，再看庚金成器。',
    match: '本盘甲木生申月，庚透月干，丁火只藏支内。',
    original_text: '七月甲木丁火为尊庚金次之若有癸水阻隔便灭丁火',
  });

  assert.deepEqual(item.paragraphs, ['七月甲木，丁火为尊，庚金次之。']);
  assert.equal(item.plain, '七月甲木先看丁火调候，再看庚金成器。');
  assert.equal(item.match, '本盘甲木生申月，庚透月干，丁火只藏支内。');
  assert.equal(item.originalText, '七月甲木丁火为尊庚金次之若有癸水阻隔便灭丁火');
});
