const MAX_CLASSICS = 6;
const QUOTE_LIMIT = 220;
const NOTE_LIMIT = 180;

function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + '…';
}

function compactClassicsItem(item) {
  if (!item || typeof item !== 'object') return null;
  const source = clip(item.source, 60);
  const scope = clip(item.scope, 100);
  const quote = clip(item.quote || item.text, QUOTE_LIMIT);
  const plain = clip(item.plain, NOTE_LIMIT);
  const match = clip(item.match, NOTE_LIMIT);
  if (!source && !scope && !quote && !plain && !match) return null;
  return { source, scope, quote, plain, match };
}

export function buildChatClientContext({ view, workspace, classics } = {}) {
  const context = {
    view: clip(view, 40),
    context_label: clip(workspace?.contextLabel, 80),
    classics: [],
  };

  const items = Array.isArray(classics?.items) ? classics.items : [];
  context.classics = items
    .slice(0, MAX_CLASSICS)
    .map(compactClassicsItem)
    .filter(Boolean);

  return context;
}
