import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { streamSSE } from '../../lib/api.js';
import { friendlyError } from '../../lib/errorMessages.js';

// 合盘"完整解读" — Plan 5+ 付费功能。点 "解锁完整解读 →" 触发 SSE，文字
// 流式落到下方。结构是 LLM prompt 里规定的四段（# 你们的核心动力 / # 容易
// 撞墙的地方 / # 怎么相互调成最舒服的频率 / # 一句话总结）— 我们渲染时
// 把每个 # 当 h2，其余当段落，不依赖外部 markdown lib 也不允许 LLM 越权
// 渲染 link / image。

export default function HepanReadingPanel({ slug }) {
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);     // friendlyError 结果对象（可能带 cta）
  const abortRef = useRef(null);

  async function start() {
    if (streaming) return;
    setStreaming(true);
    setError(null);
    setText('');
    setDone(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamSSE(`/api/hepan/${slug}/reading`, null, {
        signal: ctrl.signal,
        onDelta: (_t, running) => setText(running),
        onDone: (full) => { if (full) setText(full); setDone(true); },
      });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      const ui = friendlyError(e, 'hepan');
      setError(ui);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  // 没启动 + 没文本 + 没错 — 显示初始 CTA
  if (!streaming && !text && !error) {
    return (
      <div className="hepan-reading-cta">
        <p className="hepan-reading-hook">想看你和 TA 的相处指南？</p>
        <p className="hepan-reading-detail">
          谁主动谁跟随、容易撞墙的地方、怎么调成最舒服的频率 — 由 AI 写一段 600-900 字。
        </p>
        <button type="button" className="btn-primary" onClick={start}>
          解锁完整解读 →
        </button>
      </div>
    );
  }

  // 错误（含 paywall）— 用 ErrorState-like 渲染但简化掉 dismiss
  if (error) {
    return (
      <div className="hepan-reading-error" role="alert">
        <div className="hepan-reading-error-title">{error.title}</div>
        {error.detail ? (
          <div className="hepan-reading-error-detail muted">{error.detail}</div>
        ) : null}
        <div className="hepan-reading-error-actions">
          {error.cta?.to ? (
            <Link to={error.cta.to} className="btn-primary">{error.cta.label}</Link>
          ) : null}
          {error.retryable ? (
            <button type="button" className="btn-inline" onClick={start}>再试一次</button>
          ) : (
            <button type="button" className="btn-inline" onClick={() => setError(null)}>关闭</button>
          )}
        </div>
      </div>
    );
  }

  // streaming / done — 展示文本
  return (
    <div className={'hepan-reading' + (streaming ? ' is-streaming' : '')}>
      <div className="hepan-reading-head">
        <span className="hepan-reading-tag">完整解读</span>
        {streaming ? (
          <button type="button" className="hepan-reading-stop" onClick={stop}>停止生成</button>
        ) : null}
      </div>
      <div className="hepan-reading-body">
        {renderReading(text)}
        {streaming && !done ? <span className="hepan-reading-caret" aria-hidden="true">▍</span> : null}
      </div>
    </div>
  );
}

function renderReading(text) {
  if (!text) return null;
  const blocks = [];
  let buffer = '';
  const flush = () => {
    const t = buffer.trim();
    if (t) blocks.push({ kind: 'para', text: t });
    buffer = '';
  };
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(line)) {
      flush();
      blocks.push({ kind: 'heading', text: line.replace(/^#+\s*/, '') });
    } else if (/^[-*_]{3,}$/.test(trimmed)) {
      // LLM 自己插的 markdown hr (---) — 我们已经用 heading 间距分段了，
      // 不需要再一条横线，跳过。
      flush();
    } else if (trimmed === '') {
      flush();
    } else {
      buffer += (buffer ? '\n' : '') + line;
    }
  }
  flush();
  return blocks.map((b, i) => b.kind === 'heading'
    ? <h2 key={i} className="hepan-reading-heading">{b.text}</h2>
    : <p key={i} className="hepan-reading-para">{b.text}</p>
  );
}
