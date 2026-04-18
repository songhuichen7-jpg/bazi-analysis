import { create } from 'zustand';
import { MAX_CHARTS, SESSION_VERSION } from '../lib/constants.js';
import { streamVerdicts } from '../lib/api.js';
import { appendChatMessage } from '../lib/chatHistory.js';

// Fields that belong to a single chart session (persisted per chart).
const CHART_FIELDS = ['paipan','force','guards','dayun','meta','birthInfo',
  'sections','dayunCache','liunianCache','verdicts'];

function _serverMsgToUiMsg(m) {
  if (m.role === 'gua') {
    const { gua, body, question } = m.meta || {};
    return { role: 'gua', content: { ...(gua || {}), body, question, streaming: false } };
  }
  if (m.role === 'cta') {
    const { question } = m.meta || {};
    return { role: 'cta', content: { question, manual: false } };
  }
  return { role: m.role, content: m.content || '' };
}

function blankVerdicts() {
  return {
    status: 'idle',
    body: '',
    lastError: null,
  };
}

function hydrateVerdicts(verdicts) {
  if (!verdicts) return blankVerdicts();
  const body = typeof verdicts.body === 'string' ? verdicts.body : '';
  return {
    status: verdicts.status || (body ? 'done' : 'idle'),
    body,
    lastError: verdicts.lastError || null,
  };
}

function buildChartPayload(entry) {
  if (!entry?.paipan || !entry?.meta) return null;
  return {
    PAIPAN: entry.paipan,
    FORCE: entry.force || [],
    GUARDS: entry.guards || [],
    DAYUN: entry.dayun || [],
    META: entry.meta,
  };
}

function updateChartVerdicts(state, chartId, updater) {
  const current = chartId === state.currentId
    ? hydrateVerdicts(state.verdicts)
    : hydrateVerdicts(state.charts[chartId]?.verdicts);
  const nextVerdicts = updater(current);
  const next = {};

  if (chartId === state.currentId) next.verdicts = nextVerdicts;
  if (chartId && state.charts[chartId]) {
    next.charts = {
      ...state.charts,
      [chartId]: { ...state.charts[chartId], verdicts: nextVerdicts },
    };
  }
  return next;
}

const BLANK_CHART = {
  paipan: null, force: [], guards: [], dayun: [], meta: null, birthInfo: null,
  sections: [],
  // Plan 6: chat data is server-of-truth; ephemeral here, never persisted
  chatHistory: [],
  conversations: [],
  currentConversationId: null,
  gua: { current: null, history: [] },   // ephemeral, not persisted
  dayunCache: {}, liunianCache: {},
  verdicts: blankVerdicts(),
};

function makeBlankChart() { return { ...BLANK_CHART }; }

function genId() { return 'chart_' + Date.now(); }

export function generateChartLabel(formData) {
  if (!formData) return '新命盘';
  const g = formData.gender === 'female' ? '女' : '男';
  const d = formData.date || `${formData.year}-${String(formData.month||'').padStart(2,'0')}-${String(formData.day||'').padStart(2,'0')}`;
  const t = formData.time || (formData.hour != null && formData.hour !== -1 ? `${String(formData.hour).padStart(2,'0')}:${String(formData.minute||0).padStart(2,'0')}` : '');
  return `${g} · ${d}${t ? ' ' + t : ''}`;
}

// Snapshot current flat chart state for persistence.
function snapshotChart(s, extra = {}) {
  return {
    paipan: s.paipan, force: s.force, guards: s.guards,
    dayun: s.dayun, meta: s.meta, birthInfo: s.birthInfo,
    sections: s.sections,
    dayunCache: s.dayunCache, liunianCache: s.liunianCache,
    verdicts: s.verdicts,
    ...extra,
  };
}

const initialState = {
  screen: 'landing',
  view: 'chart',
  ...BLANK_CHART,

  // Multi-chart index
  charts: {},      // Record<id, { id, label, createdAt, formData, ...chartFields }>
  currentId: null,

  // Transient UI (not per-chart, not persisted)
  dayunOpenIdx: null, liunianOpenKey: null,
  dayunStreaming: false, liunianStreaming: false,
  chatStreaming: false, guaStreaming: false,
  sectionsLoading: false, sectionsError: null,
  formError: null, loadingStage: 0,
  appNotice: null,
  llmEnabled: false,
};

