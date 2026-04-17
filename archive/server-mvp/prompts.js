/**
 * Prompt builder — loads skill files once at boot, constructs system prompt.
 *
 * Strategy (v1):
 *   - SKILL.md (methodology + output style)            — always in
 *   - conversation-guide.md (tone, pacing, dictio)     — always in
 *   - chart context (compact, per-request)             — injected into system
 *   - advanced-techniques.md / classical-references.md — NOT included by default
 *     (too big; will add RAG later)
 *
 * If files are missing we fall back to a minimal inline prompt.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'SKILL.md');
const GUIDE_PATH = path.join(ROOT, 'conversation-guide.md');

let SKILL_TEXT = '';
let GUIDE_TEXT = '';
try { SKILL_TEXT = fs.readFileSync(SKILL_PATH, 'utf8'); } catch (e) { /* missing */ }
try { GUIDE_TEXT = fs.readFileSync(GUIDE_PATH, 'utf8'); } catch (e) { /* missing */ }

// Intent-specific shards (replace bulky SKILL.md + conversation-guide for chat expert).
const SHARD_DIR = path.join(ROOT, 'shards');
const SHARDS = {};
try {
  for (const f of fs.readdirSync(SHARD_DIR)) {
    if (!f.endsWith('.md')) continue;
    SHARDS[f.replace(/\.md$/, '')] = fs.readFileSync(path.join(SHARD_DIR, f), 'utf8');
  }
} catch (e) { /* no shards dir */ }

function loadShardsFor(intent) {
  // Always include core; append intent-specific if exists.
  const out = [];
  if (SHARDS.core) out.push(SHARDS.core);
  if (intent && SHARDS[intent]) out.push(SHARDS[intent]);
  return out.join('\n\n---\n\n');
}

const FALLBACK_STYLE = `
你是一位懂命理的朋友。回复要：
1. 用聊天而非报告的语气；术语必须配白话翻译
2. 命理判断要有依据（命盘数据 + 古籍/经验）；不做空泛心灵鸡汤
3. 识别"真实边界"与"防御性回避"——前者尊重，后者温和挑战
4. 回复长度随内容走，写透为止，不要自行截断
5. 能用原话就用原话，避免机械的"我听到你说..."式复述
`;

function resolveTodayYear(meta = {}) {
  const ymd = meta?.today?.ymd;
  if (typeof ymd === 'string') {
    const match = ymd.match(/^(\d{4})-/);
    if (match) return Number(match[1]);
  }
  return null;
}

function resolveCurrentTiming(ui) {
  const meta = ui?.META || {};
  const dayun = ui?.DAYUN || [];
  const todayYear = resolveTodayYear(meta);
  if (!dayun.length) {
    return { todayYear, currentDayun: null, currentDayunIndex: -1, currentLiunian: null };
  }

  let currentDayunIndex = -1;
  if (Number.isFinite(todayYear)) {
    currentDayunIndex = dayun.findIndex((step) => {
      const startYear = Number(step?.startYear);
      const endYear = Number(step?.endYear);
      return Number.isFinite(startYear) && Number.isFinite(endYear) && todayYear >= startYear && todayYear <= endYear;
    });
  }
  if (currentDayunIndex < 0) currentDayunIndex = dayun.findIndex((step) => step.current);

  const currentDayun = currentDayunIndex >= 0 ? dayun[currentDayunIndex] : null;
  const currentLiunian = currentDayun?.years?.find?.((year) => Number(year?.year) === todayYear)
    || currentDayun?.years?.find?.((year) => year.current)
    || null;

  return { todayYear, currentDayun, currentDayunIndex, currentLiunian };
}

/**
 * Build a compact text description of the user's chart.
 */
function compactChartContext(ui) {
  if (!ui) return '';
  const p = ui.PAIPAN || {};
  const m = ui.META || {};
  const f = ui.FORCE || [];
  const g = ui.GUARDS || [];
  const d = ui.DAYUN || [];
  const sec = ui.SECTIONS || [];           // [{title, body}]
  const verd = ui.VERDICTS || {};          // {picks, items:[{source,yuanwen,baihua,duiying}]}

  const lines = [];
  lines.push('【用户命盘】');
  const hourUnknown = m.hourUnknown === true || !p.sizhu?.hour;
  if (p.sizhu) {
    const segs = ['年 '+p.sizhu.year, '月 '+p.sizhu.month, '日 '+p.sizhu.day];
    segs.push('时 ' + (hourUnknown ? '未知' : p.sizhu.hour));
    lines.push('四柱：' + segs.join(' / '));
  }
  if (p.shishen) {
    const segs = ['年='+p.shishen.year, '月='+p.shishen.month];
    if (!hourUnknown && p.shishen.hour) segs.push('时='+p.shishen.hour);
    lines.push('十神：' + segs.join('，'));
  }
  if (p.cangGan) {
    const cg = k => (p.cangGan[k] || []).join('·');
    const segs = ['年[' + cg('year') + ']', '月[' + cg('month') + ']', '日[' + cg('day') + ']'];
    if (!hourUnknown) segs.push('时[' + cg('hour') + ']');
    lines.push('藏干：' + segs.join(' '));
  }
  if (hourUnknown) {
    lines.push('※ 时辰未知：时柱、时干十神、时支藏干不详；只分析年/月/日三柱 + 大运流年即可，不要推测时柱或据此展开。');
  }
  if (m.rizhu) {
    lines.push('日主：' + m.rizhu + '（' + (m.dayStrength || '') + '）');
    lines.push('格局：' + (m.geju || '') + (m.gejuNote ? '  ·  ' + m.gejuNote : ''));
    lines.push('用神（粗算）：' + (m.yongshen || ''));
  }
  if (f.length) {
    lines.push('十神力量（0-10）：' + f.map(x => x.name + ' ' + (x.val?.toFixed?.(1) ?? x.val)).join(' / '));
  }
  if (g.length) {
    lines.push('结构提示：');
    g.forEach(x => lines.push('  · [' + x.type + '] ' + x.note));
  }
  if (d.length) {
    const { currentDayun, currentLiunian } = resolveCurrentTiming(ui);
    const cur = currentDayun;
    if (cur) {
      lines.push('当前大运：' + cur.age + '岁起 ' + cur.gz + '（' + cur.ss + '）' + (cur.startYear ? ' ' + cur.startYear + '–' + cur.endYear : ''));
      const curYear = currentLiunian;
      if (curYear) lines.push('当前流年：' + curYear.year + ' ' + curYear.gz + '（' + curYear.ss + '）');
    }
    lines.push('大运序列：' + d.map(x => x.age + '↓' + x.gz).join(' → '));
  }
  if (m.input) {
    const hr = m.input.hour === -1 ? '时辰未知' : (m.input.hour + ':' + String(m.input.minute||0).padStart(2,'0'));
    lines.push('出生：' + m.input.year + '-' + m.input.month + '-' + m.input.day + ' ' + hr + '，' + (m.input.city || '') + '，' + (m.input.gender === 'male' ? '男' : '女'));
  }
  if (m.lunar) lines.push('农历：' + m.lunar);

  // Initial reading sections (first 800 chars each to avoid blowing token budget)
  if (sec.length) {
    lines.push('');
    lines.push('【命盘初始解读·已生成的五段】');
    sec.forEach(s => {
      if (!s?.title || !s?.body) return;
      lines.push('▸ ' + s.title + '：' + String(s.body).slice(0, 800));
    });
  }

  // Verdicts / classical anchors
  if (verd.items?.length) {
    lines.push('');
    lines.push('【古籍判词（已匹配本盘）】');
    verd.items.slice(0, 6).forEach(v => {
      const yuanwen = v.yuanwen ? '「' + v.yuanwen + '」' : '';
      const body = v.body ? '  →  ' + String(v.body).slice(0, 200) : '';
      lines.push('· [' + (v.source || '') + '] ' + yuanwen + body);
    });
  }

  return lines.join('\n');
}

