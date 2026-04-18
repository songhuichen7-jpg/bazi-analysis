export function finalizeChatTurn({ setChatStreaming, refreshChips }) {
  setChatStreaming(false);
  if (typeof refreshChips !== 'function') return;

  Promise.resolve(refreshChips()).catch(() => {
    // Best-effort refresh only; keep the chat UI responsive.
  });
}
