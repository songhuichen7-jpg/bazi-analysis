export function createChatProgress({ contextLabel = null, seed = Date.now(), previousFirst = '' } = {}) {
  return {
    contextLabel,
    phase: 'idle',
    hasOutput: false,
    intent: null,
    hasRetrieval: false,
    redirectTo: null,
    seed,
    previousFirst,
  };
}

export function applyChatProgressEvent(progress, event) {
  const current = progress || createChatProgress();

  switch (event?.type) {
    case 'intent':
      return {
        ...current,
        phase: 'routing',
        intent: event.intent || null,
      };

    case 'retrieval':
      return {
        ...current,
        phase: 'streaming',
        hasRetrieval: true,
      };

    case 'model':
      return current;

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
