/**
 * 梅花易数·时间起卦 — MVP
 * 用 lunar-javascript 取当下农历年/月/日 + 时辰，按经典公式起本卦 + 动爻。
 * 本卦从 data/zhouyi/gua64.json 查表。
 */

const fs = require('fs');
const path = require('path');
const { Solar } = require('lunar-javascript');

const GUA64 = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'zhouyi', 'gua64.json'), 'utf8')
);

// 八卦序：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8（梅花易数顺序）
const TRIGRAM_NAMES = ['乾','兑','离','震','巽','坎','艮','坤'];

// 八卦组合 → 64卦在 GUA64 数组里的 id（基于周易经典顺序，先按 upper-lower 索引）
const COMBO_INDEX = (() => {
  const m = {};
  for (const g of GUA64) {
    const u = TRIGRAM_NAMES.indexOf(g.upper) + 1;
    const l = TRIGRAM_NAMES.indexOf(g.lower) + 1;
    if (u > 0 && l > 0) m[u * 10 + l] = g.id;
  }
  return m;
})();

// 地支序号：子1, 丑2, ..., 亥12
const ZHI_INDEX = { 子:1,丑:2,寅:3,卯:4,辰:5,巳:6,午:7,未:8,申:9,酉:10,戌:11,亥:12 };

// 时辰序号：23-1 子=1, 1-3 丑=2 ... 21-23 亥=12
function hourToZhiIndex(hour) {
  // 子时跨日：23点也算子时
  if (hour === 23 || hour === 0) return 1;
  // 1-2 丑, 3-4 寅, ...
  return Math.floor((hour + 1) / 2) + 1;
}

function mod(n, m) {
  const r = n % m;
  return r === 0 ? m : r;
}

/**
 * Build gua at a given moment (defaults to now).
 * Returns { id, name, symbol, upper, lower, guaci, daxiang, dongyao, drawnAt, source }
 */
function castGua(at = new Date()) {
  const solar = Solar.fromYmdHms(
    at.getFullYear(), at.getMonth() + 1, at.getDate(),
    at.getHours(), at.getMinutes(), at.getSeconds()
  );
  const lunar = solar.getLunar();
  // 农历年支
  const yearGz = lunar.getYearInGanZhi();           // e.g. "丙午"
  const yearZhi = yearGz[1];                         // 第二个字 = 支
  const yearZhiIdx = ZHI_INDEX[yearZhi] || 1;
  // 农历月（数字 1-12，闰月暂按本月）
  const lMonth = Math.abs(lunar.getMonth());
  const lDay = lunar.getDay();
  const hourZhiIdx = hourToZhiIndex(at.getHours());

  const sumUpper = yearZhiIdx + lMonth + lDay;
  const sumLower = sumUpper + hourZhiIdx;

  const upperIdx = mod(sumUpper, 8); // 1-8
  const lowerIdx = mod(sumLower, 8);
  const dongyao  = mod(sumLower, 6); // 1-6, 1=初爻

  const id = COMBO_INDEX[upperIdx * 10 + lowerIdx];
  const gua = GUA64.find(g => g.id === id);
  if (!gua) {
    throw new Error('gua lookup failed: upper=' + upperIdx + ' lower=' + lowerIdx);
  }

  return {
    id: gua.id,
    name: gua.name,
    symbol: gua.symbol,
    upper: gua.upper,
    lower: gua.lower,
    guaci: gua.guaci,
    daxiang: gua.daxiang,
    dongyao,
    drawnAt: solar.toYmdHms(),
    source: {
      yearGz,
      yearZhi,
      yearZhiIdx,
      lunarMonth: lMonth,
      lunarDay: lDay,
      hourZhiIdx,
      sumUpper,
      sumLower,
      formula: `上卦 (${yearZhiIdx}+${lMonth}+${lDay})mod8 = ${upperIdx} ${TRIGRAM_NAMES[upperIdx-1]} / `
             + `下卦 (${sumUpper}+${hourZhiIdx})mod8 = ${lowerIdx} ${TRIGRAM_NAMES[lowerIdx-1]} / `
             + `动爻 mod6 = ${dongyao}`,
    },
  };
}

module.exports = { castGua, GUA64 };
