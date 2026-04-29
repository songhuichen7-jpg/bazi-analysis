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

  const isPending = (status === 'idle' || status === 'loading') && !items.length;
  const hasContent = items.length > 0;

  return (
    <div className="classics-panel">
      <div className="panel-head classics-head">
        <div>
          <div className="section-num">古 籍 旁 证</div>
          {/* 副标题作为结果态文案, 只在数据真到达后才出现, 避免 loading 态误导 */}
          {hasContent ? (
            <div className="serif classics-title">对照这张盘的整体框架 —— 调候、格局、用神三条主线，具体细节留给对话里继续问</div>
          ) : null}
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

      {isPending ? (
        <div className="classics-loader" role="status" aria-label="正在翻检古籍">
          <div className="classics-loader-stage" aria-hidden="true">
            {['滴天髓', '穷通宝鉴', '三命通会', '渊海子平', '子平真诠'].map((title, i) => (
              <div key={title} className="classics-loader-book" style={{ '--i': i }}>
                <div className="classics-loader-page-left">{title}</div>
                <div className="classics-loader-page-back" />
                <div className="classics-loader-page classics-loader-page-2" />
                <div className="classics-loader-page classics-loader-page-1" />
              </div>
            ))}
          </div>
          <div className="classics-loader-text">翻检古籍…</div>
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
                  {item.plain ? (
                    <div className="classics-plain">{renderMd(item.plain)}</div>
                  ) : null}
                </div>
                {item.match ? (
                  <div className="classics-match">对照本盘：{item.match}</div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {items.length > DEFAULT_VISIBLE_ITEMS ? (
        <button className="btn-inline classics-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起旁证' : `展开更多旁证（还有 ${hiddenCount} 段）`}
        </button>
      ) : null}
    </div>
  );
}
