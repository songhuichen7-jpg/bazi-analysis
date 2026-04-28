import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// "从古书里取几段，与这张命盘互相照看" 是结果态文案, 不能在 loading 态出现
// (否则用户会误以为已经检索完, 但下面又写"正在检索", 形成矛盾).

test('ClassicsPanel subtitle only renders after items arrive', () => {
  const source = fs.readFileSync(new URL('../src/components/ClassicsPanel.jsx', import.meta.url), 'utf8');

  // 副标题被 hasContent (= items.length > 0) 守住, 出现在条件分支里
  assert.match(source, /hasContent\s*\?[\s\S]*?从古书里取几段，与这张命盘互相照看/);
  // hasContent 派生自 items.length
  assert.match(source, /hasContent\s*=\s*items\.length\s*>\s*0/);
});

test('ClassicsPanel pending text is concise and does not duplicate the title promise', () => {
  const source = fs.readFileSync(new URL('../src/components/ClassicsPanel.jsx', import.meta.url), 'utf8');

  // 旧版本"正在检索与你命盘最相关的古籍原文…"含'最相关'再次承诺, 已收紧
  assert.doesNotMatch(source, /正在检索与你命盘最相关的古籍原文/);
  // 新版本短句
  assert.match(source, /正在翻检古籍/);
  assert.match(source, /古 籍 旁 证/);
  assert.doesNotMatch(source, /最贴近|最相关/);
});
