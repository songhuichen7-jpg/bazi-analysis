/**
 * 真太阳时修正 + 均时差
 *
 * 标准时（北京时 UTC+8，120°E）→ 真太阳时
 *
 * 修正分两部分：
 *   1. 经度时差：每经度 4 分钟。用户所在经度 L（东经正值），
 *      相对 120°E 的时差 = (L - 120) * 4 分钟
 *   2. 均时差（Equation of Time, EoT）：地球轨道离心率+黄赤交角
 *      造成的太阳相对于平太阳的快慢。使用 Meeus 简化公式，
 *      精度约 ±1 分钟，足够命理使用。
 */

/**
 * 均时差（分钟），基于 Meeus《天文算法》简化式
 * @param {Date} date - UTC Date
 * @returns {number} 均时差分钟数（正：真太阳快于平太阳）
 */
function equationOfTime(date) {
  // N = 一年中的第几天（从 1 月 1 日起）
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  const N = Math.floor(diff / 86400000);

  // B = 2π(N-81)/365
  const B = (2 * Math.PI * (N - 81)) / 365;

  // EoT = 9.87 sin(2B) - 7.53 cos(B) - 1.5 sin(B)   分钟
  const eot =
    9.87 * Math.sin(2 * B) -
    7.53 * Math.cos(B) -
    1.5 * Math.sin(B);
  return eot;
}

/**
 * 把北京时间转换成真太阳时
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} day
 * @param {number} hour - 0-23
 * @param {number} minute - 0-59
 * @param {number} longitude - 东经为正，西经为负
 * @returns {{year, month, day, hour, minute, shiftMinutes, eotMinutes, longitudeMinutes}}
 */
function toTrueSolarTime(year, month, day, hour, minute, longitude) {
  // 北京时的 UTC 时间戳
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0));

  // 经度时差（分钟）
  const longitudeMinutes = (longitude - 120) * 4;

  // 均时差（分钟）
  const eotMinutes = equationOfTime(utcDate);

  // 总修正
  const shiftMinutes = longitudeMinutes + eotMinutes;

  // 应用到北京时间上
  const correctedMs = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    0
  ).getTime() + shiftMinutes * 60 * 1000;
  const corrected = new Date(correctedMs);

  return {
    year: corrected.getFullYear(),
    month: corrected.getMonth() + 1,
    day: corrected.getDate(),
    hour: corrected.getHours(),
    minute: corrected.getMinutes(),
    shiftMinutes: Math.round(shiftMinutes * 10) / 10,
    eotMinutes: Math.round(eotMinutes * 10) / 10,
    longitudeMinutes: Math.round(longitudeMinutes * 10) / 10,
  };
}

module.exports = { toTrueSolarTime, equationOfTime };
