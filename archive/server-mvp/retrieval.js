const fs = require('fs');
const path = require('path');

const CLASSICS_DIR = path.resolve(__dirname, '..', 'classics');

// TODO (next round): wire 三命通会·卷08-09 (日时断 — chart-feature trigger)
//                    and 三命通会·卷03 (神煞/纳音 — separate health-related intent)

// ============================================================================
// Qiongtong Baojian (日干 × 月令)
// ============================================================================

const QIONGTONG_FILE = {
  '甲': 'qiongtong-baojian/02_lun-jia-mu.md',
  '乙': 'qiongtong-baojian/03_lun-yi-mu.md',
  '丙': 'qiongtong-baojian/04_lun-bing-huo.md',
  '丁': 'qiongtong-baojian/05_lun-ding-huo.md',
  '戊': 'qiongtong-baojian/06_lun-wu-tu.md',
  '己': 'qiongtong-baojian/07_lun-ji-tu.md',
  '庚': 'qiongtong-baojian/08_lun-geng-jin.md',
  '辛': 'qiongtong-baojian/09_lun-xin-jin.md',
  '壬': 'qiongtong-baojian/10_lun-ren-shui.md',
  '癸': 'qiongtong-baojian/11_lun-gui-shui.md',
};

const GAN_WUXING = {
  甲:'木', 乙:'木', 丙:'火', 丁:'火', 戊:'土',
  己:'土', 庚:'金', 辛:'金', 壬:'水', 癸:'水',
};

const ZHI_TO_MONTH = {
  '寅': { num: '正月', season: '三春' },
  '卯': { num: '二月', season: '三春' },
  '辰': { num: '三月', season: '三春' },
  '巳': { num: '四月', season: '三夏' },
  '午': { num: '五月', season: '三夏' },
  '未': { num: '六月', season: '三夏' },
  '申': { num: '七月', season: '三秋' },
  '酉': { num: '八月', season: '三秋' },
  '戌': { num: '九月', season: '三秋' },
  '亥': { num: '十月', season: '三冬' },
  '子': { num: '十一月', season: '三冬' },
  '丑': { num: '十二月', season: '三冬' },
};

