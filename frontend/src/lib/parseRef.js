import { useAppStore } from '../store/useAppStore.js';

// Two token shapes share the [[…]] syntax:
//   [[ref.id|label]]                 — chart-internal cross-references
//   [[song:title|subtitle?]]         — pop-culture media cards (song / movie / book)
//   [[movie:title|director?]]
//   [[book:title|author?]]
// Subtitle is optional for media tokens (artist/director/author can be absent
// when the LLM isn't sure).
const TOKEN_RE = /\[\[(?:(song|movie|book):([^|\]]+)(?:\|([^\]]+))?|([\w.一-鿿]+)\|([^\]]+))\]\]/g;
// Media cards render as their own paragraph; the LLM almost always wraps
// them in \n\n which our pre-wrap parent renders as visible blank lines,
// stacking on top of the card's own margin. Strip the surrounding
// whitespace + an optional sentence-ending 。/！/？ at the parser level
// so the card sits flush against the adjacent text. Chart refs (inline
// labels) keep their punctuation/whitespace untouched.
const MEDIA_TRAILING_RE = /^[。！？.!?]?[\s ]*/;

// LLMs occasionally serialise our token in malformed shapes — single brackets,
// markdown-link syntax, etc. Repair the common ones BEFORE the strict parser
// runs so users don't see "[label](url)" leak into the reply.
const FIXUP_PATTERNS = [
  // [label](url) where url looks like a chart-ref id (pillar./shishen./dayun./liunian.)
  // → [[id|label]]. Caught even when the LLM stuffed extra text into the URL.
  {
    re: /\[([^\]]+)\]\(([^)]*?(?:pillar|shishen|dayun|liunian)\.[\w.一-鿿]*)\)/g,
    repl: (_m, label, urlish) => {
      const id = String(urlish).match(/(?:pillar|shishen|dayun|liunian)\.[\w.一-鿿]+/)?.[0];
      return id ? `[[${id}|${label}]]` : _m;
    },
  },
  // Single-bracket media token: [song:歌|艺] → [[song:歌|艺]]
  {
    re: /(^|[^\[])\[(song|movie|book):([^|\]]+)(?:\|([^\]]+))?\](?!\])/g,
    repl: (_m, head, kind, title, sub) =>
      `${head}[[${kind}:${title}${sub ? '|' + sub : ''}]]`,
  },
];

