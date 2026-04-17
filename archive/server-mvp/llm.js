/**
 * MiMo (小米大模型) client — streaming + non-streaming + fallback wrappers.
 * OpenAI-compatible API. Migrated from OpenRouter on 2026-04.
 *
 * Env:
 *   MIMO_API_KEY        required  (from platform.xiaomimimo.com)
 *   MIMO_BASE_URL       optional  (default https://api.xiaomimimo.com/v1)
 *   LLM_MODEL           primary model   (default mimo-v2-pro)
 *   LLM_FAST_MODEL      fast/router tier (default mimo-v2-flash)
 *   LLM_FALLBACK_MODEL  fallback on primary failure (default mimo-v2-flash)
 *
 * --- OpenRouter migration notes (kept for rollback reference) ---
 * Old OPENROUTER_API_KEY / OPENROUTER_PROVIDERS / OPENROUTER_ALLOW_FALLBACKS
 * and provider-locking logic removed. `reasoning: {exclude: true}` removed
 * (MiMo thinking is opt-in via `thinking: {type:"enabled"}`; default = off).
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

const BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const ENDPOINT = BASE_URL + '/chat/completions';

const DEFAULT_MODEL  = process.env.LLM_MODEL         || 'mimo-v2-pro';
const FAST_MODEL     = process.env.LLM_FAST_MODEL     || 'mimo-v2-flash';
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || 'mimo-v2-flash';

function primaryFor(tier) {
  if (tier === 'fast' && FAST_MODEL) return FAST_MODEL;
  return DEFAULT_MODEL;
}

const STREAM_FIRST_DELTA_MS = Number(process.env.STREAM_FIRST_DELTA_MS) || 0;

function hasKey() {
  return !!(process.env.MIMO_API_KEY && process.env.MIMO_API_KEY.trim());
}

function buildHeaders() {
  return {
    'Authorization': 'Bearer ' + process.env.MIMO_API_KEY,
    'Content-Type': 'application/json',
  };
}

function makeRequest(endpoint, body) {
  const parsed = url.parse(endpoint);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    method: 'POST',
    headers: buildHeaders(),
  };
  return { transport, options };
}

function chat(opts) {
  return new Promise((resolve, reject) => {
    if (!hasKey()) return reject(new Error('MIMO_API_KEY missing'));
    const model = opts.model || DEFAULT_MODEL;
    const payload = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 1400,
      stream: false,
    };
    if (opts.response_format) payload.response_format = opts.response_format;
    const body = JSON.stringify(payload);
    const { transport, options } = makeRequest(ENDPOINT, body);
    const req = transport.request(options, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('LLM ' + res.statusCode + ': ' + buf));
        try {
          const j = JSON.parse(buf);
          const msg = j.choices?.[0]?.message;
          const content = msg?.content || msg?.reasoning_content || '';
          if (!content) {
            console.error('[LLM] empty content. Raw response:', JSON.stringify(j).slice(0, 2000));
            if (j.error) return reject(new Error('LLM error: ' + JSON.stringify(j.error)));
            return reject(new Error('LLM returned empty content. finish_reason=' + (j.choices?.[0]?.finish_reason || '?')));
          }
          resolve(content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function chatStream(opts) {
  return new Promise((resolve, reject) => {
    if (!hasKey()) {
      const err = new Error('MIMO_API_KEY missing');
      opts.onError?.(err);
      return reject(err);
    }
    const model = opts.model || DEFAULT_MODEL;
    const payload = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 1400,
      stream: true,
    };
    const body = JSON.stringify(payload);
    const { transport, options } = makeRequest(ENDPOINT, body);

    const req = transport.request(options, (res) => {
      if (res.statusCode >= 400) {
        let errBuf = '';
        res.on('data', c => errBuf += c);
        res.on('end', () => {
          const err = new Error('LLM ' + res.statusCode + ': ' + errBuf);
          opts.onError?.(err);
          reject(err);
        });
        return;
      }
      let carry = '';
      let full = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        carry += chunk;
        const lines = carry.split('\n');
        carry = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t || !t.startsWith('data:')) continue;
          const p = t.slice(5).trim();
          if (p === '[DONE]') continue;
          try {
            const j = JSON.parse(p);
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              opts.onDelta?.(delta);
            }
          } catch (_) {}
        }
      });
      res.on('end', () => {
        opts.onDone?.(full);
        resolve(full);
      });
      res.on('error', err => { opts.onError?.(err); reject(err); });
    });
    req.on('error', err => { opts.onError?.(err); reject(err); });
    req.write(body);
    req.end();
  });
}

/** Non-stream fallback: primary → FALLBACK_MODEL on error/empty. Returns {text, modelUsed}. */
async function chatWithFallback(opts) {
  const primary = primaryFor(opts.tier);
  try {
    const text = await chat({ ...opts, model: primary });
    if (!text || !text.trim()) throw new Error('empty content from ' + primary);
    return { text, modelUsed: primary };
  } catch (e) {
    if (!FALLBACK_MODEL) throw e;
    console.warn('[llm] ' + (opts.tier || 'primary') + ' (' + primary + ') failed (' + (e.message || e) + '), trying fallback ' + FALLBACK_MODEL);
    const text = await chat({ ...opts, model: FALLBACK_MODEL });
    return { text, modelUsed: FALLBACK_MODEL };
  }
}

