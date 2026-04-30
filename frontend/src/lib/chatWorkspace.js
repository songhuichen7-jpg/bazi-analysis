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

const DEFAULT_OPENING_GUIDE = {
  intro: '你想从哪个方向聊起？比如：',
  items: [
    { label: '整体', detail: '这盘命的底色是什么，核心结构长什么样' },
    { label: '性格', detail: '你是什么样的人，思维和情绪模式' },
    { label: '事业', detail: '适合什么方向，当前的困难是结构性的还是阶段性的' },
    { label: '财运', detail: '财的形态、来源、节奏' },
    { label: '感情', detail: '正缘什么样，什么时候可能出现，关系里的模式' },
    { label: '流年', detail: '最近几年或未来几年有什么重要变化' },
    { label: '人生课题', detail: '你这辈子在修什么，压力的意义是什么' },
    { label: '具体困惑', detail: '你现在有什么具体的事想问' },
  ],
  closing: '也可以什么都不选，我先从整体聊起，后面你随时追问。',
};

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
} = {}) {
  const visibility = buildChartVisibility({ meta, force, guards });
  const liunianFocus = getOpenLiunian(dayun, liunianOpenKey);
  const dayunFocus = getOpenDayun(dayun, dayunOpenIdx);

  if (liunianFocus) {
    const { step, year } = liunianFocus;
    return {
      title: `${year.year} ${year.gz}`,
      lead: '',
      badges: compact([step?.gz ? `所属 ${step.gz}大运` : null, year?.ss]),
      contextLabel: `${year.year} ${year.gz}`,
      starterQuestions: [
        '这一年最大的机会',
        '这一年最大的压力',
        '用一句话总结这一年',
        '这一年怎么取舍',
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
        '这十年的主线',
        '这十年最该避开什么',
        '用一句话形容这十年',
        '大运和原局哪里最冲',
      ],
    };
  }

  return {
    title: '命盘已经排好了',
    lead: '',
    badges: compact([
      visibility.dayMasterText || null,
      hasValue(meta?.geju) ? meta.geju : null,
      hasValue(meta?.yongshen) ? `用神 ${meta.yongshen}` : null,
    ]),
    contextLabel: null,
    openingGuide: DEFAULT_OPENING_GUIDE,
    starterQuestions: [
      '这盘像哪部电影',
      '这盘的核心矛盾',
      '接下来两年的关键节点',
      '我天生擅长什么',
    ],
  };
}
