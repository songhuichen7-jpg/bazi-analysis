import test from 'node:test';
import assert from 'node:assert/strict';

import * as chatFlow from '../src/lib/chatFlow.js';

test('bootstrap chips skip empty conversations so the first send can start immediately', async () => {
  assert.equal(typeof chatFlow.startBootstrapChipsRefresh, 'function');

  const startedAt = Date.now();
  let refreshCalled = false;
  let sendCalledAt = null;

  const refreshChips = async () => {
    refreshCalled = true;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  };

  const bootstrapped = chatFlow.startBootstrapChipsRefresh({
    meta: { chart_id: 'chart-1' },
    currentConversationId: 'conv-1',
    historyLength: 0,
    refreshChips,
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  sendCalledAt = Date.now();

  assert.equal(bootstrapped, false);
  assert.equal(refreshCalled, false);
  assert(sendCalledAt - startedAt < 200);
});

test('send path reuses the current conversation id instead of waiting for bootstrap hydration', async () => {
  assert.equal(typeof chatFlow.resolveConversationIdForSend, 'function');

  let ensureCalls = 0;
  const startedAt = Date.now();
  const convId = await chatFlow.resolveConversationIdForSend({
    currentConversationId: 'conv-existing',
    currentChartId: 'chart-1',
    ensureConversation: async () => {
      ensureCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return { conversationId: 'conv-from-bootstrap' };
    },
  });

  assert.equal(convId, 'conv-existing');
  assert.equal(ensureCalls, 0);
  assert(Date.now() - startedAt < 200);
});
