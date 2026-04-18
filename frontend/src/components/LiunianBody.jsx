import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamLiunian } from '../lib/api';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';

export default function LiunianBody({ dayunIdx, yearIdx }) {
  const key = dayunIdx + '-' + yearIdx;
  const cached = useAppStore(s => s.liunianCache[key]);
  const setCache = useAppStore(s => s.setLiunianCache);
  const deleteCache = useAppStore(s => s.deleteLiunianCache);
  const setStreaming = useAppStore(s => s.setLiunianStreaming);
  const currentId = useAppStore(s => s.currentId);

  const [text, setText] = useState(cached || '');
  const [error, setError] = useState(null);
  const startedFor = useRef(null);
  const uiError = error ? friendlyError(error, 'liunian') : null;

  useEffect(() => {
    setText(cached || '');
    setError(null);
    const t = setTimeout(() => {
      document.getElementById('liunian-body-' + key)?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }, 20);
    return () => clearTimeout(t);
  }, [key, cached]);

  useEffect(() => {
    if (cached) return;
    if (startedFor.current === key) return;
    startedFor.current = key;
    startStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cached]);

  async function startStream() {
    if (!currentId) return;
    setStreaming(true);
    setError(null);
    setText('');
    try {
      const full = await streamLiunian(currentId, { dayun_index: dayunIdx, year_index: yearIdx }, {
        onDelta: (_t, running) => setText(running),
        onModel: (m) => console.log('[liunian] modelUsed=' + m),
        onRetrieval: (src) => console.log('[liunian] retrieval=' + src),
      });
      if (!full.trim()) throw new Error('empty response');
      setCache(key, full);
      setText(full);
    } catch (e) {
      console.error('[liunian] failed:', e);
      deleteCache(key);
      setError(e.message || String(e));
    } finally {
      setStreaming(false);
    }
  }

  function onRetry() {
    deleteCache(key);
    startedFor.current = null;
    void startStream();
  }

  return (
    <div
      id={'liunian-body-' + key}
      style={{
        marginTop:12, padding:'12px 14px', borderLeft:'2px solid #888',
        background:'#fff', fontSize:13, lineHeight:1.9, whiteSpace:'pre-wrap',
      }}
    >
      {error ? (
        <ErrorState
          title={uiError.title}
          detail={uiError.detail}
          retryable={uiError.retryable}
          onRetry={uiError.retryable ? onRetry : undefined}
        />
      ) : (
        <>
          {text ? <RichText text={text} /> : '生成中…'}
        </>
      )}
    </div>
  );
}
