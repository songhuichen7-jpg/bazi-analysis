import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChartVisibility } from '../src/lib/chartVisibility.js';

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
