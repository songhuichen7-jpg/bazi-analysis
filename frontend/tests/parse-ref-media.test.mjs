import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseRef } from '../src/lib/parseRef.js';
import { ATMOSPHERE_ASSETS, pickAtmosphereAsset } from '../src/lib/mediaCard.js';

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

test('weather and scent tokens render one semantic card without duplicate cards', () => {
  const segments = parseRef(
    '你现在像 [[weather:雨后初雾|慢下来，光会回来]]。\n\n如果换个说法，也像 [[weather:阴天|需要休息]]。',
    { context: '用一种天气形容我现在的状态' },
  );

  const media = segments.filter((s) => s.type === 'media');
  assert.equal(media.length, 1);
  assert.equal(media[0].kind, 'weather');
  assert.equal(media[0].title, '雨后初雾');
  assert.equal(media[0].subtitle, '慢下来，光会回来');
  assert.match(
    segments.map((s) => s.value || s.title || '').join(''),
    /《阴天》/,
  );

  const scentSegments = parseRef(
    '这盘像 [[scent:冷茶白花|雨后石板 · 淡淡焚香]]，后面又像 [[scent:雪松|清冷木质]]。',
    { context: '用一种气味形容我这盘' },
  );
  const scent = scentSegments.filter((s) => s.type === 'media');
  assert.equal(scent.length, 1);
  assert.equal(scent[0].kind, 'scent');
  assert.equal(scent[0].title, '冷茶白花');
  assert.match(
    scentSegments.map((s) => s.value || s.title || '').join(''),
    /《雪松》/,
  );
});

test('weather and scent cards require explicit tokens, avoiding casual false triggers', () => {
  const weatherChat = parseRef(
    '今天的天气有点潮，但你这盘主要不是低气压。',
    { context: '最近天气不好会影响我吗' },
  );
  assert.equal(weatherChat.filter((s) => s.type === 'media').length, 0);

  const scentChat = parseRef(
    '这段关系的味道不是香水感，更像慢慢熟悉后的安全感。',
    { context: '关系怎么相处' },
  );
  assert.equal(scentChat.filter((s) => s.type === 'media').length, 0);
});

test('semantic weather and scent cards stay local and non-clickable', () => {
  const mediaHelpers = fs.readFileSync(new URL('../src/lib/mediaCard.js', import.meta.url), 'utf8');
  const mediaCard = fs.readFileSync(new URL('../src/components/MediaCard.jsx', import.meta.url), 'utf8');

  assert.match(mediaHelpers, /if \(kind !== 'song' && kind !== 'movie'\) return null/);
  assert.match(mediaCard, /const isSemanticCard = kind === 'weather' \|\| kind === 'scent'/);
  assert.match(mediaCard, /if \(!safeTitle \|\| isSemanticCard\)/);
  assert.match(mediaCard, /const CardTag = url \? 'a' : 'div'/);
  assert.match(mediaCard, /url[\s\S]*href:\s*url[\s\S]*role:\s*'group'/);
  assert.match(mediaCard, /pickAtmosphereAsset\(kind,\s*safeTitle,\s*displaySub\)/);
  assert.match(mediaCard, /--media-atmosphere/);
});

test('semantic card atmosphere pool has multiple assets and keyword matching', () => {
  assert.equal(ATMOSPHERE_ASSETS.weather.length, 15);
  assert.equal(ATMOSPHERE_ASSETS.scent.length, 15);
  assert.equal(ATMOSPHERE_ASSETS.book.length, 4);

  assert.equal(pickAtmosphereAsset('weather', '初雪', '冷白的早晨')?.id, 'first-snow');
  assert.equal(pickAtmosphereAsset('weather', '台风前夜', '风雨快到了')?.id, 'typhoon-eve');
  assert.equal(pickAtmosphereAsset('weather', '夕照', '慢慢变暖')?.id, 'sunset-glow');
  assert.equal(pickAtmosphereAsset('scent', '冷茶白花', '雨后石板 · 淡淡焚香')?.id, 'cold-tea');
  assert.equal(pickAtmosphereAsset('scent', '红茶', '深茶汤')?.id, 'black-tea');
  assert.equal(pickAtmosphereAsset('scent', '檀木', '温热的木质底色')?.id, 'sandalwood');
  assert.equal(pickAtmosphereAsset('scent', '柑橘皮', '明亮但不吵')?.id, 'citrus-peel');
  assert.equal(pickAtmosphereAsset('book', '诗集', '安静的下午')?.id, 'poetry-ink');
  assert.equal(pickAtmosphereAsset('book', '夜读', '灯下翻页')?.id, 'night-reading');

  const fallbackA = pickAtmosphereAsset('weather', '柔软的灰蓝', '需要慢下来')?.id;
  const fallbackB = pickAtmosphereAsset('weather', '柔软的灰蓝', '需要慢下来')?.id;
  assert.equal(fallbackA, fallbackB);
});

test('book cards use a local literary fallback image while keeping search behavior', () => {
  const mediaCard = fs.readFileSync(new URL('../src/components/MediaCard.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(mediaCard, /const isAtmosphereCard = kind === 'weather' \|\| kind === 'scent' \|\| kind === 'book'/);
  assert.match(mediaCard, /atmosphereAsset\?\.src/);
  assert.match(mediaCard, /const CardTag = url \? 'a' : 'div'/);
  assert.match(css, /\.media-card-book::before[\s\S]*var\(--media-atmosphere\)/);
  assert.doesNotMatch(css, /\.media-card-book \.media-card-cta[\s\S]*display:\s*none/);
});
