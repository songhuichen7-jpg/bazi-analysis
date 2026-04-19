const BENQI = {
  '子': '癸', '丑': '己', '寅': '甲', '卯': '乙', '辰': '戊',
  '巳': '丙', '午': '丁', '未': '己', '申': '庚', '酉': '辛',
  '戌': '戊', '亥': '壬',
};

const GAN_YANG = {
  '甲': true, '乙': false, '丙': true, '丁': false, '戊': true,
  '己': false, '庚': true, '辛': false, '壬': true, '癸': false,
};

const GAN_WX = {
  '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土',
  '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水',
};

function wxRelation(from, to) {
  if (!from || !to) return 'same';
  if (from === to) return 'same';
  if (
    (from === '木' && to === '火') ||
    (from === '火' && to === '土') ||
    (from === '土' && to === '金') ||
    (from === '金' && to === '水') ||
    (from === '水' && to === '木')
  ) return 'sheng';
  if (
    (from === '木' && to === '土') ||
    (from === '土' && to === '水') ||
    (from === '水' && to === '火') ||
    (from === '火' && to === '金') ||
    (from === '金' && to === '木')
  ) return 'ke';
  if (
    (to === '木' && from === '火') ||
    (to === '火' && from === '土') ||
    (to === '土' && from === '金') ||
    (to === '金' && from === '水') ||
    (to === '水' && from === '木')
  ) return 'shengBy';
  return 'keBy';
}

function ssLookup(dayGan, otherGan) {
  const a = GAN_WX[dayGan];
  const b = GAN_WX[otherGan];
  const samePolarity = GAN_YANG[dayGan] === GAN_YANG[otherGan];
  switch (wxRelation(a, b)) {
    case 'same':
      return samePolarity ? '比肩' : '劫财';
    case 'sheng':
      return samePolarity ? '食神' : '伤官';
    case 'ke':
      return samePolarity ? '偏财' : '正财';
    case 'keBy':
      return samePolarity ? '七杀' : '正官';
    case 'shengBy':
      return samePolarity ? '偏印' : '正印';
    default:
      return '';
  }
}

function todayYear(rawChart) {
  const year = Number(String(rawChart?.todayYmd || '').slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
}

function buildBirthLabel(birthInfo) {
  if (!birthInfo) return '未命名命盘';
  const gender = birthInfo.gender === 'female' ? '女' : '男';
  const date = birthInfo.date || '';
  const time = birthInfo.hourUnknown ? '' : (birthInfo.time || '');
  return `${gender} · ${date}${time ? ' ' + time : ''}`;
}

export function birthInputToBirthInfo(birthInput = {}) {
  const hourUnknown = birthInput.hour === -1;
  const minute = Number.isFinite(birthInput.minute) ? birthInput.minute : 0;
  const hour = Number.isFinite(birthInput.hour) ? birthInput.hour : 0;
  return {
    date: [
      birthInput.year,
      String(birthInput.month || '').padStart(2, '0'),
      String(birthInput.day || '').padStart(2, '0'),
    ].join('-'),
    time: hourUnknown ? '' : `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hourUnknown,
    city: birthInput.city || '',
    gender: birthInput.gender || 'male',
    ziConvention: birthInput.ziConvention || 'early',
    trueSolar: birthInput.useTrueSolarTime !== false,
  };
}

function buildDayun(rawChart) {
  const dayGan = rawChart?.rizhu || rawChart?.sizhu?.day?.[0] || '';
  const list = rawChart?.dayun?.list || [];
  const currentYear = todayYear(rawChart);
  return list.map((step) => {
    const gz = step?.ganzhi || '';
    const gan = gz[0] || '';
    const zhi = gz[1] || '';
    const liunian = step?.liunian || [];
    const years = liunian.map((year) => {
      const yearGz = year?.ganzhi || '';
      const yearGan = yearGz[0] || '';
      const yearZhi = yearGz[1] || '';
      return {
        year: year?.year,
        gz: yearGz,
        ss: `${ssLookup(dayGan, yearGan)}/${ssLookup(dayGan, BENQI[yearZhi] || yearGan)}`,
        current: year?.year === currentYear,
      };
    });
    return {
      age: step?.startAge,
      gz,
      ss: `${ssLookup(dayGan, gan)}/${ssLookup(dayGan, BENQI[zhi] || gan)}`,
      startYear: step?.startYear,
      endYear: step?.endYear ?? ((step?.startYear ?? currentYear) + 10),
      current: years.some((year) => year.current),
      years,
    };
  });
}

export function chartListItemToEntry(item = {}) {
  return {
    id: item.id,
    label: item.label || '未命名命盘',
    createdAt: item.created_at ? Date.parse(item.created_at) : Date.now(),
    updatedAt: item.updated_at ? Date.parse(item.updated_at) : Date.now(),
    loaded: false,
  };
}

export function chartResponseToEntry(response = {}) {
  const detail = response.chart || {};
  const rawChart = detail.paipan || {};
  const birthInfo = birthInputToBirthInfo(detail.birth_input || {});
  return {
    id: detail.id,
    label: detail.label || buildBirthLabel(birthInfo),
    createdAt: detail.created_at ? Date.parse(detail.created_at) : Date.now(),
    updatedAt: detail.updated_at ? Date.parse(detail.updated_at) : Date.now(),
    birthInfo,
    paipan: {
      sizhu: rawChart.sizhu || {},
      shishen: rawChart.shishen || {},
      cangGan: rawChart.cangGan || {},
    },
    force: [],
    guards: [],
    dayun: buildDayun(rawChart),
    meta: {
      rizhu: rawChart.sizhu?.day || '',
      rizhuGan: rawChart.rizhu || rawChart.sizhu?.day?.[0] || '',
      dayStrength: '',
      sameSideScore: null,
      otherSideScore: null,
      geju: '',
      gejuNote: '',
      yongshen: '',
      lunar: rawChart.lunar || '',
      solarCorrected: rawChart.solarCorrected || '',
      warnings: rawChart.warnings || [],
      corrections: rawChart.meta?.corrections || [],
      jieqiCheck: rawChart.meta?.jieqiCheck || null,
      hourUnknown: rawChart.hourUnknown === true,
      today: {
        ymd: rawChart.todayYmd || '',
        yearGz: rawChart.todayYearGz || '',
        monthGz: rawChart.todayMonthGz || '',
        dayGz: rawChart.todayDayGz || '',
      },
      input: {
        ...(rawChart.meta?.input || {}),
        gender: detail.birth_input?.gender || 'male',
        city: detail.birth_input?.city || '',
      },
    },
    loaded: true,
  };
}
