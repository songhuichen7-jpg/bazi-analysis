import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRef } from '../src/lib/parseRef.js';

test('media questions render only one primary media card for repeated movie tokens', () => {
  const segments = parseRef(
    '你这盘像 [[movie:肖申克的救赎|弗兰克·德拉邦特]]。\n\n后面又像 [[movie:肖申克|1994]] 里的坚持。',
    { context: '用一部电影形容我这盘' },
  );

  const media = segments.filter((s) => s.type === 'media');
  assert.equal(media.length, 1);
  assert.equal(media[0].title, '肖申克的救赎');
  assert.equal(media[0].subtitle, '弗兰克·德拉邦特');
  assert.match(
    segments.map((s) => s.value || s.title || '').join(''),
    /《肖申克》里的坚持/,
  );
});

test('media questions prefer explicit media tokens over rescuing quoted titles', () => {
  const segments = parseRef(
    '先想到《老伴》。真正推荐 [[song:老伴|李荣浩]]，它的节奏更贴。',
    { context: '用一首歌形容我这盘' },
  );

  const media = segments.filter((s) => s.type === 'media');
  assert.equal(media.length, 1);
  assert.equal(media[0].kind, 'song');
  assert.equal(media[0].title, '老伴');
  assert.equal(media[0].subtitle, '李荣浩');
  assert.match(segments.map((s) => s.value || '').join(''), /先想到《老伴》/);
});