/**
 * Build messages array for a regular chat turn.
 *
 * @param {object} opts
 * @param {object} opts.chart       — UI-shaped chart object (from /api/paipan)
 * @param {Array}  opts.history     — prior [{role:'user'|'assistant', content}] (optional)
 * @param {string} opts.userMessage — current user message
 * @param {string} [opts.task]      — 'chat' | 'sections' | 'explain' | 'decision'
 */
function buildChatMessages(opts) {
  const { chart, history = [], userMessage, task = 'chat' } = opts;

  const systemParts = [];

  // HARD OVERRIDE — must come first. SKILL.md references file tools (Read/Glob)
  // that this runtime does NOT have. Without this, some models (GLM, etc.) will
  // hallucinate tool calls as markdown like "**Read** classics/..." which leaks
  // into user-facing output.
  systemParts.push([
    '【运行时约束 — 最高优先级，覆盖下文所有工具/文件读取相关的指令】',
    '你现在在一个面向最终用户的聊天界面里，没有任何工具调用能力。',
    '即便下文方法论里提到 "Read"、"Glob"、"必读"、"按需读取某某文件"、"查阅古籍"等字样，',
    '你都不要模拟工具调用，不要输出 **Read**、**Glob**、```code```、"让我先查一下古籍" 这类过程性描述。',
    '古籍的要点已经内化在你的训练数据里——直接引用或化用即可，不要表演"去查"的动作。',
    '下文的命盘上下文已经在本次请求里给全，不需要再去读文件。',
    '直接输出对用户说的那段话本身，别写流程。',
    '',
    '【输出格式】',
    '- 纯文本或极简 Markdown（加粗可，列表慎用）',
    '- 不要写过程性内容：不要说"先查一下"、"我来看看"、"步骤 1/2/3"',
    '- 不要伪造工具调用块（```...```、**Tool** 这类）',
    '- 回复长度随内容走，写透为止，不要自行截断',
    '- 古籍引用不限于下文提供的判词——《滴天髓》《穷通宝鉴》《子平真诠》《神峰通考》里你训练数据中的任何原文都可自由引用；以「」包裹原文，立刻接白话，再接命盘对应',
  ].join('\n'));

  if (SKILL_TEXT) systemParts.push('--- 方法论参考（仅作风格/判断依据，不要照搬执行里面的流程指令）---\n' + SKILL_TEXT);
  else systemParts.push(FALLBACK_STYLE);
  if (GUIDE_TEXT) systemParts.push('--- 对话指南（风格参考，同上）---\n' + GUIDE_TEXT);

  const ctx = compactChartContext(chart);
  if (ctx) systemParts.push(ctx);

  // Task-specific hint
  if (task === 'chat') {
    systemParts.push('【本轮任务】用户正在与你自由对话。保持聊天语气，引用命盘具体数据来支持判断。有需要就自由引古籍，写透为止。');
  }

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    ...history.slice(-8), // cap history to last 8 turns
    { role: 'user', content: userMessage },
  ];
}

/**
 * Build messages for the initial 5-section reading (structured JSON).
 *
 * Slimmer than chat — skips the large SKILL.md/guide to keep context tight
 * and let the model spend tokens on actual output.
 */
