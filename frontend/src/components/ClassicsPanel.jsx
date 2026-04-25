import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { renderMd } from './RefChip';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';
import { buildClassicsDisplayItem } from '../lib/classics';

const DEFAULT_VISIBLE_ITEMS = 2;

export default function ClassicsPanel() {
  const classics = useAppStore((s) => s.classics);
  const currentId = useAppStore((s) => s.currentId);
  const loadClassics = useAppStore((s) => s.loadClassics);

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [currentId]);

  const status = classics?.status || 'idle';
  const items = Array.isArray(classics?.items) ? classics.items : [];
  const error = classics?.lastError || null;
  const uiError = error ? friendlyError(error, 'classics') : null;
  const visibleItems = expanded ? items : items.slice(0, DEFAULT_VISIBLE_ITEMS);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="classics-panel">
      <div className="panel-head classics-head">
        <div>
          <div className="section-num">古 籍 原 文</div>
          <div className="serif classics-title">古书里与你命盘最贴近的原文</div>
        </div>
        {status === 'error' && currentId && uiError?.retryable ? (
          <button className="btn-inline" onClick={() => loadClassics(currentId)}>再试一次</button>
        ) : null}
      </div>

      {status === 'error' ? (
        <ErrorState
          title={uiError.title}
          detail={uiError.detail}
          retryable={uiError.retryable}
          onRetry={uiError.retryable && currentId ? () => loadClassics(currentId) : undefined}
        />
      ) : null}

      {(status === 'idle' || status === 'loading') && !items.length ? (
        <div className="classics-pending-note" role="status">
          正在检索与你命盘最相关的古籍原文…
        </div>
      ) : null}

      {visibleItems.length ? (
        <div className="classics-list fade-in">
          {visibleItems.map((rawItem, index) => {
            const item = buildClassicsDisplayItem(rawItem);
            return (
              <article className="classics-item" key={`${rawItem.source}-${rawItem.scope}-${index}`}>
                <div className="classics-meta">
                  <div className="classics-bookline">
                    <div className="classics-book serif">{item.book}</div>
                    {item.chapter ? <div className="classics-chapter serif">{item.chapter}</div> : null}
                  </div>
                  {item.section ? <div className="classics-scope">{item.section}</div> : null}
                </div>
                <div className="classics-text">
                  {item.paragraphs.map((paragraph, paragraphIndex) => (
                    <p className="classics-paragraph" key={paragraphIndex}>
                      {renderMd(paragraph)}
                    </p>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {items.length > DEFAULT_VISIBLE_ITEMS ? (
        <button className="btn-inline classics-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起原文' : `展开更多原文（还有 ${hiddenCount} 段）`}
        </button>
      ) : null}
    </div>
  );
}