function repairTokens(text) {
  let out = String(text);
  for (const { re, repl } of FIXUP_PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}

// When the user explicitly asked "用一首歌/一部电影/一本书 形容…" but the LLM
// fell back to 《XX》 instead of our token format, infer the media kind from
// the question and rewrite. Only fires when the question STRONGLY signals a
// kind, so we don't accidentally turn 古籍《滴天髓》into a movie card.
function inferMediaKind(context) {
  const c = String(context || '');
  if (/(一首|一支)?\s*(歌|曲)/.test(c)) return 'song';
  if (/(一部|一本)?\s*(电影|影片|片|纪录片|剧)/.test(c)) return 'movie';
  if (/(一本)?\s*(书|小说|散文|诗集|诗)/.test(c)) return 'book';
  return null;
}

// Match 《X》 plus optional "—— 艺人/导演" subtitle, plus optionally an
// orphan sentence-ending punct ([。！？.!?]) ONLY when followed by newline
// or end-of-string. This eats the dangling 。 next to a card-as-sentence
// (e.g. "《肖申克的救赎》。\n\n…") without disturbing 《X》 mid-sentence
// (e.g. "我喜欢《肖申克》。它讲的是…" keeps its sentence break intact).
const TITLE_QUOTE_RE = /《([^《》]{1,40})》(?:\s*[—-]+\s*([^，。；,;.!\n\s]{1,20}))?(?:[。！？.!?](?=\s*$|\s*\n))?/g;

function rescueQuotedTitles(text, kind) {
  if (!kind) return text;
  return text.replace(TITLE_QUOTE_RE, (_m, title, sub) => {
    return `[[${kind}:${title.trim()}${sub ? '|' + sub.trim() : ''}]]`;
  });
}

export function parseRef(text, options = {}) {
  if (!text) return [];
  text = repairTokens(text);
  const inferredKind = inferMediaKind(options.context);
  if (inferredKind) text = rescueQuotedTitles(text, inferredKind);
  const out = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      let preceding = text.slice(last, m.index);
      // Trim trailing newlines/spaces from the segment before a media card —
      // the card has its own margin and doesn't need the LLM's "\n\n"
      // padding rendered as a visible blank line above it.
      if (m[1]) preceding = preceding.replace(/[\s ]+$/, '');
      if (preceding) out.push({ type: 'text', value: preceding });
    }
    let cursor = m.index + m[0].length;
    if (m[1]) {
      out.push({
        type: 'media',
        kind: m[1],
        title: (m[2] || '').trim(),
        subtitle: (m[3] || '').trim(),
      });
      // Eat trailing sentence punct + any whitespace that follows the card,
      // for the same reason: card margin handles spacing, raw \n\n adds
      // a visible blank line on top.
      const tail = text.slice(cursor);
      const tm = tail.match(MEDIA_TRAILING_RE);
      if (tm && tm[0]) {
        cursor += tm[0].length;
        TOKEN_RE.lastIndex = cursor;
      }
    } else {
      out.push({ type: 'ref', id: m[4], label: m[5] });
    }
    last = cursor;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

function doFlash(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ref-highlight');
  setTimeout(() => el.classList.remove('ref-highlight'), 2000);
}

function getActiveDayun() {
  const state = useAppStore.getState();
  const currentId = state?.currentId;
  const activeChartDayun = currentId ? state?.charts?.[currentId]?.dayun : null;

  if (Array.isArray(state?.dayun) && state.dayun.length) return state.dayun;
  if (Array.isArray(activeChartDayun)) return activeChartDayun;
  return [];
}

export function scrollAndFlash(id) {
  const el = document.querySelector(`[data-ref="${CSS.escape(id)}"]`);
  if (el) { doFlash(el); return true; }

  // liunian dead-link rescue: find which dayun step owns this year, expand it, then flash.
  if (id.startsWith('liunian.')) {
    const year = parseInt(id.split('.')[1]);
    if (isNaN(year)) { console.warn('[ref] no match:', id); return false; }
    // Find dayun cell that covers this year (via data-ref="dayun.N")
    const dayCells = Array.from(document.querySelectorAll('.dayun-cell[data-ref]'));
    // dayun step years are not stored in DOM attrs, so use the active chart data in store
    // to find which dayun step owns the requested liunian.
    const dayun = getActiveDayun();
    let targetIdx = -1;
    if (dayun && Array.isArray(dayun)) {
      targetIdx = dayun.findIndex(d => (d.years || []).some(y => y.year === year));
    }
    if (targetIdx < 0) {
      // heuristic: use startYear/endYear from cell data attributes if set
      for (const cell of dayCells) {
        const idx = parseInt(cell.dataset.idx);
        if (!isNaN(idx)) {
          // check in DOM if a chip for this year already exists after expand
          // Just try clicking the current-open step's sibling that covers the range
          // Without data, click the cell whose age-range might cover the year — unknown. Give up gracefully.
        }
      }
      console.warn('[ref] no match:', id); return false;
    }
    // Click dayun cell to expand it
    const cell = document.querySelector(`.dayun-cell[data-ref="dayun.${targetIdx}"]`);
    if (!cell) { console.warn('[ref] no match:', id); return false; }
    // Switch to timing view first
    const timingTab = Array.from(document.querySelectorAll('.view-item')).find(e => e.textContent.includes('流'));
    timingTab?.click();
    // If not already open (i.e. dayun body not visible), click to expand
    const bodyId = `dayun-step-body-${targetIdx}`;
    const existingBody = document.getElementById(bodyId);
    if (!existingBody || existingBody.style.display === 'none') {
      cell.click();
    }
    // Wait for React to render the liunian chips then flash
    const delay = existingBody && existingBody.style.display !== 'none' ? 50 : 800;
    setTimeout(() => {
      const target = document.querySelector(`[data-ref="${CSS.escape(id)}"]`);
      if (target) doFlash(target);
      else console.warn('[ref] liunian chip still not found after expand:', id);
    }, delay);
    return true;
  }

  console.warn('[ref] no match:', id);
  return false;
}
