/**
 * 中国 1986-1991 年夏令时修正
 *
 * 中国从 1986 年至 1991 年实行过 6 年夏令时（简称 DST）。
 * 每年 4-5 月的某个周日 02:00 起拨快 1 小时，
 * 9 月的某个周日 02:00 起拨回 1 小时。
 *
 * 处于 DST 期间的出生时间，钟表显示时比真实太阳钟早 1 小时，
 * 排八字时必须先减 1 小时再做后续处理。
 *
 * 数据来源：国务院 1986 年 4 月 12 日发布的关于实行夏令时的通知，
 * 及国务院 1992 年 4 月 5 日发布的关于停止实行夏令时的通知。
 */

// 每年 DST 的起止日期（闭区间起，闭区间止 00:00 - 不含结束日 02:00 之后）
const CHINA_DST_PERIODS = [
  // 年份, 开始 [月,日], 结束 [月,日]
  { year: 1986, start: [5, 4],  end: [9, 14] },
  { year: 1987, start: [4, 12], end: [9, 13] },
  { year: 1988, start: [4, 10], end: [9, 11] },
  { year: 1989, start: [4, 16], end: [9, 17] },
  { year: 1990, start: [4, 15], end: [9, 16] },
  { year: 1991, start: [4, 14], end: [9, 15] },
];

/**
 * 判断指定的"钟表显示时间"是否处于中国夏令时期间
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} day
 * @param {number} hour - 0-23
 * @returns {boolean}
 */
function isChinaDst(year, month, day, hour) {
  const period = CHINA_DST_PERIODS.find((p) => p.year === year);
  if (!period) return false;

  const ts = new Date(year, month - 1, day, hour, 0, 0).getTime();
  // 开始：起始日 02:00
  const startTs = new Date(year, period.start[0] - 1, period.start[1], 2, 0, 0).getTime();
  // 结束：结束日 02:00（含该日 00:00-02:00）
  const endTs = new Date(year, period.end[0] - 1, period.end[1], 2, 0, 0).getTime();

  return ts >= startTs && ts < endTs;
}

/**
 * 如果在 DST 期间，返回真实太阳时对应的钟表时间（减 1 小时）
 * @returns {{year, month, day, hour, minute, wasDst}}
 */
function correctChinaDst(year, month, day, hour, minute) {
  const inDst = isChinaDst(year, month, day, hour);
  if (!inDst) {
    return { year, month, day, hour, minute, wasDst: false };
  }
  const d = new Date(year, month - 1, day, hour - 1, minute, 0);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    wasDst: true,
  };
}

module.exports = { isChinaDst, correctChinaDst, CHINA_DST_PERIODS };
