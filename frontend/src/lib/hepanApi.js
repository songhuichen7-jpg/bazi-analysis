// frontend/src/lib/hepanApi.js
//
// Thin wrappers over /api/hepan/* — mirrors cardApi.js for consistency.
import { ApiError } from './cardApi.js';

const DEFAULT_BASE = '';  // same-origin

export async function postHepanInvite(payload, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  // credentials:'include' — 登录态时让后端把 user_id 绑到这条 invite 上。
  // 匿名调用（没 cookie）后端 optional_user 自然 fallback 到 user_id=NULL，
  // 一份代码两套用法。
  const resp = await fetchImpl(`${baseUrl}/api/hepan/invite`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  return data;
}

// 登录用户的合盘历史。匿名 401。
export async function getHepanMine({ fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(`${baseUrl}/api/hepan/mine`, { credentials: 'include' });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
  return data;
}

// 软删一条邀请。后端只允许创建者本人删；其他人 / 不存在 / 已删都 404。
export async function deleteHepanInvite(slug, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(
    `${baseUrl}/api/hepan/${encodeURIComponent(slug)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  if (resp.status === 204) return { ok: true };
  const data = await resp.json().catch(() => ({}));
  throw new ApiError(data.detail || `request failed (${resp.status})`, resp.status);
}

// 合盘对话历史（仅创建者）。匿名 / 非创建者 → 401 / 404。
export async function getHepanMessages(slug, { fetchImpl = fetch, baseUrl = DEFAULT_BASE } = {}) {
  const resp = await fetchImpl(
    `${baseUrl}/api/hepan/${encodeURIComponent(slug)}/messages`,
    { credentials: 'include' },
  );
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
