#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLASSICS_DIR = path.join(ROOT, 'classics');
const OUT_DIR = path.join(ROOT, 'server', 'data', 'verdicts');
const OUT_FILE = path.join(OUT_DIR, 'tree.json');

const STATIC_FILES = [
  'sanming-tonghui/juan-03.md',
  'sanming-tonghui/juan-06.md',
  'sanming-tonghui/juan-09.md',
  'sanming-tonghui/juan-10.md',
  'sanming-tonghui/juan-11.md',
  'sanming-tonghui/juan-12.md',
  'ziping-zhenquan/09_lun-yong-shen-cheng-bai-jiu-ying.md',
  'ziping-zhenquan/12_lun-yong-shen-ge-ju-gao-di.md',
  'ziping-zhenquan/13_lun-yong-shen-yin-cheng-de-bai-yin-bai-de-cheng.md',
  'ziping-zhenquan/14_lun-yong-shen-pei-qi-hou-de-shi.md',
  'ditian-sui/tong-shen-lun_17_shuai-wang.md',
  'ditian-sui/tong-shen-lun_18_zhong-he.md',
  'ditian-sui/tong-shen-lun_19_yuan-liu.md',
  'ditian-sui/tong-shen-lun_22_shang-guan.md',
  'ditian-sui/tong-shen-lun_23_qing-qi.md',
  'ditian-sui/tong-shen-lun_24_zhuo-qi.md',
  'ditian-sui/tong-shen-lun_25_zhen-shen.md',
  'ditian-sui/tong-shen-lun_26_jia-shen.md',
  'yuanhai-ziping/09_shen-sha_yang-ren-ri-ren-ri-gui-ri-de-kui-gang-jin-shen.md',
  'yuanhai-ziping/12_fu-lun_zi-ping-ju-yao-xi-ji-ji-shan.md',
  'yuanhai-ziping/13_kan-ming-ru-shi-shen-qu-ba-fa-za-lun.md',
  'yuanhai-ziping/14_qun-xing-lun-xing-wang-bao-fa-cun-jin.md',
  'yuanhai-ziping/15_lun-ming-xi-fa-xin-jing-ge-yao-xiang-fu.md',
  'yuanhai-ziping/16_luo-yi-fu-xiang-xin-fu-xuan-ji-fu.md',
  'yuanhai-ziping/17_you-wei-fu-wu-xing-yuan-li-xiao-xi-fu.md',
  'yuanhai-ziping/18_jin-yu-fu-zao-wei-lun-ren-jian-lun.md',
  'yuanhai-ziping/19_ai-zeng-fu-bi-yuan-fu.md',
  'yuanhai-ziping/20_wan-jin-fu-qie-yao-jue.md',
  'yuanhai-ziping/21_yuan-yuan-ji-shuo-ke-jia-ge.md',
  'yuanhai-ziping/22_si-yan-du-bu.md',
  'yuanhai-ziping/23_shen-ruo-lun-qi-ming-cong-sha-lun.md',
  'yuanhai-ziping/24_wu-yan-du-bu.md',
  'yuanhai-ziping/25_wu-xing-sheng-ke-fu.md',
  'yuanhai-ziping/26_luo-lu-zi-xiao-xi-fu.md',
];

function expandPatternFiles() {
  const out = [];
  const ditianDir = path.join(CLASSICS_DIR, 'ditian-sui');
  for (const file of fs.readdirSync(ditianDir)) {
    if (file.startsWith('liu-qin-lun_') && file.endsWith('.md')) {
      out.push(path.join('ditian-sui', file));
    }
  }
  return out.sort();
}

function uniq(items) {
  return [...new Set(items)];
}

function stripFrontmatter(lines) {
  let start = 0;
  let fenceCount = 0;
  for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
    if (lines[i].trim() === '---') {
      fenceCount += 1;
      if (fenceCount === 2) {
        start = i + 1;
        break;
      }
    }
  }
  return { start, lines: lines.slice(start) };
}

function cleanPreviewLine(line) {
  return line
    .replace(/^>\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function buildPreview(bodyLines) {
  const raw = bodyLines
    .map(cleanPreviewLine)
    .filter(Boolean)
    .join(' ');
  if (raw.length < 30) return null;
  return raw.slice(0, 100);
}

function headingText(line) {
  return line.replace(/^##\s*/, '').trim();
}

function deriveWholeFileHeading(lines) {
  for (const line of lines) {
    if (/^#\s+/.test(line)) return line.replace(/^#\s+/, '').trim();
  }
  return null;
}

function buildChunksFromLines(relPath, lines) {
  const { start: frontmatterStart } = stripFrontmatter(lines);
  const h2Indexes = [];
  for (let i = frontmatterStart; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) h2Indexes.push(i);
  }

  const book = relPath.split(path.sep)[0];
  const file = path.basename(relPath);
  const chunks = [];

  if (!h2Indexes.length) {
    const heading = deriveWholeFileHeading(lines);
    if (!heading) return [];
    const start = lines.findIndex((line, idx) => idx >= frontmatterStart && /^#\s+/.test(line));
    const bodyLines = lines.slice(start + 1);
    const preview = buildPreview(bodyLines);
    if (!preview) return [];
    chunks.push({
      id: `${book}/${file}#${heading}`,
      book,
      file,
      heading,
      preview,
      offset: { line_start: start + 1, line_end: lines.length },
      mode: 'whole-file',
    });
    return chunks;
  }

  for (let idx = 0; idx < h2Indexes.length; idx += 1) {
    const start = h2Indexes[idx];
    const end = idx + 1 < h2Indexes.length ? h2Indexes[idx + 1] - 1 : lines.length - 1;
    const heading = headingText(lines[start]);
    const bodyLines = lines.slice(start + 1, end + 1);
    const preview = buildPreview(bodyLines);
    if (!preview) continue;
    chunks.push({
      id: `${book}/${file}#${heading}`,
      book,
      file,
      heading,
      preview,
      offset: { line_start: start + 1, line_end: end + 1 },
      mode: 'h2-section',
    });
  }

  return chunks;
}

export function buildChunksFromMarkdown(relPath, text) {
  return buildChunksFromLines(relPath, text.split('\n'));
}

export function resolveWhitelistFiles() {
  return uniq([...STATIC_FILES, ...expandPatternFiles()]).sort();
}

export function buildVerdictTree() {
  const files = resolveWhitelistFiles();
  const chunks = [];
  const byBook = new Map();

  for (const relPath of files) {
    const fullPath = path.join(CLASSICS_DIR, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const fileChunks = buildChunksFromMarkdown(relPath, content);
    chunks.push(...fileChunks);
    const book = relPath.split(path.sep)[0];
    byBook.set(book, (byBook.get(book) || 0) + fileChunks.length);
  }

  return {
    chunks,
    counts: Object.fromEntries([...byBook.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function writeVerdictTree(outFile = OUT_FILE) {
  const { chunks, counts } = buildVerdictTree();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(chunks));
  const size = fs.statSync(outFile).size;
  return { chunks, counts, size };
}

async function main() {
  const { chunks, counts, size } = writeVerdictTree();
  console.log(`[verdicts] wrote ${OUT_FILE}`);
  console.log(`[verdicts] chunks=${chunks.length} size=${size} bytes`);
  for (const [book, count] of Object.entries(counts)) {
    console.log(`[verdicts] ${book}: ${count}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
