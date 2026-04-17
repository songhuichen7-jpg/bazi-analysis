/**
 * Bazi local server — wraps paipan-engine + ming/analyze.
 * No framework: pure Node http.
 *
 * Endpoints:
 *   GET  /                    → serves prototype/index.html
 *   GET  /*.{js,css,html}     → static from ../prototype/
 *   POST /api/paipan          → body: birth info → returns {paipan, analyze, ui}
 *   GET  /api/cities          → list of known cities
 *
 * Usage:
 *   cd server && npm install && npm start
 *   open http://localhost:3101
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no external dependency)
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const txt = fs.readFileSync(envPath, 'utf8');
    txt.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
})();

const { chat, chatWithFallback, chatStreamWithFallback, hasKey, DEFAULT_MODEL } = require('./llm');
const { retrieveForChart } = require('./retrieval');
const verdicts = require('./verdicts');
const {
  buildSectionsMessages, parseSectionsText, skillLoaded,
  buildRouterMessages, buildExpertMessages, parseRouterJSON, classifyByKeywords,
  buildDayunStepMessages, buildLiunianMessages, buildGuaMessages,
  buildChipsMessages, parseChipsJSON,
} = require('./prompts');
const { castGua } = require('./gua');

// Engine is in sibling folder
const ENGINE = path.resolve(__dirname, '..', 'paipan-engine');
// Make lunar-javascript discoverable by the engine modules
const Module = require('module');
const origResolve = Module._resolveLookupPaths;
// Simpler: just require engine via absolute paths
const { paipan } = require(path.join(ENGINE, 'src', 'paipan.js'));
const { analyze } = require(path.join(ENGINE, 'src', 'ming', 'analyze.js'));
const { CITIES } = tryRequireCities();

function tryRequireCities() {
  try {
    return require(path.join(ENGINE, 'src', 'cities.js'));
  } catch (e) {
    return { CITIES: {} };
  }
}

const PROTO_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');
const PORT = process.env.PORT || 3101;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }, headers || {}));
  res.end(body);
}

function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1e6) { req.destroy(); reject(new Error('too large')); }});
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function resolveTodayYear(r) {
  const fromMeta = Number(String(r?.todayYmd || '').slice(0, 4));
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  return new Date().getFullYear();
}

/**
 * Build the UI-shaped data the prototype expects.
 * Maps engine output → PAIPAN / FORCE / GUARDS / DAYUN / META.
 */