/** Stream fallback: primary stream → fallback on HTTP error or empty stream. */
function chatStreamWithFallback(opts) {
  return new Promise((resolve, reject) => {
    const primary = primaryFor(opts.tier);
    let firstDeltaSeen = false;
    let timer = null;
    let aborted = false;
    let fallbackRan = false;

    const startFallback = async (reason) => {
      if (fallbackRan) return;
      fallbackRan = true;
      if (!FALLBACK_MODEL) {
        opts.onError?.(new Error('primary failed (' + reason + '), no fallback configured'));
        return reject(new Error('primary failed, no fallback'));
      }
      console.warn('[llm] stream fallback ' + primary + ' → ' + FALLBACK_MODEL + ' (' + reason + ')');
      opts.onModel?.(FALLBACK_MODEL);
      try {
        const full = await chatStream({ ...opts, model: FALLBACK_MODEL });
        resolve(full);
      } catch (e) {
        opts.onError?.(e);
        reject(e);
      }
    };

    const wrapped = {
      ...opts,
      model: primary,
      onDelta: (t) => {
        if (!firstDeltaSeen) {
          firstDeltaSeen = true;
          if (timer) { clearTimeout(timer); timer = null; }
          opts.onModel?.(primary);
        }
        if (!aborted) opts.onDelta?.(t);
      },
      onDone: (full) => {
        if (aborted) return;
        if (!firstDeltaSeen && (!full || !full.trim())) {
          aborted = true;
          return startFallback('empty_stream');
        }
        opts.onDone?.(full);
      },
      onError: (err) => {
        if (aborted) return;
        if (!firstDeltaSeen) {
          aborted = true;
          return startFallback(err.message || 'error');
        }
        opts.onError?.(err);
      },
    };

    if (STREAM_FIRST_DELTA_MS > 0) {
      timer = setTimeout(() => {
        if (firstDeltaSeen) return;
        aborted = true;
        console.warn('[llm] primary stream timeout @ ' + STREAM_FIRST_DELTA_MS + 'ms, switching to fallback');
        startFallback('first_delta_timeout');
      }, STREAM_FIRST_DELTA_MS);
    }

    chatStream(wrapped).then((full) => {
      if (!aborted) resolve(full);
    }).catch(() => {
      // wrapped.onError handles fallback if not yet aborted
    });
  });
}

module.exports = {
  chat, chatStream,
  chatWithFallback, chatStreamWithFallback,
  hasKey, DEFAULT_MODEL, FAST_MODEL, FALLBACK_MODEL,
};
