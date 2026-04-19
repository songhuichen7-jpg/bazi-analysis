import test from 'node:test';
import assert from 'node:assert/strict';

import { useAppStore } from '../src/store/useAppStore.js';

function resetStore() {
  useAppStore.setState({
    screen: 'landing',
    user: null,
    charts: {},
    currentId: null,
    paipan: null,
    meta: null,
  });
}

test.beforeEach(() => {
  resetStore();
});

test('landing CTA routes to auth when user is logged out', async () => {
  await useAppStore.getState().enterFromLanding();
  assert.equal(useAppStore.getState().screen, 'auth');
});

test('landing CTA routes to input when logged-in user has no charts', async () => {
  let syncCalls = 0;
  useAppStore.setState({
    user: { id: 'u1' },
    syncChartsFromServer: async () => {
      syncCalls += 1;
      return [];
    },
  });

  await useAppStore.getState().enterFromLanding();

  assert.equal(syncCalls, 1);
  assert.equal(useAppStore.getState().screen, 'input');
});

test('landing CTA routes to shell using the latest loaded chart when charts are present', async () => {
  const calls = [];
  useAppStore.setState({
    user: { id: 'u1' },
    currentId: null,
    charts: {
      old: { id: 'old', createdAt: 1, paipan: { sizhu: { day: '甲子' } }, meta: { rizhu: '甲子' } },
      latest: { id: 'latest', createdAt: 2, paipan: { sizhu: { day: '乙丑' } }, meta: { rizhu: '乙丑' } },
    },
    switchChart: async (id) => {
      calls.push(id);
      useAppStore.setState({ currentId: id, screen: 'shell' });
    },
  });

  await useAppStore.getState().enterFromLanding();

  assert.deepEqual(calls, ['latest']);
  assert.equal(useAppStore.getState().screen, 'shell');
  assert.equal(useAppStore.getState().currentId, 'latest');
});
