import { getAnonymousId } from './anonymousId.js';

let _fetchImpl = (typeof fetch !== 'undefined') ? fetch : null;
export function __setTrackFetch(f) { _fetchImpl = f; }

function collectContext() {
  if (typeof window === 'undefined') return {};
  const ctx = {
    anonymous_id: getAnonymousId(),
    user_agent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
  try {
    let sid = sessionStorage.getItem('youshi_sid');
    if (!sid) {
      sid = `s_${Math.random().toString(36).slice(2, 14)}`;
      sessionStorage.setItem('youshi_sid', sid);
    }
    ctx.session_id = sid;
  } catch { /* sessionStorage may be unavailable */ }
  return ctx;
}

export async function track(event, properties = {}) {
  if (!_fetchImpl) return;
  try {
    await _fetchImpl('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        properties: { ...collectContext(), ...properties },
      }),
    });
  } catch (_) { /* silent */ }
}
