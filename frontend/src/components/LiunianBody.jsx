import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamSSE } from '../lib/api';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';

export default function LiunianBody({ dayunIdx, yearIdx }) {
  const key = dayunIdx + '-' + yearIdx;
  const cached = useAppStore(s => s.liunianCache[key]);
  const setCache = useAppStore(s => s.setLiunianCache);
  const deleteCache = useAppStore(s => s.deleteLiunianCache);
  const setStreaming = useAppStore(s => s.setLiunianStreaming);

  const [text, setText] = useState(cached || '');
  const [error, setError] = useState(null);
  const [fallbackModel, setFallbackModel] = useState(null);
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
    const state = useAppStore.getState();
    const chart = {
      PAIPAN: state.paipan, FORCE: state.force, GUARDS: state.guards,
      DAYUN: state.dayun, META: state.meta,
    };
    setStreaming(true);
    setError(null);
    setText('');
    setFallbackModel(null);
    try {
      const full = await streamSSE('/api/liunian', { chart, dayunIdx, yearIdx }, {
        onDelta: (_t, running) => setText(running),
        onModel: (m) => {
          console.log('[liunian] modelUsed=' + m);
          if (m && m !== 'z-ai/glm-5.1') setFallbackModel(m);
        },
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
    startStream();
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
