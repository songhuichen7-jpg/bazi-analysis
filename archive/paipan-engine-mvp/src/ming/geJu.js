/**
 * 格局识别（§2）
 *
 * 月令三类规则（子平真诠第8、16、45章）：
 *   - 四仲月（子午卯酉）：专气单一，月令本气透干即成格
 *   - 四孟月（寅申巳亥）：两藏干，透哪个取哪格；都不透取本气
 *   - 四库月（辰戌丑未）：须透干方可取格；不透则格局不清
 *
 * 建禄月劫格（第45章）：
 *   月令本气 = 日主比肩/劫财/禄神 时，改从天干透出的其他十神定格
 *   （因为"自己不能当用神"）
 *
 * 本模块输出候选格局 + 来源诊断，成败判断和相神分析由 LLM 基于原文做。
 */

const { ZHI_CATEGORY } = require('./ganzhi');
const { getCangGan, getBenQi } = require('./cangGan');
const { getShiShen } = require('./shishen');

// 十神 → 格局名（只列常用；建禄/阳刃特殊处理）
const SHI_SHEN_TO_GE = {
  正官: '正官格',
  七杀: '七杀格',
  正财: '正财格',
  偏财: '偏财格',
  正印: '正印格',
  偏印: '偏印格',
  食神: '食神格',
  伤官: '伤官格',
  比肩: '建禄格',   // 月令本气为日主比肩 → 建禄
  劫财: '月刃格',   // 月令本气为日主劫财 → 月刃（又称阳刃格）
};

/**
 * 识别格局候选
 * @param {Object} bazi
 * @returns {Object}
 */
