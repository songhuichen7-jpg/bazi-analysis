/**
 * 力量擂台（§4）
 *
 * 每个十神从 4 个维度评估：
 *   1. 透干（出现在天干） — 高权重
 *   2. 得令（月令本气） — 最高权重
 *   3. 根（地支藏干中的数量和质量） — 高权重
 *   4. 合/克（被合走或被克）— 中权重（减分）
 *
 * 最终产出：
 *   - 每个十神的原始得分（0-10 尺度）
 *   - 日主本身的强弱（同类 = 比劫+印；异类 = 食伤+财+官杀）
 *   - 正/偏对子的显式对比（防止类型 A bug）
 *   - 日主与各十神的合/克/生关系（防止类型 F bug）
 */

const { GAN_WUXING, WUXING_SHENG, WUXING_KE } = require('./ganzhi');
const { getShiShen, SHI_SHEN_PAIRS } = require('./shishen');
const { getCangGan, getBenQi } = require('./cangGan');
const { findGanHe, isGanHe } = require('./heKe');

// 力量权重配置（可后续调参）
const WEIGHTS = {
  tougan: 3.0,      // 透干
  deling: 4.0,      // 得令（月令本气）
  rootBenQi: 2.0,   // 地支本气根
  rootZhongQi: 1.0, // 地支中气根
  rootYuQi: 0.5,    // 地支余气根
  heDiscount: 0.4,  // 被合走，减到原 40%
  keDiscount: 0.6,  // 被邻干克，减到原 60%
};

const ALL_SHI_SHEN = [
  '比肩','劫财','食神','伤官','正财','偏财','正官','七杀','正印','偏印',
];

/**
 * 计算各十神的力量
 * @param {Object} bazi - { yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi, hourGan, hourZhi }
 * @returns {Object}
 */
