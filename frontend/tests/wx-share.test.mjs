import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareConfig, isWeChatBrowser } from '../src/lib/wxShare.js';

test('isWeChatBrowser detects MicroMessenger', () => {
  assert.equal(isWeChatBrowser('Mozilla/5.0 ... MicroMessenger/8.0'), true);
  assert.equal(isWeChatBrowser('Mozilla/5.0 ... Chrome/100'), false);
});

test('buildShareConfig friend produces correct title/desc/link', () => {
  const cfg = buildShareConfig('friend', {
    cosmic_name: '春笋',
    suffix: '天生享乐家',
    share_slug: 'c_abc',
    illustration_url: '/static/01.png',
  }, 'https://chabazi.com');
  assert.match(cfg.title, /春笋·天生享乐家/);
  assert.match(cfg.link, /from=share_friend/);
  assert.match(cfg.link, /c_abc/);
  assert.equal(cfg.imgUrl, 'https://chabazi.com/static/01.png');
});

test('buildShareConfig timeline has distinct title', () => {
  const cfg = buildShareConfig('timeline', {
    cosmic_name: '春笋',
    suffix: '天生享乐家',
    share_slug: 'c_abc',
    illustration_url: '/static/01.png',
  }, 'https://chabazi.com');
  assert.match(cfg.title, /点开看你是什么/);
  assert.match(cfg.link, /from=share_timeline/);
});
