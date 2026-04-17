/**
 * 排盘主封装层
 *
 * 输入：钟表出生时间 + 出生地 + 性别 + 子时派 + 是否修正真太阳时
 * 输出：标准化的八字对象（四柱 / 十神 / 大运 / 警告 / 元数据）
 *
 * 处理顺序：
 *   钟表时间
 *     → DST 修正（1986-1991 夏季）
 *     → 真太阳时修正（可选）
 *     → 子时归属转换（早/晚子时派）
 *     → 节气交界检查（输出警告，不改时间）
 *     → lunar-javascript 排盘
 */

const { Solar } = require('lunar-javascript');
const { toTrueSolarTime } = require('./solarTime');
const { correctChinaDst } = require('./chinaDst');
const { convertToLateZiConvention, checkJieqiBoundary } = require('./ziHourAndJieqi');
const { getCityCoords } = require('./cities');

/**
 * @param {Object} opts
 * @param {number} opts.year - 钟表时间，公历年
 * @param {number} opts.month - 1-12
 * @param {number} opts.day
 * @param {number} opts.hour - 0-23（若时辰未知可传 -1）
 * @param {number} opts.minute - 0-59
 * @param {string} opts.city - 城市名，用于真太阳时修正
 * @param {number} [opts.longitude] - 直接提供经度（优先于 city）
 * @param {'male'|'female'} opts.gender
 * @param {'early'|'late'} [opts.ziConvention='early'] - 子时派
 * @param {boolean} [opts.useTrueSolarTime=true] - 是否修正真太阳时
 * @returns {Object}
 */
function paipan(opts) {
  const {
    year, month, day, hour, minute,
    city, longitude,
    gender,
    ziConvention = 'early',
    useTrueSolarTime = true,
  } = opts;

  const warnings = [];
  const meta = {
    input: { year, month, day, hour, minute },
    corrections: [],
  };

  // 未知时辰处理
  const hourUnknown = hour === -1;
  let h = hourUnknown ? 12 : hour; // 占位
  let mi = minute || 0;
  let y = year, mo = month, d = day;

  // Step 1: DST 修正
  if (!hourUnknown) {
    const dst = correctChinaDst(y, mo, d, h, mi);
    if (dst.wasDst) {
      meta.corrections.push({
        type: 'china_dst',
        from: `${y}-${mo}-${d} ${h}:${mi}`,
        to: `${dst.year}-${dst.month}-${dst.day} ${dst.hour}:${dst.minute}`,
      });
      y = dst.year; mo = dst.month; d = dst.day; h = dst.hour; mi = dst.minute;
      warnings.push('1986-1991 中国实行过夏令时，已自动减 1 小时。若你不确定当时是否用夏令时，请核对。');
    }
  }

  // Step 2: 真太阳时
  let lng = longitude;
  let resolvedCity = null;
  if (lng == null && city) {
    const c = getCityCoords(city);
    if (c) { lng = c.lng; resolvedCity = c.canonical; }
  }
  if (useTrueSolarTime && !hourUnknown && city && lng == null) {
    // 用户勾了"修正真太阳时"+ 输入了城市，但我们没认出来。明确告知，别静默跳过。
    warnings.push(`未识别城市"${city}"，未做真太阳时修正。可以换个常见行政名（例如"北京"、"长沙"、"苏州"），或在高级选项里关闭"修正真太阳时"。`);
    meta.cityUnknown = true;
  }
  if (useTrueSolarTime && !hourUnknown && lng != null) {
    const t = toTrueSolarTime(y, mo, d, h, mi, lng);
    meta.corrections.push({
      type: 'true_solar_time',
      longitude: lng,
      longitudeMinutes: t.longitudeMinutes,
      eotMinutes: t.eotMinutes,
      shiftMinutes: t.shiftMinutes,
      resolvedCity,
      from: `${y}-${mo}-${d} ${h}:${mi}`,
      to: `${t.year}-${t.month}-${t.day} ${t.hour}:${t.minute}`,
    });
    y = t.year; mo = t.month; d = t.day; h = t.hour; mi = t.minute;
  }

  // Step 3: 子时派转换
  if (!hourUnknown && ziConvention === 'late') {
    const z = convertToLateZiConvention(y, mo, d, h, mi);
    if (z.converted) {
      meta.corrections.push({
        type: 'late_zi',
        from: `${y}-${mo}-${d} ${h}:${mi}`,
        to: `${z.year}-${z.month}-${z.day} ${z.hour}:${z.minute}`,
      });
      y = z.year; mo = z.month; d = z.day; h = z.hour; mi = z.minute;
    }
  }

  // Step 4: 节气交界检查
  if (!hourUnknown) {
    const jq = checkJieqiBoundary(y, mo, d, h, mi);
    if (jq.isNearBoundary) warnings.push(jq.hint);
    meta.jieqiCheck = jq;
  }

  // Step 5: lunar-javascript 排盘
  const solar = Solar.fromYmdHms(y, mo, d, h, mi, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();

  const result = {
    sizhu: {
      year: ec.getYear(),
      month: ec.getMonth(),
      day: ec.getDay(),
      hour: hourUnknown ? null : ec.getTime(),
    },
    rizhu: ec.getDayGan(),
    shishen: {
      year: ec.getYearShiShenGan(),
      month: ec.getMonthShiShenGan(),
      hour: hourUnknown ? null : ec.getTimeShiShenGan(),
    },
    cangGan: {
      year: ec.getYearHideGan(),
      month: ec.getMonthHideGan(),
      day: ec.getDayHideGan(),
      hour: hourUnknown ? null : ec.getTimeHideGan(),
    },
    naYin: {
      year: ec.getYearNaYin(),
      month: ec.getMonthNaYin(),
      day: ec.getDayNaYin(),
      hour: hourUnknown ? null : ec.getTimeNaYin(),
    },
    dayun: [],
    lunar: lunar.toString(),
    solarCorrected: `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`,
    warnings,
    meta,
    hourUnknown,
  };

  // 今天所属的"立春年"年柱（用于 UI 高亮 current 大运/流年）
  {
    const now = new Date();
    const today = Solar.fromYmdHms(now.getFullYear(), now.getMonth()+1, now.getDate(), 12, 0, 0);
    const todayEc = today.getLunar().getEightChar();
    result.todayYearGz = todayEc.getYear();
    result.todayMonthGz = todayEc.getMonth();
    result.todayDayGz = todayEc.getDay();
    result.todayYmd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  // 大运：只依赖月柱和性别，未知时辰也能算
  {
    const yun = ec.getYun(gender === 'male' ? 1 : 0);
    const startSolar = yun.getStartSolar();
    result.dayun = {
      startSolar: startSolar.toYmd(),
      startAge: yun.getStartYear() + yun.getStartMonth() / 12 + yun.getStartDay() / 365,
      startYearsDesc: `${yun.getStartYear()}年${yun.getStartMonth()}月${yun.getStartDay()}天后起运`,
      list: yun.getDaYun().slice(1, 9).map((dy) => ({
        index: dy.getIndex(),
        ganzhi: dy.getGanZhi(),
        startAge: dy.getStartAge(),
        startYear: dy.getStartYear(),
        endYear:   dy.getEndYear(),
        // 10 流年 — 用 lunar-javascript 的 LiuNian（自动按立春切年柱）
        liunian: dy.getLiuNian().map((ly) => ({
          year: ly.getYear(),
          ganzhi: ly.getGanZhi(),
          age: ly.getAge(),
        })),
      })),
    };
  }

  return result;
}

module.exports = { paipan };