function analyzeForce(bazi) {
  const { yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi, hourGan, hourZhi } = bazi;
  const riZhu = dayGan;

  // 天干列表（排除日主本位，但日主的十神归为"比肩"）
  const gans = [
    { gan: yearGan,  pos: '年干' },
    { gan: monthGan, pos: '月干' },
    { gan: dayGan,   pos: '日干' },   // 日主本身
    { gan: hourGan,  pos: '时干' },
  ].filter((x) => x.gan);

  // 地支列表
  const zhis = [
    { zhi: yearZhi,  pos: '年支' },
    { zhi: monthZhi, pos: '月支' },
    { zhi: dayZhi,   pos: '日支' },
    { zhi: hourZhi,  pos: '时支' },
  ].filter((x) => x.zhi);

  // 初始化得分表
  const scores = {};
  const contributions = {}; // 详细来源
  for (const s of ALL_SHI_SHEN) {
    scores[s] = 0;
    contributions[s] = { tougan: [], deling: null, roots: [], adjustments: [] };
  }

  // 1) 透干（不含日主本身，日主是比肩的"本位"）
  for (const { gan, pos } of gans) {
    if (pos === '日干') continue;
    const ss = getShiShen(riZhu, gan);
    scores[ss] += WEIGHTS.tougan;
    contributions[ss].tougan.push({ gan, pos });
  }

  // 2) 得令：月支本气转成十神
  const monthBenQi = getBenQi(monthZhi);
  if (monthBenQi) {
    const delingSs = (monthBenQi === riZhu) ? '比肩' : getShiShen(riZhu, monthBenQi);
    scores[delingSs] += WEIGHTS.deling;
    contributions[delingSs].deling = { monthZhi, benQi: monthBenQi };
  }

  // 3) 根：所有地支藏干
  for (const { zhi, pos } of zhis) {
    const cg = getCangGan(zhi);
    for (const { gan, weight, role } of cg) {
      const ss = (gan === riZhu) ? '比肩' : getShiShen(riZhu, gan);
      // 月支本气已在得令算过，避免重复
      if (pos === '月支' && role === '本气') continue;
      const w = role === '本气' ? WEIGHTS.rootBenQi
            : role === '中气' ? WEIGHTS.rootZhongQi
            : WEIGHTS.rootYuQi;
      scores[ss] += w * weight;
      contributions[ss].roots.push({ zhi, pos, gan, role, weight: w * weight });
    }
  }

  // 4) 合/克调整（仅对透干的天干）
  const ganList = gans.map((x) => x.gan);
  const heList = findGanHe(ganList);

  for (const he of heList) {
    for (const g of [he.a, he.b]) {
      if (g === riZhu) continue; // 日主被合，另外算
      const ss = getShiShen(riZhu, g);
      const reduction = scores[ss] * (1 - WEIGHTS.heDiscount);
      scores[ss] -= reduction;
      contributions[ss].adjustments.push({
        type: '被合',
        with: (g === he.a) ? he.b : he.a,
        reduction: Math.round(reduction * 10) / 10,
      });
    }
  }

  // 归一化到 0-10 尺度（取最高分为 10）
  const maxScore = Math.max(...Object.values(scores), 1);
  const normalized = {};
  for (const s of ALL_SHI_SHEN) {
    normalized[s] = Math.round((scores[s] / maxScore) * 10 * 10) / 10;
  }

  // 日主强弱：同类分（比劫+印）vs 异类分（食伤+财+官杀）
  const sameSideScore =
    scores['比肩'] + scores['劫财'] + scores['正印'] + scores['偏印'];
  const otherSideScore =
    scores['食神'] + scores['伤官'] + scores['正财'] + scores['偏财'] +
    scores['正官'] + scores['七杀'];
  const totalScore = sameSideScore + otherSideScore;
  const sameRatio = totalScore > 0 ? sameSideScore / totalScore : 0;

  let dayStrength;
  if (sameRatio >= 0.55) dayStrength = '身强';
  else if (sameRatio <= 0.35) dayStrength = '身弱';
  else dayStrength = '中和';

  // 极弱从格候选（同类 ≤ 15%）
  const congCandidate = sameRatio <= 0.15;

  // 正/偏对子显式对比（防类型 A）
  const pairs = {};
  for (const [group, members] of Object.entries(SHI_SHEN_PAIRS)) {
    pairs[group] = members.map((m) => ({ name: m, score: normalized[m], raw: scores[m] }));
  }

  // 日主与各十神的合/克/生关系（防类型 F）
  const relations = {};
  for (const s of ALL_SHI_SHEN) {
    relations[s] = getRiZhuRelation(riZhu, s, { ganList, zhis, heList });
  }

  return {
    riZhu,
    scoresRaw: scores,
    scoresNormalized: normalized,
    contributions,
    dayStrength,
    sameSideScore: Math.round(sameSideScore * 10) / 10,
    otherSideScore: Math.round(otherSideScore * 10) / 10,
    sameRatio: Math.round(sameRatio * 100) / 100,
    congCandidate,
    pairs,
    relations,
  };
}

/**
 * 日主与某十神的关系（合/克/生）
 * 判断方式：
 *   - 查该十神对应的天干在命盘里出现过
 *   - 判断每个出现位置与日主的关系（天干层面的合/克/生）
 */
function getRiZhuRelation(riZhu, shiShen, ctx) {
  const { ganList } = ctx;
  const results = [];

  // 找出命盘中所有对应该十神的天干位置
  for (let i = 0; i < ganList.length; i++) {
    const g = ganList[i];
    if (g === riZhu) continue;
    if (getShiShen(riZhu, g) !== shiShen) continue;

    // 与日主的关系
    const gw = GAN_WUXING[g];
    const rw = GAN_WUXING[riZhu];
    let rel;
    if (isGanHe(riZhu, g)) rel = '合';
    else if (WUXING_KE[rw] === gw) rel = '日主克';
    else if (WUXING_KE[gw] === rw) rel = '克日主';
    else if (WUXING_SHENG[rw] === gw) rel = '日主生';
    else if (WUXING_SHENG[gw] === rw) rel = '生日主';
    else if (gw === rw) rel = '同类';
    else rel = '无关';

    results.push({ gan: g, position: i, relation: rel });
  }
  return results;
}

module.exports = { analyzeForce, WEIGHTS };