function buildClassicalAnchor(retrievedList, { terse = false } = {}) {
  // Accept legacy single object or array
  const list = Array.isArray(retrievedList)
    ? retrievedList
    : (retrievedList ? [retrievedList] : []);
  if (!list.length) return '';

  const sections = list.map(r => {
    const src = r.source;
    return [
      '来源：' + src,
      '',
      '<classical source="' + src + '">',
      r.text,
      '</classical>',
    ].join('\n');
  }).join('\n\n---\n\n');

  if (terse) {
    return [
      '【古籍锚点】',
      sections,
      '',
      '【引用规则】引用必须从上面 <classical> 段内摘，不要出现任何未列出的书名（如《三命通会》《渊海子平》等）。',
    ].join('\n');
  }

  return [
    '【古籍锚点 — 必读】以下可能有多段原文来自不同古籍：',
    '',
    sections,
    '',
    '【使用规则 — 严格遵守】',
    '- 引用时必须从 <classical> 段内 quote 原文（用 > 引用符），并标明出处',
    '- 多段之间如有观点差异，明确说"XX 说…… 而 YY 说……，此处取 YY 因为……"',
    '- 禁止引用上述之外的任何书名（《三命通会》《渊海子平》《滴天髓》等若未在上面列出，一律不要提）',
    '- 如果古籍原文和命主情况不完全对应，说明"古籍此处讨论的是 X，命主是 Y，以下是基于古籍原理的外推"',
    '- 三步走：白话翻译 + 现代 reframe + 对照本盘',
  ].join('\n');
}

function buildSectionsMessages(chart, retrieved) {
  const systemParts = [];

  systemParts.push([
    '你是一位懂八字命理的朋友，语气是聊天而非交报告。',
    '',
    '【风格】',
    '- 判断要 tie to 命盘里具体的干支/十神/分数，不要空话',
    '- 术语配白话（例："七杀格" 配 "最强势的力量是一把对着你的刀"）',
    '- 用原话/具象化表达，避免"你是个内心丰富的人"这种废话',
    '- 能化用古籍意旨可化用，但不说"我查了..."',
    '',
    '【严格约束】',
    '- 你没有工具调用能力。不要写 **Read**、**Glob**、```...```、"让我先查一下古籍" 这类过程性内容。',
    '- 直接输出最终 JSON，前后不要任何字符（不要 ```json 围栏，不要解释）。',
  ].join('\n'));

  const ctx = compactChartContext(chart);
  if (ctx) systemParts.push(ctx);

  const anchor = buildClassicalAnchor(retrieved, { terse: false });
  if (anchor) systemParts.push(anchor);

  systemParts.push([
    '【本轮任务】基于上面的命盘，写五段"初始解读"，顺序固定：',
    '1. 底层结构  2. 性格两面  3. 关系模式  4. 发力方向  5. 此刻的提醒',
    '',
    '【硬要求】',
    '- 每段 body 控制在 60-120 字，1-3 句',
    '- 判断必须 tie to 命盘里具体的干支/十神/分数',
    '- 用原话/具象化表达，避免"你是个内心丰富的人"这种废话',
    '- 能化用古籍意旨可化用，但不说"我查了..."',
    '',
    '【输出格式 — 极其严格】',
    '第一个字符必须是 "§"。绝对不要写"分析请求"、"让我先"、"润色检查"、"草稿"、"角色：..." 这种思考过程。',
    '绝对不要写前言（"以下是解读："）或后语（"希望对你有帮助"）。',
    '只按下面这种格式输出五段，中间用空行分隔：',
    '',
    '§1 底层结构',
    '正文...',
    '',
    '§2 性格两面',
    '正文...',
    '',
    '§3 关系模式',
    '正文...',
    '',
    '§4 发力方向',
    '正文...',
    '',
    '§5 此刻的提醒',
    '正文...',
  ].join('\n'));

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: '请直接输出这份初始解读，从 "§1" 开始。' },
  ];
}

/**
 * Parse the §-delimited sections format back into {title, body}[].
 * Robust to leading garbage (model scratchpad) — we skip anything before the first §.
 */
function parseSectionsText(raw) {
  if (!raw) return [];
  // Skip any preamble before the first § marker
  const firstMark = raw.search(/§\s*\d/);
  if (firstMark === -1) return [];
  const body = raw.slice(firstMark);

  // Split on §<digit>
  const parts = body.split(/§\s*(\d+)\s*/).filter(Boolean);
  // parts alternates: [digit, chunk, digit, chunk, ...]
  const out = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const chunk = parts[i + 1].trim();
    if (!chunk) continue;
    // First line is title, rest is body
    const lines = chunk.split('\n');
    const title = lines[0].trim();
    const bodyText = lines.slice(1).join('\n').trim();
    if (title && bodyText) out.push({ title, body: bodyText });
  }
  return out;
}

// ============================================================================
// Router + Expert (two-stage chat)
// ============================================================================

const INTENTS = [
  'relationship', 'career', 'wealth', 'timing',
  'personality', 'health', 'meta', 'chitchat', 'other',
  'dayun_step', 'liunian',
  'appearance', 'special_geju',
  'divination',
];

const KEYWORDS = {
  divination:   ['起卦','占卜','卦象','该不该','能不能','测一下','求一卦','占一下','问卦','吉凶','宜不宜','起一卦','要不要','合适吗','值不值','会成吗','可以吗','好不好'],
  timing:       ['今年','明年','后年','大运','流年','这几年','最近几年','下半年','上半年','几岁','什么时候','何时','哪一年','近几年'],
  relationship: ['感情','恋爱','爱情','对象','正缘','姻缘','婚姻','结婚','离婚','老公','老婆','配偶','男朋友','女朋友','暗恋','分手','复合','桃花'],
  appearance:   ['长相','外貌','相貌','颜值','好看','好不好看','丑','帅','漂亮','胖瘦','身材','高矮','皮肤','脸型','五官','长得'],
  career:       ['事业','工作','职业','跳槽','换工作','转行','创业','辞职','升职','老板','同事','上司','行业','方向','发展'],
  wealth:       ['财运','钱','收入','投资','理财','副业','赚钱','亏钱','破财','存款','房产','买房'],
  health:       ['身体','健康','生病','失眠','焦虑','抑郁','情绪','养生','压力大','累'],
  special_geju: ['特殊格局','飞天禄马','倒冲','井栏叉','朝阳格','六乙鼠贵','六阴朝阳','金神格','魁罡','日刃','从格','化格','专旺','曲直'],
  meta:         ['七杀','正官','正财','偏财','食神','伤官','正印','偏印','比肩','劫财','格局','用神','日主','十神','什么意思','怎么理解','是什么'],
  personality:  ['性格','脾气','我这个人','我是不是','我是不是太','自我','待自己'],
  chitchat:     ['你好','您好','hi','hello','谢谢','多谢','辛苦了','感谢','再见'],
};

