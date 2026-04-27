// frontend/src/lib/hepanApi.js
//
// Thin wrappers over /api/hepan/* — mirrors cardApi.js for consistency.
import { ApiError } from './cardApi.js';

const DEFAULT_BASE = '';  // same-origin

export async function postHepanInvite(payload, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(`${baseUrl}/api/hepan/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  return data;
}

export async function postHepanComplete(slug, payload, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(
    `${baseUrl}/api/hepan/${encodeURIComponent(slug)}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  return data;
}

export async function getHepan(slug, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(`${baseUrl}/api/hepan/${encodeURIComponent(slug)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  return data;
}
