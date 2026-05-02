import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { streamSSE } from '../../lib/api.js';
import { friendlyError } from '../../lib/errorMessages.js';
import { getHepanMessages } from '../../lib/hepanApi.js';

// 合盘多轮对话 — 邀请创建者（A）跟 LLM 围绕这段关系连续追问。
// 只在 A 自己访问 /hepan/{slug} 时挂出来。其他人（B 或匿名）拉
// /messages 拿 401/404，组件直接隐身。
//
// UI 模仿主 chat 但精简：
//   · 输入区在最下；用户 bubble 右对齐，assistant 左对齐
//   · 没历史时露 3 个 suggested chip（针对关系语境）
//   · 流式 markdown 渲染 (复用 HepanReadingPanel 的简洁 renderer 思路)
//
// 配额错误（PLAN_UPGRADE_REQUIRED / QUOTA_EXCEEDED）走 friendlyError + cta，
// 在输入区上面渲染一条带"查看订阅方案"的横幅。

const SUGGESTED = [
  '我们一起做项目谁该主导？',
  '吵完架后该怎么和好？',
  '在感情里我们最容易卡在哪？',
];

export default function HepanChat({ slug, hepan }) {
  const [messages, setMessages] = useState(null);   // null = 加载中；[] = 空
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [hidden, setHidden] = useState(false);      // 401 / 404 → 完全不渲染
  const [error, setError] = useState(null);          // friendlyError 结果
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  // 初次挂载拉历史；401/404 → 当前用户不是创建者，组件隐身。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getHepanMessages(slug);
        if (cancelled) return;
        setMessages(data?.items || []);
      } catch (e) {
        if (cancelled) return;
        if (e?.status === 401 || e?.status === 404) {
          setHidden(true);
        } else {
          setMessages([]);
          setError(friendlyError(e, 'hepan'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // 每次 streaming 文本或消息变化都滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [streamingText, messages]);

  if (hidden) return null;

  async function send(text) {
    const q = (text || input).trim();
    if (!q || streaming) return;
    setError(null);
    setInput('');
    // 乐观插入用户消息 + 占位 assistant
    const tempUserId = '__local-user-' + Date.now();
    const tempAsstId = '__local-asst-' + Date.now();
    setMessages((prev) => [
      ...(prev || []),
      { id: tempUserId, role: 'user', content: q, created_at: new Date().toISOString() },
    ]);
    setStreaming(true);
    setStreamingText('');

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let finalText = '';
    try {
      await streamSSE(`/api/hepan/${slug}/messages`, { message: q }, {
        signal: ctrl.signal,
        onDelta: (_t, running) => {
          finalText = running;
          setStreamingText(running);
        },
        onDone: (full) => { finalText = full || finalText; },
      });
      // streamDone — 把流式文本固化为一条 assistant 消息
      setMessages((prev) => [
        ...(prev || []),
        { id: tempAsstId, role: 'assistant', content: finalText, created_at: new Date().toISOString() },
      ]);
      setStreamingText('');
    } catch (e) {
      if (e?.name === 'AbortError') {
        // 用户中断 — 留下中断标记
        if (finalText) {
          setMessages((prev) => [
            ...(prev || []),
            { id: tempAsstId, role: 'assistant', content: finalText + '\n\n（已停止）', created_at: new Date().toISOString() },
          ]);
        }
        setStreamingText('');
      } else {
        const ui = friendlyError(e, 'hepan');
        setError(ui);
        // 移除本地乐观插入的 user 占位 — 让用户重新发
        setMessages((prev) => (prev || []).filter((m) => m.id !== tempUserId));
        setStreamingText('');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming) stop();
      else send();
    }
  }

  // 加载中 — 不渲染太多；让 reading panel 已有的内容站住视觉
  if (messages === null) {
    return (
      <section className="hepan-chat hepan-chat-loading muted">
        正在加载对话…
      </section>
    );
  }

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <section className="hepan-chat">
      <div className="hepan-chat-head">
        <span className="hepan-chat-title">继续聊聊</span>
        <span className="hepan-chat-sub muted">
          有具体问题就问，回答会基于你跟 {hepan?.b?.nickname || hepan?.b?.cosmic_name || '对方'} 的合盘底色。
        </span>
      </div>

      {error ? (
        <div className="hepan-chat-banner" role="alert">
          <div className="hepan-chat-banner-title">{error.title}</div>
          {error.detail ? <div className="hepan-chat-banner-detail muted">{error.detail}</div> : null}
          {error.cta?.to ? (
            <Link to={error.cta.to} className="btn-primary hepan-chat-banner-cta">
              {error.cta.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="hepan-chat-history">
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} text={m.content} />
        ))}
        {streaming ? (
          <ChatBubble role="assistant" text={streamingText} streaming />
        ) : null}
        <div ref={bottomRef} />
      </div>

      {isEmpty ? (
        <div className="hepan-chat-suggestions">
          <div className="hepan-chat-suggest-head muted">想问 TA 的话…</div>
          <div className="hepan-chat-suggest-chips">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                type="button"
                className="hepan-chat-suggest-chip"
                onClick={() => send(q)}
              >{q}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="hepan-chat-input">
        {/* textarea 自己不会垂直居中文字（不像 div），所以套一层
            min-height + flex align-center 的 wrap，让单行 placeholder /
            短问句跟右边的「发送」按钮在视觉中线对齐。模式跟主 chat 的
            .chat-textarea-wrap 一致。 */}
        <div className="hepan-chat-textarea-wrap">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={streaming ? '正在回答…' : '问点什么 — Enter 发送'}
            disabled={streaming}
          />
        </div>
        <button
          type="button"
          className={streaming ? 'btn-inline' : 'btn-primary'}
          onClick={() => streaming ? stop() : send()}
          disabled={!streaming && !input.trim()}
        >{streaming ? '停止' : '发送'}</button>
      </div>
    </section>
  );
}

function ChatBubble({ role, text, streaming }) {
  return (
    <div className={'hepan-chat-msg hepan-chat-msg-' + role}>
      <div className={'hepan-chat-bubble' + (streaming ? ' is-streaming' : '')}>
        {renderInlineMd(text || '')}
        {streaming ? <span className="hepan-chat-caret">▍</span> : null}
      </div>
    </div>
  );
}

// 极简内联 markdown：**bold** / *italic* / 段落保留 \n。不支持 # 标题
// 跟主 chat 的回复语气一致 — assistant 在 hepan chat 里默认不写标题。
function renderInlineMd(text) {
  if (!text) return null;
  const lines = String(text).split('\n');
  return lines.flatMap((line, lineIdx) => {
    const out = [];
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
    let last = 0, m;
    let key = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) out.push(line.slice(last, m.index));
      if (m[0].startsWith('**')) out.push(<strong key={`b-${lineIdx}-${key++}`}>{m[2]}</strong>);
      else out.push(<em key={`i-${lineIdx}-${key++}`}>{m[3]}</em>);
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return [...out, lineIdx < lines.length - 1 ? <br key={`br-${lineIdx}`} /> : null];
  });
}