// Order matters: timing/relationship/appearance first → narrow life domains;
// special_geju before meta so specific格局名先命中；chitchat handled separately.
const PRIORITY = ['divination','timing','relationship','appearance','career','wealth','health','special_geju','meta','personality','chitchat'];

function classifyByKeywords(userMessage) {
  if (!userMessage) return null;
  const text = String(userMessage).toLowerCase();
  for (const intent of PRIORITY) {
    if (intent === 'chitchat') continue;
    for (const kw of KEYWORDS[intent]) {
      if (text.includes(kw.toLowerCase())) {
        return { intent, reason: 'kw:' + kw, source: 'keyword' };
      }
    }
  }
  if (String(userMessage).trim().length <= 8) {
    for (const kw of KEYWORDS.chitchat) {
      if (text.includes(kw.toLowerCase())) {
        return { intent: 'chitchat', reason: 'kw:' + kw, source: 'keyword' };
      }
    }
  }
  return null;
}

function buildRouterMessages({ history = [], userMessage }) {
  const sys = [
    '你是一个意图分类器。读用户最近几轮对话和当前消息，输出一个 JSON：',
    '{"intent": "<one of the list>", "reason": "<一句不超 20 字的判断依据>"}',
    '',
    '可选 intent（严格从中选一个）：',
    '- relationship  关系、感情、正缘、婚姻、配偶、亲密关系、家人',
    '- appearance    外貌、长相、相貌、身材、五官（自身或配偶）',
    '- special_geju  问到具体的特殊格局：飞天禄马、倒冲、六阴朝阳、魁罡、金神、日刃、从格、化格 等',
    '- career        事业、工作、方向、转行、创业、辞职、读书深造',
    '- wealth        财运、投资、副业、赚钱、破财',
    '- timing        大运、流年、今年、明年、某个具体岁数、时机',
    '- personality   自我性格、内在特质、如何看待自己',
    '- health        身体、情绪、睡眠、养生',
    '- meta          对命理概念本身的提问（如"什么是七杀"、"我的格局是什么意思"）',
    '- divination    用户在问一件具体的事"该不该/要不要/能不能/合不合适"——这类是非决策题，适合用起卦辅助，不适合直接用命盘分析回答',
    '- chitchat      打招呼、致谢、闲聊、测试',
    '- other         以上都不贴切的兜底',
    '',
    '规则：',
    '- 有上下文时按上下文判断（如上一轮在聊工作、这轮"那今年呢" → timing）',
    '- 只输出 JSON，第一个字符必须是 "{"，不要前言、不要 ```json 围栏',
    '- reason 用中文，一句话',
  ].join('\n');

  const hist = history.slice(-4).map(h => ({
    role: h.role,
    content: String(h.content || '').slice(0, 300),
  }));

  return [
    { role: 'system', content: sys },
    ...hist,
    { role: 'user', content: userMessage },
  ];
}

function parseRouterJSON(raw) {
  if (!raw) return { intent: 'other', reason: 'empty_response' };
  const trimmed = String(raw).trim();
  try {
    const j = JSON.parse(trimmed);
    if (j && INTENTS.includes(j.intent)) return { intent: j.intent, reason: String(j.reason || '') };
  } catch (_) {}
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && INTENTS.includes(j.intent)) return { intent: j.intent, reason: String(j.reason || '') };
    } catch (_) {}
  }
  return { intent: 'other', reason: 'parse_failed' };
}

/**
 * Return a chart-shaped subset that only keeps fields relevant to this intent.
 * compactChartContext naturally skips missing sub-keys so this works out.
 */
function pickChartSlice(chart, intent) {
  if (!chart) return null;
  if (intent === 'chitchat') return null;
  if (intent === 'other') return chart;

  const P = chart.PAIPAN || {};
  const M = chart.META   || {};
  const F = chart.FORCE  || [];
  const G = chart.GUARDS || [];
  const D = chart.DAYUN  || [];
  const timing = resolveCurrentTiming(chart);

  const pickForce = (names) => F.filter(x => names.includes(x.name));
  const curDayun = timing.currentDayun;
  const nextDayun = timing.currentDayunIndex >= 0 ? D[timing.currentDayunIndex + 1] : null;

  const baseMeta = {
    rizhu: M.rizhu, rizhuGan: M.rizhuGan,
    dayStrength: M.dayStrength,
    geju: M.geju, gejuNote: M.gejuNote,
    yongshen: M.yongshen,
    input: M.input,
  };

  switch (intent) {
    case 'relationship':
      return {
        PAIPAN: P,
        FORCE: pickForce(['正财','偏财','正官','七杀','比肩','劫财']),
        GUARDS: G.filter(g => g.type === 'liuhe' || g.type === 'chong' || g.note?.includes('财') || g.note?.includes('官')),
        DAYUN: curDayun ? [curDayun] : [],
        META: baseMeta,
      };
    case 'career':
      return {
        PAIPAN: P,
        FORCE: pickForce(['正官','七杀','食神','伤官','正印','偏印']),
        GUARDS: G,
        DAYUN: [curDayun, nextDayun].filter(Boolean),
        META: baseMeta,
      };
    case 'wealth':
      return {
        PAIPAN: P,
        FORCE: pickForce(['正财','偏财','食神','伤官','比肩','劫财']),
        GUARDS: G.filter(g => g.note?.includes('财') || g.type === 'chong'),
        DAYUN: [curDayun, nextDayun].filter(Boolean),
        META: baseMeta,
      };
    case 'timing': {
      const idx = timing.currentDayunIndex;
      const window = idx >= 0 ? D.slice(Math.max(0, idx - 1), idx + 3) : D.slice(0, 3);
      return {
        PAIPAN: P,
        FORCE: F,
        GUARDS: G,
        DAYUN: window,
        META: baseMeta,
      };
    }
    case 'personality':
      return {
        PAIPAN: P,
        FORCE: F,
        GUARDS: G.filter(g => g.type === 'pair_mismatch'),
        DAYUN: [],
        META: baseMeta,
      };
    case 'health': {
      // 找被克最重 / 偏枯：按分数极值列出
      const sorted = F.slice().sort((a,b) => (b.val||0) - (a.val||0));
      return {
        PAIPAN: P,
        FORCE: sorted,
        GUARDS: G.filter(g => g.type === 'chong'),
        DAYUN: curDayun ? [curDayun] : [],
        META: baseMeta,
      };
    }
    case 'meta':
      return {
        PAIPAN: P,
        FORCE: F,
        GUARDS: [],
        DAYUN: [],
        META: baseMeta,
      };
    default:
      return chart;
  }
}

