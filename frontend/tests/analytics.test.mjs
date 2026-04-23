import test from 'node:test';
import assert from 'node:assert/strict';
import { track, __setTrackFetch } from '../src/lib/analytics.js';

test('track posts event with properties', async () => {
  let captured;
  __setTrackFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 204 };
  });
  await track('card_view', { type_id: '01', from: 'direct' });
  assert.match(captured.url, /\/api\/track$/);
  assert.equal(captured.body.event, 'card_view');
  assert.equal(captured.body.properties.type_id, '01');
  assert.equal(captured.body.properties.from, 'direct');
});

test('track swallows network errors silently', async () => {
  __setTrackFetch(async () => { throw new Error('network down'); });
  await track('card_view', {});
  assert.ok(true);
});

test('track with no fetchImpl does nothing (no crash)', async () => {
  __setTrackFetch(null);
  await track('card_view', {});
  assert.ok(true);
});
