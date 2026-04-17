const fs = require('fs');
const path = require('path');

const { chatStreamWithFallback, hasKey } = require('./llm');
const { buildVerdictsMessages } = require('./prompts');
const { retrieveForChart } = require('./retrieval');

const ROOT = path.resolve(__dirname, '..');
const TREE_PATH = path.join(__dirname, 'data', 'verdicts', 'tree.json');

function verdictsTreeExists() {
  // Kept for backward-compat with server.js guard; not actually used in the
  // new single-streaming flow, but returning true lets the endpoint proceed.
  return fs.existsSync(TREE_PATH) || true;
}

/**
 * New streaming verdicts: one LLM call, emits delta events.
 * onEvent receives:
 *   { type: 'model', modelUsed }
 *   { type: 'delta', text }
 *   { type: 'done',  full }
 *   { type: 'error', message }
 */
async function generateVerdicts(chart, onEvent = () => {}) {
  try {
    if (!hasKey()) throw new Error('MIMO_API_KEY not configured');

    let retrieved = [];
    try {
      retrieved = await retrieveForChart(chart, 'meta', null);
    } catch (e) {
      // retrieval is best-effort; the model can cite from training data
      console.warn('[verdicts] retrieval failed:', e.message || e);
    }
    if (retrieved.length) {
      const total = retrieved.reduce((s, r) => s + r.chars, 0);
      console.log('[verdicts] retrieval hit: ' + retrieved.map(r => r.source + '(' + (r.scope || 'full') + ',' + r.chars + ')').join(' + ') + ' [' + total + ' chars]');
    }

    const messages = buildVerdictsMessages(chart, retrieved);

    await chatStreamWithFallback({
      messages,
      temperature: 0.7,
      max_tokens: 5000,
      onModel: (m) => onEvent({ type: 'model', modelUsed: m }),
      onDelta: (t) => onEvent({ type: 'delta', text: t }),
      onDone: (full) => onEvent({ type: 'done', full }),
      onError: (err) => onEvent({ type: 'error', message: String(err.message || err) }),
    });
  } catch (err) {
    onEvent({ type: 'error', message: String(err.message || err) });
  }
}

module.exports = {
  verdictsTreeExists,
  generateVerdicts,
};
