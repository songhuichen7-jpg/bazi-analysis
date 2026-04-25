import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamLiunian } from '../lib/api';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';
import { buildLiunianPanel } from '../lib/timingPanels';

export default function LiunianBody({ dayunIdx, yearIdx }) {
  const key = `${dayunIdx}-${yearIdx}`;
  const cached = useAppStore((s) => s.liunianCache[key]);
  const setCache = useAppStore((s) => s.setLiunianCache);
  const deleteCache = useAppStore((s) => s.deleteLiunianCache);
  const setStreaming = useAppStore((s) => s.setLiunianStreaming);
  const currentId = useAppStore((s) => s.currentId);
  const dayun = useAppStore((s) => s.dayun);

  const [text, setText] = useState(cached || '');
  const [error, setError] = useState(null);
  const startedFor = useRef(null);
  const uiError = error ? friendlyError(error, 'liunian') : null;

  useEffect(() => {
    setText(cached || '');
    setError(null);
    const timer = setTimeout(() => {
      document.getElementById(`liunian-body-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 20);
    return () => clearTimeout(timer);
  }, [key, cached]);

  useEffect(() => {
    if (cached) return;
    if (startedFor.current === key) return;
    startedFor.current = key;
    void startStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cached]);

  async function startStream() {
    if (!currentId) return;
    setStreaming(true);
    setError(null);
    setText('');
    try {
      const full = await streamLiunian(currentId, { dayun_index: dayunIdx, year_index: yearIdx }, {
        onModel: (model) => console.log('[liunian] modelUsed=' + model),
        onRetrieval: (source) => console.log('[liunian] retrieval=' + source),
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

  const year = dayun?.[dayunIdx]?.years?.[yearIdx] || null;
  const panel = buildLiunianPanel(year, text);

  return (
    <section id={`liunian-body-${key}`} className="timing-panel timing-subpanel">
      <div className="timing-panel-head">
        <div className="timing-panel-kicker">{panel.kicker}</div>
        <div className="timing-panel-title serif">{panel.title}</div>
      </div>

      {error ? (
        <ErrorState
          title={uiError.title}
          detail={uiError.detail}
          retryable={uiError.retryable}
          onRetry={uiError.retryable ? onRetry : undefined}
        />
      ) : !text ? (
        <div className="skeleton-progress timing-loading" role="status" aria-live="polite">
          <div className="skeleton-progress-label">正在细看这一年</div>
          <div className="skeleton-progress-sublabel">会给你看这一年的主压力、机会点和需要留心的地方。</div>
          <div className="skeleton-lines">
            <div className="skeleton-line skeleton-pulse" style={{ width: '86%' }} />
            <div className="skeleton-line skeleton-pulse" style={{ width: '79%' }} />
            <div className="skeleton-line skeleton-pulse" style={{ width: '68%' }} />
          </div>
        </div>
      ) : (
        <div className="timing-body">
          {panel.paragraphs.map((paragraph, paragraphIndex) => (
            <p className="timing-paragraph" key={paragraphIndex}>
              <RichText text={paragraph} />
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
