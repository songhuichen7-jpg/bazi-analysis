import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnonymousId } from '../src/lib/anonymousId.js';

test('generates new id when cookie missing', () => {
  const cookieStore = { value: '' };
  const id = getAnonymousId({
    readCookie: () => cookieStore.value,
    writeCookie: v => cookieStore.value = v,
  });
  assert.match(id, /^a_[a-z0-9]{14}$/);
  assert.match(cookieStore.value, /chabazi_aid=a_[a-z0-9]{14}/);
});

test('returns existing id when cookie present', () => {
  const cookieStore = { value: 'chabazi_aid=a_existing123456' };
  const id = getAnonymousId({
    readCookie: () => cookieStore.value,
    writeCookie: () => {},
  });
  assert.equal(id, 'a_existing123456');
});

test('ignores malformed cookie', () => {
  const cookieStore = { value: 'other=foo; chabazi_aid=BADFORMAT' };
  let wrote = '';
  const id = getAnonymousId({
    readCookie: () => cookieStore.value,
    writeCookie: v => wrote = v,
  });
  assert.match(id, /^a_[a-z0-9]{14}$/);
  assert.notEqual(id, 'BADFORMAT');
});
