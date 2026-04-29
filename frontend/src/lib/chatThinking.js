export const FORBIDDEN_THINKING_PATTERNS = [
  /正在回复/,
  /接住/,
  /陪你/,
  /我懂/,
  /我想/,
  /我正在/,
  /心理/,
  /客服/,
];

const DEFAULT_POOL = [
  '先看命盘主线…',
  '先把结构理清…',
  '看这张盘最重的一条线…',
  '把判断落到具体干支…',
  '先收拢重点…',
  '先分清主次…',
  '看哪里是根，哪里是表象…',
  '这次会多展开一点…',
  '先看原局，再看运势…',
  '把盘里的矛盾点对齐…',
  '看用神和格局能不能接上…',
  '先把强弱、月令和透干放在一起看…',
];

const CLASSICS_POOL = [
  '先对古籍旁证…',
  '看哪几句真正贴盘…',
  '核对原文和命盘对应…',
  '把古籍意思落回这张盘…',
  '先分清泛论和贴盘的句子…',
  '看古书说的是条件，还是结果…',
  '对照月令、日主和用神…',
  '先取能落到本盘的几句…',
  '看这段原文卡在哪个结构上…',
  '把原文里的关节拆开…',
  '先看古籍条件有没有齐…',
  '把旁证和盘面一条条对上…',
];

const TIMING_POOL = [
  '先看大运，再落到流年…',
  '看这一年推起哪条线…',
  '核对合冲和十神变化…',
  '分清阶段压力和长期趋势…',
  '看这一运补了什么、冲了什么…',
  '先看节奏，再看事件倾向…',
  '看流年有没有触到原局关键点…',
  '把年份放回十年大运里看…',
  '先分清机会、压力和消耗…',
  '看这一年是开局、转折还是收尾…',
  '先看天干发露，再看地支牵动…',
  '把这一年的轻重缓急排出来…',
];

const CAREER_POOL = [
  '先看格局、用神和官杀食伤…',
  '看事业线索从哪里出来…',
  '分清结构问题和阶段问题…',
  '看压力能不能转成权责…',
  '先看适合的方向，再看当前阻力…',
  '看杀、印、食伤怎么配合…',
  '把事业判断落到月令和大运…',
  '看是该借力，还是该破局…',
  '先看能力形态，再看位置选择…',
  '看这步运把哪种工作状态推起来…',
  '先看权责、资源和表达的比例…',
  '把职业方向和盘里的气势对齐…',
];

const RELATIONSHIP_POOL = [
  '先看配偶宫和关系星…',
  '看关系线被哪一步运推起来…',
  '分清稳定点和冲突点…',
  '看感情里的主动与被动…',
  '先看原局关系模式…',
  '再看当前运势有没有触发…',
  '看伴侣星落在哪里、受不受制…',
  '把关系判断落到日支和大运…',
  '看是缘分问题，还是相处结构问题…',
  '先看关系能不能承载现实压力…',
  '看亲密关系里哪一端更吃力…',
  '把关系节奏和当前运势对起来…',
];

const WEALTH_POOL = [
  '先看财星来源和承载力…',
  '看财从哪里来，又耗在哪里…',
  '分清财运、辛劳和机会…',
  '看这张盘适合怎么取财…',
  '先看能不能担财…',
  '再看财有没有被劫、被耗、被生…',
  '看收入方式和压力来源…',
  '把财星放回格局里看…',
  '看是资源型财，还是辛苦型财…',
  '先看财的路径，再看财的节奏…',
  '看钱是随权责来，还是随技能来…',
  '先分清进财、守财和耗财…',
];

const HEALTH_POOL = [
  '先看五行偏枯和受冲的位置…',
  '把身体提醒落到结构上…',
  '看哪一类压力最容易累积…',
  '先分清季节气候和原局偏性…',
  '看过旺、过弱之处在哪里…',
  '把情绪和身体线索分开看…',
  '先看被压住和被耗掉的五行…',
  '看当前运势有没有加重偏枯…',
];

const PERSONALITY_POOL = [
  '先看日主和十神组合…',
  '把性格两面性放回结构里看…',
  '看主导力量和反向牵制…',
  '先分清本性、压力和习惯反应…',
  '看哪些特质来自格局，哪些来自运势…',
  '把性情判断落到月令和日支…',
  '看内在驱动力从哪里来…',
  '先看自我感和外界压力怎么相处…',
];

const META_POOL = [
  '先把概念讲清楚…',
  '再落回这张盘里的位置…',
  '看这个术语成立的条件…',
  '先分清名词和实际结构…',
  '把规则和本盘对应起来…',
  '看古法讲的是哪一层意思…',
  '先拆条件，再看结果…',
  '把概念放回四柱里看…',
];

const APPEARANCE_POOL = [
  '先看日主五行和月令气候…',
  '把形象判断落到主导十神…',
  '看骨架、气色和气质从哪里来…',
  '先分清五行底色和运势修饰…',
  '看古法相貌描述对应哪一端…',
  '把外形线索和性情结构一起看…',
];

const CHAT_POOL = [
  '稍等一下…',
  '先看这句的重点…',
  '把问题理清楚一点…',
  '看从哪里说起更清楚…',
  '先顺一下脉络…',
  '看重点落在哪里…',
  '先把前后意思对齐…',
  '把话题收拢一下…',
  '换个更清楚的角度看…',
  '先分清这句里的主线…',
];

export const THINKING_COPY_POOLS = {
  default: DEFAULT_POOL,
  classics: CLASSICS_POOL,
  timing: TIMING_POOL,
  liunian: TIMING_POOL,
  dayun_step: TIMING_POOL,
  career: CAREER_POOL,
  relationship: RELATIONSHIP_POOL,
  wealth: WEALTH_POOL,
  health: HEALTH_POOL,
  personality: PERSONALITY_POOL,
  meta: META_POOL,
  appearance: APPEARANCE_POOL,
  special_geju: META_POOL,
  chitchat: CHAT_POOL,
};

function normalizeIntent(intent) {
  return THINKING_COPY_POOLS[intent] ? intent : 'default';
}

function pickOffset(seed, length) {
  const raw = Number.isFinite(Number(seed)) ? Number(seed) : 0;
  return Math.abs(Math.floor(raw)) % Math.max(1, length);
}

function rotate(values, offset) {
  if (!values.length) return [];
  const cut = offset % values.length;
  return values.slice(cut).concat(values.slice(0, cut));
}

export function buildThinkingSequence({
  intent = null,
  hasClassics = false,
  previousFirst = '',
  seed = 0,
  maxLines = 3,
} = {}) {
  const normalized = normalizeIntent(intent);
  const basePool = THINKING_COPY_POOLS[normalized] || THINKING_COPY_POOLS.default;
  const pool = normalized !== 'chitchat' && hasClassics
    ? [...THINKING_COPY_POOLS.classics, ...basePool]
    : basePool;
  const unique = Array.from(new Set(pool)).filter(Boolean);
  if (!unique.length) return [];

  let rotated = rotate(unique, pickOffset(seed, unique.length));
  if (previousFirst && rotated[0] === previousFirst && rotated.length > 1) {
    rotated = rotate(rotated, 1);
  }
  return rotated.slice(0, Math.max(1, maxLines));
}
