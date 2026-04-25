import { create } from 'zustand';
import { SESSION_VERSION } from '../lib/constants.js';
import { streamVerdicts } from '../lib/api.js';
import { clearAuthSessionHint } from '../lib/authSessionHint.js';
import { clearAuthPhoneHint } from '../lib/authPhoneHint.js';
import { appendChatMessage } from '../lib/chatHistory.js';
import { clearSession } from '../lib/persistence.js';
import { chartListItemToEntry, chartResponseToEntry } from '../lib/chartUi.js';

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

function blankClassics() {
  return {
    status: 'idle',
    items: [],
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

function hydrateClassics(classics) {
  if (!classics) return blankClassics();
  const items = Array.isArray(classics.items) ? classics.items : [];
  return {
    status: classics.status || (items.length ? 'done' : 'idle'),
    items,
    lastError: classics.lastError || null,
  };
}

function chartStateFromEntry(entry, extra = {}) {
  return {
    ...makeBlankChart(),
    paipan: entry?.paipan || null,
    force: entry?.force || [],
    guards: entry?.guards || [],
    dayun: entry?.dayun || [],
    meta: entry?.meta || null,
    birthInfo: entry?.birthInfo || null,
    sections: entry?.sections || [],
    dayunCache: entry?.dayunCache || {},
    liunianCache: entry?.liunianCache || {},
    verdicts: hydrateVerdicts(entry?.verdicts),
    classics: hydrateClassics(entry?.classics),
    screen: 'shell',
    dayunOpenIdx: null,
    liunianOpenKey: null,
    ...extra,
  };
}

function readCurrentChartId() {
  try { return sessionStorage.getItem('currentChartId'); } catch { return null; }
}

function writeCurrentChartId(chartId) {
  try {
    if (chartId) sessionStorage.setItem('currentChartId', chartId);
    else sessionStorage.removeItem('currentChartId');
  } catch {
    // Ignore storage errors in private mode / SSR.
  }
}

function clearClientSessionStorage() {
  try {
    const keys = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key && (key === 'currentChartId' || key.startsWith('currentConversationId:'))) {
        keys.push(key);
      }
    }
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Ignore storage errors in private mode / SSR.
  }
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

function updateChartClassics(state, chartId, updater) {
  const current = chartId === state.currentId
    ? hydrateClassics(state.classics)
    : hydrateClassics(state.charts[chartId]?.classics);
  const nextClassics = updater(current);
  const next = {};

  if (chartId === state.currentId) next.classics = nextClassics;
  if (chartId && state.charts[chartId]) {
    next.charts = {
      ...state.charts,
      [chartId]: { ...state.charts[chartId], classics: nextClassics },
    };
  }
  return next;
}

const conversationBootstrapPromises = new Map();

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
  classics: blankClassics(),
};

function makeBlankChart() { return { ...BLANK_CHART }; }

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
    classics: s.classics,
    ...extra,
  };
}

const initialState = {
  screen: 'landing',
  view: 'chart',
  ...BLANK_CHART,
  user: null,

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
  llmEnabled: true,
  skipConversationHydration: false,
};

