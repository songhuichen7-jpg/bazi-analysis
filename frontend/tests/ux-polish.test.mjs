import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChartVisibility } from '../src/lib/chartVisibility.js';
import { buildGenerationStatus, getWelcomeMessageState } from '../src/lib/chatStatus.js';

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

test('buildGenerationStatus reports streaming verdicts and sections without blocking chat', () => {
  const result = buildGenerationStatus({
    verdicts: { status: 'streaming', body: '正在生成中' },
    sections: [],
    sectionsLoading: true,
  });

  assert.deepEqual(result, {
    visible: true,
    text: '后台还在生成：判词 ⏳ · 五段 ⏳ · 大运待开 · 流年待开',
  });
});

test('getWelcomeMessageState prepends an in-flight hint while background reading is still generating', () => {
  const result = getWelcomeMessageState({
    verdicts: { status: 'streaming' },
    sectionsLoading: true,
  });

  assert.equal(
    result.lead,
    '我正在为你生成命盘的初读和判词...你现在就可以提问，我会先答你的，背景内容会在后台陆续到位。',
  );
  assert.equal(result.showDefaultGuidance, true);
});
