/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { renderMd } from '../lib/richText.jsx';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';
import { buildClassicsDisplayItem } from '../lib/classics';

const DEFAULT_VISIBLE_ITEMS = 2;
// 古籍 retrieval + LLM 抛光串起来比较慢；超过这个阈值给用户一个
// "还在翻 / 可重试"的兜底，不要让翻书 loader 永远转。
const SLOW_HINT_AFTER_MS = 22000;

export default function ClassicsPanel() {
  const classics = useAppStore((s) => s.classics);
  const currentId = useAppStore((s) => s.currentId);
  const loadClassics = useAppStore((s) => s.loadClassics);

  const [expanded, setExpanded] = useState(false);
  // 当 isPending 进入第 22s 时切到 true，文案 + 重试出现
  const [isSlow, setIsSlow] = useState(false);
  const pendingStartRef = useRef(null);

  useEffect(() => {
    setExpanded(false);
    setIsSlow(false);
    pendingStartRef.current = null;
  }, [currentId]);

  const status = classics?.status || 'idle';
  const items = Array.isArray(classics?.items) ? classics.items : [];
  const error = classics?.lastError || null;
  const uiError = error ? friendlyError(error, 'classics') : null;
  const visibleItems = expanded ? items : items.slice(0, DEFAULT_VISIBLE_ITEMS);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  const isPending = (status === 'idle' || status === 'loading') && !items.length;
  const hasContent = items.length > 0;

  useEffect(() => {
    if (!isPending) {
      pendingStartRef.current = null;
      setIsSlow(false);
      return undefined;
    }
    if (pendingStartRef.current == null) pendingStartRef.current = Date.now();
    const elapsed = Date.now() - pendingStartRef.current;
    const remaining = Math.max(0, SLOW_HINT_AFTER_MS - elapsed);
    if (remaining === 0) {
      setIsSlow(true);
      return undefined;
    }
    const t = setTimeout(() => setIsSlow(true), remaining);
    return () => clearTimeout(t);
  }, [isPending, currentId]);

  return (
    <div className="classics-panel">
      <div className="panel-head classics-head">
        <div>
          <div className="section-num">古 籍 旁 证</div>
          {/* 副标题作为结果态文案, 只在数据真到达后才出现, 避免 loading 态误导 */}
          {hasContent ? (
            <div className="serif classics-title">整体框架 —— 调候、格局、用神</div>
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
          {/* 文案在 22s 后切到"还在翻"耐心安抚版 — 只是慢，不是出错，
           * 不需要给重试按钮（重试只会再等一次相同时长）。真正的失败
           * 走上面的 ErrorState 分支，那里才有"再试一次"。 */}
          <div className="classics-loader-text">
            {isSlow ? '古籍较厚，再翻一会儿' : '正在翻阅古籍'}
          </div>
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
