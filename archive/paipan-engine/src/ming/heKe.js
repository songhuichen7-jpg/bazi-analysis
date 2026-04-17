/**
 * 天干合、地支冲/合/三合 检测
 *
 * 天干五合：
 *   甲己合（化土）、乙庚合（化金）、丙辛合（化水）、丁壬合（化木）、戊癸合（化火）
 *
 * 地支六合（支合）：
 *   子丑合（化土）、寅亥合（化木）、卯戌合（化火）、辰酉合（化金）、巳申合（化水）、午未合（化日月，不化）
 *
 * 地支六冲：
 *   子午冲、丑未冲、寅申冲、卯酉冲、辰戌冲、巳亥冲
 *
 * 地支三合（局）：
 *   申子辰合水局、亥卯未合木局、寅午戌合火局、巳酉丑合金局
 *
 * 地支半合：三合局中任意两支（含中气支 子/卯/午/酉）
 *
 * 地支三会（方）：
 *   亥子丑会北方水、寅卯辰会东方木、巳午未会南方火、申酉戌会西方金
 */

const GAN_HE = {
  '甲己': '土', '己甲': '土',
  '乙庚': '金', '庚乙': '金',
  '丙辛': '水', '辛丙': '水',
  '丁壬': '木', '壬丁': '木',
  '戊癸': '火', '癸戊': '火',
};

const ZHI_LIU_HE = {
  '子丑':'土','丑子':'土',
  '寅亥':'木','亥寅':'木',
  '卯戌':'火','戌卯':'火',
  '辰酉':'金','酉辰':'金',
  '巳申':'水','申巳':'水',
  '午未': null,'未午': null, // 午未合日月，不化
};

const ZHI_CHONG_PAIRS = [
  ['子','午'],['丑','未'],['寅','申'],['卯','酉'],['辰','戌'],['巳','亥']
];

const SAN_HE_JU = [
  { zhi:['申','子','辰'], wx:'水', main:'子' },
  { zhi:['亥','卯','未'], wx:'木', main:'卯' },
  { zhi:['寅','午','戌'], wx:'火', main:'午' },
  { zhi:['巳','酉','丑'], wx:'金', main:'酉' },
];

const SAN_HUI = [
  { zhi:['亥','子','丑'], wx:'水', dir:'北' },
  { zhi:['寅','卯','辰'], wx:'木', dir:'东' },
  { zhi:['巳','午','未'], wx:'火', dir:'南' },
  { zhi:['申','酉','戌'], wx:'金', dir:'西' },
];

/**
 * 在给定的天干数组里找所有天干合
 * @param {string[]} gans - 如 ['甲','庚','丙','丁']
 * @returns {Array<{a, b, idx_a, idx_b, wuxing}>}
 */
function findGanHe(gans) {
  const results = [];
  for (let i = 0; i < gans.length; i++) {
    for (let j = i + 1; j < gans.length; j++) {
      const key = gans[i] + gans[j];
      if (GAN_HE[key] != null) {
        results.push({
          a: gans[i], b: gans[j],
          idx_a: i, idx_b: j,
          wuxing: GAN_HE[key],
        });
      }
    }
  }
  return results;
}

/**
 * 在地支数组里找六合、六冲、三合、三会、半合
 * @param {string[]} zhis
 */
function findZhiRelations(zhis) {
  const liuHe = [];
  const chong = [];
  const sanHe = [];
  const banHe = [];
  const sanHui = [];

  // 六合 / 六冲
  for (let i = 0; i < zhis.length; i++) {
    for (let j = i + 1; j < zhis.length; j++) {
      const k = zhis[i] + zhis[j];
      if (k in ZHI_LIU_HE) {
        liuHe.push({ a:zhis[i], b:zhis[j], idx_a:i, idx_b:j, wuxing:ZHI_LIU_HE[k] });
      }
      for (const [p, q] of ZHI_CHONG_PAIRS) {
        if ((zhis[i]===p && zhis[j]===q) || (zhis[i]===q && zhis[j]===p)) {
          chong.push({ a:zhis[i], b:zhis[j], idx_a:i, idx_b:j });
        }
      }
    }
  }

  // 三合 / 半合
  for (const ju of SAN_HE_JU) {
    const matched = ju.zhi.filter((z) => zhis.includes(z));
    if (matched.length === 3) {
      sanHe.push({ zhi:matched, wuxing:ju.wx, type:'full' });
    } else if (matched.length === 2 && matched.includes(ju.main)) {
      banHe.push({ zhi:matched, wuxing:ju.wx });
    }
  }

  // 三会
  for (const hui of SAN_HUI) {
    const matched = hui.zhi.filter((z) => zhis.includes(z));
    if (matched.length === 3) {
      sanHui.push({ zhi:matched, wuxing:hui.wx, dir:hui.dir });
    }
  }

  return { liuHe, chong, sanHe, banHe, sanHui };
}

/** 判断两地支是否冲 */
function isChong(a, b) {
  return ZHI_CHONG_PAIRS.some(([p,q]) => (a===p&&b===q)||(a===q&&b===p));
}

/** 判断两天干是否合 */
function isGanHe(a, b) {
  return (a+b) in GAN_HE;
}

module.exports = {
  GAN_HE, ZHI_LIU_HE, ZHI_CHONG_PAIRS, SAN_HE_JU, SAN_HUI,
  findGanHe, findZhiRelations, isChong, isGanHe,
};