export const useAppStore = create((set, get) => ({
  ...initialState,

  // ── Navigation ──────────────────────────────────────────────────────────────
  setScreen: (screen) => set({ screen }),
  setView:   (view)   => set({ view }),
  setLlmStatus: (enabled) => set({ llmEnabled: enabled }),
  setFormError: (f)  => set({ formError: f }),
  setLoadingStage: (i) => set({ loadingStage: i }),
  setAppNotice: (notice) => set((s) => {
    if (!notice) return { appNotice: null };
    if (s.appNotice && s.appNotice.title === notice.title && s.appNotice.detail === notice.detail) {
      return s;
    }
    return { appNotice: { id: Date.now(), ...notice } };
  }),
  clearAppNotice: () => set({ appNotice: null }),

  // ── Chart data (flat) ───────────────────────────────────────────────────────
  setBirthInfo: (birthInfo) => set({ birthInfo }),
  applyServerData: (ui) => set({
    paipan: ui.PAIPAN, force: ui.FORCE, guards: ui.GUARDS,
    dayun: ui.DAYUN, meta: ui.META,
  }),

  setSectionsLoading: (b) => set({ sectionsLoading: b }),
  setSectionsError:   (e) => set({ sectionsError: e }),
  setSections:        (sections) => set({ sections, sectionsError: null }),

  loadVerdicts: async (chartId) => {
    const state = get();
    const entry = chartId === state.currentId
      ? {
          paipan: state.paipan,
          force: state.force,
          guards: state.guards,
          dayun: state.dayun,
          meta: state.meta,
        }
      : state.charts[chartId];
    const chart = buildChartPayload(entry);
    if (!chart) return;

    set((s) => updateChartVerdicts(s, chartId, () => ({
      status: 'streaming',
      body: '',
      lastError: null,
    })));

    try {
      await streamVerdicts(chart, {
        onDelta: (text) => {
          set((s) => updateChartVerdicts(s, chartId, (current) => ({
            ...current,
            status: 'streaming',
            body: (current.body || '') + text,
            lastError: null,
          })));
        },
        onDone: (full) => {
          set((s) => updateChartVerdicts(s, chartId, (current) => ({
            ...current,
            status: 'done',
            body: full || current.body || '',
            lastError: null,
          })));
        },
      });
    } catch (e) {
      const message = e.message || String(e);
      set((s) => updateChartVerdicts(s, chartId, (current) => ({
        ...current,
        status: 'error',
        lastError: message,
      })));
    }
  },

  appendMessage: (msg) => set(s => ({ chatHistory: [...s.chatHistory, msg] })),
  pushChat: (msg) => set(s => {
    const chatHistory = appendChatMessage(s.chatHistory, msg);
    return { chatHistory };
  }),
  replaceLastAssistant: (content) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') { arr[i] = { ...arr[i], content }; break; }
    }
    return { chatHistory: arr };
  }),
  replaceLastCtaWithAssistant: () => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'cta') {
        arr[i] = { role: 'assistant', content: '' };
        break;
      }
    }
    return { chatHistory: arr };
  }),

  replacePlaceholderWithCta: (question, manual = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') {
        arr[i] = { role: 'cta', content: { question, manual } };
        break;
      }
    }
    return { chatHistory: arr };
  }),

  pushGuaCard: (guaData) => set(s => {
    const chatHistory = appendChatMessage(s.chatHistory, {
      role: 'gua',
      content: { ...guaData, streaming: true },
    });
    return { chatHistory };
  }),

  updateLastGuaCard: (body, finalize = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'gua') {
        arr[i] = {
          ...arr[i],
          content: {
            ...arr[i].content,
            body,
            streaming: finalize ? false : arr[i].content.streaming,
          },
        };
        break;
      }
    }
    return { chatHistory: arr };
  }),

  clearChat: () => set({ chatHistory: [] }),

  consumeCta: () => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'cta') { arr.splice(i, 1); break; }
    }
    return { chatHistory: arr };
  }),

  setChatStreaming: (b) => set({ chatStreaming: b }),

  // ── Conversations (server-backed) ────────────────────────────────────────
  loadConversations: async (chartId) => {
    const { listConversations } = await import('../lib/api.js');
    const data = await listConversations(chartId);
    const items = data.items || [];
    let currentId = null;
    try { currentId = sessionStorage.getItem('currentConversationId:' + chartId); } catch { /* SSR/private mode */ }
    if (!currentId || !items.some(c => c.id === currentId)) {
      currentId = items.length ? items[0].id : null;
    }
    set({ conversations: items, currentConversationId: currentId });
    return items;
  },

  selectConversation: async (convId) => {
    const s = get();
    if (s.currentId) {
      try { sessionStorage.setItem('currentConversationId:' + s.currentId, convId); } catch { /* SSR/private mode */ }
    }
    set({ currentConversationId: convId });
    await get().loadMessages(convId);
  },

  loadMessages: async (convId) => {
    const { listMessages } = await import('../lib/api.js');
    const data = await listMessages(convId, { limit: 50 });
    const chrono = (data.items || []).slice().reverse();
    set({ chatHistory: chrono.map(m => _serverMsgToUiMsg(m)) });
  },

  newConversationOnServer: async (chartId, label) => {
    const { createConversation } = await import('../lib/api.js');
    const conv = await createConversation(chartId, label);
    const list = [...(get().conversations || []), conv];
    try { sessionStorage.setItem('currentConversationId:' + chartId, conv.id); } catch { /* SSR/private mode */ }
    set({ conversations: list, currentConversationId: conv.id, chatHistory: [] });
    return conv;
  },

  renameConversationOnServer: async (convId, label) => {
    const { patchConversation } = await import('../lib/api.js');
    const updated = await patchConversation(convId, label);
    set(s => ({
      conversations: (s.conversations || []).map(c => c.id === convId ? updated : c),
    }));
    return updated;
  },

  deleteConversationOnServer: async (chartId, convId) => {
    const { deleteConversation: apiDelete } = await import('../lib/api.js');
    await apiDelete(convId);
    const list = (get().conversations || []).filter(c => c.id !== convId);
    let nextId = get().currentConversationId;
    if (nextId === convId) {
      nextId = list[0]?.id || null;
      if (!nextId) {
        set({ conversations: [] });   // clear the deleted item before recursive call
        await get().newConversationOnServer(chartId, '对话 1');
        return;
      }
      try { sessionStorage.setItem('currentConversationId:' + chartId, nextId); } catch { /* SSR/private mode */ }
    }
    set({ conversations: list, currentConversationId: nextId });
    if (nextId) await get().loadMessages(nextId);
  },

  setDayunCache: (idx, text) => set(s => ({ dayunCache: { ...s.dayunCache, [idx]: text } })),
  deleteDayunCache: (idx) => set(s => { const { [idx]: _, ...rest } = s.dayunCache; return { dayunCache: rest }; }),
  setDayunOpenIdx: (idx) => set({ dayunOpenIdx: idx }),
  setDayunStreaming: (b)  => set({ dayunStreaming: b }),

  setGuaCurrent: (current) => set(s => ({ gua: { ...(s.gua || {}), current } })),
  pushGuaHistory: (entry) => set(s => ({
    gua: { ...(s.gua || {}), history: [...(s.gua?.history || []), entry].slice(-20) },
  })),
  setGuaStreaming: (b) => set({ guaStreaming: b }),

  setLiunianCache: (key, text) => set(s => ({ liunianCache: { ...s.liunianCache, [key]: text } })),
  deleteLiunianCache: (key) => set(s => { const { [key]: _, ...rest } = s.liunianCache; return { liunianCache: rest }; }),
  setLiunianOpenKey: (key) => set({ liunianOpenKey: key }),
  setLiunianStreaming: (b)  => set({ liunianStreaming: b }),

  // ── Multi-chart management ────────────────────────────────────────────────
  // Called just before submitting a new form to reserve an id.
  prepareNewChart: () => {
    const id = genId();
    set({ currentId: id });
    return id;
  },

  // After paipan returns, register the chart with its label.
  finalizeChart: (id, formData, label) => {
    const s = get();
    const entry = {
      ...snapshotChart(s),
      id,
      label: label || generateChartLabel(formData),
      createdAt: Date.now(),
      formData: formData || null,
    };
    const charts = { ...s.charts, [id]: entry };
    // FIFO: keep newest MAX_CHARTS (we already checked count before prepareNewChart)
    const keys = Object.keys(charts).sort((a,b) => (charts[a].createdAt||0) - (charts[b].createdAt||0));
    while (keys.length > MAX_CHARTS) {
      const del = keys.shift();
      if (del !== id) delete charts[del];
    }
    set({ charts, currentId: id });
  },

  switchChart: (id) => {
    const s = get();
    if (id === s.currentId) return;
    // Save current into charts map
    const updatedCharts = s.currentId
      ? { ...s.charts, [s.currentId]: { ...s.charts[s.currentId], ...snapshotChart(s) } }
      : { ...s.charts };
    const target = updatedCharts[id];
    if (!target) return;
    set({
      charts: updatedCharts,
      currentId: id,
      ...makeBlankChart(),
      paipan: target.paipan || null,
      force: target.force || [],
      guards: target.guards || [],
      dayun: target.dayun || [],
      meta: target.meta || null,
      birthInfo: target.birthInfo || null,
      sections: target.sections || [],
      // chat data: cleared; App.jsx will call loadConversations + loadMessages
      chatHistory: [], conversations: [], currentConversationId: null,
      gua: { current: null, history: [] },
      dayunCache: target.dayunCache || {},
      liunianCache: target.liunianCache || {},
      verdicts: hydrateVerdicts(target.verdicts),
      screen: 'shell',
      dayunOpenIdx: null, liunianOpenKey: null,
    });
  },

  deleteChart: (id) => {
    const s = get();
    const charts = { ...s.charts };
    delete charts[id];
    const ids = Object.keys(charts).sort((a,b) => (charts[b].createdAt||0) - (charts[a].createdAt||0));
    if (ids.length === 0) {
      set({ charts: {}, currentId: null, ...makeBlankChart(), screen: 'input' });
      return;
    }
    if (id === s.currentId) {
      const next = ids[0];
      const t = charts[next];
      set({
        charts, currentId: next,
        ...makeBlankChart(),
        paipan: t.paipan||null, force: t.force||[], guards: t.guards||[],
        dayun: t.dayun||[], meta: t.meta||null, birthInfo: t.birthInfo||null,
        sections: t.sections||[],
        // chat data: cleared; App.jsx will call loadConversations + loadMessages
        chatHistory: [], conversations: [], currentConversationId: null,
        gua: { current: null, history: [] },
        dayunCache: t.dayunCache||{}, liunianCache: t.liunianCache||{},
        verdicts: hydrateVerdicts(t.verdicts),
        screen: 'shell',
        dayunOpenIdx: null, liunianOpenKey: null,
      });
    } else {
      set({ charts });
    }
  },

  renameChart: (id, label) => set(s => ({
    charts: { ...s.charts, [id]: { ...s.charts[id], label } },
  })),

  // Snapshot current flat state back to charts[currentId] (called by persistence).
  commitCurrentChart: () => {
    const s = get();
    if (!s.currentId) return;
    set({
      charts: { ...s.charts, [s.currentId]: { ...s.charts[s.currentId], ...snapshotChart(s) } },
    });
  },

  // ── Session restore (v4) ──────────────────────────────────────────────────
  restoreFromSession: (saved) => {
    if (saved.version === SESSION_VERSION && saved.currentId && saved.charts?.[saved.currentId]) {
      const t = saved.charts[saved.currentId];
      set({
        charts: saved.charts,
        currentId: saved.currentId,
        screen: 'shell',
        paipan: t.paipan||null, force: t.force||[], guards: t.guards||[],
        dayun: t.dayun||[], meta: t.meta||null, birthInfo: t.birthInfo||null,
        sections: t.sections||[],
        // chat data: cleared; App.jsx will call loadConversations + loadMessages
        chatHistory: [], conversations: [], currentConversationId: null,
        gua: { current: null, history: [] },
        dayunCache: t.dayunCache||{}, liunianCache: t.liunianCache||{},
        verdicts: hydrateVerdicts(t.verdicts),
        dayunOpenIdx: null, liunianOpenKey: null,
      });
    }
  },

  // startNewChart: clear flat chart state + go to form, but KEEP all charts in memory
  startNewChart: () => set(() => ({
    ...makeBlankChart(),
    screen: 'input',
    view: 'chart',
    dayunOpenIdx: null, liunianOpenKey: null,
    formError: null, sectionsLoading: false, sectionsError: null,
    // Do NOT wipe: charts, currentId (we'll assign a new currentId in prepareNewChart)
  })),

  // reset: clear EVERYTHING (all charts + flat state), used for "× clear all"
  reset: () => set({
    ...initialState,
    ...makeBlankChart(),
    charts: {},
    currentId: null,
    screen: 'input',
    llmEnabled: get().llmEnabled,
  }),
}));