function toUiShape(r, a, opts) {
  const b = a.bazi;
  const ss = a.shiShen;
  const hourUnknown = !!r.hourUnknown;

  // PAIPAN — shape expected by prototype renderChart:
  //   sizhu:   {year,month,day,hour} → 2-char 干支
  //   shishen: {year,month,hour}     → 十神 name
  //   cangGan: {year,month,day,hour} → array of gan chars
  //
  // 时辰未知 → 时柱相关字段全部置空/降级，前端按 null 兜底。
  const PAIPAN = {
    sizhu: {
      year:  b.yearGan  + b.yearZhi,
      month: b.monthGan + b.monthZhi,
      day:   b.dayGan   + b.dayZhi,
      hour:  hourUnknown ? null : (b.hourGan || '') + (b.hourZhi || ''),
    },
    shishen: {
      year:  ss.year?.ss || '',
      month: ss.month?.ss || '',
      hour:  hourUnknown ? null : (ss.hour?.ss || null),
    },
    cangGan: {
      year:  (a.zhiDetail.year?.cangGan  || []).map(c => c.gan),
      month: (a.zhiDetail.month?.cangGan || []).map(c => c.gan),
      day:   (a.zhiDetail.day?.cangGan   || []).map(c => c.gan),
      hour:  hourUnknown ? [] : (a.zhiDetail.hour?.cangGan || []).map(c => c.gan),
    },
  };

  // FORCE: 10 ten-gods, scores 0-10 (already clamped in engine)
  const SS_ORDER = ['比肩','劫财','食神','伤官','正财','偏财','正官','七杀','正印','偏印'];
  const FORCE = SS_ORDER.map(name => ({
    name,
    val: Math.max(0, Math.min(10, a.force.scores[name] || 0)),
  }));

  // GUARDS — shape: [{type, note}] to match prototype renderChart
  const GUARDS = [];
  (a.notes || []).forEach(n => {
    if (n.type === 'pair_mismatch') {
      GUARDS.push({ type: 'pair_mismatch', note: n.message });
    }
  });
  const seenLiuHe = new Set();
  (a.zhiRelations?.liuHe || []).forEach(lh => {
    const key = [lh.a, lh.b].sort().join('');
    if (seenLiuHe.has(key)) return;
    seenLiuHe.add(key);
    const note = lh.wuxing
      ? lh.a + lh.b + ' 六合 化 ' + lh.wuxing
      : lh.a + lh.b + ' 六合（合日月，不化）';
    GUARDS.push({ type: 'liuhe', note });
  });
  const seenChong = new Set();
  (a.zhiRelations?.chong || []).forEach(c => {
    const pair = c.a && c.b ? c.a + c.b : (c.zhi || []).join('');
    const key = pair.split('').sort().join('');
    if (!pair || seenChong.has(key)) return;
    seenChong.add(key);
    GUARDS.push({ type: 'chong', note: pair + ' 相冲' });
  });

  // DAYUN — shape expected: [{age, gz, ss, current}] where ss = "干十神/支本气十神"
  const input = r.meta.input;
  const BENQI = {子:'癸',丑:'己',寅:'甲',卯:'乙',辰:'戊',巳:'丙',午:'丁',未:'己',申:'庚',酉:'辛',戌:'戊',亥:'壬'};
  const todayYear = resolveTodayYear(r);

  const DAYUN = (r.dayun.list || []).map(d => {
    const g = d.ganzhi[0], z = d.ganzhi[1];
    const zBenqi = BENQI[z] || g;
    const ssGan = ssLookup(b.dayGan, g);
    const ssZhi = ssLookup(b.dayGan, zBenqi);
    const liunianList = d.liunian || [];
    const years = liunianList.map(ly => {
      const yg = ly.ganzhi[0], yz = ly.ganzhi[1];
      const yzBenqi = BENQI[yz] || yg;
      return {
        year: ly.year,
        gz: ly.ganzhi,
        ss: ssLookup(b.dayGan, yg) + '/' + ssLookup(b.dayGan, yzBenqi),
        current: (ly.year === todayYear),
      };
    });
    return {
      age: d.startAge,
      gz: d.ganzhi,
      ss: ssGan + '/' + ssZhi,
      startYear: d.startYear,
      endYear: d.endYear ?? (d.startYear + 10),
      // current 按公历年判断，避免把 60 年后的同干支流年误判成当前。
      current: years.some(y => y.current),
      years,
    };
  });

  // META
  const META = {
    rizhu: b.dayGan + b.dayZhi,
    rizhuGan: b.dayGan,
    dayStrength: a.force.dayStrength,
    sameSideScore: a.force.sameSideScore,
    otherSideScore: a.force.otherSideScore,
    geju: a.geJu?.mainCandidate?.name || '（格局未定）',
    gejuNote: a.geJu?.decisionNote || '',
    yongshen: suggestYongshen(a),  // heuristic placeholder
    lunar: r.lunar,
    solarCorrected: r.solarCorrected,
    warnings: r.warnings || [],
    corrections: r.meta?.corrections || [],
    jieqiCheck: r.meta?.jieqiCheck || null,
    hourUnknown: r.hourUnknown,
    today: {
      ymd: r.todayYmd,
      yearGz: r.todayYearGz,
      monthGz: r.todayMonthGz,
      dayGz: r.todayDayGz,
    },
    input: {
      year: input.year, month: input.month, day: input.day,
      hour: input.hour, minute: input.minute,
      gender: opts.gender,
      city: opts.city,
    },
  };

  return { PAIPAN, FORCE, GUARDS, DAYUN, META };
}

