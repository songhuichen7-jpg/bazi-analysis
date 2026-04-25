function splitSources(source) {
  return String(source || '')
    .split(/\s+\+\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeSourceName(source) {
  const value = String(source || '').trim();
  if (!value) return '';
  if (value.includes(' · ')) return value.split(' · ')[0]?.trim() || value;
  return value.split('·')[0]?.trim() || value;
}

function describeIntent(intent) {
  switch (intent) {
    case 'timing':
      return '方向：流年';
    case 'relationship':
      return '方向：关系';
    case 'career':
      return '方向：事业';
    case 'wealth':
      return '方向：财务';
    case 'health':
      return '方向：健康';
    case 'personality':
      return '方向：性情';
    case 'divination':
      return '更适合起卦';
    default:
      return '';
  }
}

function describeRetrieval(source) {
  const items = splitSources(source).map(normalizeSourceName).filter(Boolean);
  const unique = Array.from(new Set(items));
  if (!unique.length) return '';
  if (unique.length <= 2) return `查阅：${unique.join('、')}`;
  return `查阅：${unique.slice(0, 2).join('、')} 等${unique.length}条`;
}

function upsertReceipt(receipts, key, text) {
  if (!text) return Array.isArray(receipts) ? receipts : [];
  const next = Array.isArray(receipts) ? receipts.map((item) => ({ ...item })) : [];
  const index = next.findIndex((item) => item.key === key);
  if (index >= 0) next[index] = { key, text };
  else next.push({ key, text });
  return next;
}

function removeReceipt(receipts, key) {
  return (Array.isArray(receipts) ? receipts : []).filter((item) => item.key !== key);
}

export function createChatProgress({ contextLabel = null } = {}) {
  return {
    contextLabel,
    phase: 'idle',
    hasOutput: false,
    receipts: [],
  };
}

export function applyChatProgressEvent(progress, event) {
  const current = progress || createChatProgress();

  switch (event?.type) {
    case 'intent':
      return {
        ...current,
        phase: 'routing',
        receipts: upsertReceipt(current.receipts, 'intent', describeIntent(event.intent)),
      };

    case 'retrieval': {
      const text = describeRetrieval(event.source);
      if (!text) return current;
      return {
        ...current,
        phase: 'streaming',
        receipts: upsertReceipt(current.receipts, 'retrieval', text),
      };
    }

    case 'model':
      return current;

    case 'delta':
      if (current.hasOutput) return current;
      return {
        ...current,
        hasOutput: true,
        phase: 'streaming',
        receipts: current.receipts.length
          ? upsertReceipt(current.receipts, 'streaming', '输出中')
          : current.receipts,
      };

    case 'redirect':
      return {
        ...current,
        phase: 'redirect',
        receipts: upsertReceipt(current.receipts, 'redirect', '转入起卦'),
      };

    case 'done':
      return {
        ...current,
        phase: 'done',
        receipts: removeReceipt(current.receipts, 'streaming'),
      };

    case 'abort':
      return {
        ...current,
        phase: 'stopped',
        receipts: upsertReceipt(removeReceipt(current.receipts, 'streaming'), 'abort', '已停止'),
      };

    default:
      return current;
  }
}
