/**
 * 子时归属 + 节气交界日提示
 *
 * 1) 子时归属
 *    - 早子时派（lunar-javascript 默认）：
 *        23:00-00:00 属当日，00:00-01:00 属次日
 *    - 晚子时派：23:00 起已换日，23:00-01:00 整段都属次日
 *
 *    我们保留早子时作为默认，并提供晚子时转换：把 23 点时间加 1 小时，
 *    这样进入库时就会被认为是次日 00 点，自然归次日。
 *
 * 2) 节气交界日提示
 *    年柱、月柱的换柱瞬间就是节气时刻（定气法）。
 *    若出生时间距离最近的节气时刻在阈值内（默认 ±120 分钟），
 *    提示用户："你的出生时间在节气交界附近，月柱可能是 X 或 Y"。
 */

const { Solar } = require('lunar-javascript');

/**
 * 把输入时间按"晚子时派"转换为等效的"早子时"输入。
 * 只有 hour === 23 时需要加 1 小时（进入次日 00:xx）。
 */
function convertToLateZiConvention(year, month, day, hour, minute) {
  if (hour !== 23) {
    return { year, month, day, hour, minute, converted: false };
  }
  const d = new Date(year, month - 1, day, hour + 1, minute, 0);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    converted: true,
  };
}

// 12 个影响月柱的节气（节，非中气）
const MONTH_JIE_NAMES = [
  '立春', '惊蛰', '清明', '立夏', '芒种', '小暑',
  '立秋', '白露', '寒露', '立冬', '大雪', '小寒',
];

/**
 * 检查出生时间是否接近节气交界
 * @param {number} year/.../minute
 * @param {number} thresholdMinutes - 阈值分钟数
 * @returns {{isNearBoundary, jieqi, jieqiTime, minutesDiff, hint}}
 */
function checkJieqiBoundary(year, month, day, hour, minute, thresholdMinutes = 120) {
  const solar = Solar.fromYmdHms(year, month - 1 + 1, day, hour, minute, 0);
  const lunar = solar.getLunar();

  // 取当年和相邻年的所有 jieqi 表，找距离输入时间最近的"节"
  const birthTs = new Date(year, month - 1, day, hour, minute, 0).getTime();

  let closest = null;
  for (const targetYear of [year - 1, year, year + 1]) {
    const l = Solar.fromYmdHms(targetYear, 6, 1, 0, 0, 0).getLunar();
    const table = l.getJieQiTable();
    for (const name of MONTH_JIE_NAMES) {
      const s = table[name];
      if (!s) continue;
      const t = new Date(
        s.getYear(), s.getMonth() - 1, s.getDay(),
        s.getHour(), s.getMinute(), s.getSecond()
      ).getTime();
      const diff = Math.abs(t - birthTs);
      if (!closest || diff < closest.diff) {
        closest = { name, solar: s, ts: t, diff };
      }
    }
  }

  const minutesDiff = closest ? Math.round(closest.diff / 60000) : null;
  const isNearBoundary = closest ? minutesDiff <= thresholdMinutes : false;

  let hint = null;
  if (isNearBoundary) {
    const s = closest.solar;
    const timeStr = `${s.getYear()}-${String(s.getMonth()).padStart(2,'0')}-${String(s.getDay()).padStart(2,'0')} ${String(s.getHour()).padStart(2,'0')}:${String(s.getMinute()).padStart(2,'0')}`;
    hint = `你的出生时间距离「${closest.name}」（${timeStr}）仅 ${minutesDiff} 分钟，年柱或月柱在此节气前后不同，请仔细核对出生时间是否精确。`;
  }

  return {
    isNearBoundary,
    jieqi: closest ? closest.name : null,
    jieqiTime: closest ? closest.solar : null,
    minutesDiff,
    hint,
  };
}

module.exports = { convertToLateZiConvention, checkJieqiBoundary };
