export function createChatProgress({ contextLabel = null, seed = Date.now(), previousFirst = '' } = {}) {
  return {
    contextLabel,
    phase: 'idle',
    hasOutput: false,
    intent: null,
    intentReason: null,
    hasRetrieval: false,
    retrievalSources: [],
    modelUsed: null,
    redirectTo: null,
    seed,
    previousFirst,
    // 用于显示"已经等了 N 秒"和超过 12s 的"还在算"友好提示
    startedAt: Date.now(),
  };
}

function parseSources(raw) {
  return String(raw || '')
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applyChatProgressEvent(progress, event) {
  const current = progress || createChatProgress();

  switch (event?.type) {
    case 'intent':
      return {
        ...current,
        phase: 'routing',
        intent: event.intent || null,
        intentReason: event.reason || null,
      };

    case 'retrieval':
      return {
        ...current,
        phase: 'streaming',
        hasRetrieval: true,
        retrievalSources: parseSources(event.source),
      };

    case 'model':
      return {
        ...current,
        phase: current.hasOutput ? current.phase : 'composing',
        modelUsed: event.modelUsed || null,
      };

    case 'delta':
      if (current.hasOutput) return current;
      return {
        ...current,
        hasOutput: true,
        phase: 'streaming',
      };

    case 'redirect':
      return {
        ...current,
        phase: 'redirect',
        redirectTo: event.to || null,
      };

    case 'done':
      return {
        ...current,
        phase: 'done',
      };

    case 'abort':
      return {
        ...current,
        phase: 'stopped',
      };

    default:
      return current;
  }
}

export const INTENT_LABELS = {
  relationship: '感情',
  career: '事业',
  wealth: '财运',
  timing: '时机',
  liunian: '流年',
  dayun_step: '大运',
  personality: '性格',
  health: '身体',
  meta: '命理概念',
  appearance: '外貌',
  special_geju: '特殊格局',
  chitchat: '闲聊',
  divination: '占卜',
  media: '形容比喻',
  other: '综合',
};

export function intentLabel(intent) {
  if (!intent) return '';
  return INTENT_LABELS[intent] || intent;
}
