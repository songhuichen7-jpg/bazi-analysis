#!/usr/bin/env node
/**
 * 一次性工具：读 birth_inputs.json（数组），逐条调 paipan()，
 * 把结果写到 fixtures/<case_id>.json。
 */
const fs = require('fs');
const path = require('path');
const { paipan } = require('../src/paipan');

function dieUsage() {
  console.error('Usage: node dump-oracle.js <birth_inputs.json> <out-dir>');
  process.exit(2);
}

const [, , inputsPath, outDir] = process.argv;
if (!inputsPath || !outDir) dieUsage();

const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
if (!Array.isArray(inputs)) {
  console.error('birth_inputs.json 必须是数组');
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });

let ok = 0, fail = 0;
for (const item of inputs) {
  const { case_id, birth_input } = item;
  if (!case_id || !birth_input) {
    console.error('missing case_id or birth_input:', item);
    fail++; continue;
  }
  try {
    // todayYearGz 等字段依赖 "今天"——确定性地冻结成 2026-04-17 12:00:00
    // 做法：mock Date 为固定时间
    const RealDate = Date;
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate('2026-04-17T12:00:00+08:00');
        return new RealDate(...args);
      }
      static now() { return new RealDate('2026-04-17T12:00:00+08:00').getTime(); }
    };
    const expected = paipan(birth_input);
    global.Date = RealDate;

    const outPath = path.join(outDir, `${case_id}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ case_id, birth_input, expected }, null, 2));
    ok++;
  } catch (e) {
    console.error(`FAIL ${case_id}:`, e.message);
    fail++;
  }
}

console.log(`\nDone: ${ok} ok, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