function extractQiongtongSection(fileContent, dayGan, monthZhi) {
  const conf = ZHI_TO_MONTH[monthZhi];
  if (!conf) return null;
  const { num, season } = conf;
  const wx = GAN_WUXING[dayGan];
  const lines = fileContent.split('\n');

  const seasonHeadRe = new RegExp('^###\\s*' + season + dayGan + wx);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (seasonHeadRe.test(lines[i])) { startIdx = i; break; }
  }
  if (startIdx === -1) {
    return { text: fileContent.slice(0, 2000), scope: 'fallback', heading: '(未找到季节章节)' };
  }

  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (i > startIdx && /^#{1,3}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  const seasonBlock = out.join('\n').trim();
  const seasonHeading = lines[startIdx].trim();

  const numChar = num.replace('月', '');
  const paras = seasonBlock.split(/\n\s*\n/);
  const hit = paras.filter(p => {
    const body = p.replace(/^#+\s.*\n?/, '');
    const re = new RegExp('(^|[^一二三四五六七八九十])' + numChar + '[一二三四五六七八九十]{0,2}月' + dayGan + wx + '[，,]');
    return re.test(body) || body.includes(num + dayGan + wx);
  });

  if (hit.length) {
    const text = seasonHeading + '\n\n' + hit.join('\n\n');
    return { text, scope: 'month', heading: seasonHeading + ' / ' + num + dayGan + wx };
  }
  return { text: seasonBlock, scope: 'season', heading: seasonHeading };
}

// ============================================================================
// Intent → classical book routing
// ============================================================================

// Verified via ls — files that actually exist in classics/
const INTENT_ROUTES = {
  meta: [
    { file: 'ziping-zhenquan/08_lun-yong-shen.md', label: '子平真诠·论用神' },
  ],
  career: [
    { file: 'ziping-zhenquan/08_lun-yong-shen.md', label: '子平真诠·论用神' },
  ],
  wealth: [
    { file: 'ziping-zhenquan/08_lun-yong-shen.md', label: '子平真诠·论用神' },
  ],
  timing: [
    { file: 'ziping-zhenquan/08_lun-yong-shen.md', label: '子平真诠·论用神' },
  ],
  relationship: [
    { file: 'ditian-sui/liu-qin-lun_01_fu-qi.md',                     label: '滴天髓·夫妻' },
    { file: 'ziping-zhenquan/23_lun-gong-fen-yong-shen-pei-liu-qin.md', label: '子平真诠·宫分六亲' },
  ],
  personality: [
    // Note: xing-qing lives under liu-qin-lun in this repo, not tong-shen-lun
    { file: 'ditian-sui/liu-qin-lun_24_xing-qing.md', label: '滴天髓·性情' },
  ],
  health: [
    { file: 'ditian-sui/tong-shen-lun_17_shuai-wang.md', label: '滴天髓·衰旺' },
  ],
  dayun_step: [
    { file: 'ziping-zhenquan/08_lun-yong-shen.md', label: '子平真诠·论用神' },
  ],
  liunian: [],     // fast model, token-tight → only qiongtong
  chitchat: [],
  other: [],
  appearance: [
    { file: 'sanming-tonghui/juan-07.md', label: '三命通会·卷七·论性情相貌',
      extractHeading: '論性情相貌' },
  ],
  special_geju: [
    // juan-06 has 40+ small sections (one per格局), pick by user-message keyword
    { file: 'sanming-tonghui/juan-06.md', label: '三命通会·卷六·特殊格局',
      extractByMessageKeyword: true },
    { file: 'yuanhai-ziping/09_shen-sha_yang-ren-ri-ren-ri-gui-ri-de-kui-gang-jin-shen.md',
      label: '渊海子平·论阳刃日刃魁罡金神' },
  ],
};

// Map user-message keywords → 三命通会 卷六 section heading text.
// All headings are H2 (## 井欄斜义 etc).
const SANMING_GEJU_KEYWORDS = {
  '飞天禄马': ['飛天禄馬', '飛天'],
  '倒冲':     ['倒冲', '衝合'],
  '井栏叉':   ['井欄', '井栏'],
  '六阴朝阳': ['六隂朝陽', '六阴'],
  '六乙鼠贵': ['六乙䑕貴', '六乙鼠'],
  '朝阳格':   ['朝陽', '朝阳'],
  '金神':     ['金神'],
  '魁罡':     ['魁罡'],
  '日刃':     ['日刃'],
  '日德':     ['日德'],
  '日贵':     ['日貴', '日贵'],
  '从格':     ['弃命', '從'],
  '专旺':     ['專旺', '专旺'],
  '曲直':     ['曲直'],
};

// For meta intent, if user message mentions a 十神 name, prefer that chapter.
const SHISHEN_CHAPTER = {
  '七杀': 'ziping-zhenquan/39_lun-pian-guan.md',
  '偏官': 'ziping-zhenquan/39_lun-pian-guan.md',
  '正官': 'ziping-zhenquan/31_lun-zheng-guan.md',
  '正财': 'ziping-zhenquan/33_lun-cai.md',
  '偏财': 'ziping-zhenquan/33_lun-cai.md',
  '食神': 'ziping-zhenquan/37_lun-shi-shen.md',
  '伤官': 'ziping-zhenquan/41_lun-shang-guan.md',
  '正印': 'ziping-zhenquan/35_lun-yin-shou.md',
  '偏印': 'ziping-zhenquan/35_lun-yin-shou.md',
  '印绶': 'ziping-zhenquan/35_lun-yin-shou.md',
  '阳刃': 'ziping-zhenquan/43_lun-yang-ren.md',
  '建禄': 'ziping-zhenquan/45_lun-jian-lu-yue-jie.md',
};

const SHISHEN_LABEL = {
  'ziping-zhenquan/39_lun-pian-guan.md':        '子平真诠·论偏官（七杀）',
  'ziping-zhenquan/31_lun-zheng-guan.md':       '子平真诠·论正官',
  'ziping-zhenquan/33_lun-cai.md':              '子平真诠·论财',
  'ziping-zhenquan/37_lun-shi-shen.md':         '子平真诠·论食神',
  'ziping-zhenquan/41_lun-shang-guan.md':       '子平真诠·论伤官',
  'ziping-zhenquan/35_lun-yin-shou.md':         '子平真诠·论印绶',
  'ziping-zhenquan/43_lun-yang-ren.md':         '子平真诠·论阳刃',
  'ziping-zhenquan/45_lun-jian-lu-yue-jie.md':  '子平真诠·论建禄月劫',
};

function pickMetaClassic(userMessage) {
  if (!userMessage) return null;
  for (const [kw, file] of Object.entries(SHISHEN_CHAPTER)) {
    if (userMessage.includes(kw)) {
      return { file, label: SHISHEN_LABEL[file] || ('子平真诠·' + kw) };
    }
  }
  return null;
}

// ============================================================================
// File reading + budgeting
// ============================================================================

const PER_SOURCE_MAX = 2500;
const TOTAL_MAX = 6000;

// Strip YAML/metadata front matter (up to and including the first `---` divider line).
function stripFrontmatter(text) {
  const lines = text.split('\n');
  let cut = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/^---\s*$/.test(lines[i])) { cut = i + 1; break; }
  }
  return lines.slice(cut).join('\n').trim();
}

