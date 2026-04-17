import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { useAppStore } from '../src/store/useAppStore.js';
import { scrollAndFlash } from '../src/lib/parseRef.js';

const CORE_PATH = new URL('../../shards/core.md', import.meta.url);

function buildMessages(count, role = 'user', start = 0) {
  return Array.from({ length: count }, (_, index) => ({
    role,
    content: `m${start + index}`,
  }));
}

function buildChartEntry(extra = {}) {
  return {
    id: extra.id || 'chart_a',
    label: '测试命盘',
    createdAt: Date.now(),
    formData: null,
    paipan: null,
    force: [],
    guards: [],
    dayun: [],
    meta: null,
    birthInfo: null,
    sections: [],
    chatHistory: [],
    dayunCache: {},
    liunianCache: {},
    gua: { current: null, history: [] },
    verdicts: { status: 'idle', picks: [], items: [], lastError: null },
    ...extra,
  };
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalCSS = globalThis.CSS;
const originalSetTimeout = globalThis.setTimeout;

function resetStore() {
  useAppStore.getState().reset();
}

test.beforeEach(() => {
  resetStore();
});

test.afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.CSS = originalCSS;
  globalThis.setTimeout = originalSetTimeout;
});

test('scrollAndFlash rescues liunian refs from the active chart store data instead of window globals', () => {
  const year = 2026;
  let expanded = false;
  let timingClicks = 0;
  let dayunClicks = 0;
  let flashCount = 0;

  const dayunCell = {
    dataset: { idx: '1' },
    click() {
      dayunClicks += 1;
      expanded = true;
    },
  };
  const timingTab = {
    textContent: '流 年',
    click() {
      timingClicks += 1;
    },
  };
  const target = {
    scrollIntoView() {
      flashCount += 1;
    },
    classList: {
      add() {},
      remove() {},
    },
  };

  useAppStore.setState({
    currentId: 'chart_a',
    dayun: [],
    charts: {
      chart_a: buildChartEntry({
        id: 'chart_a',
        dayun: [
          { years: [{ year: 2024 }] },
          { years: [{ year }] },
        ],
      }),
    },
  });

  const legacyDayunKey = '__' + 'dayunData';
  globalThis.window = {
    [legacyDayunKey]: [{ years: [{ year: 1999 }] }],
  };
  globalThis.CSS = { escape: (value) => value };
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector === `[data-ref="liunian.${year}"]`) {
        return expanded ? target : null;
      }
      if (selector === '.dayun-cell[data-ref="dayun.1"]') {
        return dayunCell;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.dayun-cell[data-ref]') return [dayunCell];
      if (selector === '.view-item') return [timingTab];
      return [];
    },
    getElementById() {
      return null;
    },
  };

  assert.equal(scrollAndFlash(`liunian.${year}`), true);
  assert.equal(timingClicks, 1);
  assert.equal(dayunClicks, 1);
  assert.equal(flashCount, 1);
});

test('core shard forbids wrapping REF markers with backticks, quotes, or book-title punctuation', () => {
  const core = fs.readFileSync(CORE_PATH, 'utf8');

  assert.match(core, /不要用反引号、单双引号或书名号包裹 REF 标记/);
  assert.match(core, /不要写 `\[\[ref\|label\]\]`、"\[\[ref\|label\]\]"/);
});

test('restored oversized chat history stays intact until append, then truncates to CHAT_HISTORY_MAX while preserving a pinned first message', async () => {
  const { CHAT_HISTORY_MAX } = await import('../src/lib/constants.js');
  assert.equal(CHAT_HISTORY_MAX, 100);

  const greeting = { role: 'system', content: '系统提示' };
  const oldHistory = [greeting, ...buildMessages(149)];

  useAppStore.getState().restoreFromSession({
    version: 3,
    currentId: 'chart_a',
    charts: {
      chart_a: buildChartEntry({
        id: 'chart_a',
        chatHistory: oldHistory,
      }),
    },
  });

  assert.equal(useAppStore.getState().chatHistory.length, 150);

  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args);
  try {
    useAppStore.getState().pushChat({ role: 'assistant', content: 'latest' });
  } finally {
    console.info = originalInfo;
  }

  const trimmed = useAppStore.getState().chatHistory;
  assert.equal(trimmed.length, CHAT_HISTORY_MAX);
  assert.deepEqual(trimmed[0], greeting);
  assert.equal(trimmed.at(-1).content, 'latest');
  assert.ok(logs.some((args) => args[0] === '[chat] history truncated to' && args[1] === CHAT_HISTORY_MAX));
});

test('truncating the active chart after append does not mutate sibling chart histories', async () => {
  const { CHAT_HISTORY_MAX } = await import('../src/lib/constants.js');
  assert.equal(CHAT_HISTORY_MAX, 100);

  const chartAHistory = buildMessages(150);
  const chartBHistory = buildMessages(5, 'assistant', 900);

  useAppStore.setState({
    currentId: 'chart_a',
    charts: {
      chart_a: buildChartEntry({ id: 'chart_a', chatHistory: chartAHistory }),
      chart_b: buildChartEntry({ id: 'chart_b', chatHistory: chartBHistory }),
    },
    chatHistory: chartAHistory,
  });

  useAppStore.getState().pushChat({ role: 'user', content: 'new question' });
  useAppStore.getState().commitCurrentChart();

  const state = useAppStore.getState();
  assert.equal(state.charts.chart_a.chatHistory.length, CHAT_HISTORY_MAX);
  assert.deepEqual(state.charts.chart_b.chatHistory, chartBHistory);
});
