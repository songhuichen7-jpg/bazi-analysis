import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  compactChartContext,
  pickChartSlice,
  buildLiunianMessages,
  resolveCurrentTiming,
} = require('../prompts.js');

function makeChart() {
  return {
    META: {
      today: { ymd: '2026-04-15', yearGz: '丙午' },
      rizhu: '甲木',
      dayStrength: '身强',
      geju: '七杀格',
      yongshen: '火土',
      input: { year: 1990, month: 6, day: 1, hour: 12, minute: 0, city: '北京', gender: 'male' },
    },
    FORCE: [
      { name: '七杀', val: 9.8 },
      { name: '食神', val: 5.1 },
      { name: '正印', val: 4.7 },
    ],
    DAYUN: [
      {
        age: 26,
        gz: '戊戌',
        ss: '劫财',
        startYear: 2018,
        endYear: 2027,
        current: false,
        years: [
          { year: 2025, gz: '乙巳', ss: '劫财', current: false },
          { year: 2026, gz: '丙午', ss: '食神', current: false },
          { year: 2086, gz: '丙午', ss: '食神', current: true },
        ],
      },
      {
        age: 36,
        gz: '己亥',
        ss: '比肩',
        startYear: 2028,
        endYear: 2037,
        current: true,
        years: [
          { year: 2028, gz: '戊申', ss: '比肩', current: false },
        ],
      },
    ],
  };
}

test('prompt timing resolution prefers actual 2026 range over stale current flags', () => {
  const chart = makeChart();
  const timing = resolveCurrentTiming(chart);

  assert.equal(timing.currentDayun?.gz, '戊戌');
  assert.equal(timing.currentDayunIndex, 0);
  assert.equal(timing.currentLiunian?.year, 2026);
  assert.equal(timing.currentLiunian?.gz, '丙午');
});

test('compact chart context prints 2026 current liunian instead of stale 2086 twin ganzhi', () => {
  const context = compactChartContext(makeChart());

  assert.match(context, /当前大运：26岁起 戊戌（劫财） 2018–2027/);
  assert.match(context, /当前流年：2026 丙午（食神）/);
  assert.doesNotMatch(context, /2086 丙午/);
});

test('career chart slice keeps the actual current and next dayun', () => {
  const slice = pickChartSlice(makeChart(), 'career');

  assert.equal(slice.DAYUN.length, 2);
  assert.equal(slice.DAYUN[0].gz, '戊戌');
  assert.equal(slice.DAYUN[1].gz, '己亥');
});

test('timing chart slice windows around the actual current dayun', () => {
  const slice = pickChartSlice(makeChart(), 'timing');

  assert.equal(slice.DAYUN.length, 2);
  assert.equal(slice.DAYUN[0].gz, '戊戌');
  assert.equal(slice.DAYUN[1].gz, '己亥');
});

test('liunian messages mark the actual year as current even when stale flags disagree', () => {
  const chart = makeChart();
  const messages = buildLiunianMessages({ chart, dayunIdx: 0, yearIdx: 1 });
  const system = messages[0].content;

  assert.match(system, /【当前大运】26岁起 戊戌（劫财） 2018–2027 ← 正走/);
  assert.match(system, /【本年】2026年 丙午（食神） ← 今年/);
  assert.doesNotMatch(system, /2086/);
});
