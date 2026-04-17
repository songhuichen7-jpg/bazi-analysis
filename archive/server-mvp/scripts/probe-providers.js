#!/usr/bin/env node
/**
 * Probe OpenRouter providers for z-ai/glm-5.1.
 * For each candidate provider, run 5 calls with the same reasoning-prone prompt,
 * record success rate / latency / empty-response count.
 *
 * Usage: node probe-providers.js
 */

const fs = require('fs');
const path = require('path');

// minimal .env load
(function () {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    txt.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
})();

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY missing'); process.exit(1); }

const CANDIDATES = [
  'Friendli', 'Inceptron', 'Together', 'Parasail', 'Io Net',
  'GMICloud', 'Fireworks', 'DeepInfra', 'AtlasCloud', 'Novita', 'Chutes',
];

const RUNS_PER_PROVIDER = 5;

const PROMPT = '请用 5 行中文讲"七杀格"对人的影响。直接开始，第一个字是"七"，不要前言。';

async function callOnce(provider) {
  const body = JSON.stringify({
    model: 'z-ai/glm-5.1',
    messages: [{ role: 'user', content: PROMPT }],
    temperature: 0.6,
    max_tokens: 2000,
    reasoning: { exclude: true },
    provider: { order: [provider], allow_fallbacks: false },
  });
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3101',
      'X-Title': 'bazi-probe',
    },
    body,
  });
  const ms = Date.now() - t0;
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch (_) { return { ok: false, ms, err: 'non_json', status: res.status }; }
  if (j.error) return { ok: false, ms, err: j.error.message || JSON.stringify(j.error) };
  const msg = j.choices?.[0]?.message;
  const content = msg?.content || msg?.reasoning_content || '';
  const finish = j.choices?.[0]?.finish_reason;
  const usedProvider = j.provider;
  return {
    ok: !!(content && content.trim()),
    ms,
    finish,
    provider: usedProvider,
    len: (content || '').length,
    reasoning_tokens: j.usage?.completion_tokens_details?.reasoning_tokens || 0,
  };
}

function median(arr) { const s = arr.slice().sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function p95(arr) { const s = arr.slice().sort((a,b)=>a-b); return s[Math.floor(s.length*0.95)] || s[s.length-1]; }

(async () => {
  const rows = [];
  for (const prov of CANDIDATES) {
    process.stderr.write(`probing ${prov}…\n`);
    const results = [];
    for (let i = 0; i < RUNS_PER_PROVIDER; i++) {
      try { results.push(await callOnce(prov)); }
      catch (e) { results.push({ ok: false, ms: 0, err: e.message }); }
    }
    const okResults = results.filter(r => r.ok);
    const latencies = results.map(r => r.ms);
    const empties = results.filter(r => !r.ok && !r.err).length;
    const errors = results.filter(r => r.err).length;
    rows.push({
      provider: prov,
      success: `${okResults.length}/${RUNS_PER_PROVIDER}`,
      p50_ms: median(latencies),
      p95_ms: p95(latencies),
      empty: empties,
      error: errors,
      avgReasoning: Math.round(results.reduce((s,r)=>s+(r.reasoning_tokens||0),0)/results.length),
    });
  }
  console.log('\n=== Results ===');
  console.log('provider     | success | p50ms | p95ms | empty | err | avgReason');
  console.log('-'.repeat(78));
  rows.forEach(r => {
    console.log(
      r.provider.padEnd(13) + '| ' +
      r.success.padEnd(8) + '| ' +
      String(r.p50_ms).padEnd(6) + '| ' +
      String(r.p95_ms).padEnd(6) + '| ' +
      String(r.empty).padEnd(6) + '| ' +
      String(r.error).padEnd(4) + '| ' +
      String(r.avgReasoning)
    );
  });
})();
