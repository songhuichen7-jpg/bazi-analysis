import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { streamDayunStep } from '../lib/api';
import LiunianBody from './LiunianBody';
import { RichText } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';
import { buildDayunPanel } from '../lib/timingPanels';

export default function DayunStepBody({ idx }) {
  const cached = useAppStore((s) => s.dayunCache[idx]);
  const dayun = useAppStore((s) => s.dayun);
  const setDayunCache = useAppStore((s) => s.setDayunCache);
  const deleteDayunCache = useAppStore((s) => s.deleteDayunCache);
  const setDayunStreaming = useAppStore((s) => s.setDayunStreaming);
  const currentId = useAppStore((s) => s.currentId);

  const [text, setText] = useState(cached || '');
  const [error, setError] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const startedFor = useRef(null);

  useEffect(() => {
    setText(cached || '');
    setError(null);
    const timer = setTimeout(() => {
      document.getElementById(`dayun-step-body-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 20);
    return () => clearTimeout(timer);
  }, [idx, cached]);

  useEffect(() => {
    if (cached) return;
    if (startedFor.current === idx) return;
    startedFor.current = idx;
    void startStream();
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
        onModel: (model) => console.log('[dayun-step] modelUsed=' + model),
        onRetrieval: (source) => console.log('[dayun-step] retrieval=' + source),
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
  const panel = buildDayunPanel(step, text);

  return (
    <section id={`dayun-step-body-${idx}`} className="timing-panel timing-panel-dayun">
      <div className="timing-panel-head">
        <div className="timing-panel-kicker">{panel.kicker}</div>
        <div className="timing-panel-title serif">{panel.title}</div>
        {panel.meta ? <div className="timing-panel-meta">{panel.meta}</div> : null}
      </div>

      {error ? (
        <ErrorState
          title={uiError.title}
          detail={uiError.detail}
          retryable={uiError.retryable}
          onRetry={uiError.retryable ? onRetry : undefined}
        />
      ) : streaming ? (
        <div className="skeleton-progress timing-loading" role="status" aria-live="polite">
          <div className="skeleton-progress-label">正在推演这一步大运</div>
          <div className="skeleton-progress-sublabel">先给你整理这十年的主线、压力来源和后段转折。</div>
          <div className="skeleton-lines">
            <div className="skeleton-line skeleton-pulse" style={{ width: '92%' }} />
            <div className="skeleton-line skeleton-pulse" style={{ width: '88%' }} />
            <div className="skeleton-line skeleton-pulse" style={{ width: '84%' }} />
            <div className="skeleton-line skeleton-pulse" style={{ width: '72%' }} />
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

      {!error && !streaming && text && years.length > 0 ? (
        <LiunianChips dayunIdx={idx} years={years} />
      ) : null}
    </section>
  );
}

function LiunianChips({ dayunIdx, years }) {
  const cache = useAppStore((s) => s.liunianCache);
  const openKey = useAppStore((s) => s.liunianOpenKey);
  const setOpenKey = useAppStore((s) => s.setLiunianOpenKey);
  const dayunStreaming = useAppStore((s) => s.dayunStreaming);
  const liunianStreaming = useAppStore((s) => s.liunianStreaming);

  const onChipClick = (yearIndex) => {
    if (dayunStreaming || liunianStreaming) return;
    const key = `${dayunIdx}-${yearIndex}`;
    setOpenKey(openKey === key ? null : key);
  };

  const openYearIdx = openKey?.startsWith(`${dayunIdx}-`)
    ? Number(openKey.split('-')[1])
    : null;

  return (
    <div className="liunian-section">
      <div className="liunian-heading-row">
        <div className="liunian-heading">流 年</div>
        <div className="liunian-hint">再点具体年份，看这一运里的波动和转折。</div>
      </div>
      <div className="liunian-chip-grid">
        {years.map((year, yearIndex) => {
          const key = `${dayunIdx}-${yearIndex}`;
          const isCurrent = year.current;
          const isCached = !!cache[key];
          const isOpen = openKey === key;
          const isDisabled = (dayunStreaming || liunianStreaming) && !isOpen;
          return (
            <button
              type="button"
              key={yearIndex}
              className={
                'ln-chip liunian-chip'
                + (isCurrent ? ' ln-cur' : '')
                + (isCached ? ' ln-cached' : '')
                + (isOpen ? ' active' : '')
                + (isDisabled ? ' disabled' : '')
              }
              data-ref={`liunian.${year.year}`}
              onClick={() => onChipClick(yearIndex)}
              title={isDisabled ? '正在生成中，请稍候' : ''}
            >
              {year.year} {year.gz}
            </button>
          );
        })}
      </div>
      <div className="liunian-footnote">按公历年粗算（未切立春）</div>
      {openYearIdx !== null ? <LiunianBody dayunIdx={dayunIdx} yearIdx={openYearIdx} /> : null}
    </div>
  );
}
