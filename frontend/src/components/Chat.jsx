import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamMessage, streamGua, fetchChips } from '../lib/api';
import { finalizeChatTurn, resolveConversationIdForSend, startBootstrapChipsRefresh } from '../lib/chatFlow';
import GuaCard from './GuaCard';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';
import ConversationSwitcher from './ConversationSwitcher';
import { buildChatWorkspace, mergePromptChips } from '../lib/chatWorkspace';
import { buildChatClientContext } from '../lib/chatClientContext';
import { applyChatProgressEvent, createChatProgress, intentLabel } from '../lib/chatProgress';
import { PROMPT_EXAMPLES, PROMPT_ROTATE_INTERVAL_MS } from '../lib/chatPromptExamples';

/** Compact phase-aware progress: shows real backend SSE events as a vertical
 *  step list (intent → retrieval → model → streaming). Each step appears
 *  the moment its event arrives — pending steps are not rendered, so the
 *  indicator grows downward as the request progresses. */
function ThinkingIndicator({ trace }) {
  const phase = trace?.phase || 'idle';
  const stopped = phase === 'stopped';
  const redirected = phase === 'redirect';
  const intent = trace?.intent || null;
  const sources = Array.isArray(trace?.retrievalSources) ? trace.retrievalSources : [];
  const model = trace?.modelUsed || '';
  const hasOutput = !!trace?.hasOutput;
  const skipRetrieval = intent === 'chitchat' || redirected;
  const past = (target) => {
    const order = ['idle', 'routing', 'retrieving', 'composing', 'streaming', 'done'];
    return order.indexOf(phase) > order.indexOf(target);
  };

  // 整体已经等了多少秒 — 当前 active 步骤超过 5s 就在它旁边附一个时长
  // hint，超过 12s 在底部出一行"还在算，可能要再等几秒"的友好兜底。
  const startedAt = trace?.startedAt;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt || stopped || hasOutput) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt, stopped, hasOutput]);
  const now = startedAt ? startedAt + tick * 1000 : 0;
  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;

  const steps = [];
  // Step 1: intent
  steps.push({
    key: 'intent',
    state: intent ? (past('routing') || phase === 'routing' && hasOutput ? 'done' : (phase === 'routing' && !past('routing') ? 'done' : 'done')) : 'active',
    label: intent ? `已识别意图  ${intentLabel(intent)}` : '正在识别意图…',
  });
  // Step 2: retrieval (skip for chitchat / divination redirect)
  if (!skipRetrieval) {
    if (trace?.hasRetrieval) {
      const hint = sources.length > 3
        ? sources.slice(0, 3).join('  ·  ') + `  …等 ${sources.length} 条`
        : sources.join('  ·  ');
      steps.push({
        key: 'retrieval',
        state: past('retrieving') ? 'done' : 'done',
        label: `翻阅古籍  ${sources.length} 段`,
        detail: hint,
      });
    } else if (intent && !redirected) {
      steps.push({
        key: 'retrieval',
        state: 'active',
        label: '翻阅古籍中…',
      });
    }
  }
  // Step 3: model
  if (!redirected) {
    if (model) {
      steps.push({
        key: 'model',
        state: hasOutput ? 'done' : 'done',
        label: '起笔',
        detail: model,
      });
    } else if (trace?.hasRetrieval || skipRetrieval) {
      steps.push({
        key: 'model',
        state: 'active',
        label: '调用模型中…',
      });
    }
  }
  // Step 4: streaming / done / stopped / redirect
  if (redirected) {
    steps.push({
      key: 'redirect',
      state: 'active',
      label: '此问题适合起卦,已为你转入占卜流程',
    });
  } else if (stopped) {
    steps.push({
      key: 'stopped',
      state: 'stopped',
      label: '已停止',
    });
  } else if (hasOutput || phase === 'streaming') {
    steps.push({
      key: 'streaming',
      state: 'active',
      label: '正在回复',
    });
  }

  // 给 active 步骤附上耗时 — 超过 5s 才显示，避免快回复时干扰。
  const stepsWithTiming = steps.map((step) => {
    if (step.state !== 'active' || elapsedSec < 5 || stopped || hasOutput) return step;
    return { ...step, label: `${step.label}  · ${elapsedSec}s` };
  });
  const showSlowHint = !stopped && !hasOutput && !redirected && elapsedSec >= 12;

  return (
    <div className="thinking-steps" role="status" aria-live="polite">
      {stepsWithTiming.map((step) => (
        <div className={`thinking-step thinking-step-${step.state}`} key={step.key}>
          <span className="thinking-step-marker" aria-hidden="true">
            {step.state === 'done' ? '✓' : step.state === 'stopped' ? '×' : ''}
          </span>
          <div className="thinking-step-body">
            <div className="thinking-step-label">{step.label}</div>
            {step.detail ? <div className="thinking-step-detail">{step.detail}</div> : null}
          </div>
        </div>
      ))}
      {showSlowHint ? (
        <div className="thinking-slow-hint">
          模型还在思考，比平时多用了点时间，再稍等几秒。
        </div>
      ) : null}
    </div>
  );
}

