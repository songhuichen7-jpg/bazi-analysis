import test from 'node:test';
import assert from 'node:assert/strict';

import { useAppStore } from '../src/store/useAppStore.js';
import { finalizeChatTurn } from '../src/lib/chatFlow.js';

test('finalizeChatTurn clears chatStreaming before background chips refresh resolves', async () => {
  useAppStore.setState({ chatStreaming: true });

  let resolveRefresh;
  let refreshResolved = false;
  let refreshStarted = false;

  finalizeChatTurn({
    setChatStreaming: useAppStore.getState().setChatStreaming,
    refreshChips: async () => {
      refreshStarted = true;
      await new Promise((resolve) => {
        resolveRefresh = resolve;
      });
      refreshResolved = true;
    },
  });

  await Promise.resolve();
  assert.equal(useAppStore.getState().chatStreaming, false);
  assert.equal(refreshStarted, true);
  assert.equal(refreshResolved, false);

  resolveRefresh();
  await Promise.resolve();
  assert.equal(refreshResolved, true);
});
