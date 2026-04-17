/**
 * 命理层主入口
 *
 * 输入：排盘引擎产出的四柱（sizhu = {year, month, day, hour} 含天干和地支）
 * 输出：结构化分析对象，供 LLM 在其上做解读对话
 *
 * 产出包含：
 *   - 四柱、十神（每位）
 *   - 藏干明细
 *   - 力量擂台（10 个十神得分 + 正/偏对子）
 *   - 日主强弱 + 从格候选
 *   - 格局候选
 *   - 天干合、地支冲/合/会
 *   - 日主与各十神的合/克/生关系
 *
 * 本模块不做"解读"，只做事实层面的结构化分析。
 * 所有判定都带来源（哪个字段、哪条规则），方便 LLM 审查和引用。
 */

const { getShiShen } = require('./shishen');
const { getCangGan } = require('./cangGan');
const { findGanHe, findZhiRelations } = require('./heKe');
const { analyzeForce } = require('./liLiang');
const { identifyGeJu } = require('./geJu');

/**
 * 从 paipan 的 sizhu 对象解析出单字的 gan/zhi
 */
function splitPillar(pillar) {
  if (!pillar) return { gan: null, zhi: null };
  return { gan: pillar[0], zhi: pillar[1] };
}

/**
 * @param {Object} paipanResult - paipan() 的输出
 * @returns {Object} 结构化分析对象
 */
function analyze(paipanResult) {
  const { sizhu } = paipanResult;
  const y = splitPillar(sizhu.year);
  const m = splitPillar(sizhu.month);
  const d = splitPillar(sizhu.day);
  const h = splitPillar(sizhu.hour);

  const bazi = {
    yearGan: y.gan, yearZhi: y.zhi,
    monthGan: m.gan, monthZhi: m.zhi,
    dayGan: d.gan,  dayZhi: d.zhi,
    hourGan: h.gan, hourZhi: h.zhi,
  };

  const riZhu = d.gan;
  const hourUnknown = paipanResult.hourUnknown;

  // 四柱十神
  const shiShen = {
    year:  { gan: y.gan, ss: y.gan === riZhu ? '比肩' : getShiShen(riZhu, y.gan) },
    month: { gan: m.gan, ss: m.gan === riZhu ? '比肩' : getShiShen(riZhu, m.gan) },
    day:   { gan: d.gan, ss: '日主' },
    hour:  hourUnknown ? null
         : { gan: h.gan, ss: h.gan === riZhu ? '比肩' : getShiShen(riZhu, h.gan) },
  };

  // 地支藏干 + 各藏干的十神
  const zhiDetail = {};
  for (const [pos, pillar] of [['year', y], ['month', m], ['day', d], ['hour', h]]) {
    if (!pillar.zhi) continue;
    zhiDetail[pos] = {
      zhi: pillar.zhi,
      cangGan: getCangGan(pillar.zhi).map((cg) => ({
        ...cg,
        ss: cg.gan === riZhu ? '比肩' : getShiShen(riZhu, cg.gan),
      })),
    };
  }

  // 力量擂台
  const force = analyzeForce(bazi);

  // 格局
  const geJu = identifyGeJu(bazi);

  // 天干合
  const ganList = [y.gan, m.gan, d.gan, h.gan].filter(Boolean);
  const ganHe = findGanHe(ganList);
  // 标注涉及日主的合（关键信息）
  const ganHeWithRiZhu = ganHe.filter((x) => x.a === riZhu || x.b === riZhu);

  // 地支关系
  const zhiList = [y.zhi, m.zhi, d.zhi, h.zhi].filter(Boolean);
  const zhiRelations = findZhiRelations(zhiList);

  return {
    bazi,
    shiShen,
    zhiDetail,
    force: {
      dayStrength: force.dayStrength,
      sameSideScore: force.sameSideScore,
      otherSideScore: force.otherSideScore,
      sameRatio: force.sameRatio,
      congCandidate: force.congCandidate,
      scores: force.scoresNormalized,
      pairs: force.pairs,
      relations: force.relations,
      contributions: force.contributions,
    },
    geJu,
    ganHe: {
      all: ganHe,
      withRiZhu: ganHeWithRiZhu,
    },
    zhiRelations,
    notes: buildNotes({ force, geJu, ganHeWithRiZhu, zhiRelations }),
  };
}