function CtaBubble({ question, manual, onCast, onAnalyze, disabled }) {
  const [q, setQ] = useState(question || '');
  const castTarget = manual || !question ? q : question;
  return (
    <div className="cta-bubble">
      {!manual && question && (
        <div style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
          这个问题适合起一卦，要不要为你算一下？
        </div>
      )}
      {(manual || !question) && (
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCast(q); }}
          placeholder="问一件具体的事，例如：下周该不该换工作"
          disabled={disabled}
          style={{
            width: '100%', padding: '6px 10px', fontSize: 13,
            border: '1px solid #ccc', marginBottom: 8, boxSizing: 'border-box',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn-primary"
          onClick={() => onCast(castTarget)}
          disabled={disabled || !castTarget?.trim()}
          style={{ fontSize: 12, padding: '4px 14px' }}
        >
          {disabled ? '占算中…' : '起一卦'}
        </button>
        {!manual && question && onAnalyze && (
          <button
            onClick={() => onAnalyze(question)}
            disabled={disabled}
            style={{
              fontSize: 12, padding: '4px 14px', background: 'none',
              border: '1px solid #bbb', cursor: 'pointer', color: '#555',
            }}
          >
            用命盘直接分析
          </button>
        )}
      </div>
    </div>
  );
}

function isAbortError(error) {
  if (!error) return false;
  return error.name === 'AbortError' || /aborted|abort/i.test(String(error.message || error));
}

function findPreviousUserIndex(history, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') return i;
  }
  return -1;
}

export default function Chat() {
  const history = useAppStore(s => s.chatHistory);
  const pushChat = useAppStore(s => s.pushChat);
  const replaceLastAssistant = useAppStore(s => s.replaceLastAssistant);
  const prepareChatRegeneration = useAppStore(s => s.prepareChatRegeneration);
  const replacePlaceholderWithCta = useAppStore(s => s.replacePlaceholderWithCta);
  const replaceLastCtaWithAssistant = useAppStore(s => s.replaceLastCtaWithAssistant);
  const pushGuaCard = useAppStore(s => s.pushGuaCard);
  const updateLastGuaCard = useAppStore(s => s.updateLastGuaCard);
  const llmEnabled = useAppStore(s => s.llmEnabled);
  const chatStreaming = useAppStore(s => s.chatStreaming);
  const setChatStreaming = useAppStore(s => s.setChatStreaming);
  const guaStreaming = useAppStore(s => s.guaStreaming);
  const setGuaStreaming = useAppStore(s => s.setGuaStreaming);
  const setGuaCurrent = useAppStore(s => s.setGuaCurrent);
  const bumpQuotaUsage = useAppStore(s => s.bumpQuotaUsage);
  const setAppNotice = useAppStore(s => s.setAppNotice);
  const view = useAppStore(s => s.view);
  const meta = useAppStore(s => s.meta);
  const force = useAppStore(s => s.force);
  const guards = useAppStore(s => s.guards);
  const dayun = useAppStore(s => s.dayun);
  const dayunOpenIdx = useAppStore(s => s.dayunOpenIdx);
  const liunianOpenKey = useAppStore(s => s.liunianOpenKey);
  const setDayunOpenIdx = useAppStore(s => s.setDayunOpenIdx);
  const setLiunianOpenKey = useAppStore(s => s.setLiunianOpenKey);
  const classics = useAppStore(s => s.classics);
  const currentConversationId = useAppStore(s => s.currentConversationId);
  const ensureConversation = useAppStore(s => s.ensureConversation);
  const newConversationOnServer = useAppStore(s => s.newConversationOnServer);

  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState(null);
  const [chips, setChips] = useState([]);
  const [chatTrace, setChatTrace] = useState(null);
  const [editingUserIndex, setEditingUserIndex] = useState(null);
  const [editingText, setEditingText] = useState('');
  // Rotating placeholder example: random first index per session, advance
  // every PROMPT_ROTATE_INTERVAL_MS while the input is empty + idle.
  const [exampleIdx, setExampleIdx] = useState(
    () => Math.floor(Math.random() * PROMPT_EXAMPLES.length),
  );
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const streamAbortRef = useRef(null);
  // 每个对话保留各自的输入草稿。在 A 输了一半切到 B，再切回 A，
  // 应该能看到原文还在；不会"打了一半的内容突然没了"。
  const inputDraftRef = useRef(new Map());

  // 滚动管理：
  //   - stuckToBottom: 用户当前是否"贴在底部"。流式 delta 只在贴底时跟随，
  //     否则保留用户的位置，避免阅读上文时被新内容拽走。
  //   - showJumpToBottom: 离底超过阈值时显示一个 ↓ 浮动按钮，点了立刻吸底。
  //   - scrollMemoryRef: { convId → {top, stuck} } 切换对话时把上一会话的
  //     滚动位置存住、新会话进入时按记忆恢复，否则默认贴底。
  const scrollMemoryRef = useRef(new Map());
  const prevConvIdRef = useRef(currentConversationId);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  function distanceFromBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function onChatScroll() {
    const el = bodyRef.current;
    if (!el) return;
    const dist = distanceFromBottom(el);
    const stuck = dist < 12;
    setStuckToBottom(stuck);
    setShowJumpToBottom(dist > 120);
    if (currentConversationId) {
      scrollMemoryRef.current.set(currentConversationId, { top: el.scrollTop, stuck });
    }
  }

  function jumpToBottom() {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStuckToBottom(true);
    setShowJumpToBottom(false);
  }

  // 一个 layout effect 同时处理"切对话恢复"和"流式跟随"。在 paint 前完成
  // scrollTop / 输入框草稿 的写入，避免 jitter。
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const prevId = prevConvIdRef.current;
    const idChanged = prevId !== currentConversationId;
    if (idChanged) {
      // 1. 把旧对话的输入草稿存起来（空字符串则删除条目，避免 Map 膨胀）
      if (prevId) {
        if (input && input.trim()) inputDraftRef.current.set(prevId, input);
        else inputDraftRef.current.delete(prevId);
      }
      // 2. 切到新对话时还原草稿（没有就清空）
      const incomingDraft = currentConversationId
        ? (inputDraftRef.current.get(currentConversationId) || '')
        : '';
      setInput(incomingDraft);
      // 3. 滚动位置恢复
      prevConvIdRef.current = currentConversationId;
      const mem = currentConversationId
        ? scrollMemoryRef.current.get(currentConversationId)
        : null;
      if (mem) {
        el.scrollTop = mem.top;
        setStuckToBottom(mem.stuck);
      } else {
        el.scrollTop = el.scrollHeight;
        setStuckToBottom(true);
      }
      setShowJumpToBottom(distanceFromBottom(el) > 120);
      return;
    }
    if (stuckToBottom) {
      el.scrollTop = el.scrollHeight;
      setShowJumpToBottom(false);
    } else {
      // 不在底部时，新内容来了 → 提示用户"下面有新内容"
      if (distanceFromBottom(el) > 120) setShowJumpToBottom(true);
    }
  }, [history, currentConversationId, stuckToBottom, input]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = '0px';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 140)}px`;
  }, [input]);

  async function refreshChips() {
    const state = useAppStore.getState();
    if (!state.currentId) return;
    const convId = state.currentConversationId;
    try {
      const chipsList = await fetchChips(state.currentId, convId);
      if (chipsList && chipsList.length >= 2) setChips(chipsList);
    } catch {
      // best-effort; keep prior chips
    }
  }

  useEffect(() => {
    const bootstrapped = startBootstrapChipsRefresh({
      meta,
      currentConversationId,
      historyLength: history.length,
      refreshChips,
    });
    if (!bootstrapped) setChips([]);
  }, [history.length, meta, currentConversationId]);

  useEffect(() => {
    setChatTrace(null);
    streamAbortRef.current = null;
  }, [currentConversationId]);

  async function ensureConversationId() {
    const state = useAppStore.getState();
    return resolveConversationIdForSend({
      currentConversationId: state.currentConversationId,
      currentChartId: state.currentId,
      ensureConversation,
    });
  }

  function beginTrace() {
    setChatTrace(createChatProgress({ contextLabel: workspace.contextLabel, seed: Date.now() }));
  }

  function updateTrace(event) {
    setChatTrace((current) => applyChatProgressEvent(current, event));
  }

  function bindStreamController() {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    return controller;
  }

  function releaseStreamController(controller) {
    if (streamAbortRef.current === controller) {
      streamAbortRef.current = null;
    }
  }

  function stopStreaming() {
    if (!streamAbortRef.current) return;
    streamAbortRef.current.abort();
    updateTrace({ type: 'abort' });
  }

  function beginEditUserMessage(index, content) {
    if (chatStreaming || guaStreaming) return;
    setChatError(null);
    setEditingUserIndex(index);
    setEditingText(String(content || ''));
  }

  function cancelEditUserMessage() {
    setEditingUserIndex(null);
    setEditingText('');
  }

  async function regenerateFromUser(index, content) {
    const q = String(content || '').trim();
    if (!q || chatStreaming || guaStreaming) return;
    setInput('');
    setChatError(null);
    setChatTrace(null);
    cancelEditUserMessage();
    prepareChatRegeneration(index, q);
    await send(q, { retry: true });
  }

  async function send(text, options = {}) {
    const retry = options.retry === true;
    const q = String(text ?? inputRef.current?.value ?? input).trim();
    if (!q || chatStreaming || guaStreaming) return;
    const sendStartedAt = Date.now();
    console.log(`[chat] send:start retry=${retry} at=${sendStartedAt}`);
    setChatError(null);

    if (!llmEnabled) {
      if (retry) {
        replaceLastAssistant('（未配置 LLM，当前回到预设回复）');
      } else {
        setInput('');
        if (currentConversationId) inputDraftRef.current.delete(currentConversationId);
        pushChat({ role: 'user', content: q });
        pushChat({ role: 'assistant', content: '' });
        replaceLastAssistant('（未配置 LLM，当前回到预设回复）');
      }
      return;
    }

    console.log(`[chat] ensureConversation:start dt=0ms`);
    const convId = await ensureConversationId();
    console.log(`[chat] ensureConversation:ready conv=${convId || 'none'} dt=${Date.now() - sendStartedAt}ms`);
    if (retry) {
      replaceLastAssistant('');
    } else {
      setInput('');
      if (convId) inputDraftRef.current.delete(convId);
      pushChat({ role: 'user', content: q });
      pushChat({ role: 'assistant', content: '' });
    }

    if (!convId) {
      replaceLastAssistant('（请先创建一个对话）');
      return;
    }

    setChatStreaming(true);
    beginTrace();
    const controller = bindStreamController();
    try {
      console.log(`[chat] stream:start conv=${convId} dt=${Date.now() - sendStartedAt}ms`);
      await streamMessage(convId, { message: q, bypass_divination: false, client_context: clientContext }, {
        signal: controller.signal,
        onDelta: (_t, running) => {
          replaceLastAssistant(running);
          updateTrace({ type: 'delta' });
        },
        onIntent: (intent, reason, source) =>
        {
          console.log(`[chat] intent=${intent} reason=${reason} source=${source}`);
          updateTrace({ type: 'intent', intent, reason, source });
        },
        onRedirect: (to, redirQ) => {
          setChatTrace(null);
          if (to === 'gua') replacePlaceholderWithCta(redirQ || q, false);
        },
        onModel: (m) => {
          console.log('[chat] modelUsed=' + m);
          updateTrace({ type: 'model', modelUsed: m });
        },
        onRetrieval: (src) => {
          console.log('[chat] retrieval=' + src);
          updateTrace({ type: 'retrieval', source: src });
        },
        onDone: (full) => {
          if (full) replaceLastAssistant(full);
          updateTrace({ type: 'done' });
        },
      });
      bumpQuotaUsage('chat_message');
    } catch (e) {
      if (isAbortError(e)) {
        updateTrace({ type: 'abort' });
        return;
      }
      console.error('[chat] failed:', e);
      const uiError = friendlyError(e, 'chat');
      replaceLastAssistant(uiError.title);
      setChatError({ error: e, question: q });
      // QUOTA_EXCEEDED / CHART_LIMIT_EXCEEDED — friendlyError 给挂上 cta，
      // 弹个 toast 让用户看到"查看订阅方案"那个按钮。
      if (uiError.cta) setAppNotice(uiError);
    } finally {
      releaseStreamController(controller);
      finalizeChatTurn({ setChatStreaming, refreshChips });
    }
  }

  async function castGuaInline(question) {
    if (!question?.trim() || guaStreaming || chatStreaming) return;
    const convId = await ensureConversationId();
    if (!convId) return;
    setGuaStreaming(true);
    const controller = bindStreamController();

    let guaData = null;
    let runningBody = '';
    try {
      const final = await streamGua(convId, { question: question.trim() }, {
        signal: controller.signal,
        onGua: (g) => {
          guaData = g;
          pushGuaCard({ ...g, question: question.trim(), body: '' });
        },
        onDelta: (_t, running) => {
          runningBody = running;
          updateLastGuaCard(running, false);
        },
        onModel: (m) => console.log('[gua] model=' + m),
      });
      const finalBody = final || runningBody;
      updateLastGuaCard(finalBody, true);
      setGuaCurrent({ ...(guaData || {}), question: question.trim(), body: finalBody, ts: Date.now() });
      // Note: gua history is now server-backed (each gua becomes a role='gua' message);
      // we no longer call pushGuaHistory.
      bumpQuotaUsage('gua');
    } catch (e) {
      if (isAbortError(e)) {
        updateLastGuaCard(runningBody || '（已停止输出）', true);
        return;
      }
      console.error('[gua inline] failed:', e);
      const ui = friendlyError(e, 'gua');
      updateLastGuaCard('（起卦失败：' + (ui.title || e.message || String(e)) + '）', true);
      if (ui.cta) setAppNotice(ui);
    } finally {
      releaseStreamController(controller);
      setGuaStreaming(false);
    }
  }

  async function analyzeDirectly(question) {
    if (!question?.trim() || chatStreaming || guaStreaming) return;
    setChatError(null);
    replaceLastCtaWithAssistant();
    setChatStreaming(true);
    beginTrace();
    const convId = await ensureConversationId();
    if (!convId) {
      setChatTrace(null);
      setChatStreaming(false);
      return;
    }
    const controller = bindStreamController();
    try {
      await streamMessage(convId, { message: question, bypass_divination: true, client_context: clientContext }, {
        signal: controller.signal,
        onDelta: (_t, running) => {
          replaceLastAssistant(running);
          updateTrace({ type: 'delta' });
        },
        onIntent: (intent, reason, source) => {
          console.log(`[chat] analyze intent=${intent} reason=${reason} source=${source}`);
          updateTrace({ type: 'intent', intent, reason, source });
        },
        onModel: (m) => {
          console.log('[chat] analyze model=' + m);
          updateTrace({ type: 'model', modelUsed: m });
        },
        onRetrieval: (src) => {
          console.log('[chat] retrieval=' + src);
          updateTrace({ type: 'retrieval', source: src });
        },
        onDone: (full) => {
          if (full) replaceLastAssistant(full);
          updateTrace({ type: 'done' });
        },
      });
      bumpQuotaUsage('chat_message');
    } catch (e) {
      if (isAbortError(e)) {
        updateTrace({ type: 'abort' });
        return;
      }
      console.error('[analyze] failed:', e);
      const uiError = friendlyError(e, 'chat');
      replaceLastAssistant(uiError.title);
      setChatError({ error: e, question });
      if (uiError.cta) setAppNotice(uiError);
    } finally {
      releaseStreamController(controller);
      setChatStreaming(false);
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatStreaming || guaStreaming) stopStreaming();
      else send();
    }
  }

  const workspace = buildChatWorkspace({
    meta,
    force,
    guards,
    dayun,
    dayunOpenIdx,
    liunianOpenKey,
  });
  const clientContext = buildChatClientContext({ view, workspace, classics });
  // 把"已经问过的问题"传给 mergePromptChips，避免 chip 列表里还杵着
  // "这盘的核心矛盾"这种刚刚已经被回答的兜底。
  const askedQuestions = history
    .filter((m) => m?.role === 'user')
    .map((m) => String(m?.content || '').trim())
    .filter(Boolean);
  const composerChips = mergePromptChips(workspace.starterQuestions, chips, 4, askedQuestions);
  const busy = chatStreaming || guaStreaming;
  const traceVisible = !!chatTrace && !chatTrace.hasOutput && (chatStreaming || chatTrace.phase === 'stopped');
  // Rotate the placeholder only when idle + empty + no contextual override.
  const placeholderRotating = !busy && !input && !workspace.contextLabel;
  useEffect(() => {
    if (!placeholderRotating) return undefined;
    const handle = setInterval(() => {
      setExampleIdx((i) => (i + 1) % PROMPT_EXAMPLES.length);
    }, PROMPT_ROTATE_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [placeholderRotating]);
  const placeholderText = busy
    ? '生成中…可点停止'
    : workspace.contextLabel
      ? '继续追问这一点…'
      : PROMPT_EXAMPLES[exampleIdx];

  return (
    <div className="right-pane">
      <div className="chat-topbar">
        <div className="section-num">对 话</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ConversationSwitcher disabled={busy} />
          <button
            className="muted"
            style={{ fontSize: 11 }}
            onClick={async () => {
              const chartId = useAppStore.getState().currentId;
              if (!chartId) return;
              const count = (useAppStore.getState().conversations || []).length;
              await newConversationOnServer(chartId, `对话 ${count + 1}`);
            }}
            disabled={busy}
            title="新建对话"
          >新对话</button>
        </div>
      </div>

      <div className="chat-body" ref={bodyRef} onScroll={onChatScroll}>
        {history.length === 0 && (
          <div className="chat-welcome fade-in">
            <div className="chat-opening-guide">
              <p className="chat-opening-lead">
                <strong>{workspace.title}</strong>
                {workspace.openingGuide?.intro ? `。${workspace.openingGuide.intro}` : '。可以直接告诉我你想追问的点。'}
              </p>
              {workspace.openingGuide?.items?.length ? (
                <ul className="chat-opening-list">
                  {workspace.openingGuide.items.map(item => (
                    <li key={item.label}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {workspace.openingGuide?.closing ? (
                <p className="chat-opening-closing">{workspace.openingGuide.closing}</p>
              ) : null}
            </div>
          </div>
        )}
        {history.map((m, i) => {
          if (m.role === 'user') {
            const isEditing = editingUserIndex === i;
            if (isEditing) {
              return (
                <div className="msg msg-user msg-user-editing" key={i}>
                  <div className="chat-edit-card">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelEditUserMessage();
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          regenerateFromUser(i, editingText);
                        }
                      }}
                      rows={3}
                      autoFocus
                    />
                    <div className="chat-turn-actions user-turn-actions">
                      <button onClick={() => regenerateFromUser(i, editingText)} disabled={!String(editingText).trim() || busy}>
                        重新回答
                      </button>
                      <button onClick={cancelEditUserMessage} disabled={busy}>取消</button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div className="msg msg-user" key={i}>
                <span className="bubble">{m.content}</span>
                <div className="chat-turn-actions user-turn-actions">
                  <button onClick={() => beginEditUserMessage(i, m.content)} disabled={busy}>修改问题</button>
                </div>
              </div>
            );
          }

          if (m.role === 'gua') {
            return (
              <div className="msg msg-ai" key={i}>
                <GuaCard data={m.content} />
              </div>
            );
          }

          if (m.role === 'cta') {
            const { question: ctaQ, manual } = m.content || {};
            return (
              <div className="msg msg-ai" key={i}>
                <CtaBubble
                  question={ctaQ}
                  manual={manual}
                  onCast={(q) => castGuaInline(q)}
                  onAnalyze={(q) => analyzeDirectly(q)}
                  disabled={busy}
                />
              </div>
            );
          }

          const isLast = i === history.length - 1;
          if (isLast && chatError) {
            const uiError = friendlyError(chatError.error, 'chat');
            return (
              <div className="msg msg-ai" key={i}>
                <ErrorState
                  title={uiError.title}
                  detail={uiError.detail}
                  retryable={uiError.retryable}
                  onRetry={uiError.retryable ? () => send(chatError.question, { retry: true }) : undefined}
                />
              </div>
            );
          }
          return (
            <div className="msg msg-ai" key={i}>
              <div className={'msg-ai-card' + (!m.content && !(isLast && traceVisible) ? ' loading' : '')}>
                {isLast && traceVisible ? (
                  <ThinkingIndicator trace={chatTrace} />
                ) : null}
                <div className="msg-ai-body">
                  {m.content ? (
                    <RichText
                      text={m.content}
                      context={history[findPreviousUserIndex(history, i)]?.content || ''}
                    />
                  ) : null}
                </div>
              </div>
              {(() => {
                const userIndex = findPreviousUserIndex(history, i);
                if (userIndex < 0) return null;
                const question = history[userIndex]?.content || '';
                return (
                  <div className="chat-turn-actions ai-turn-actions">
                    {isLast && busy ? <button onClick={stopStreaming}>停止</button> : null}
                    {!busy ? <button onClick={() => regenerateFromUser(userIndex, question)}>重新回答</button> : null}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {showJumpToBottom ? (
        <button
          type="button"
          className="chat-jump-bottom"
          data-above-chips={history.length > 0 ? 'true' : 'false'}
          onClick={jumpToBottom}
          aria-label="回到底部"
          title="回到底部"
        >
          <span className="chat-jump-bottom-arrow" aria-hidden="true">↓</span>
          <span className="chat-jump-bottom-label">新内容</span>
        </button>
      ) : null}

      <div className="chat-input-wrap">
        {workspace.contextLabel ? (
          <div className="chat-context-pill" role="status">
            <span className="chat-context-pill-prefix" aria-hidden="true">聚焦</span>
            <span className="chat-context-pill-label">{workspace.contextLabel}</span>
            <button
              type="button"
              className="chat-context-pill-close"
              onClick={() => {
                // 同时清掉 dayun + liunian focus，回到"整盘对话"模式
                if (liunianOpenKey) setLiunianOpenKey(null);
                if (dayunOpenIdx != null) setDayunOpenIdx(null);
              }}
              aria-label="退出当前聚焦"
              title="退出当前聚焦，回到整盘对话"
              disabled={busy}
            >×</button>
          </div>
        ) : null}
        {history.length > 0 ? (
          <div className="chat-chips">
            {composerChips.map((chip) => {
              const hasDraft = !!String(input).trim();
              return (
                <button
                  key={chip}
                  className={'chip' + (hasDraft ? ' chip-soft-disabled' : '')}
                  onClick={() => {
                    // 草稿非空时 chip 不响应（避免静默清空打了一半的字）。
                    // tooltip 解释：先发出或清空草稿，chip 才会再次可点。
                    if (hasDraft) return;
                    send(chip);
                  }}
                  disabled={busy}
                  aria-disabled={hasDraft || busy}
                  title={
                    hasDraft
                      ? '正在编辑草稿，先发出或清空后才会响应'
                      : '点击直接发送'
                  }
                >{chip}</button>
              );
            })}
          </div>
        ) : null}
        <div className="chat-input">
          <div className="chat-textarea-wrap">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder=""
              disabled={busy}
            />
            {!input ? (
              <div
                className="chat-placeholder-overlay"
                aria-hidden="true"
                key={placeholderRotating ? exampleIdx : placeholderText}
              >
                {placeholderText}
              </div>
            ) : null}
          </div>
          <button
            className="btn-primary chat-send-btn"
            onClick={busy ? stopStreaming : () => send()}
            disabled={busy ? false : !String(input).trim()}
          >
            {busy ? '停止' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
