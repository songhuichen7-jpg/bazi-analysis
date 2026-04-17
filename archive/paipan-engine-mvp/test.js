/**
 * 完整封装层测试
 */
const { paipan } = require('./src/paipan');

function banner(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

// === Test 1：毛泽东，不做真太阳时，对比族谱记载 ===
banner('Test 1: 毛泽东 1893-12-26 辰时（北京时，无校正）');
const r1 = paipan({
  year: 1893, month: 12, day: 26, hour: 8, minute: 0,
  gender: 'male', useTrueSolarTime: false,
});
console.log('四柱:', r1.sizhu);
console.log('期望: 癸巳 甲子 丁酉 甲辰');

// === Test 2：毛泽东 + 真太阳时（韶山 112.53°E）===
banner('Test 2: 毛泽东 + 真太阳时校正（韶山）');
const r2 = paipan({
  year: 1893, month: 12, day: 26, hour: 8, minute: 0,
  city: '韶山', gender: 'male', useTrueSolarTime: true,
});
console.log('四柱:', r2.sizhu);
console.log('校正信息:', JSON.stringify(r2.meta.corrections, null, 2));

// === Test 3：1988 夏令时期间出生 ===
banner('Test 3: 1988-07-15 10:00 北京（DST 期间）');
const r3 = paipan({
  year: 1988, month: 7, day: 15, hour: 10, minute: 0,
  city: '北京', gender: 'male', useTrueSolarTime: true,
});
console.log('四柱:', r3.sizhu);
console.log('警告:', r3.warnings);
console.log('校正信息:', JSON.stringify(r3.meta.corrections, null, 2));

// === Test 4：节气交界测试（立春前后 10 分钟）===
banner('Test 4: 节气交界 2024-02-04 16:20（立春 16:27 前）');
const r4 = paipan({
  year: 2024, month: 2, day: 4, hour: 16, minute: 20,
  city: '北京', gender: 'female', useTrueSolarTime: false,
});
console.log('四柱:', r4.sizhu);
console.log('警告:', r4.warnings);

// === Test 5：子时派差异 ===
banner('Test 5: 2024-03-15 23:30 早子时 vs 晚子时');
const r5a = paipan({
  year: 2024, month: 3, day: 15, hour: 23, minute: 30,
  city: '北京', gender: 'male', ziConvention: 'early', useTrueSolarTime: false,
});
const r5b = paipan({
  year: 2024, month: 3, day: 15, hour: 23, minute: 30,
  city: '北京', gender: 'male', ziConvention: 'late', useTrueSolarTime: false,
});
console.log('早子时派（23-24 归当日）:');
console.log('  日柱/时柱:', r5a.sizhu.day, '/', r5a.sizhu.hour);
console.log('晚子时派（23 起换日）:');
console.log('  日柱/时柱:', r5b.sizhu.day, '/', r5b.sizhu.hour);

// === Test 6：未知时辰 ===
banner('Test 6: 未知时辰');
const r6 = paipan({
  year: 1990, month: 5, day: 15, hour: -1, minute: 0,
  city: '上海', gender: 'female', useTrueSolarTime: true,
});
console.log('四柱（时柱应为 null）:', r6.sizhu);
console.log('大运（仍应有）:', r6.dayun);

// === Test 7：完整输出示例 ===
banner('Test 7: 完整输出示例 1995-06-15 14:30 上海男');
const r7 = paipan({
  year: 1995, month: 6, day: 15, hour: 14, minute: 30,
  city: '上海', gender: 'male', useTrueSolarTime: true,
});
console.log(JSON.stringify(r7, null, 2));