/**
 * Slice a section out of a markdown file by matching a keyword in any heading
 * (H2-H4). Returns the heading line + everything until the next heading of
 * equal-or-higher level. Null if not found.
 */
function extractByHeading(content, keyword) {
  const lines = content.split('\n');
  const headingRe = /^(#{2,4})\s+/;
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && lines[i].includes(keyword)) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function pickGejuKeyword(userMessage) {
  if (!userMessage) return null;
  for (const [askedKw, headings] of Object.entries(SANMING_GEJU_KEYWORDS)) {
    if (userMessage.includes(askedKw)) return headings;
  }
  return null;
}

function loadClassicFile(file, label, opts = {}) {
  try {
    const full = fs.readFileSync(path.join(CLASSICS_DIR, file), 'utf8');
    let body = null;
    let scope = 'full';

    if (opts.extractHeading) {
      const sec = extractByHeading(full, opts.extractHeading);
      if (sec) { body = sec; scope = 'heading:' + opts.extractHeading; }
    } else if (opts.headingCandidates) {
      for (const kw of opts.headingCandidates) {
        const sec = extractByHeading(full, kw);
        if (sec) { body = sec; scope = 'heading:' + kw; break; }
      }
    }

    if (!body) {
      body = stripFrontmatter(full);
      scope = opts.extractHeading || opts.headingCandidates ? 'fallback-head' : 'full';
    }

    const text = body.length > PER_SOURCE_MAX ? body.slice(0, PER_SOURCE_MAX) + '\n…(节选)' : body;
    return { source: label, file, scope, text, chars: text.length };
  } catch (e) {
    console.error('[retrieval] failed to load ' + file + ':', e.message);
    return null;
  }
}

// ============================================================================
// Main entry
// ============================================================================

async function retrieveForChart(chart, intent = null, userMessage = null) {
  const results = [];
  let totalChars = 0;

  // 1) Always: qiongtong (日干×月令)
  const qt = retrieveQiongtong(chart);
  if (qt) { results.push(qt); totalChars += qt.chars; }

  // 2) Intent-driven additions
  const routes = (intent && INTENT_ROUTES[intent]) || [];
  const dynamicRoutes = [];

  if (intent === 'meta' && userMessage) {
    const picked = pickMetaClassic(userMessage);
    if (picked) dynamicRoutes.push(picked);
  }

  const allRoutes = [...dynamicRoutes, ...routes];
  const seen = new Set();
  for (const route of allRoutes) {
    if (seen.has(route.file)) continue;
    seen.add(route.file);
    if (totalChars >= TOTAL_MAX) break;
    const opts = {};
    if (route.extractHeading) opts.extractHeading = route.extractHeading;
    if (route.extractByMessageKeyword) {
      const headings = pickGejuKeyword(userMessage);
      if (headings) opts.headingCandidates = headings;
    }
    const loaded = loadClassicFile(route.file, route.label, opts);
    if (!loaded) continue;
    if (totalChars + loaded.chars > TOTAL_MAX) {
      const room = TOTAL_MAX - totalChars;
      if (room < 500) break;
      loaded.text = loaded.text.slice(0, room) + '\n…(截断)';
      loaded.chars = loaded.text.length;
    }
    results.push(loaded);
    totalChars += loaded.chars;
  }

  return results;
}

function retrieveQiongtong(chart) {
  try {
    const dayGan = chart?.META?.rizhuGan;
    const monthGz = chart?.PAIPAN?.sizhu?.month;
    if (!dayGan || !monthGz || monthGz.length < 2) return null;
    const monthZhi = monthGz[1];
    const file = QIONGTONG_FILE[dayGan];
    if (!file) return null;
    const content = fs.readFileSync(path.join(CLASSICS_DIR, file), 'utf8');
    const section = extractQiongtongSection(content, dayGan, monthZhi);
    if (!section) return null;
    const MAX = PER_SOURCE_MAX;
    const text = section.text.length > MAX ? section.text.slice(0, MAX) + '\n…(节选)' : section.text;
    return {
      source: '穷通宝鉴 · ' + section.heading,
      file, scope: section.scope, text, chars: text.length,
    };
  } catch (e) {
    console.error('[retrieval] qiongtong failed:', e.message);
    return null;
  }
}

module.exports = { retrieveForChart, extractQiongtongSection, pickMetaClassic, extractByHeading };