const INTENT_GUIDE = {
  relationship:
    '【本轮：关系/感情】聚焦日支（配偶宫）、正偏财与官杀的强弱与位置、六合/相冲对感情宫的影响、当前大运对关系的烘托。避免泛泛爱情鸡汤，要把判断挂在具体干支/十神/分数上。',
  career:
    '【本轮：事业方向】聚焦格局（geju）、用神、官杀与食伤的配比（制/泄/化）、月令的土壤，再结合当前大运。给建议时要能落到"做什么类型的事"而不是"要努力"。',
  wealth:
    '【本轮：财运】聚焦正偏财根气、食伤生财链路、比劫是否夺财、当前/下一步大运走财还是走印。不要给炒股吉凶，要给"你适合怎么挣钱"的结构化判断。',
  timing:
    '【本轮：时机/大运流年】聚焦当前大运 + 下一步大运 + 近期流年，解释它对命主的结构意味着什么（补了什么、冲了什么）。日期要具体到岁数或年份。',
  personality:
    '【本轮：性格自我】聚焦日主、十神结构、格局、十神组内的失衡（pair_mismatch）。用命盘"结构"解释性格的两面性，避免 MBTI 式标签化。',
  health:
    '【本轮：身体情绪】聚焦五行偏枯、被冲最重的柱、过强/过弱的十神。只给结构性提醒（比如"水过弱、注意肾/泌尿与冬季"），不作医疗诊断。',
  meta:
    '【本轮：命理概念】用户在问命理本身。先用两三句把概念讲清楚（白话+原理），再落回命主自身盘中对应的情况，不要只回答通识。',
  chitchat:
    '【本轮：闲聊】用户没在问命盘。自然接话，不要硬塞八字分析。一两句即可。',
  other:
    '【本轮：兜底】按常规方法论回答，若用户问题模糊可温和反问具体化。',
  appearance:
    '【本轮：外貌/形象】聚焦三命通会"性情相貌"的体系：日主五行 + 主导十神 + 月令气候，对应身材、肤色、面相轮廓。挂出来的古籍是依据，不要随意加现代审美词。说"古籍把这种结构形容为...，落到你身上大概是..."。',
  special_geju:
    '【本轮：特殊格局】用户问到了某个特殊格局名词。先用挂接的古籍原文确认它的成立条件，再对照命主盘看是否真的成立。如果不成立，明说"古籍要求 A、B、C，你的盘缺 C，所以这个格局不成立"。绝对不要凑话说成立。',
  liunian:
    '【本轮：某一年的流年解读】\n'
    + '在当前大运背景下讲这一年对命主的具体作用：\n'
    + '- 年干支与日主的十神关系（ss 字段已给）\n'
    + '- 年柱与大运干支的合冲刑害（同冲/同合会加码，互冲互合会缓和）\n'
    + '- 落在"紧/松"哪种节奏：杀旺压身、财星辛劳、印年贵人等\n'
    + '- 结尾给一句"这一年适合做什么 / 避免什么"，要具体\n'
    + '- 4-8 行，口语，不要段落标题\n'
    + '- 第一个字必须是具体干支或结论，不要"好的"、"这一年"这种套话开头。',
  dayun_step:
    '【本轮：某一步大运的走向解读】\n'
    + '分析这一步大运（干支 + 起运年龄）对日主的作用：干支各自是什么十神，和日主/用神的生克、与原局四柱的合冲。\n'
    + '回答要落到具体十年里：前 2-3 年受上一步余气影响，中段（4-7 年）最纯，末 2 年过渡下一步。\n'
    + '指出这十年哪条线被激活：事业/关系/财/健康，只选最突出的一两条。\n'
    + '语气：像朋友在白板前给你画时间线。8-12 行，不用段落标题，不要前言后语。',
};

