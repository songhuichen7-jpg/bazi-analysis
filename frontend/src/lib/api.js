/**
 * SSE streamer. Handlers: { onDelta(text, running), onDone(full), onModel(m), onIntent(i,r,s) }
 * Returns the final text.
 */
export async function streamSSE(url, body, handlers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    let msg = 'HTTP ' + resp.status;
    try { const err = await resp.json(); msg = err?.detail?.message || msg; } catch { /* ignore parse error */ }
    throw new Error(msg);
  }
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

// ============================================================================
// Plan 6 — conversation layer
// ============================================================================

async function _getJSON(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
  return r.json();
}

async function _postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? null : JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
  return r.json();
}

async function _patchJSON(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
  return r.json();
}

async function _delete(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!r.ok && r.status !== 204) {
    const err = await r.json().catch(() => ({ detail: { message: 'HTTP ' + r.status } }));
    throw new Error(err?.detail?.message || ('HTTP ' + r.status));
  }
}

export async function listConversations(chartId) {
  return _getJSON(`/api/charts/${chartId}/conversations`);
}

export async function createConversation(chartId, label) {
  return _postJSON(`/api/charts/${chartId}/conversations`, { label });
}

export async function patchConversation(convId, label) {
  return _patchJSON(`/api/conversations/${convId}`, { label });
}

export async function deleteConversation(convId) {
  return _delete(`/api/conversations/${convId}`);
}

export async function restoreConversation(convId) {
  return _postJSON(`/api/conversations/${convId}/restore`, null);
}

export async function listMessages(convId, { before, limit = 50 } = {}) {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  if (before) qs.set('before', before);
  return _getJSON(`/api/conversations/${convId}/messages?${qs.toString()}`);
}

export async function streamMessage(convId, body, handlers = {}) {
  return streamSSE(`/api/conversations/${convId}/messages`, body, handlers);
}

export async function streamGua(convId, body, handlers = {}) {
  return streamSSE(`/api/conversations/${convId}/gua`, body, handlers);
}

export async function fetchChips(chartId, conversationId) {
  const qs = conversationId ? `?conversation_id=${conversationId}` : '';
  let final = '';
  await streamSSE(`/api/charts/${chartId}/chips${qs}`, null, {
    onDone: (full) => { final = full; },
  });
  try {
    const parsed = JSON.parse(final);
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
