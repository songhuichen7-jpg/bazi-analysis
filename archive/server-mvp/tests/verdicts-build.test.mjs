import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = '/Users/veko/code/usual/bazi-analysis';
const SCRIPT = path.join(ROOT, 'scripts', 'build-verdicts.mjs');
const OUT = path.join(ROOT, 'server', 'data', 'verdicts', 'tree.json');

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n');
}

test('build-verdicts generates verdict tree within expected budget', () => {
  const run = spawnSync('node', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, `build-verdicts should exit 0\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.equal(fs.existsSync(OUT), true, 'tree.json should be generated');

  const stat = fs.statSync(OUT);
  assert.ok(stat.size < 400 * 1024, `tree.json must stay under 400KB, got ${stat.size}`);

  const tree = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  assert.ok(Array.isArray(tree), 'tree.json should be an array');
  assert.ok(tree.length >= 400 && tree.length <= 600, `expected 400-600 chunks, got ${tree.length}`);
});

test('build-verdicts captures known chunk metadata and exact offsets', () => {
  const tree = JSON.parse(fs.readFileSync(OUT, 'utf8'));

  const sanming = tree.find(
    (chunk) =>
      chunk.book === 'sanming-tonghui' &&
      chunk.file === 'juan-09.md' &&
      chunk.heading === '六已日甲子時斷'
  );
  assert.ok(sanming, 'should include sanming命例 chunk');
  assert.equal(sanming.mode, 'h2-section');
  assert.ok(sanming.preview.length >= 30, 'preview should be at least 30 chars');

  const sanmingLines = readLines(path.join(ROOT, 'classics', 'sanming-tonghui', 'juan-09.md'));
  assert.equal(sanmingLines[sanming.offset.line_start - 1].trim(), '## 六已日甲子時斷');
  assert.ok(
    sanmingLines.slice(sanming.offset.line_start, sanming.offset.line_end).join('\n').includes('明見官星暗有財'),
    'offset should cover expected body text'
  );

  const ziping = tree.find(
    (chunk) =>
      chunk.book === 'ziping-zhenquan' &&
      chunk.file === '12_lun-yong-shen-ge-ju-gao-di.md'
  );
  assert.ok(ziping, 'should include ziping格局总论 chunk');
  assert.equal(ziping.mode, 'whole-file');

  const ditian = tree.find(
    (chunk) =>
      chunk.book === 'ditian-sui' &&
      chunk.file === 'liu-qin-lun_01_fu-qi.md'
  );
  assert.ok(ditian, 'should include ditian六亲论 chunk');
  assert.equal(ditian.mode, 'whole-file');
});