function buildExpertMessages({ chart, history = [], userMessage, intent = 'other', retrieved = null }) {
  const systemParts = [];

  // same hard runtime override as buildChatMessages
  systemParts.push([
    '【运行时约束 — 最高优先级】',
    '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、```...```、"让我先查一下古籍" 这类过程性描述。',
    '古籍/方法论内容已内化在训练里，直接引用即可。',
    '',
    '【输出格式】纯文本或极简 Markdown。',
    '- 回复长度随内容走，写透为止，不要自行截断',
    '- 每个判断必须落到命盘里具体的干支/十神/分数，不要悬空下结论',
    '- 古籍引用不限于下文提供的判词——《滴天髓》《穷通宝鉴》《子平真诠》《神峰通考》里你训练数据中的任何原文都可自由引用；以「」包裹原文，立刻接白话，再接命盘对应',
  ].join('\n'));

  // Intent-specific guide
  systemParts.push(INTENT_GUIDE[intent] || INTENT_GUIDE.other);

  // Methodology — load intent-specific shards instead of full SKILL.md + GUIDE
  if (intent !== 'chitchat') {
    const shards = loadShardsFor(intent);
    if (shards) systemParts.push('--- 方法论 ---\n' + shards);
    else systemParts.push(FALLBACK_STYLE);
  } else {
    systemParts.push(FALLBACK_STYLE);
  }

  // Chart slice
  const slice = pickChartSlice(chart, intent);
  const ctx = compactChartContext(slice);
  if (ctx) systemParts.push(ctx);

  // Classical anchor (skip for chitchat to save tokens)
  if (intent !== 'chitchat') {
    const anchor = buildClassicalAnchor(retrieved, { terse: true });
    if (anchor) systemParts.push(anchor);
  }

  // Time anchor — prepend to user message so LLM doesn't hallucinate "current year".
  // Top of user message has highest attention.
  const t = chart?.META?.today;
  const anchor = t?.yearGz
    ? '【当前时间锚】今天 ' + (t.ymd || '') + '，年柱 ' + t.yearGz
      + (t.monthGz ? '，月柱 ' + t.monthGz : '')
      + '。所有"今年/明年/最近"默认以此为基准，不要自己另行推断。\n\n'
    : '';

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    ...history.slice(-8),
    { role: 'user', content: anchor + userMessage },
  ];
}

function buildDayunStepMessages({ chart, stepIdx, retrieved = null }) {
  const D = (chart && chart.DAYUN) || [];
  const step = D[stepIdx];
  if (!step) throw new Error('invalid stepIdx ' + stepIdx);
  const prev = D[stepIdx - 1] || null;
  const next = D[stepIdx + 1] || null;
  const timing = resolveCurrentTiming(chart);
  const M = (chart && chart.META) || {};
  const P = (chart && chart.PAIPAN) || {};
  const F = (chart && chart.FORCE) || [];

  const topForce = F.slice().sort((a,b) => (b.val||0) - (a.val||0)).slice(0, 5)
    .map(x => x.name + ' ' + (x.val?.toFixed?.(1) ?? x.val)).join(' / ');

  const sys = [
    '【运行时约束 — 最高优先级】',
    '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、```...```、"让我先查一下古籍" 这类过程性描述。',
    '古籍/方法论内容已内化，直接引用即可。',
    '',
    INTENT_GUIDE.dayun_step,
    '',
    '【输出格式】',
    '- 纯文本或极简 Markdown，不要标题，不要"以下是..."前言',
    '- 第一个字是 "这"、"从"、或直接说干支，不要铺垫',
    '- 8-12 行，每行 1-2 句',
    '- 判断挂在具体干支/十神/用神/大运十神上',
  ].join('\n');

  const coreLines = [];
  coreLines.push('【命主核心】日主 ' + (M.rizhu || '?') + '（' + (M.dayStrength || '?') + '）');
  coreLines.push('格局：' + (M.geju || '—') + '  ·  用神：' + (M.yongshen || '—'));
  if (P.sizhu) coreLines.push('原局四柱：年 ' + P.sizhu.year + ' / 月 ' + P.sizhu.month + ' / 日 ' + P.sizhu.day + ' / 时 ' + (P.sizhu.hour || '未知'));
  if (topForce) coreLines.push('十神力量（Top5）：' + topForce);

  const fmt = (s) => s ? (s.age + '岁起 ' + s.gz + '（' + s.ss + '）' + (s.startYear ? ' ' + s.startYear + '–' + s.endYear : '')) : '无';
  coreLines.push('');
  coreLines.push('【上一步】' + fmt(prev));
  coreLines.push('【本步】   ' + fmt(step) + (stepIdx === timing.currentDayunIndex ? '  ← 当前正走' : ''));
  coreLines.push('【下一步】' + fmt(next));

  const user = '请讲讲 ' + step.age + '岁起 ' + step.gz + '（' + step.ss + '）这步大运对我意味着什么。';

  const anchor = buildClassicalAnchor(retrieved, { terse: true });
  const systemContent = sys + '\n\n' + coreLines.join('\n') + (anchor ? '\n\n' + anchor : '');

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: user },
  ];
}

function buildLiunianMessages({ chart, dayunIdx, yearIdx, retrieved = null }) {
  const D = (chart && chart.DAYUN) || [];
  const step = D[dayunIdx];
  if (!step) throw new Error('invalid dayunIdx ' + dayunIdx);
  const yearInfo = step.years?.[yearIdx];
  if (!yearInfo) throw new Error('invalid yearIdx ' + yearIdx);

  const timing = resolveCurrentTiming(chart);
  const M = (chart && chart.META) || {};
  const F = (chart && chart.FORCE) || [];
  const topForce = F.slice().sort((a,b) => (b.val||0) - (a.val||0)).slice(0, 3)
    .map(x => x.name + ' ' + (x.val?.toFixed?.(1) ?? x.val)).join(' / ');

  const sys = [
    '【运行时约束 — 最高优先级】',
    '面向用户的聊天界面，无工具调用能力。不要输出 **Read**、**Glob**、"让我先查一下古籍" 这类过程性描述。',
    '古籍/方法论内容已内化，直接引用即可。',
    '',
    INTENT_GUIDE.liunian,
    '',
    '【输出格式】',
    '- 纯文本，不要标题、不要"以下是..."前言',
    '- 4-8 行，每行 1-2 句',
    '- 判断必须 tie to 年干支 + 大运干支 + 日主/用神',
  ].join('\n');

  const core = [
    '【命主核心】日主 ' + (M.rizhu || '?') + '（' + (M.dayStrength || '?') + '）',
    '格局：' + (M.geju || '—') + '  ·  用神：' + (M.yongshen || '—'),
    '十神 Top3：' + topForce,
    '',
    '【当前大运】' + step.age + '岁起 ' + step.gz + '（' + step.ss + '）'
      + (step.startYear ? ' ' + step.startYear + '–' + step.endYear : '')
      + (dayunIdx === timing.currentDayunIndex ? ' ← 正走' : ''),
    '【本年】' + yearInfo.year + '年 ' + yearInfo.gz + '（' + yearInfo.ss + '）'
      + (timing.currentLiunian?.year === yearInfo.year ? ' ← 今年' : ''),
  ].join('\n');

  const user = '请讲讲 ' + yearInfo.year + '年（' + yearInfo.gz + ' ' + yearInfo.ss
    + '）在 ' + step.gz + ' 大运里对我意味着什么。';

  const anchor = buildClassicalAnchor(retrieved, { terse: true });
  const systemContent = sys + '\n\n' + core + (anchor ? '\n\n' + anchor : '');

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: user },
  ];
}

