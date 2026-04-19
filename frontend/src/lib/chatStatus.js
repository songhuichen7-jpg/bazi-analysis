function isDoneStatus(status, body) {
  return status === 'done' || !!String(body || '').trim();
}

function statusLabel(label, state) {
  if (state === 'done') return `${label} ✓`;
  if (state === 'streaming') return `${label} ⏳`;
  return `${label}待开`;
}

export function buildGenerationStatus({
  verdicts,
  sections,
  sectionsLoading,
  dayunStreaming = false,
  dayunStarted = false,
  liunianStreaming = false,
  liunianStarted = false,
} = {}) {
  const verdictState = verdicts?.status === 'streaming'
    ? 'streaming'
    : (isDoneStatus(verdicts?.status, verdicts?.body) ? 'done' : 'pending');
  const sectionsState = sectionsLoading
    ? 'streaming'
    : (Array.isArray(sections) && sections.length > 0 ? 'done' : 'pending');
  const dayunState = dayunStreaming ? 'streaming' : (dayunStarted ? 'done' : 'pending');
  const liunianState = liunianStreaming ? 'streaming' : (liunianStarted ? 'done' : 'pending');
  const visible = [verdictState, sectionsState, dayunState, liunianState].includes('streaming');

  return {
    visible,
    text: visible
      ? `后台还在生成：${[
          statusLabel('判词', verdictState),
          statusLabel('五段', sectionsState),
          statusLabel('大运', dayunState),
          statusLabel('流年', liunianState),
        ].join(' · ')}`
      : '',
  };
}

export function getWelcomeMessageState({ verdicts, sectionsLoading } = {}) {
  const generationInFlight = verdicts?.status === 'streaming' || sectionsLoading;
  return {
    lead: generationInFlight
      ? '我正在为你生成命盘的初读和判词...你现在就可以提问，我会先答你的，背景内容会在后台陆续到位。'
      : '我已经看过你的命盘了。你可以：',
    showDefaultGuidance: true,
  };
}
