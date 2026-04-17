/**
 * 命理层测试
 */
const { paipan } = require('./src/paipan');
const { analyze } = require('./src/ming/analyze');

function banner(t) { console.log('\n' + '='.repeat(70) + '\n' + t + '\n' + '='.repeat(70)); }

// === Test 1: 毛泽东 1893-12-26 辰时 ===
// 预期：日主丁火，生于子月（癸水当令正官司令），年柱七杀癸水
//      月柱甲子 → 甲是正印透干，子月本气癸（七杀）得令
//      丁火日主，同类：比劫（火）+印（木）
//      天干：癸(七杀) 甲(正印) 丁(日主) 甲(正印)
//      可见正印甲两透，七杀透干得令
banner('Test 1: 毛泽东命盘分析');
const p1 = paipan({
  year: 1893, month: 12, day: 26, hour: 8, minute: 0,
  gender: 'male', useTrueSolarTime: false,
});
const a1 = analyze(p1);

console.log('四柱:', p1.sizhu);
console.log('日主:', a1.bazi.dayGan, '(丁火)');
console.log('十神分布:');
console.log('  年干:', a1.shiShen.year.gan, '→', a1.shiShen.year.ss);
console.log('  月干:', a1.shiShen.month.gan, '→', a1.shiShen.month.ss);
console.log('  时干:', a1.shiShen.hour.gan, '→', a1.shiShen.hour.ss);

console.log('\n地支藏干十神:');
for (const [pos, d] of Object.entries(a1.zhiDetail)) {
  console.log(`  ${pos} (${d.zhi}):`, d.cangGan.map(c => `${c.gan}[${c.ss}·${c.role}]`).join(' '));
}

console.log('\n日主强弱:', a1.force.dayStrength);
console.log(`  同类分: ${a1.force.sameSideScore}, 异类分: ${a1.force.otherSideScore}, 占比: ${Math.round(a1.force.sameRatio*100)}%`);
console.log('  从格候选:', a1.force.congCandidate);

console.log('\n十神力量（0-10 归一化）:');
for (const [name, s] of Object.entries(a1.force.scores)) {
  const bar = '█'.repeat(Math.round(s));
  console.log(`  ${name.padEnd(3)}: ${String(s).padStart(4)} ${bar}`);
}

console.log('\n正/偏对子:');
for (const [group, pair] of Object.entries(a1.force.pairs)) {
  console.log(`  ${group}: ${pair[0].name}=${pair[0].score} / ${pair[1].name}=${pair[1].score}`);
}

console.log('\n格局:');
console.log('  主候选:', a1.geJu.mainCandidate);
console.log('  所有候选:', a1.geJu.candidates.map(c=>c.name).join(', '));
console.log('  诊断:', a1.geJu.decisionNote);

console.log('\n日主与各十神关系（类型 F 防护）:');
for (const [ss, rels] of Object.entries(a1.force.relations)) {
  if (rels.length > 0) {
    console.log(`  ${ss}:`, rels.map(r => `${r.gan}=${r.relation}`).join(', '));
  }
}

console.log('\n天干合:');
console.log('  全部:', a1.ganHe.all);
console.log('  涉及日主:', a1.ganHe.withRiZhu);

console.log('\n地支关系:');
console.log('  六合:', a1.zhiRelations.liuHe);
console.log('  冲:', a1.zhiRelations.chong);

console.log('\n自动生成的注意事项（给 LLM 的 guardrails）:');
for (const n of a1.notes) {
  console.log(`  [${n.type}]`, n.message);
}

// === Test 2: 一个典型身弱七杀格，用来测试 pair 预警 ===
banner('Test 2: 构造用例 - 身弱七杀格');
// 日主甲木生于申月（七杀当令），天干无比劫印帮身
const p2 = paipan({
  year: 1984, month: 8, day: 15, hour: 10, minute: 0,
  city: '北京', gender: 'male', useTrueSolarTime: false,
});
const a2 = analyze(p2);
console.log('四柱:', p2.sizhu);
console.log('日主强弱:', a2.force.dayStrength, `(${Math.round(a2.force.sameRatio*100)}%)`);
console.log('格局:', a2.geJu.mainCandidate?.name);
console.log('注意事项:');
for (const n of a2.notes) console.log('  -', n.type, ':', n.message);

// === Test 3: 四库月不透干 - 格局不清 ===
banner('Test 3: 四库月不透干');
const p3 = paipan({
  year: 1990, month: 4, day: 12, hour: 12, minute: 0,  // 辰月
  city: '上海', gender: 'female', useTrueSolarTime: false,
});
const a3 = analyze(p3);
console.log('四柱:', p3.sizhu);
console.log('格局诊断:', a3.geJu.decisionNote);
console.log('候选:', a3.geJu.candidates);

// === Test 4: 建禄月劫格 ===
banner('Test 4: 建禄月');
// 找一个日主甲木，生于寅月的例子
const p4 = paipan({
  year: 1985, month: 2, day: 20, hour: 14, minute: 0,  // 寅月
  city: '北京', gender: 'male', useTrueSolarTime: false,
});
const a4 = analyze(p4);
console.log('四柱:', p4.sizhu);
console.log('月令本气十神:', a4.geJu.benQiShiShen);
console.log('格局候选:', a4.geJu.candidates);
console.log('诊断:', a4.geJu.decisionNote);