/**
 * 自动生成给 LLM 的 "必须注意" 提醒列表
 * 对应 synthesizer-bug-prevention.md 的关键陷阱
 */
function buildNotes({ force, geJu, ganHeWithRiZhu, zhiRelations }) {
  const notes = [];

  // 正/偏对子显式提醒（防类型 A）
  for (const [group, members] of Object.entries(force.pairs)) {
    const [p1, p2] = members;
    if (Math.abs(p1.score - p2.score) > 3) {
      notes.push({
        type: 'pair_mismatch',
        group,
        dominant: p1.score > p2.score ? p1.name : p2.name,
        message: `${group} 组中 ${p1.name} (${p1.score}) vs ${p2.name} (${p2.score}) 强度差异大，分析时不能笼统称"${group}旺/弱"`,
      });
    }
  }

  // 食伤近零 + 偏财旺 的替代通道提醒（类型 G）
  const shishangScore = Math.max(force.pairs['食伤'][0].score, force.pairs['食伤'][1].score);
  const pianCaiScore = force.pairs['财'].find(x => x.name === '偏财').score;
  if (shishangScore <= 2 && pianCaiScore >= 6) {
    notes.push({
      type: 'alt_expression_channel',
      message: '食伤近零但偏财旺，表达通道换了赛道（感知驱动），不能断"无表达出口"',
    });
  }

  // 食伤近零 + 比劫有根 的替代通道提醒（类型 B）
  const biJieScore = Math.max(force.pairs['比劫'][0].score, force.pairs['比劫'][1].score);
  if (shishangScore <= 2 && biJieScore >= 4) {
    notes.push({
      type: 'alt_autonomy_channel',
      message: '食伤近零但比劫有根，仍有"安静的自主决定"，不能断"无叛逆/无自主"',
    });
  }

  // 日主合财提醒（类型 F 合/克关系）
  for (const rel of ['偏财', '正财']) {
    const rels = force.relations[rel] || [];
    if (rels.some(r => r.relation === '合')) {
      notes.push({
        type: 'rizhu_he_cai',
        message: `日主与${rel}有合，${rel}带有"情"的维度，不可简化为功能性占有`,
      });
    }
  }

  // 日主合正缘标（正官/七杀，女命用）
  for (const rel of ['正官', '七杀']) {
    const rels = force.relations[rel] || [];
    if (rels.some(r => r.relation === '合')) {
      notes.push({
        type: 'rizhu_he_guan',
        message: `日主与${rel}有合，关系中有"主动融合"意象`,
      });
    }
  }

  // 地支冲提醒
  if (zhiRelations.chong.length > 0) {
    notes.push({
      type: 'zhi_chong',
      chongs: zhiRelations.chong,
      message: `地支有冲：${zhiRelations.chong.map(c=>`${c.a}${c.b}`).join(', ')}，可能带来突发事件或环境变动`,
    });
  }

  // 从格候选
  if (force.congCandidate) {
    notes.push({
      type: 'cong_candidate',
      message: `日主同类分占比仅 ${Math.round(force.sameRatio*100)}%，疑似从格候选——若成从格，§5 身弱规则完全失效，喜忌逻辑翻转`,
    });
  }

  // 格局不清
  if (geJu.mainCandidate && geJu.mainCandidate.name === '格局不清') {
    notes.push({
      type: 'geju_unclear',
      message: '四库月无透干，格局不清，需大运流年刑冲开库后重新定格',
    });
  }

  return notes;
}

module.exports = { analyze };
