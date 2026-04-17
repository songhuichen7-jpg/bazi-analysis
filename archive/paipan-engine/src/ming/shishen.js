/**
 * 十神计算（以日主为参照）
 *
 * 规则：
 *   - 同我者 → 比劫（同五行）
 *       同阴阳：比肩；异阴阳：劫财
 *   - 我生者 → 食伤
 *       同阴阳：食神；异阴阳：伤官
 *   - 我克者 → 财
 *       同阴阳：偏财；异阴阳：正财
 *   - 克我者 → 官杀
 *       同阴阳：七杀；异阴阳：正官
 *   - 生我者 → 印
 *       同阴阳：偏印；异阴阳：正印
 */

const {
  GAN_WUXING, GAN_YINYANG,
  WUXING_SHENG, WUXING_KE,
} = require('./ganzhi');

/**
 * 计算 gan 对 riZhu 的十神关系
 * @param {string} riZhu - 日主天干
 * @param {string} gan - 目标天干
 * @returns {string} 十神名
 */
function getShiShen(riZhu, gan) {
  const riWx = GAN_WUXING[riZhu];
  const riYy = GAN_YINYANG[riZhu];
  const gWx = GAN_WUXING[gan];
  const gYy = GAN_YINYANG[gan];
  const sameYy = riYy === gYy;

  if (gWx === riWx) return sameYy ? '比肩' : '劫财';
  if (WUXING_SHENG[riWx] === gWx) return sameYy ? '食神' : '伤官';
  if (WUXING_KE[riWx] === gWx) return sameYy ? '偏财' : '正财';
  if (WUXING_KE[gWx] === riWx) return sameYy ? '七杀' : '正官';
  if (WUXING_SHENG[gWx] === riWx) return sameYy ? '偏印' : '正印';
  return '未知';
}

// 十神分组
const SHI_SHEN_PAIRS = {
  比劫: ['比肩', '劫财'],
  食伤: ['食神', '伤官'],
  财:   ['正财', '偏财'],
  官杀: ['正官', '七杀'],
  印:   ['正印', '偏印'],
};

// 反查：某十神属于哪一类
function getShiShenGroup(shishen) {
  for (const [k, v] of Object.entries(SHI_SHEN_PAIRS)) {
    if (v.includes(shishen)) return k;
  }
  return null;
}

module.exports = { getShiShen, getShiShenGroup, SHI_SHEN_PAIRS };
