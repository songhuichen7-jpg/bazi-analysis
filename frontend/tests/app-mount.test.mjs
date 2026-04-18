import test from 'node:test';
import assert from 'node:assert/strict';

import { useAppStore } from '../src/store/useAppStore.js';
import { bootstrapAuthGate } from '../src/lib/appBootstrap.js';

function resetStore() {
  useAppStore.setState({
    screen: 'landing',
    user: { id: 'stale-user' },
    charts: { old: { id: 'old' } },
    currentId: 'old',
  });
}

test.beforeEach(() => {
  resetStore();
});

test('bootstrapAuthGate calls me() and routes 401 sessions to auth screen', async () => {
  let meCalls = 0;
  let syncCalls = 0;

  useAppStore.setState({
    syncChartsFromServer: async () => {
      syncCalls += 1;
    },
  });

  await bootstrapAuthGate({
    store: useAppStore,
    me: async () => {
      meCalls += 1;
      throw new Error('HTTP 401');
    },
  });

  assert.equal(meCalls, 1);
  assert.equal(syncCalls, 0);
  assert.equal(useAppStore.getState().screen, 'auth');
  assert.equal(useAppStore.getState().user, null);
});
