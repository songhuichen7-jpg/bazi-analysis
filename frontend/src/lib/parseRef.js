import { useAppStore } from '../store/useAppStore.js';

// Two token shapes share the [[…]] syntax:
//   [[ref.id|label]]                 — chart-internal cross-references
//   [[song:title|subtitle?]]         — pop-culture media cards (song / movie / book)
//   [[movie:title|director?]]
//   [[book:title|author?]]
// Subtitle is optional for media tokens (artist/director/author can be absent
// when the LLM isn't sure).
const TOKEN_RE = /\[\[(?:(song|movie|book):([^|\]]+)(?:\|([^\]]+))?|([\w.一-鿿]+)\|([^\]]+))\]\]/g;

export function parseRef(text) {
  if (!text) return [];
  const out = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1]) {
      out.push({
        type: 'media',
        kind: m[1],
        title: (m[2] || '').trim(),
        subtitle: (m[3] || '').trim(),
      });
    } else {
      out.push({ type: 'ref', id: m[4], label: m[5] });
    }
    last = m.index + m[0].length;
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
