import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamMessage, streamGua, fetchChips } from '../lib/api';
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
  const meta = useAppStore(s => s.meta);
  const currentConversationId = useAppStore(s => s.currentConversationId);
  const ensureConversation = useAppStore(s => s.ensureConversation);
  const newConversationOnServer = useAppStore(s => s.newConversationOnServer);

  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState(null);
  const [chips, setChips] = useState(DEFAULT_CHIPS);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [history]);

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
    if (!meta) return;
    refreshChips();
  }, [meta, currentConversationId]);

  async function ensureConversationId() {
    const result = await ensureConversation(useAppStore.getState().currentId);
    return result?.conversationId || null;
  }

  async function send(text, options = {}) {
    const retry = options.retry === true;
    const q = String(text ?? inputRef.current?.value ?? input).trim();
    if (!q || chatStreaming) return;
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

    const convId = await ensureConversationId();
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
    try {
      await streamMessage(convId, { message: q, bypass_divination: false }, {
        onDelta: (_t, running) => replaceLastAssistant(running),
        onIntent: (intent, reason, source) =>
          console.log(`[chat] intent=${intent} reason=${reason} source=${source}`),
        onRedirect: (to, redirQ) => {
          if (to === 'gua') replacePlaceholderWithCta(redirQ || q, false);
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
      refreshChips();
    }
  }

  async function castGuaInline(question) {
    if (!question?.trim() || guaStreaming) return;
    const convId = await ensureConversationId();
    if (!convId) return;
    setGuaStreaming(true);

    let guaData = null;
    let runningBody = '';
    try {
      const final = await streamGua(convId, { question: question.trim() }, {
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
      console.error('[gua inline] failed:', e);
      updateLastGuaCard('（起卦失败：' + (e.message || String(e)) + '）', true);
    } finally {
      setGuaStreaming(false);
    }
  }

  async function analyzeDirectly(question) {
    if (!question?.trim() || chatStreaming) return;
    setChatError(null);
    replaceLastCtaWithAssistant();
    setChatStreaming(true);
    const convId = await ensureConversationId();
    if (!convId) { setChatStreaming(false); return; }
    try {
      await streamMessage(convId, { message: question, bypass_divination: true }, {
        onDelta: (_t, running) => replaceLastAssistant(running),
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
            onClick={async () => {
              const chartId = useAppStore.getState().currentId;
              if (!chartId) return;
              const count = (useAppStore.getState().conversations || []).length;
              if (confirm('开一个新对话？')) {
                await newConversationOnServer(chartId, `对话 ${count + 1}`);
              }
            }}
            disabled={chatStreaming || guaStreaming}
            title="新建对话"
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
            ref={inputRef}
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
