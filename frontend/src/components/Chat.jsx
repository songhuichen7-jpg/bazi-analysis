import { useState, useRef, useEffect } from 'react';
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

  return (
    <div className="thinking-steps" role="status" aria-live="polite">
      {steps.map((step) => (
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
  const view = useAppStore(s => s.view);
  const meta = useAppStore(s => s.meta);
  const force = useAppStore(s => s.force);
  const guards = useAppStore(s => s.guards);
  const dayun = useAppStore(s => s.dayun);
  const dayunOpenIdx = useAppStore(s => s.dayunOpenIdx);
  const liunianOpenKey = useAppStore(s => s.liunianOpenKey);
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
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const streamAbortRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [history]);

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
    } catch (e) {
      if (isAbortError(e)) {
        updateTrace({ type: 'abort' });
        return;
      }
      console.error('[chat] failed:', e);
      const uiError = friendlyError(e, 'chat');
      replaceLastAssistant(uiError.title);
      setChatError({ error: e, question: q });
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
    } catch (e) {
      if (isAbortError(e)) {
        updateLastGuaCard(runningBody || '（已停止输出）', true);
        return;
      }
      console.error('[gua inline] failed:', e);
      updateLastGuaCard('（起卦失败：' + (e.message || String(e)) + '）', true);
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
    } catch (e) {
      if (isAbortError(e)) {
        updateTrace({ type: 'abort' });
        return;
      }
      console.error('[analyze] failed:', e);
      const uiError = friendlyError(e, 'chat');
      replaceLastAssistant(uiError.title);
      setChatError({ error: e, question });
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
  const composerChips = mergePromptChips(workspace.starterQuestions, chips, 4);
  const busy = chatStreaming || guaStreaming;
  const traceVisible = !!chatTrace && !chatTrace.hasOutput && (chatStreaming || chatTrace.phase === 'stopped');

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

      <div className="chat-body" ref={bodyRef}>
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
                  {m.content ? <RichText text={m.content} /> : null}
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

      <div className="chat-input-wrap">
        {workspace.contextLabel ? (
          <div className="chat-context-pill">{workspace.contextLabel}</div>
        ) : null}
        {history.length > 0 ? (
          <div className="chat-chips">
            {composerChips.map((chip) => (
              <button key={chip} className="chip" onClick={() => send(chip)} disabled={busy}>{chip}</button>
            ))}
          </div>
        ) : null}
        <div className="chat-input">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={busy ? '生成中，按停止可中断当前输出' : (workspace.contextLabel ? '继续追问这一点…' : '把你最在意的问题直接告诉我')}
            disabled={busy}
          />
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
