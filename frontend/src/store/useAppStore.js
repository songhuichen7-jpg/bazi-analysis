import { create } from 'zustand';
import { MAX_CHARTS } from '../lib/constants.js';
import { streamVerdicts } from '../lib/api.js';
import { appendChatMessage } from '../lib/chatHistory.js';

// Fields that belong to a single chart session (persisted per chart).
const CHART_FIELDS = ['paipan','force','guards','dayun','meta','birthInfo',
  'sections','chatHistory','conversations','currentConversationId',
  'dayunCache','liunianCache','gua','verdicts'];

function genConvId() { return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

function blankConversation() {
  return { id: genConvId(), label: '默认对话', createdAt: Date.now(), messages: [] };
}

function derivedLabelFromMessages(messages, fallback = '默认对话') {
  const firstUser = (messages || []).find(m => m.role === 'user' && typeof m.content === 'string');
  if (!firstUser) return fallback;
  const txt = String(firstUser.content || '').replace(/\s+/g, ' ').trim();
  if (!txt) return fallback;
  return txt.length > 14 ? txt.slice(0, 14) + '…' : txt;
}

// Normalize + migrate conversations from persisted state. If a chart had a
// legacy `chatHistory` but no `conversations`, fold it into a default one.
function hydrateConversations(entry) {
  const raw = Array.isArray(entry?.conversations) ? entry.conversations : null;
  if (raw && raw.length) {
    const list = raw
      .filter(c => c && typeof c === 'object')
      .map(c => ({
        id: c.id || genConvId(),
        label: c.label || derivedLabelFromMessages(c.messages),
        createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
        messages: Array.isArray(c.messages) ? c.messages : [],
      }));
    const currentId = entry.currentConversationId && list.some(c => c.id === entry.currentConversationId)
      ? entry.currentConversationId
      : list[list.length - 1].id;
    return { conversations: list, currentConversationId: currentId };
  }
  // Migrate from legacy chatHistory
  const legacy = Array.isArray(entry?.chatHistory) ? entry.chatHistory : [];
  const conv = {
    id: genConvId(),
    label: derivedLabelFromMessages(legacy),
    createdAt: Date.now(),
    messages: legacy,
  };
  return { conversations: [conv], currentConversationId: conv.id };
}

function activeMessagesOf(conversations, currentConversationId) {
  const conv = (conversations || []).find(c => c.id === currentConversationId);
  return conv ? conv.messages : [];
}

// Produce a new conversations array with the active one replaced by `nextMessages`.
function syncActive(conversations, currentConversationId, nextMessages) {
  const list = conversations || [];
  let touched = false;
  const out = list.map(c => {
    if (c.id !== currentConversationId) return c;
    touched = true;
    // Auto-relabel from first user message if still default
    const isDefaultLabel = !c.label || c.label === '默认对话' || c.label === '新对话';
    const newLabel = isDefaultLabel
      ? derivedLabelFromMessages(nextMessages, c.label || '默认对话')
      : c.label;
    return { ...c, label: newLabel, messages: nextMessages };
  });
  if (!touched) {
    // Active id missing — create one on the fly.
    out.push({
      id: currentConversationId || genConvId(),
      label: derivedLabelFromMessages(nextMessages),
      createdAt: Date.now(),
      messages: nextMessages,
    });
  }
  return out;
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

const _initialConv = blankConversation();
const BLANK_CHART = {
  paipan: null, force: [], guards: [], dayun: [], meta: null, birthInfo: null,
  sections: [], chatHistory: [],
  conversations: [_initialConv],
  currentConversationId: _initialConv.id,
  dayunCache: {}, liunianCache: {},
  gua: { current: null, history: [] },
  verdicts: blankVerdicts(),
};
function makeBlankChart() {
  const conv = blankConversation();
  return {
    paipan: null, force: [], guards: [], dayun: [], meta: null, birthInfo: null,
    sections: [], chatHistory: [],
    conversations: [conv],
    currentConversationId: conv.id,
    dayunCache: {}, liunianCache: {},
    gua: { current: null, history: [] },
    verdicts: blankVerdicts(),
  };
}

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
  // Ensure conversations reflect the latest chatHistory for the active convo
  const conversations = syncActive(s.conversations, s.currentConversationId, s.chatHistory || []);
  return {
    paipan: s.paipan, force: s.force, guards: s.guards,
    dayun: s.dayun, meta: s.meta, birthInfo: s.birthInfo,
    sections: s.sections,
    chatHistory: s.chatHistory,
    conversations,
    currentConversationId: s.currentConversationId,
    dayunCache: s.dayunCache, liunianCache: s.liunianCache,
    gua: s.gua,
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

  pushChat: (msg) => set(s => {
    const chatHistory = appendChatMessage(s.chatHistory, msg);
    const conversations = syncActive(s.conversations, s.currentConversationId, chatHistory);
    return { chatHistory, conversations };
  }),
  replaceLastAssistant: (content) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') { arr[i] = { ...arr[i], content }; break; }
    }
    const conversations = syncActive(s.conversations, s.currentConversationId, arr);
    return { chatHistory: arr, conversations };
  }),
  replaceLastCtaWithAssistant: () => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'cta') {
        arr[i] = { role: 'assistant', content: '' };
        break;
      }
    }
    const conversations = syncActive(s.conversations, s.currentConversationId, arr);
    return { chatHistory: arr, conversations };
  }),

  replacePlaceholderWithCta: (question, manual = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') {
        arr[i] = { role: 'cta', content: { question, manual } };
        break;
      }
    }
    const conversations = syncActive(s.conversations, s.currentConversationId, arr);
    return { chatHistory: arr, conversations };
  }),

  pushGuaCard: (guaData) => set(s => {
    const chatHistory = appendChatMessage(s.chatHistory, {
      role: 'gua',
      content: { ...guaData, streaming: true },
    });
    const conversations = syncActive(s.conversations, s.currentConversationId, chatHistory);
    return { chatHistory, conversations };
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
    const conversations = syncActive(s.conversations, s.currentConversationId, arr);
    return { chatHistory: arr, conversations };
  }),

  clearChat: () => set(s => {
    const conversations = syncActive(s.conversations, s.currentConversationId, []);
    return { chatHistory: [], conversations };
  }),
  setChatStreaming: (b) => set({ chatStreaming: b }),

  // ── Conversations (per-chart) ─────────────────────────────────────────────
  newConversation: () => set(s => {
    // snapshot current chatHistory into active convo, then create a fresh one
    const saved = syncActive(s.conversations, s.currentConversationId, s.chatHistory || []);
    const conv = blankConversation();
    return {
      conversations: [...saved, conv],
      currentConversationId: conv.id,
      chatHistory: [],
    };
  }),

  switchConversation: (id) => set(s => {
    if (!id || id === s.currentConversationId) return s;
    const saved = syncActive(s.conversations, s.currentConversationId, s.chatHistory || []);
    const target = saved.find(c => c.id === id);
    if (!target) return s;
    return {
      conversations: saved,
      currentConversationId: id,
      chatHistory: target.messages || [],
    };
  }),

  deleteConversation: (id) => set(s => {
    let list = (s.conversations || []).filter(c => c.id !== id);
    if (!list.length) {
      const conv = blankConversation();
      list = [conv];
      return {
        conversations: list,
        currentConversationId: conv.id,
        chatHistory: [],
      };
    }
    if (id === s.currentConversationId) {
      const next = list[list.length - 1];
      return {
        conversations: list,
        currentConversationId: next.id,
        chatHistory: next.messages || [],
      };
    }
    return { conversations: list };
  }),

  renameConversation: (id, label) => set(s => {
    const cleaned = String(label || '').trim().slice(0, 40);
    if (!cleaned) return s;
    const conversations = (s.conversations || []).map(c =>
      c.id === id ? { ...c, label: cleaned } : c
    );
    return { conversations };
  }),

  setDayunCache: (idx, text) => set(s => ({ dayunCache: { ...s.dayunCache, [idx]: text } })),
  deleteDayunCache: (idx) => set(s => { const { [idx]: _, ...rest } = s.dayunCache; return { dayunCache: rest }; }),
  setDayunOpenIdx: (idx) => set({ dayunOpenIdx: idx }),
  setDayunStreaming: (b)  => set({ dayunStreaming: b }),

  setGuaCurrent: (current) => set(s => ({ gua: { ...s.gua, current } })),
  pushGuaHistory: (entry) => set(s => ({
    gua: { ...s.gua, history: [...(s.gua?.history || []), entry].slice(-20) },
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
    const convState = hydrateConversations(target);
    const activeMsgs = activeMessagesOf(convState.conversations, convState.currentConversationId);
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
      chatHistory: activeMsgs,
      conversations: convState.conversations,
      currentConversationId: convState.currentConversationId,
      dayunCache: target.dayunCache || {},
      liunianCache: target.liunianCache || {},
      gua: target.gua || { current: null, history: [] },
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
      const convState = hydrateConversations(t);
      const activeMsgs = activeMessagesOf(convState.conversations, convState.currentConversationId);
      set({
        charts, currentId: next,
        ...makeBlankChart(),
        paipan: t.paipan||null, force: t.force||[], guards: t.guards||[],
        dayun: t.dayun||[], meta: t.meta||null, birthInfo: t.birthInfo||null,
        sections: t.sections||[],
        chatHistory: activeMsgs,
        conversations: convState.conversations,
        currentConversationId: convState.currentConversationId,
        dayunCache: t.dayunCache||{}, liunianCache: t.liunianCache||{},
        gua: t.gua || { current: null, history: [] },
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

  // ── Session restore (v3) ──────────────────────────────────────────────────
  restoreFromSession: (saved) => {
    if (saved.version === 3 && saved.currentId && saved.charts?.[saved.currentId]) {
      const t = saved.charts[saved.currentId];
      const convState = hydrateConversations(t);
      const activeMsgs = activeMessagesOf(convState.conversations, convState.currentConversationId);
      set({
        charts: saved.charts,
        currentId: saved.currentId,
        screen: 'shell',
        paipan: t.paipan||null, force: t.force||[], guards: t.guards||[],
        dayun: t.dayun||[], meta: t.meta||null, birthInfo: t.birthInfo||null,
        sections: t.sections||[],
        chatHistory: activeMsgs,
        conversations: convState.conversations,
        currentConversationId: convState.currentConversationId,
        dayunCache: t.dayunCache||{}, liunianCache: t.liunianCache||{},
        gua: t.gua || { current: null, history: [] },
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