function buildGuaMessages({ question, gua, birthContext }) {
  const sys = [
    '你是一位精通周易的占卦师。你的分析必须严格基于本次起卦得到的卦辞 + 大象辞，禁止编造其他卦辞或引述未提供的卦。',
    '',
    '【输出格式 — 严格】',
    '只输出四段，每段之间用空行分隔，每段第一行是 "§" 加段名：',
    '',
    '§卦象',
    '一句话点出本卦的核心意象（如"雷雨同作，险中开路"），描述上下卦组合的画面。1-2 句。',
    '',
    '§原文',
    '把卦辞和大象辞用 > 引用符照抄一遍。先卦辞后大象。',
    '',
    '§白话',
    '把卦辞 + 大象用现代汉语翻译，告诉用户这卦在讲什么核心情境。3-4 句。',
    '',
    '§你的问题',
    '把卦的意象 / 古义对照用户的问题，给一个具体的判断（适合 / 不适合 / 慎重 / 顺势 / 等待）+ 一句行动建议。3-5 句。',
    '',
    '【硬约束】',
    '- 第一个字必须是 "§"，不要任何前言（"以下是占卦结果："等）',
    '- 引用古文必须从下面 <classical> 内逐字摘',
    '- 不要扯爻辞、互卦、变卦——本轮 MVP 只看本卦',
  ].join('\n');

  const guaInfo = [
    '【本次起卦】',
    '卦象：' + gua.symbol + '（' + gua.name + ' · 上' + gua.upper + '下' + gua.lower + '）',
    '起卦时刻：' + gua.drawnAt,
    '起卦推算：' + (gua.source?.formula || ''),
    '',
    '<classical source="周易·' + gua.name + '">',
    '卦辞：' + gua.guaci,
    '大象：' + gua.daxiang,
    '</classical>',
  ].join('\n');

  const ctx = birthContext ? '【命主背景】日主 ' + (birthContext.rizhu || '?') + '，当前大运 '
    + (birthContext.currentDayun || '?') + '，当前流年 ' + (birthContext.currentYear || '?') + '。'
    : '';

  return [
    { role: 'system', content: sys + '\n\n' + guaInfo + (ctx ? '\n\n' + ctx : '') },
    { role: 'user', content: '我的问题：' + question },
  ];
}

/**
 * Build messages for the single-shot streaming verdicts narrative.
 * Inspired by the old "整体断词：古籍两锚点" skill output — a long, flowing
 * essay that anchors 1–2 classical quotes, interprets them in plain Chinese,
 * applies them to the user's chart, and closes with a poetic summary.
 *
 * @param {object} chart    — UI-shaped chart
 * @param {Array}  retrieved — retrieval sources (optional, used as hint only)
 */
function buildVerdictsMessages(chart, retrieved = []) {
  const systemParts = [];

  systemParts.push([
    '【运行时约束 — 最高优先级】',
    '你没有工具调用能力。不要输出 **Read**、**Glob**、```...```、"让我先查一下古籍" 这类过程性内容。',
    '古籍的要点已经内化在你训练数据里——直接引用原文即可，不要表演"去查"的动作。',
    '命盘上下文已在本请求给全，不要再"去读"什么文件。',
    '直接输出给用户看的那段话本身，别写你的思考过程、草稿、自我校对。',
    '',
    '【输出格式】',
    '- 纯文本 + 基础 Markdown（## 小标题、**加粗**、> 引用可用）',
    '- 不要代码块，不要 JSON，不要前言/后语',
    '- 长度随内容走，写透为止',
  ].join('\n'));

  if (SKILL_TEXT) systemParts.push('--- 方法论参考（风格/判断依据，不要照搬里面的流程指令）---\n' + SKILL_TEXT);
  else systemParts.push(FALLBACK_STYLE);
  if (GUIDE_TEXT) systemParts.push('--- 对话指南（风格参考）---\n' + GUIDE_TEXT);

  const ctx = compactChartContext(chart);
  if (ctx) systemParts.push(ctx);

  // Optional retrieval hint (not required; model can cite freely)
  if (retrieved?.length) {
    const anchor = buildClassicalAnchor(retrieved, { terse: true });
    if (anchor) systemParts.push(anchor);
  }

  systemParts.push([
    '【本轮任务 — 古籍判词·整体断词】',
    '为这张命盘写一段整体断词，像给朋友讲"古书里是怎么说你这种命的"。',
    '',
    '结构建议（不是死板模板，节奏随内容走）：',
    '',
    '一、古籍锚点（1–2 段）',
    '挑 1–2 处最切合此盘的古籍原文——《滴天髓》《穷通宝鉴》《子平真诠》《神峰通考》《三命通会》《渊海子平》等都可自由引用。',
    '每段这样写：',
    '  - 小标题给出书名 · 篇目（例：**《滴天髓》· 天干论 · 庚金**）',
    '  - 用 > 引用符摘原文一两句',
    '  - 紧接白话（一句话说清意思）',
    '  - 再对照你的盘：用 ✓ 或 · 列 2–4 条具体对应（干支、十神分数、大运流年都可）',
    '',
    '二、一生的形状',
    '用一段诗意但不空的语言画出这个人一生的骨架（不要鸡汤，要具象）。',
    '',
    '三、一生的几重张力（或"几处要命的地方"）',
    '2–3 条，每条用 **粗体小标题** 点出张力名（如 **第一重：水与火**、**第二重：官杀与印**），下面一小段白话展开。',
    '',
    '四、一生的课题',
    '1–2 段，讲清这张盘真正要学会的是什么。',
    '',
    '五、收尾一句',
    '用一句古籍原文或化用收尾（以「」或 > 引用），留下余味。',
    '',
    '【写作风格】',
    '- 判断必须 tie 到命盘里具体的干支/十神/分数/大运，不要泛泛',
    '- 术语必须配白话',
    '- 不要报告腔（"综上所述"、"总的来说"），要聊天+讲书的感觉',
    '- 古籍原文用「」或 > 引用符框住，后面立刻接白话，再接"你的盘上..."',
    '- 不要在正文里写任何 XML 标签（如 <classical>），不要写 "pair_mismatch" 这类内部标识',
  ].join('\n'));

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: '请直接写这份整体断词，从第一段古籍锚点开始，不要前言。' },
  ];
}