function identifyGeJu(bazi) {
  const { yearGan, monthGan, monthZhi, dayGan, hourGan } = bazi;
  const riZhu = dayGan;
  const category = ZHI_CATEGORY[monthZhi]; // 四仲/四孟/四库
  const benQi = getBenQi(monthZhi);
  const cangGans = getCangGan(monthZhi);

  // 透干的非日主天干
  const tougans = [yearGan, monthGan, hourGan].filter(Boolean);

  // 找出月支藏干中，哪些透到天干
  const touInMonth = cangGans.filter((cg) => tougans.includes(cg.gan));

  // 月令本气对应的十神（日主视角）
  const benQiShiShen = benQi === riZhu ? '比肩' : getShiShen(riZhu, benQi);

  // 判断建禄月劫：月令本气是比肩或劫财
  const isJianLuOrYangRen =
    benQiShiShen === '比肩' || benQiShiShen === '劫财';

  let candidates = [];
  let mainCandidate = null;
  let decisionNote = '';

  if (isJianLuOrYangRen) {
    // 建禄月劫格例外：不能以比劫定格，改从天干透出的其他十神
    const geName = SHI_SHEN_TO_GE[benQiShiShen];
    candidates.push({
      name: geName,
      source: '月令本气',
      via: benQi,
      note: '自身不能为用，须从其他透干的十神定实际用神',
    });

    // 找其他透干的"非比劫"十神作为实际用神
    for (const tg of tougans) {
      if (tg === riZhu) continue;
      const ss = getShiShen(riZhu, tg);
      if (ss === '比肩' || ss === '劫财') continue;
      const name = SHI_SHEN_TO_GE[ss] || `${ss}格`;
      candidates.push({
        name: `${geName}+取${ss}为用`,
        source: '天干透出',
        via: tg,
        shishen: ss,
      });
    }

    mainCandidate = candidates[0];
    decisionNote = '建禄月劫格：月令本气为日主比劫，框架名为建禄/月刃，实际取用须看其他透干十神';

  } else if (category === '四仲') {
    // 四仲月：月令本气单一，直接用本气定格
    const name = SHI_SHEN_TO_GE[benQiShiShen] || `${benQiShiShen}格`;
    candidates.push({
      name,
      source: '月令本气（四仲专气）',
      via: benQi,
      shishen: benQiShiShen,
      isTouGan: tougans.includes(benQi),
    });
    mainCandidate = candidates[0];
    decisionNote = `四仲月 ${monthZhi}，本气 ${benQi}（${benQiShiShen}）单一，${tougans.includes(benQi) ? '已透干' : '未透干但本气仍成格'}`;

  } else if (category === '四孟') {
    // 四孟月：子平真诠只在本气+中气里取格，余气透干不优先成格
    const primary = touInMonth.filter(x => x.role === '本气' || x.role === '中气');
    const yuqiOnly = touInMonth.filter(x => x.role === '余气');
    if (primary.length > 0) {
      // 本气优先、其次中气
      primary.sort((a, b) => (a.role === '本气' ? -1 : 1));
      for (const { gan, role } of primary) {
        const ss = gan === riZhu ? '比肩' : getShiShen(riZhu, gan);
        const name = SHI_SHEN_TO_GE[ss] || `${ss}格`;
        candidates.push({
          name,
          source: `月令${role}透出`,
          via: gan,
          shishen: ss,
        });
      }
      mainCandidate = candidates[0];
      decisionNote = `四孟月 ${monthZhi}，${primary.map(x=>x.gan).join('/')} 透干（本气优先），取${mainCandidate.name}`;
      // 余气透干作为次要候选，标注
      for (const { gan, role } of yuqiOnly) {
        const ss = gan === riZhu ? '比肩' : getShiShen(riZhu, gan);
        candidates.push({
          name: `${SHI_SHEN_TO_GE[ss] || ss+'格'}（余气透，次要）`,
          source: '月令余气透出（一般不取）',
          via: gan,
          shishen: ss,
        });
      }
    } else if (touInMonth.length > 0) {
      // 只有余气透干的情况：优先取本气
      const benSs = benQiShiShen;
      const benName = SHI_SHEN_TO_GE[benSs] || `${benSs}格`;
      candidates.push({
        name: benName,
        source: '月令本气（本气中气未透，取本气）',
        via: benQi,
        shishen: benSs,
      });
      for (const { gan, role } of yuqiOnly) {
        const ss = gan === riZhu ? '比肩' : getShiShen(riZhu, gan);
        candidates.push({
          name: `${SHI_SHEN_TO_GE[ss] || ss+'格'}（余气透，次要）`,
          source: '月令余气透出',
          via: gan,
          shishen: ss,
        });
      }
      mainCandidate = candidates[0];
      decisionNote = `四孟月 ${monthZhi}，只有余气 ${yuqiOnly.map(x=>x.gan).join('/')} 透干，仍以本气 ${benQi}(${benSs}) 定格`;
    } else {
      const name = SHI_SHEN_TO_GE[benQiShiShen] || `${benQiShiShen}格`;
      candidates.push({
        name,
        source: '月令本气（未透干，取本气）',
        via: benQi,
        shishen: benQiShiShen,
      });
      mainCandidate = candidates[0];
      decisionNote = `四孟月 ${monthZhi}，藏干无一透出，取本气 ${benQi}（${benQiShiShen}）定格`;
    }

  } else if (category === '四库') {
    // 四库月：须透干方可取格；不透则格局不清，需刑冲"开库"
    if (touInMonth.length > 0) {
      for (const { gan, role } of touInMonth) {
        const ss = gan === riZhu ? '比肩' : getShiShen(riZhu, gan);
        const name = SHI_SHEN_TO_GE[ss] || `${ss}格`;
        candidates.push({
          name,
          source: `月令${role}透出（四库必透）`,
          via: gan,
          shishen: ss,
        });
      }
      mainCandidate = candidates[0];
      decisionNote = `四库月 ${monthZhi}，${touInMonth.map(x=>x.gan).join('/')} 透干`;
    } else {
      candidates.push({
        name: '格局不清',
        source: '四库月无透干',
        via: null,
        note: '需大运流年刑冲开库方能取格',
      });
      mainCandidate = candidates[0];
      decisionNote = `四库月 ${monthZhi}，藏干均未透干，格局暂不清晰，待刑冲开库`;
    }
  }

  return {
    monthZhi,
    category,
    benQi,
    benQiShiShen,
    candidates,
    mainCandidate,
    decisionNote,
    tougans,
    touInMonth,
  };
}

module.exports = { identifyGeJu, SHI_SHEN_TO_GE };
