export function finalizeChatTurn({ setChatStreaming, refreshChips }) {
  setChatStreaming(false);
  if (typeof refreshChips !== 'function') return;

  Promise.resolve(refreshChips()).catch(() => {
    // Best-effort refresh only; keep the chat UI responsive.
  });
}

export function startBootstrapChipsRefresh({
  meta,
  currentConversationId,
  historyLength,
  refreshChips,
}) {
  if (!meta || !currentConversationId || historyLength <= 0 || typeof refreshChips !== 'function') {
    return false;
  }

  Promise.resolve(refreshChips()).catch(() => {
    // Best-effort refresh only; keep default chips if this background fetch fails.
  });
  return true;
}

export async function resolveConversationIdForSend({
  currentConversationId,
  currentChartId,
  ensureConversation,
}) {
  if (currentConversationId) return currentConversationId;
  if (!currentChartId || typeof ensureConversation !== 'function') return null;
  const result = await ensureConversation(currentChartId);
  return result?.conversationId || null;
}
