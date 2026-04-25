import { buildChartVisibility } from './chartVisibility.js';

function hasValue(value) {
  if (value == null) return false;
  return String(value).trim() !== '';
}

function getOpenDayun(dayun, dayunOpenIdx) {
  if (!Array.isArray(dayun) || dayunOpenIdx == null || dayunOpenIdx < 0) return null;
  return dayun[dayunOpenIdx] || null;
}

function getOpenLiunian(dayun, liunianOpenKey) {
  if (!liunianOpenKey) return null;
  const [dayunIndexRaw, yearIndexRaw] = String(liunianOpenKey).split('-');
  const dayunIndex = Number(dayunIndexRaw);
  const yearIndex = Number(yearIndexRaw);
  if (!Number.isFinite(dayunIndex) || !Number.isFinite(yearIndex)) return null;
  const step = Array.isArray(dayun) ? dayun[dayunIndex] : null;
  const year = step?.years?.[yearIndex] || null;
  if (!step || !year) return null;
  return { step, year };
}

function compact(values) {
  return values.filter((value) => hasValue(value));
}

export function mergePromptChips(primary = [], secondary = [], max = 4) {
  const seen = new Set();
  const merged = [];
  for (const value of [...primary, ...secondary]) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
    if (merged.length >= max) break;
  }
  return merged;
}

export function buildChatWorkspace({
  meta,
  force = [],
  guards = [],
  dayun = [],
  dayunOpenIdx = null,
  liunianOpenKey = null,
  verdicts,
} = {}) {
  const visibility = buildChartVisibility({ meta, force, guards });
  const liunianFocus = getOpenLiunian(dayun, liunianOpenKey);
  const dayunFocus = getOpenDayun(dayun, dayunOpenIdx);
  const verdictsStreaming = verdicts?.status === 'streaming';

  if (liunianFocus) {
    const { step, year } = liunianFocus;
    return {
      title: `${year.year} ${year.gz}`,
      lead: '',
      badges: compact([step?.gz ? `所属 ${step.gz}大运` : null, year?.ss]),
      contextLabel: `${year.year} ${year.gz}`,
      starterQuestions: [
        '这一年最该抓住什么机会',
        '这一年最大的压力点在哪',
        '这一年做决定要注意什么',
        '这一年感情/学业/工作怎么看',
      ],
    };
  }

  if (dayunFocus) {
    return {
      title: `${dayunFocus.gz}大运`,
      lead: '',
      badges: compact([dayunFocus.age != null ? `${dayunFocus.age}岁起` : null, dayunFocus.ss]),
      contextLabel: `${dayunFocus.gz}大运`,
      starterQuestions: [
        '这步大运的主线是什么',
        '这十年最该避开什么',
        '这步大运和原局哪里最冲',
        '这步大运对学业/事业意味着什么',
      ],
    };
  }

  return {
    title: '先看哪一块',
    lead: verdictsStreaming ? '' : '',
    badges: compact([
      visibility.dayMasterText || null,
      hasValue(meta?.geju) ? meta.geju : null,
      hasValue(meta?.yongshen) ? `用神 ${meta.yongshen}` : null,
    ]),
    contextLabel: null,
    starterQuestions: [
      '这张盘的核心矛盾是什么',
      '我最该先补哪一块',
      '接下来两年重点看什么',
      '感情和事业哪边更该先看',
    ],
  };
}
