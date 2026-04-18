import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamDayunStep } from '../lib/api';
import LiunianBody from './LiunianBody';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';

export default function DayunStepBody({ idx }) {
  const cached = useAppStore(s => s.dayunCache[idx]);
  const dayun  = useAppStore(s => s.dayun);
  const setDayunCache = useAppStore(s => s.setDayunCache);
  const deleteDayunCache = useAppStore(s => s.deleteDayunCache);
  const setDayunStreaming = useAppStore(s => s.setDayunStreaming);
  const currentId = useAppStore(s => s.currentId);

  const [text, setText] = useState(cached || '');
  const [error, setError] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const startedFor = useRef(null);

  useEffect(() => {
    setText(cached || '');
    setError(null);
    // scroll into view after mount
    const t = setTimeout(() => {
      document.getElementById('dayun-step-body-' + idx)?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }, 20);
    return () => clearTimeout(t);
  }, [idx, cached]);

  useEffect(() => {
    if (cached) return;                    // already fetched
    if (startedFor.current === idx) return; // guard against StrictMode double-invoke
    startedFor.current = idx;
    startStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cached]);

  async function startStream() {
    if (!currentId) return;
    setStreaming(true);
    setDayunStreaming(true);
    setError(null);
    setText('');
    try {
      const full = await streamDayunStep(currentId, idx, {
        onDelta: (_t, running) => setText(running),
        onModel: (m) => console.log('[dayun-step] modelUsed=' + m),
        onRetrieval: (src) => console.log('[dayun-step] retrieval=' + src),
      });
      if (!full.trim()) throw new Error('empty response');
      setDayunCache(idx, full);
      setText(full);
    } catch (e) {
      console.error('[dayun-step] failed:', e);
      deleteDayunCache(idx);
      setError(e.message || String(e));
    } finally {
      setStreaming(false);
      setDayunStreaming(false);
    }
  }

  function onRetry() {
    deleteDayunCache(idx);
    startedFor.current = null;
    void startStream();
  }

  const step = dayun[idx];
  const years = step?.years || [];
  const uiError = error ? friendlyError(error, 'dayun-step') : null;

  return (
    <div
      id={'dayun-step-body-' + idx}
      style={{
        display:'block', gridColumn:'1/-1', padding:'16px 14px', marginTop:8,
        borderLeft:'2px solid var(--ink, #333)', background:'#fafaf7',
        fontSize:13, lineHeight:1.9,
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
          <div style={{ whiteSpace:'pre-wrap' }}>{text ? <RichText text={text} /> : '生成中…'}</div>
        </>
      )}

      {!error && !streaming && text && years.length > 0 && (
        <LiunianChips dayunIdx={idx} years={years} />
      )}
    </div>
  );
}

function LiunianChips({ dayunIdx, years }) {
  const cache = useAppStore(s => s.liunianCache);
  const openKey = useAppStore(s => s.liunianOpenKey);
  const setOpenKey = useAppStore(s => s.setLiunianOpenKey);
  const dayunStreaming = useAppStore(s => s.dayunStreaming);
  const liunianStreaming = useAppStore(s => s.liunianStreaming);

  const onChipClick = (yi) => {
    if (dayunStreaming || liunianStreaming) return;
    const key = dayunIdx + '-' + yi;
    setOpenKey(openKey === key ? null : key);
  };

  const openYearIdx = openKey?.startsWith(dayunIdx + '-')
    ? Number(openKey.split('-')[1])
    : null;

  return (
    <div style={{ marginTop:14 }}>
      <div className="muted" style={{ fontSize:11, letterSpacing:'.1em', marginBottom:6 }}>流 年</div>
      <div style={{ lineHeight:2 }}>
        {years.map((y, yi) => {
          const key = dayunIdx + '-' + yi;
          const isCur = y.current;
          const isCached = !!cache[key];
          const isOpen = openKey === key;
          const isDisabled = (dayunStreaming || liunianStreaming) && !isOpen;
          return (
            <span
              key={yi}
              className={'ln-chip'
                + (isCur ? ' ln-cur' : '')
                + (isCached ? ' ln-cached' : '')
                + (isDisabled ? ' disabled' : '')}
              data-ref={`liunian.${y.year}`}
              onClick={() => onChipClick(yi)}
              title={isDisabled ? '正在生成中，请稍候' : ''}
              style={{
                display:'inline-block', padding:'4px 10px', margin:3,
                cursor:'pointer', fontSize:12, border:'1px solid #ccc', borderRadius:12,
                ...(isCur ? { background:'#fff3c4', borderColor:'#b99' } : {}),
              }}
            >
              {y.year} {y.gz}
            </span>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize:10, marginTop:4 }}>按公历年粗算（未切立春）</div>
      {openYearIdx !== null && (
        <LiunianBody dayunIdx={dayunIdx} yearIdx={openYearIdx} />
      )}
    </div>
  );
}