export const useAppStore = create((set, get) => ({
  ...initialState,

  // ── Navigation ──────────────────────────────────────────────────────────────
  setScreen: (screen) => set({ screen }),
  setView:   (view)   => set({ view }),
  setUser: (user) => set({ user }),
  enterFromLanding: async () => {
    const state = get();
    if (!state.user) {
      set({ screen: 'auth' });
      return 'auth';
    }

    const chartEntries = Object.values(state.charts || {});
    if (chartEntries.length === 0) {
      const items = await get().syncChartsFromServer();
      if (!items.length) set({ screen: 'input' });
      return items.length ? 'shell' : 'input';
    }

    const latest = chartEntries
      .slice()
      .sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0))[0];
    const latestId = latest?.id;
    if (!latestId) {
      set({ screen: 'input' });
      return 'input';
    }

    if (latestId === state.currentId && state.paipan) {
      set({ screen: 'shell' });
      return 'shell';
    }

    if (latest?.paipan) {
      await get().switchChart(latestId);
      return 'shell';
    }

    const items = await get().syncChartsFromServer();
    if (!items.length) set({ screen: 'input' });
    return items.length ? 'shell' : 'input';
  },
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

  setSectionsLoading: (b) => set({ sectionsLoading: b }),
  setSectionsError:   (e) => set({ sectionsError: e }),
  setSections:        (sections) => set({ sections, sectionsError: null }),

  loadClassics: async (chartId) => {
    if (!chartId) return;
    set((s) => updateChartClassics(s, chartId, () => ({
      status: 'loading',
      items: [],
      lastError: null,
    })));

    try {
      const { fetchClassics } = await import('../lib/api.js');
      const data = await fetchClassics(chartId);
      set((s) => updateChartClassics(s, chartId, () => ({
        status: 'done',
        items: Array.isArray(data?.items) ? data.items : [],
        lastError: null,
      })));
    } catch (e) {
      const message = e.message || String(e);
      set((s) => updateChartClassics(s, chartId, (current) => ({
        ...current,
        status: 'error',
        lastError: message,
      })));
    }
  },

  loadVerdicts: async (chartId) => {
    if (!chartId) return;

    set((s) => updateChartVerdicts(s, chartId, () => ({
      status: 'streaming',
      body: '',
      lastError: null,
    })));

    try {
      await streamVerdicts(chartId, {
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

  ensureConversation: async (chartId) => {
    const targetChartId = chartId || get().currentId;
    if (!targetChartId) return { conversationId: null, created: false };

    if (conversationBootstrapPromises.has(targetChartId)) {
      return conversationBootstrapPromises.get(targetChartId);
    }

    const task = (async () => {
      const list = await get().loadConversations(targetChartId);
      let convId = get().currentConversationId;
      let created = false;

      if (!convId) {
        const conversation = await get().newConversationOnServer(targetChartId, `对话 ${list.length + 1}`);
        convId = conversation?.id || get().currentConversationId || null;
        created = true;
      }

      return { conversationId: convId, created };
    })().finally(() => {
      conversationBootstrapPromises.delete(targetChartId);
    });

    conversationBootstrapPromises.set(targetChartId, task);
    return task;
  },

  newConversationOnServer: async (chartId, label) => {
    const previous = {
      conversations: get().conversations || [],
      currentConversationId: get().currentConversationId,
      chatHistory: get().chatHistory,
    };
    const tempId = `temp-conv-${Date.now()}`;
    const now = new Date().toISOString();
    const optimisticConv = {
      id: tempId,
      chart_id: chartId,
      label,
      position: previous.conversations.length,
      created_at: now,
      updated_at: now,
      last_message_at: null,
      message_count: 0,
      deleted_at: null,
      optimistic: true,
    };

    set({
      conversations: [...previous.conversations, optimisticConv],
      currentConversationId: tempId,
      chatHistory: [],
    });

    try {
      const { createConversation } = await import('../lib/api.js');
      const conv = await createConversation(chartId, label);
      try { sessionStorage.setItem('currentConversationId:' + chartId, conv.id); } catch { /* SSR/private mode */ }
      set((s) => ({
        conversations: (s.conversations || []).map((item) => item.id === tempId ? conv : item),
        currentConversationId: s.currentConversationId === tempId ? conv.id : s.currentConversationId,
      }));
      return conv;
    } catch (e) {
      set((s) => {
        const conversations = (s.conversations || []).filter((item) => item.id !== tempId);
        if (s.currentConversationId !== tempId) return { conversations };
        return {
          conversations: previous.conversations,
          currentConversationId: previous.currentConversationId,
          chatHistory: previous.chatHistory,
        };
      });
      throw e;
    }
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
  openChartFromResponse: (response, options = {}) => {
    const nextId = response?.chart?.id;
    if (!nextId) return;
    writeCurrentChartId(nextId);
    set((state) => {
      const charts = options.preserveCurrent === false
        ? { ...state.charts }
        : (
            state.currentId && state.charts[state.currentId]
              ? {
                  ...state.charts,
                  [state.currentId]: { ...state.charts[state.currentId], ...snapshotChart(state) },
                }
              : { ...state.charts }
          );
      const previous = charts[nextId] || {};
      const mapped = chartResponseToEntry(response);
      const entry = {
        ...makeBlankChart(),
        ...previous,
        ...mapped,
        sections: previous.sections || [],
        dayunCache: previous.dayunCache || {},
        liunianCache: previous.liunianCache || {},
        verdicts: previous.verdicts || blankVerdicts(),
        classics: previous.classics || blankClassics(),
      };
      charts[nextId] = entry;
      return {
        charts,
        currentId: nextId,
        skipConversationHydration: !!options.skipConversationHydration,
        ...chartStateFromEntry(entry),
      };
    });
  },

  openChartFromServer: async (id) => {
    const { getChart } = await import('../lib/api.js');
    const response = await getChart(id);
    get().openChartFromResponse(response);
    return response;
  },

  syncChartsFromServer: async () => {
    const { listCharts } = await import('../lib/api.js');
    clearSession();
    const data = await listCharts();
    const items = data.items || [];
    const previousCharts = get().charts || {};
    const charts = {};
    items.forEach((item) => {
      charts[item.id] = {
        ...makeBlankChart(),
        ...(previousCharts[item.id] || {}),
        ...chartListItemToEntry(item),
      };
    });
    if (!items.length) {
      writeCurrentChartId(null);
      set({
        charts: {},
        currentId: null,
        ...makeBlankChart(),
        screen: 'input',
        view: 'chart',
      });
      return [];
    }
    const storedId = readCurrentChartId();
    const nextId = storedId && charts[storedId] ? storedId : items[0].id;
    set({ charts, currentId: null });
    await get().openChartFromServer(nextId);
    return items;
  },

  switchChart: async (id) => {
    const s = get();
    if (id === s.currentId) return;
    const target = s.charts[id];
    if (!target) return;
    if (!target.paipan) {
      await get().openChartFromServer(id);
      return;
    }
    writeCurrentChartId(id);
    set((state) => {
      const charts = state.currentId && state.charts[state.currentId]
        ? {
            ...state.charts,
            [state.currentId]: { ...state.charts[state.currentId], ...snapshotChart(state) },
          }
        : { ...state.charts };
      const nextEntry = charts[id];
      return {
        charts,
        currentId: id,
        skipConversationHydration: false,
        ...chartStateFromEntry(nextEntry),
      };
    });
  },

  deleteChart: async (id) => {
    const { deleteChart: deleteChartApi } = await import('../lib/api.js');
    await deleteChartApi(id);
    const s = get();
    const charts = { ...s.charts };
    delete charts[id];
    const ids = Object.keys(charts).sort((a,b) => (charts[b].createdAt||0) - (charts[a].createdAt||0));
    if (ids.length === 0) {
      writeCurrentChartId(null);
      set({ charts: {}, currentId: null, ...makeBlankChart(), screen: 'input' });
      return;
    }
    if (id === s.currentId) {
      set({ charts, currentId: null, ...makeBlankChart(), screen: 'input' });
      await get().switchChart(ids[0]);
      return;
    }
    set({ charts });
  },

  renameChart: (id, label) => set(s => ({
    charts: { ...s.charts, [id]: { ...s.charts[id], label } },
  })),

  logout: async () => {
    const { logout: logoutApi } = await import('../lib/api.js');
    void logoutApi().catch(() => { /* best effort */ });
    clearAuthSessionHint();
    clearAuthPhoneHint();
    clearSession();
    clearClientSessionStorage();
    set((state) => ({
      ...initialState,
      ...makeBlankChart(),
      charts: {},
      currentId: null,
      screen: 'landing',
      llmEnabled: state.llmEnabled,
      user: null,
    }));
  },

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
        classics: hydrateClassics(t.classics),
        dayunOpenIdx: null, liunianOpenKey: null,
      });
    }
  },

  // startNewChart: clear flat chart state + go to form, but KEEP all charts in memory
  startNewChart: () => set((state) => {
    const charts = state.currentId && state.charts[state.currentId]
      ? {
          ...state.charts,
          [state.currentId]: { ...state.charts[state.currentId], ...snapshotChart(state) },
        }
      : state.charts;
    return {
      ...makeBlankChart(),
      charts,
      currentId: null,
      screen: 'input',
      view: 'chart',
      dayunOpenIdx: null,
      liunianOpenKey: null,
      formError: null,
      sectionsLoading: false,
      sectionsError: null,
    };
  }),

  // reset: clear EVERYTHING (all charts + flat state), used for "× clear all"
  reset: () => set((state) => ({
    ...initialState,
    ...makeBlankChart(),
    charts: {},
    currentId: null,
    screen: 'input',
    llmEnabled: state.llmEnabled,
    user: state.user,
  })),
}));