// Minimal 十神 lookup (gan-to-gan relative to rizhu gan)
// order: 甲乙丙丁戊己庚辛壬癸  (0..9)
const GAN_IDX = {甲:0,乙:1,丙:2,丁:3,戊:4,己:5,庚:6,辛:7,壬:8,癸:9};
const GAN_YANG = {甲:true,乙:false,丙:true,丁:false,戊:true,己:false,庚:true,辛:false,壬:true,癸:false};
const GAN_WX  = {甲:'木',乙:'木',丙:'火',丁:'火',戊:'土',己:'土',庚:'金',辛:'金',壬:'水',癸:'水'};
function wxRelation(from, to) {
  // returns: same / sheng(from->to) / ke(from->to) / shengBy / keBy
  if (from === to) return 'same';
  const cycle = { 木:'火', 火:'土', 土:'金', 金:'水', 水:'木' }; // 生
  const kec   = { 木:'土', 土:'水', 水:'火', 火:'金', 金:'木' }; // 克
  if (cycle[from] === to) return 'sheng';
  if (cycle[to] === from) return 'shengBy';
  if (kec[from] === to) return 'ke';
  if (kec[to] === from) return 'keBy';
  return '?';
}
function ssLookup(rizhuGan, otherGan) {
  const rwx = GAN_WX[rizhuGan], owx = GAN_WX[otherGan];
  const sameYin = GAN_YANG[rizhuGan] === GAN_YANG[otherGan];
  const rel = wxRelation(rwx, owx);
  switch (rel) {
    case 'same':    return sameYin ? '比肩' : '劫财';
    case 'sheng':   return sameYin ? '食神' : '伤官';   // 我生
    case 'shengBy': return sameYin ? '偏印' : '正印';   // 生我
    case 'ke':      return sameYin ? '偏财' : '正财';   // 我克
    case 'keBy':    return sameYin ? '七杀' : '正官';   // 克我
    default: return '?';
  }
}

/**
 * Very rough 用神 heuristic — proper 用神 selection is 格局 + 调候 + 扶抑
 * combined. This is a placeholder we can swap out later.
 */
function suggestYongshen(a) {
  const s = a.force;
  if (s.dayStrength === '身弱' || s.dayStrength === '极弱') {
    // strengthen: 印 or 比劫
    const pin = (s.scores['正印'] || 0) + (s.scores['偏印'] || 0);
    const bijie = (s.scores['比肩'] || 0) + (s.scores['劫财'] || 0);
    return pin >= bijie ? '印（扶身）' : '比劫（帮身）';
  }
  if (s.dayStrength === '身强' || s.dayStrength === '极强') {
    // drain: 财 or 官杀 or 食伤
    const guansha = (s.scores['正官'] || 0) + (s.scores['七杀'] || 0);
    const cai = (s.scores['正财'] || 0) + (s.scores['偏财'] || 0);
    const shishang = (s.scores['食神'] || 0) + (s.scores['伤官'] || 0);
    const top = Math.max(guansha, cai, shishang);
    if (top === guansha) return '官杀（制身）';
    if (top === cai) return '财（耗身）';
    return '食伤（泄身）';
  }
  return '中和（无明显偏枯）';
}

