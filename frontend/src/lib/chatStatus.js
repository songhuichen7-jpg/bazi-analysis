export function buildGenerationStatus({
  verdicts,
} = {}) {
  const streamingLabels = [];

  if (verdicts?.status === 'streaming') streamingLabels.push('古籍判词 ⏳');

  const visible = streamingLabels.length > 0;

  return {
    visible,
    text: visible ? `后台还在生成：${streamingLabels.join(' · ')}` : '',
  };
}

export function getWelcomeMessageState({ verdicts } = {}) {
  const generationInFlight = verdicts?.status === 'streaming';
  return {
    lead: generationInFlight
      ? '我正在为你研读古籍判词。你现在就可以先提问，我会继续在后台把依据补齐。'
      : '我已经看过你的命盘了。你可以：',
    showDefaultGuidance: true,
  };
}
