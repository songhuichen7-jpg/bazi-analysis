function rawMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.trim();
  return String(error.message || error).trim();
}

function hasAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function result(title, detail, retryable) {
  return {
    title,
    detail: detail && detail !== title ? detail : '',
    retryable,
  };
}

function isNetwork(lower) {
  return hasAny(lower, [
    'failed to fetch',
    'networkerror',
    'network request failed',
    'load failed',
    'fetch failed',
    'err_network',
    'offline',
  ]);
}

function isTimeout(lower) {
  return hasAny(lower, ['timeout', 'timed out', 'first_delta_timeout', 'empty stream']);
}

function isAuth(lower) {
  return hasAny(lower, [
    '401',
    '403',
    'invalid api key',
    'unauthorized',
    'forbidden',
    'deepseek_api_key missing',
    'deepseek_api_key not configured',
    'llm_api_key missing',
    'llm_api_key not configured',
    'mimo_api_key missing',
    'mimo_api_key not configured',
  ]);
}

function isRateLimit(lower) {
  return hasAny(lower, ['429', 'rate limit', 'too many requests']);
}

function isServer(lower) {
  return hasAny(lower, [
    'http 500',
    'http 502',
    'http 503',
    'http 504',
    'llm 500',
    'llm 502',
    'llm 503',
    'bad gateway',
    'service unavailable',
    'internal server error',
  ]);
}

function isFormat(lower) {
  return hasAny(lower, [
    'json',
    'parseable',
    'did not return json object',
    'verdict explain results incomplete',
    'verdict picks insufficient',
    'empty response',
    'empty content',
    'unexpected token',
    'unexpected end of json input',
  ]);
}

function isMissing(lower) {
  return hasAny(lower, ['tree missing', 'lookup failed', 'not found']);
}

function isSseDisconnect(lower) {
  return hasAny(lower, ['stream', 'aborted', 'socket hang up', 'econnreset', 'premature close', 'connection closed']);
}

function isPaipanInput(lower) {
  return hasAny(lower, [
    'wrong solar',
    'wrong lunar',
    'wrong month',
    'wrong day',
    'wrong hour',
    'wrong minute',
    'wrong second',
    'wrong years',
    'wrong days',
  ]);
}

function isStorageQuota(lower) {
  return hasAny(lower, [
    'quotaexceeded',
    'quota exceeded',
    'storage quota',
    'failed to execute setitem on storage',
  ]);
}

function isStorageUnavailable(lower) {
  return hasAny(lower, [
    'access is denied',
    'securityerror',
    'storage is disabled',
    'the operation is insecure',
    'localstorage is not available',
    'localstorage is not defined',
  ]);
}

export function friendlyError(error, context) {
  const ctx = typeof context === 'string' ? { kind: context } : (context || {});
  const detail = rawMessage(error);
  const lower = detail.toLowerCase();

  if (ctx.kind === 'storage_load') {
    if (isStorageUnavailable(lower)) return result('本地记录暂时读不了', detail, false);
    return result('本地记录读不出来了', detail, false);
  }

  if (ctx.kind === 'storage_save' || ctx.kind === 'storage_clear') {
    if (isStorageQuota(lower)) return result('浏览器存储空间不足', detail, false);
    if (isStorageUnavailable(lower)) return result('浏览器存储不可用', detail, false);
    return result('本地记录暂时存不住', detail, false);
  }

  if (ctx.kind === 'paipan' && isPaipanInput(lower)) {
    return result('请检查出生日期和城市', detail, false);
  }

  if (isNetwork(lower)) return result('网络连接有点问题', detail, true);
  if (isTimeout(lower)) return result('AI 响应慢了一点', detail, true);
  if (isAuth(lower)) return result('服务暂时不可用', detail, false);
  if (isRateLimit(lower)) return result('现在使用的人有点多', detail, true);
  if (isMissing(lower)) return result('功能暂时不可用', detail, false);
  if (isFormat(lower)) return result('这次 AI 没按规矩输出', detail, true);
  if (isSseDisconnect(lower)) return result('连接断开了，再试一次', detail, true);
  if (isServer(lower)) return result('模型服务偶尔调皮', detail, true);

  if (ctx.kind === 'paipan') {
    return result('请检查出生日期和城市', detail, false);
  }

  return result('出了点小问题，再试一次', detail, true);
}