function buildVerdictsPickMessages(chartSummary, tree) {
  const system = [
    '你是熟读八字古籍的学者。给出此命盘后，从判词索引中选 3-5 条最能评判此盘整体命格的古籍原文。',
    '优先选命例类（三命通会卷九-十二）和格局总论类（子平真诠 09/12-14、滴天髓通神论衰旺/伤官/清气/浊气/真假）。',
    '魁罡、阳刃、特殊格局盘优先选神煞断语（三命通会卷三、渊海子平 09）。',
    '避免只选一本书里的 chunk，要尽量跨古籍体现权威性。',
    '如果实在没有高度匹配，退而求其次选中度匹配，并在 reason 中明确写“匹配度:中”。',
    '严格 JSON 输出，只允许半角标点，不要 Markdown，不要代码块，不要解释。',
    'heading 必须逐字摘抄，含繁体，不得编造。',
    '输出格式固定为：{"picks":[{"book":"...","file":"...","heading":"...","reason":"..."}]}。',
  ].join('\n');

  const user = [
    '【命盘摘要】',
    chartSummary,
    '',
    '【判词索引】',
    JSON.stringify(tree),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildVerdictsExplainMessages(chartSummary, pick) {
  const system = '你是一位懂命理的朋友，说话直接、白话，像在聊天而不是写报告。';

  const user = [
    '我的八字命盘：',
    chartSummary,
    '',
    `${pick.source}里有这么一句话：`,
    `「${pick.yuanwen}」`,
    '',
    '放到我这张命盘上，这句话是什么意思？',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildChipsMessages(chart, history = []) {
  const summary = compactChartContext(chart);
  const hasHistory = Array.isArray(history) && history.length > 0;

  const histStr = hasHistory
    ? history.slice(-6)
        .map(m => (m.role === 'user' ? '用户：' : '助手：') + String(m.content || '').slice(0, 300))
        .join('\n')
    : '';

  const systemPrompt = [
    '你在为一位命主准备"他想问命理师的 4 个问题"。',
    '输出的每一条都是【命主本人】要问出口的话——主语是"我"，不是"你"。',
    '',
    '思考步骤（内部进行，不要输出）：',
    '1. 这张盘最有特点的结构是什么（格局、十神极端值、大运关键期）？',
    '2. 对话里已经覆盖了哪些维度（性格/事业/感情/财运/流年/人生课题）？',
    '3. 还有哪些重要维度完全没聊到，或者刚才的话题自然延伸到哪里？',
    '4. 对于这张具体的盘，命主此刻最想追问的 4 个问题是什么？',
    '',
    '输出要求：',
    '- 第一人称：用"我"指代命主自己；涉及命盘特征要像命主在陈述自己（例："我七杀这么重，将来的对象扛得住我的压力吗"、"我丁卯大运这十年到底在干嘛"）',
    '- 不要用"你"、"您"、"这张盘"这种第三方口吻',
    '- 贴合这张盘，提到具体的结构特征（如七杀分数、格局名、大运干支），不要通用问题',
    hasHistory
      ? '- 不重复已聊话题；刚聊完的话题可以自然延伸到下一层，也可以跳到完全没聊过的维度'
      : '- 覆盖不同维度：建议包含整体/性格/事业/感情或流年中的几个',
    '- 口语化，像命主自己会说的话',
    '- 每条不超过 20 字',
    '- 输出格式：纯 JSON 数组，["问题1","问题2","问题3","问题4"]',
    '- 只输出 JSON，不要任何其他文字',
  ].join('\n');

  const userContent = hasHistory
    ? '【命盘】\n' + summary + '\n\n【对话记录】\n' + histStr
    : '【命盘】\n' + summary;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

function parseChipsJSON(raw) {
  try {
    const s = String(raw || '').trim();
    const match = s.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => typeof x === 'string' && x.trim()).slice(0, 4);
  } catch {
    return [];
  }
}

module.exports = {
  buildChatMessages,
  buildSectionsMessages,
  buildRouterMessages,
  buildExpertMessages,
  buildDayunStepMessages,
  buildLiunianMessages,
  buildGuaMessages,
  buildVerdictsPickMessages,
  buildVerdictsExplainMessages,
  buildVerdictsMessages,
  parseRouterJSON,
  classifyByKeywords,
  pickChartSlice,
  parseSectionsText,
  compactChartContext,
  resolveCurrentTiming,
  buildChipsMessages,
  parseChipsJSON,
  INTENTS,
  skillLoaded: () => !!SKILL_TEXT,
};
