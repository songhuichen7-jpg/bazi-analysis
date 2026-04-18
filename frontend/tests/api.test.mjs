import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listConversations, createConversation, patchConversation,
  deleteConversation, restoreConversation, listMessages,
} from '../src/lib/api.js';


function _stubFetch(impl) {
  globalThis.fetch = impl;
}

function _restoreFetch() {
  delete globalThis.fetch;
}


test('listConversations GET /api/charts/:cid/conversations with credentials', async () => {
  let captured;
  _stubFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
  try {
    const r = await listConversations('chart-123');
    assert.equal(captured.url, '/api/charts/chart-123/conversations');
    assert.equal(captured.opts.credentials, 'include');
    assert.deepEqual(r, { items: [] });
  } finally {
    _restoreFetch();
  }
});


test('createConversation POSTs label payload', async () => {
  let captured;
  _stubFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 201, json: async () => ({ id: 'c1', label: '工作', position: 0 }) };
  });
  try {
    const r = await createConversation('chart-1', '工作');
    assert.equal(captured.url, '/api/charts/chart-1/conversations');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.body, JSON.stringify({ label: '工作' }));
    assert.equal(r.label, '工作');
  } finally {
    _restoreFetch();
  }
});


test('patchConversation PATCH /api/conversations/:id', async () => {
  let captured;
  _stubFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ id: 'c1', label: '感情' }) };
  });
  try {
    const r = await patchConversation('c1', '感情');
    assert.equal(captured.opts.method, 'PATCH');
    assert.equal(captured.url, '/api/conversations/c1');
    assert.equal(r.label, '感情');
  } finally {
    _restoreFetch();
  }
});


test('deleteConversation DELETE returns 204', async () => {
  let captured;
  _stubFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 204 };
  });
  try {
    await deleteConversation('c1');
    assert.equal(captured.opts.method, 'DELETE');
    assert.equal(captured.url, '/api/conversations/c1');
  } finally {
    _restoreFetch();
  }
});


test('restoreConversation POST /restore', async () => {
  let captured;
  _stubFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ id: 'c1', deleted_at: null }) };
  });
  try {
    const r = await restoreConversation('c1');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.url, '/api/conversations/c1/restore');
    assert.equal(r.deleted_at, null);
  } finally {
    _restoreFetch();
  }
});


test('listMessages with before+limit query', async () => {
  let captured;
  _stubFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ items: [], next_cursor: null }) };
  });
  try {
    await listMessages('c1', { before: 'msg-9', limit: 20 });
    assert.match(captured.url, /before=msg-9/);
    assert.match(captured.url, /limit=20/);
  } finally {
    _restoreFetch();
  }
});


test('throws with detail.message on non-2xx', async () => {
  _stubFetch(async () => ({
    ok: false, status: 429,
    json: async () => ({ detail: { code: 'QUOTA_EXCEEDED', message: '今日配额已用完' } }),
  }));
  try {
    await assert.rejects(
      () => createConversation('c1'),
      /今日配额已用完/,
    );
  } finally {
    _restoreFetch();
  }
});
