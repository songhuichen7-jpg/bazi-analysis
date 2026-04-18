import test from 'node:test';
import assert from 'node:assert/strict';

import { useAppStore } from '../src/store/useAppStore.js';


function _stubFetch(impl) {
  globalThis.fetch = impl;
}
function _restoreFetch() { delete globalThis.fetch; }


// sessionStorage shim for node
function _sessionStorageShim() {
  const data = {};
  globalThis.sessionStorage = {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}


function _resetStore() {
  useAppStore.setState({
    chatHistory: [], conversations: [], currentConversationId: null,
    currentId: 'chart-1',
  });
}


test('appendMessage adds to chatHistory ephemerally', () => {
  _resetStore();
  useAppStore.getState().appendMessage({ role: 'user', content: 'hi' });
  assert.deepEqual(
    useAppStore.getState().chatHistory,
    [{ role: 'user', content: 'hi' }]
  );
});


test('replaceLastAssistant updates only the last assistant', () => {
  useAppStore.setState({
    chatHistory: [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '' },
    ],
    currentId: 'chart-1', conversations: [], currentConversationId: null,
  });
  useAppStore.getState().replaceLastAssistant('done');
  assert.equal(useAppStore.getState().chatHistory[1].content, 'done');
});


test('replacePlaceholderWithCta turns last assistant into cta', () => {
  useAppStore.setState({
    chatHistory: [
      { role: 'user', content: '该不该' },
      { role: 'assistant', content: '' },
    ],
    currentId: 'chart-1', conversations: [], currentConversationId: null,
  });
  useAppStore.getState().replacePlaceholderWithCta('该不该', false);
  assert.deepEqual(useAppStore.getState().chatHistory[1], {
    role: 'cta', content: { question: '该不该', manual: false },
  });
});


test('consumeCta removes the trailing cta', () => {
  useAppStore.setState({
    chatHistory: [
      { role: 'user', content: 'q' },
      { role: 'cta', content: { question: 'q', manual: false } },
    ],
    currentId: 'chart-1', conversations: [], currentConversationId: null,
  });
  useAppStore.getState().consumeCta();
  const hist = useAppStore.getState().chatHistory;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].role, 'user');
});


test('loadConversations populates store + picks first as default', async () => {
  _sessionStorageShim();
  _stubFetch(async () => ({ ok: true, json: async () => ({
    items: [{ id: 'c1', label: '对话 1' }, { id: 'c2', label: '对话 2' }],
  }) }));
  try {
    _resetStore();
    await useAppStore.getState().loadConversations('chart-1');
    const s = useAppStore.getState();
    assert.deepEqual(s.conversations.map(c => c.id), ['c1', 'c2']);
    assert.equal(s.currentConversationId, 'c1');
  } finally {
    _restoreFetch();
  }
});


test('loadConversations restores currentConversationId from sessionStorage', async () => {
  _sessionStorageShim();
  globalThis.sessionStorage.setItem('currentConversationId:chart-1', 'c2');
  _stubFetch(async () => ({ ok: true, json: async () => ({
    items: [{ id: 'c1' }, { id: 'c2' }],
  }) }));
  try {
    _resetStore();
    await useAppStore.getState().loadConversations('chart-1');
    assert.equal(useAppStore.getState().currentConversationId, 'c2');
  } finally {
    _restoreFetch();
    globalThis.sessionStorage.clear();
  }
});


test('loadMessages reverses server-newest-first to chronological', async () => {
  _sessionStorageShim();
  _stubFetch(async () => ({ ok: true, json: async () => ({
    items: [
      { id: '3', role: 'assistant', content: 'a2', meta: null, created_at: '2026-04-18T03:00:00Z' },
      { id: '2', role: 'user',      content: 'q2', meta: null, created_at: '2026-04-18T02:00:00Z' },
      { id: '1', role: 'user',      content: 'q1', meta: null, created_at: '2026-04-18T01:00:00Z' },
    ],
    next_cursor: null,
  }) }));
  try {
    _resetStore();
    await useAppStore.getState().loadMessages('c1');
    const hist = useAppStore.getState().chatHistory;
    assert.deepEqual(hist.map(m => m.content), ['q1', 'q2', 'a2']);
  } finally {
    _restoreFetch();
  }
});


test('newConversationOnServer appends + selects + clears history', async () => {
  _sessionStorageShim();
  _stubFetch(async () => ({ ok: true, status: 201, json: async () => ({
    id: 'cN', label: '对话 1',
  }) }));
  try {
    useAppStore.setState({ conversations: [], chatHistory: [{ role: 'user', content: 'old' }],
                            currentId: 'chart-1' });
    await useAppStore.getState().newConversationOnServer('chart-1', '对话 1');
    const s = useAppStore.getState();
    assert.equal(s.currentConversationId, 'cN');
    assert.deepEqual(s.chatHistory, []);
  } finally {
    _restoreFetch();
  }
});
