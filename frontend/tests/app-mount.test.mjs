import test from 'node:test';
import assert from 'node:assert/strict';

import { useAppStore } from '../src/store/useAppStore.js';
import { bootstrapAuthGate } from '../src/lib/appBootstrap.js';

function resetStorage() {
  const data = {};
  globalThis.localStorage = {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    clear: () => { for (const key of Object.keys(data)) delete data[key]; },
  };
}

function resetStore() {
  useAppStore.setState({
    screen: 'landing',
    user: { id: 'stale-user' },
    charts: { old: { id: 'old' } },
    currentId: 'old',
  });
}

test.beforeEach(() => {
  resetStorage();
  resetStore();
});

test('bootstrapAuthGate skips me() when there is no local auth hint', async () => {
  let meCalls = 0;

  await bootstrapAuthGate({
    store: useAppStore,
    me: async () => {
      meCalls += 1;
      return { user: { id: 'u1' } };
    },
  });

  assert.equal(meCalls, 0);
  assert.equal(useAppStore.getState().screen, 'landing');
  assert.equal(useAppStore.getState().user, null);
});

test('bootstrapAuthGate treats null me() as logged out without syncing charts', async () => {
  let meCalls = 0;
  let syncCalls = 0;

  useAppStore.setState({
    syncChartsFromServer: async () => {
      syncCalls += 1;
    },
  });
  globalThis.localStorage.setItem('authSessionHint', '1');

  await bootstrapAuthGate({
    store: useAppStore,
    me: async () => {
      meCalls += 1;
      return null;
    },
  });

  assert.equal(meCalls, 1);
  assert.equal(syncCalls, 0);
  assert.equal(useAppStore.getState().screen, 'landing');
  assert.equal(useAppStore.getState().user, null);
});