// ===== Routes =====
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // --- API ---
  if (req.method === 'POST' && p === '/api/paipan') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      const r = paipan(data);
      const a = analyze(r);
      const ui = toUiShape(r, a, data);
      return sendJSON(res, 200, { paipan: r, analyze: a, ui });
    } catch (e) {
      console.error(e);
      return sendJSON(res, 400, { error: String(e.message || e) });
    }
  }
  if (req.method === 'GET' && p === '/api/cities') {
    return sendJSON(res, 200, { cities: Object.keys(CITIES) });
  }
  if (req.method === 'GET' && p === '/api/health') {
    return sendJSON(res, 200, {
      ok: true, ts: Date.now(),
      llm: { hasKey: hasKey(), model: DEFAULT_MODEL, skillLoaded: skillLoaded() },
    });
  }

  // --- LLM: personalized chat chip suggestions (fast model) ---
  if (req.method === 'POST' && p === '/api/chips') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!hasKey() || !data.chart) return sendJSON(res, 200, { chips: [] });
      const messages = buildChipsMessages(data.chart, data.history || []);
      const { text } = await chatWithFallback({
        messages,
        temperature: 0.9,
        max_tokens: 200,
        tier: 'fast',
      });
      const chips = parseChipsJSON(text);
      console.log('[chips] generated:', chips);
      return sendJSON(res, 200, { chips });
    } catch (e) {
      console.error('[chips] failed:', e.message || e);
      return sendJSON(res, 200, { chips: [] });
    }
  }

  // --- LLM: initial 5-section reading (§-delimited, streamed internally) ---
  if (req.method === 'POST' && p === '/api/sections') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!hasKey()) return sendJSON(res, 503, { error: 'MIMO_API_KEY not configured' });
      const retrieved = await retrieveForChart(data.chart, 'meta', null);
      if (retrieved.length) {
        const total = retrieved.reduce((s, r) => s + r.chars, 0);
        console.log('[retrieval] sections hit: ' + retrieved.map(r => r.source + '(' + r.scope + ',' + r.chars + ')').join(' + ') + ' [' + retrieved.length + ' sources, ' + total + ' chars]');
      }
      const messages = buildSectionsMessages(data.chart, retrieved);
      // Stream internally so we can use a larger token budget without blocking
      // the HTTP response on a single giant non-streaming call.
      const t0 = Date.now();
      const { text: raw, modelUsed } = await chatWithFallback({
        messages,
        temperature: 0.7,
        max_tokens: 4000,
      });
      console.log('[sections] model=' + modelUsed + ' ms=' + (Date.now()-t0) + ' raw.length=' + raw.length);
      const sections = parseSectionsText(raw);
      if (!sections.length) {
        console.error('[sections] parse failed. raw (first 500):', raw.slice(0, 500));
        return sendJSON(res, 502, { error: 'LLM returned no parseable sections', raw: raw.slice(0, 1500), modelUsed });
      }
      return sendJSON(res, 200, { sections });
    } catch (e) {
      console.error(e);
      return sendJSON(res, 500, { error: String(e.message || e) });
    }
  }

  // --- LLM: verdicts panel (SSE streaming) ---
  // body: { chart }
  if (req.method === 'POST' && p === '/api/verdicts') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!data.chart) return sendJSON(res, 400, { error: 'chart required' });
      if (!hasKey()) return sendJSON(res, 503, { error: 'MIMO_API_KEY not configured' });
      if (!verdicts.verdictsTreeExists()) return sendJSON(res, 503, { error: 'verdicts tree missing' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      await verdicts.generateVerdicts(data.chart, (ev) => {
        if (clientClosed || res.writableEnded) return;
        send(ev);
        if (ev.type === 'done' || ev.type === 'error') res.end();
      });

      if (!clientClosed && !res.writableEnded) res.end();
      return;
    } catch (e) {
      console.error(e);
      return sendJSON(res, 400, { error: String(e.message || e) });
    }
  }

  // --- LLM: dayun step reading (SSE streaming) ---
  // body: { chart, stepIdx }
  if (req.method === 'POST' && p === '/api/dayun-step') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!hasKey()) return sendJSON(res, 503, { error: 'MIMO_API_KEY not configured' });
      if (typeof data.stepIdx !== 'number') return sendJSON(res, 400, { error: 'stepIdx required' });

      let messages;
      const retrieved = await retrieveForChart(data.chart, 'dayun_step', null);
      if (retrieved.length) {
        const total = retrieved.reduce((s, r) => s + r.chars, 0);
        console.log('[retrieval] dayun-step hit: ' + retrieved.map(r => r.source + '(' + r.chars + ')').join(' + ') + ' [' + total + ' chars]');
      }
      try { messages = buildDayunStepMessages({ chart: data.chart, stepIdx: data.stepIdx, retrieved }); }
      catch (e) { return sendJSON(res, 400, { error: String(e.message || e) }); }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });
      if (retrieved.length) send({ type: 'retrieval', source: retrieved.map(r => r.source).join(' + ') });

      try {
        await chatStreamWithFallback({
          messages,
          temperature: 0.7,
          max_tokens: 3000,
          onModel: (m) => { if (!clientClosed) send({ type: 'model', modelUsed: m }); },
          onDelta: (t) => { if (!clientClosed) send({ type: 'delta', text: t }); },
          onDone:  (full) => { if (!clientClosed) { send({ type: 'done', full }); res.end(); } },
          onError: (err) => { if (!clientClosed) { send({ type: 'error', message: String(err.message || err) }); res.end(); } },
        });
      } catch (e) {
        if (!clientClosed) { send({ type: 'error', message: String(e.message || e) }); res.end(); }
      }
      return;
    } catch (e) {
      console.error(e);
      return sendJSON(res, 400, { error: String(e.message || e) });
    }
  }

  // --- LLM: liunian (流年) reading (SSE streaming) ---
  // body: { chart, dayunIdx, yearIdx }
  if (req.method === 'POST' && p === '/api/liunian') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!hasKey()) return sendJSON(res, 503, { error: 'MIMO_API_KEY not configured' });
      if (typeof data.dayunIdx !== 'number' || typeof data.yearIdx !== 'number') {
        return sendJSON(res, 400, { error: 'dayunIdx and yearIdx required' });
      }
      let messages;
      const retrieved = await retrieveForChart(data.chart, 'liunian', null);
      if (retrieved.length) {
        const total = retrieved.reduce((s, r) => s + r.chars, 0);
        console.log('[retrieval] liunian hit: ' + retrieved.map(r => r.source).join(' + ') + ' [' + total + ' chars]');
      }
      try { messages = buildLiunianMessages({ chart: data.chart, dayunIdx: data.dayunIdx, yearIdx: data.yearIdx, retrieved }); }
      catch (e) { return sendJSON(res, 400, { error: String(e.message || e) }); }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });
      if (retrieved.length) send({ type: 'retrieval', source: retrieved.map(r => r.source).join(' + ') });

      try {
        await chatStreamWithFallback({
          messages,
          temperature: 0.7,
          max_tokens: 1500,
          tier: 'fast',
          onModel: (m) => { if (!clientClosed) send({ type: 'model', modelUsed: m }); },
          onDelta: (t) => { if (!clientClosed) send({ type: 'delta', text: t }); },
          onDone:  (full) => { if (!clientClosed) { send({ type: 'done', full }); res.end(); } },
          onError: (err) => { if (!clientClosed) { send({ type: 'error', message: String(err.message || err) }); res.end(); } },
        });
      } catch (e) {
        if (!clientClosed) { send({ type: 'error', message: String(e.message || e) }); res.end(); }
      }
      return;
    } catch (e) {
      console.error(e);
      return sendJSON(res, 400, { error: String(e.message || e) });
    }
  }

  // --- LLM: 卦象（梅花易数·时间起卦）SSE streaming ---
  // body: { question, birthContext? }
  if (req.method === 'POST' && p === '/api/gua') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!data.question || !String(data.question).trim()) return sendJSON(res, 400, { error: 'question required' });
      if (!hasKey()) return sendJSON(res, 503, { error: 'MIMO_API_KEY not configured' });

      const gua = castGua(new Date());
      console.log('[gua] cast: ' + gua.symbol + ' ' + gua.name + ' (上' + gua.upper + '下' + gua.lower + ') 动爻=' + gua.dongyao + ' | ' + gua.source.formula);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      // Push gua data first so frontend can render the hexagram immediately
      send({ type: 'gua', data: gua });

      const messages = buildGuaMessages({
        question: data.question,
        gua,
        birthContext: data.birthContext || null,
      });

      try {
        await chatStreamWithFallback({
          messages,
          temperature: 0.7,
          max_tokens: 2000,
          onModel: (m) => { if (!clientClosed) send({ type: 'model', modelUsed: m }); },
          onDelta: (t) => { if (!clientClosed) send({ type: 'delta', text: t }); },
          onDone:  (full) => { if (!clientClosed) { send({ type: 'done', full }); res.end(); } },
          onError: (err) => { if (!clientClosed) { send({ type: 'error', message: String(err.message || err) }); res.end(); } },
        });
      } catch (e) {
        if (!clientClosed) { send({ type: 'error', message: String(e.message || e) }); res.end(); }
      }
      return;
    } catch (e) {
      console.error(e);
      return sendJSON(res, 400, { error: String(e.message || e) });
    }
  }

  // --- LLM chat (SSE streaming) ---
  // body: { chart, history, message, task? }
  // response: text/event-stream, each event is a line "data: <json>\n\n"
  //   {type:'delta', text:'...'} | {type:'done', full:'...'} | {type:'error', message:'...'}
  if (req.method === 'POST' && p === '/api/chat') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!data.message) return sendJSON(res, 400, { error: 'message required' });
      if (!hasKey()) return sendJSON(res, 503, { error: 'MIMO_API_KEY not configured' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      // ---- Stage 1: router (keyword fast-path → LLM fallback) ----
      let routed = classifyByKeywords(data.message);
      if (routed) {
        console.log('[chat] kw-route intent=' + routed.intent + ' (' + routed.reason + ')');
      } else {
        try {
          const routerMessages = buildRouterMessages({
            history: data.history || [],
            userMessage: data.message,
          });
          const t0 = Date.now();
          const { text: routerRaw } = await chatWithFallback({
            messages: routerMessages,
            temperature: 0,
            max_tokens: 800,
            tier: 'fast',
          });
          const parsed = parseRouterJSON(routerRaw);
          routed = { ...parsed, source: 'llm' };
          console.log('[chat] llm-route intent=' + routed.intent + ' reason=' + JSON.stringify(routed.reason) + ' router_ms=' + (Date.now() - t0));
        } catch (e) {
          console.error('[chat] router failed, falling back to other:', e.message || e);
          routed = { intent: 'other', reason: 'router_error', source: 'llm' };
        }
      }
      const intent = routed.intent;
      if (!clientClosed) send({ type: 'intent', intent, reason: routed.reason, source: routed.source });

      // Divination intent → tell frontend to redirect to /api/gua (unless bypassed)
      if (intent === 'divination' && !data.bypassDivination) {
        if (!clientClosed) {
          send({ type: 'redirect', to: 'gua', question: data.message });
          send({ type: 'done', full: '' });
          res.end();
        }
        return;
      }

      // bypassDivination: treat as 'other' so expert still gets a useful intent
      const effectiveIntent = (intent === 'divination') ? 'other' : intent;

      // ---- Stage 2: expert (streaming) ----
      const retrieved = effectiveIntent === 'chitchat' ? [] : await retrieveForChart(data.chart, effectiveIntent, data.message);
      if (retrieved.length) {
        const total = retrieved.reduce((s, r) => s + r.chars, 0);
        console.log('[retrieval] chat(intent=' + intent + ') hit: '
          + retrieved.map(r => r.source + '(' + (r.scope || 'full') + ',' + r.chars + ')').join(' + ')
          + ' [' + retrieved.length + ' sources, ' + total + ' chars]');
      }
      const expertMessages = buildExpertMessages({
        chart: data.chart,
        history: data.history || [],
        userMessage: data.message,
        intent: effectiveIntent,
        retrieved,
      });
      if (!clientClosed && retrieved.length) {
        send({ type: 'retrieval', source: retrieved.map(r => r.source).join(' + ') });
      }

      try {
        await chatStreamWithFallback({
          messages: expertMessages,
          max_tokens: 5000,
          onModel: (m) => { if (!clientClosed) send({ type: 'model', modelUsed: m }); },
          onDelta: (t) => { if (!clientClosed) send({ type: 'delta', text: t }); },
          onDone:  (full) => { if (!clientClosed) { send({ type: 'done', full }); res.end(); } },
          onError: (err) => { if (!clientClosed) { send({ type: 'error', message: String(err.message || err) }); res.end(); } },
        });
      } catch (e) {
        if (!clientClosed) { send({ type: 'error', message: String(e.message || e) }); res.end(); }
      }
      return;
    } catch (e) {
      console.error(e);
      return sendJSON(res, 400, { error: String(e.message || e) });
    }
  }

  // --- static from ../prototype ---
  let file = p === '/' ? '/index.html' : p;
  const full = path.join(PROTO_DIR, file);
  if (!full.startsWith(PROTO_DIR)) return send(res, 403, 'forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(full);
    send(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // dev-mode: never cache static, so Ctrl+R always gets fresh HTML
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('[bazi-server] listening on http://localhost:' + PORT);
    console.log('              static: ' + PROTO_DIR);
    console.log('              engine: ' + ENGINE);
    console.log('              llm: ' + DEFAULT_MODEL + ' (fast:' + (process.env.LLM_FAST_MODEL||'') + ') @ ' + (process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1'));
  });
}

module.exports = {
  server,
  __test__: {
    toUiShape,
    resolveTodayYear,
  },
};
