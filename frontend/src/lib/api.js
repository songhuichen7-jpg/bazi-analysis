/**
 * SSE streamer. Handlers: { onDelta(text, running), onDone(full), onModel(m), onIntent(i,r,s) }
 * Returns the final text.
 */
export async function streamSSE(url, body, handlers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let carry = '';
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const parts = carry.split('\n\n');
    carry = parts.pop() || '';
    for (const block of parts) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === 'delta' && ev.text) { full += ev.text; handlers.onDelta?.(ev.text, full); }
      else if (ev.type === 'done') { if (ev.full) full = ev.full; handlers.onDone?.(full); }
      else if (ev.type === 'model') handlers.onModel?.(ev.modelUsed);
      else if (ev.type === 'intent') handlers.onIntent?.(ev.intent, ev.reason, ev.source);
      else if (ev.type === 'retrieval') handlers.onRetrieval?.(ev.source);
      else if (ev.type === 'gua') handlers.onGua?.(ev.data);
      else if (ev.type === 'redirect') handlers.onRedirect?.(ev.to, ev.question);
      else if (ev.type === 'error') throw new Error(ev.message || 'LLM error');
    }
  }
  return full;
}

export async function fetchHealth() {
  const r = await fetch('/api/health');
  return r.json();
}

export async function fetchCities() {
  const r = await fetch('/api/cities');
  return r.json();
}

export async function fetchPaipan(payload) {
  const r = await fetch('/api/paipan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || '排盘失败');
  }
  return r.json();
}

export async function fetchSections(chart) {
  const r = await fetch('/api/sections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart }),
  });
  return r.json();
}

export async function streamVerdicts(chart, callbacks = {}) {
  const resp = await fetch('/api/verdicts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart }),
  });
  if (!resp.ok || !resp.body) {
    let message = 'HTTP ' + resp.status;
    try {
      const err = await resp.json();
      if (err?.error) message = err.error;
    } catch {
      // Fall back to HTTP status when the body is not JSON.
    }
    throw new Error(message);
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let carry = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const parts = carry.split('\n\n');
    carry = parts.pop() || '';

    for (const block of parts) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === 'delta' && ev.text) callbacks.onDelta?.(ev.text);
      else if (ev.type === 'model') callbacks.onModel?.(ev.modelUsed);
      else if (ev.type === 'done') callbacks.onDone?.(ev.full || '');
      else if (ev.type === 'error') {
        const err = new Error(ev.message || '判词生成失败');
        callbacks.onError?.(err);
        throw err;
      }
    }
  }
}
