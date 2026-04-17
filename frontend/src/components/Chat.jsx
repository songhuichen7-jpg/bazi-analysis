import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamSSE } from '../lib/api';
import GuaCard from './GuaCard';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';
import ConversationSwitcher from './ConversationSwitcher';

const DEFAULT_CHIPS = ['七杀格意味着什么', '我在纠结要不要离职创业', '酉辰六合会怎样', '我适合什么伴侣'];

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="生成中">
      <span /><span /><span />
    </span>
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

export default function Chat() {
  const history = useAppStore(s => s.chatHistory);
  const pushChat = useAppStore(s => s.pushChat);
  const clearChat = useAppStore(s => s.clearChat);
  const replaceLastAssistant = useAppStore(s => s.replaceLastAssistant);
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
  const pushGuaHistory = useAppStore(s => s.pushGuaHistory);
  const meta = useAppStore(s => s.meta);
  const dayun = useAppStore(s => s.dayun);
  const currentConversationId = useAppStore(s => s.currentConversationId);

  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState(null);
  const [chips, setChips] = useState(DEFAULT_CHIPS);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [history]);

  function refreshChips(withHistory = false) {
    const state = useAppStore.getState();
    if (!state.meta) return;
    const chart = {
      PAIPAN: state.paipan, FORCE: state.force, GUARDS: state.guards,
      DAYUN: state.dayun, META: state.meta,
    };
    const history = withHistory
      ? state.chatHistory.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6)
      : [];
    fetch('/api/chips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart, history }),
    })
      .then(r => r.json())
      .then(d => { if (d.chips?.length >= 2) setChips(d.chips); })
      .catch(() => {});
  }

  // Refresh chips when chart first loads OR when user switches conversation.
  // Use conversation's history if it has one, otherwise chart-only hint.
  useEffect(() => {
    if (!meta) return;
    const state = useAppStore.getState();
    const hasHistory = (state.chatHistory || []).some(m => m.role === 'user' || m.role === 'assistant');
    refreshChips(hasHistory);
  }, [meta, currentConversationId]);

  async function send(text, options = {}) {
    const retry = options.retry === true;
    const q = (text ?? input).trim();
    if (!q || chatStreaming) return;
    setChatError(null);
    if (retry) {
      replaceLastAssistant('');
    } else {
      setInput('');
      pushChat({ role: 'user', content: q });
      pushChat({ role: 'assistant', content: '' });
    }

    if (!llmEnabled) {
      replaceLastAssistant('（未配置 LLM，当前回到预设回复）');
      return;
    }

    setChatStreaming(true);
    const state = useAppStore.getState();
    const chart = {
      PAIPAN: state.paipan, FORCE: state.force, GUARDS: state.guards,
      DAYUN: state.dayun, META: state.meta,
      SECTIONS: state.sections || [],
      VERDICTS: state.verdicts || {},
    };
    // History to send: exclude the empty assistant bubble + non-chat entries
    const histToSend = state.chatHistory
      .slice(0, -1)
      .filter(m => m.role === 'user' || m.role === 'assistant');
    try {
      await streamSSE('/api/chat', {
        message: q, chart, history: histToSend, task: 'chat',
      }, {
        onDelta: (_t, running) => replaceLastAssistant(running),
        onIntent: (intent, reason, source) => console.log(`[chat] intent=${intent} reason=${reason} source=${source}`),
        onRedirect: (to, redirQ) => {
          if (to === 'gua') {
            replacePlaceholderWithCta(redirQ || q, false);
          }
        },
        onModel: (m) => console.log('[chat] modelUsed=' + m),
        onRetrieval: (src) => console.log('[chat] retrieval=' + src),
      });
    } catch (e) {
      console.error('[chat] failed:', e);
      const uiError = friendlyError(e, 'chat');
      replaceLastAssistant(uiError.title);
      setChatError({ error: e, question: q });
    } finally {
      setChatStreaming(false);
      refreshChips(true);
    }
  }

  async function castGuaInline(question) {
    if (!question?.trim() || guaStreaming) return;
    setGuaStreaming(true);

    // Build birth context from store (same as legacy Gua.jsx)
    const metaSnap = meta;
    const dayunSnap = dayun;
    let birthContext = null;
    if (metaSnap) {
      const todayYear = Number(String(metaSnap?.today?.ymd || '').slice(0, 4));
      const currentDayun = dayunSnap?.find(s => {
        const start = Number(s.startYear), end = Number(s.endYear);
        return Number.isFinite(start) && Number.isFinite(end) && todayYear >= start && todayYear <= end;
      }) || dayunSnap?.find(s => s.current) || null;
      const currentLiunian = currentDayun?.years?.find(y => Number(y.year) === todayYear)
        || currentDayun?.years?.find(y => y.current)
        || (metaSnap?.today?.yearGz ? { gz: metaSnap.today.yearGz } : null);
      birthContext = {
        rizhu: metaSnap.rizhu,
        currentDayun: currentDayun?.gz,
        currentYear: currentLiunian?.gz,
      };
    }

    let guaData = null;
    let runningBody = '';
    try {
      const final = await streamSSE('/api/gua', { question: question.trim(), birthContext }, {
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
      // Keep gua.current in store for backward compat
      const entry = { ...guaData, question: question.trim(), body: finalBody, ts: Date.now() };
      setGuaCurrent(entry);
      pushGuaHistory(entry);
    } catch (e) {
      console.error('[gua inline] failed:', e);
      updateLastGuaCard('（起卦失败：' + (e.message || String(e)) + '）', true);
    } finally {
      setGuaStreaming(false);
    }
  }

  async function analyzeDirectly(question) {
    if (!question?.trim() || chatStreaming) return;
    setChatError(null);
    replaceLastCtaWithAssistant(); // turn the CTA bubble into an empty assistant placeholder
    setChatStreaming(true);
    const state = useAppStore.getState();
    const chart = {
      PAIPAN: state.paipan, FORCE: state.force, GUARDS: state.guards,
      DAYUN: state.dayun, META: state.meta,
      SECTIONS: state.sections || [],
      VERDICTS: state.verdicts || {},
    };
    const histToSend = state.chatHistory
      .slice(0, -1) // exclude the empty assistant we just placed
      .filter(m => m.role === 'user' || m.role === 'assistant');
    try {
      await streamSSE('/api/chat', {
        message: question, chart, history: histToSend, bypassDivination: true,
      }, {
        onDelta: (_t, running) => replaceLastAssistant(running),
        onIntent: () => {},
        onRedirect: () => {},
        onModel: (m) => console.log('[chat] analyze model=' + m),
        onRetrieval: (src) => console.log('[chat] retrieval=' + src),
      });
    } catch (e) {
      console.error('[analyze] failed:', e);
      const uiError = friendlyError(e, 'chat');
      replaceLastAssistant(uiError.title);
      setChatError({ error: e, question });
    } finally {
      setChatStreaming(false);
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="right-pane">
      <div className="chat-topbar">
        <div className="section-num">对 话</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ConversationSwitcher disabled={chatStreaming || guaStreaming} />
          <button
            className="muted"
            style={{ fontSize: 11 }}
            onClick={() => { if (confirm('清空当前对话？')) clearChat(); }}
            disabled={chatStreaming || guaStreaming}
            title="清空当前对话"
          >清空</button>
        </div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {history.length === 0 && (
          <div className="msg msg-ai">
            我已经看过你的命盘了。你可以：<br/>
            <span className="muted" style={{ fontSize: 12 }}>· 直接点左侧命盘里的<b>任意字</b>——我会立即解释</span><br/>
            <span className="muted" style={{ fontSize: 12 }}>· 告诉我一个你当下的选择困境，我会进入结构化分析</span>
          </div>
        )}
        {history.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div className="msg msg-user" key={i}>
                <span className="bubble">{m.content}</span>
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
                  disabled={guaStreaming || chatStreaming}
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
{m.content ? <RichText text={m.content} /> : <TypingDots />}
            </div>
          );
        })}
      </div>

      <div className="chat-input-wrap">
        <div className="chat-chips">
          {chips.map(c => (
            <button key={c} className="chip" onClick={() => send(c)} disabled={chatStreaming}>{c}</button>
          ))}
        </div>
        <div className="chat-input">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="你想知道什么？"
            disabled={chatStreaming}
          />
          <button className="btn-primary" onClick={() => send()} disabled={chatStreaming}>发送</button>
        </div>
      </div>
    </div>
  );
}
