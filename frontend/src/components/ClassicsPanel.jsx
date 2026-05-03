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

// 五本古籍及其书页内容（翻页时显示）
const BOOKS = [
  {
    title: '滴天髓',
    color: '#8B4513',
    pages: [
      { left: '天道', right: '欲识三元万法宗\n先观帝载与神功\n\n——任铁樵注' },
      { left: '地道', right: '坤元合德机缄通\n五气偏全定吉凶\n\n阴阳顺逆之说' },
      { left: '人道', right: '戴天覆地人为贵\n顺则吉兮凶则悖\n\n知命者，不知命无以为君子' },
    ],
  },
  {
    title: '穷通宝鉴',
    color: '#654321',
    pages: [
      { left: '五行总论', right: '木\n春木\n夏木\n秋木\n冬木\n\n——余春台辑' },
      { left: '论甲木', right: '甲木参天，脱胎要火\n春不容金，秋不容土\n火炽乘龙，水宕骑虎' },
      { left: '论乙木', right: '乙木根荄种得深\n只宜阳地不宜阴\n\n浮木从水，依藤附木' },
    ],
  },
  {
    title: '三命通会',
    color: '#704214',
    pages: [
      { left: '卷一', right: '原造化之始\n论五行生成\n\n——万民英撰' },
      { left: '论天干', right: '甲乙属木\n丙丁属火\n戊己属土\n庚辛属金\n壬癸属水' },
      { left: '论地支', right: '子丑寅卯\n辰巳午未\n申酉戌亥\n十二地支藏干' },
    ],
  },
  {
    title: '渊海子平',
    color: '#5D4E37',
    pages: [
      { left: '卷一', right: '论五行所生之始\n论天干地支所出\n\n——徐子平著' },
      { left: '论十干', right: '甲丙戊庚壬属阳\n乙丁己辛癸属阴\n\n阳干刚健，阴干柔顺' },
      { left: '论十二支', right: '子为阳水，丑为己土\n寅为阳木，卯为阴木\n辰戌丑未四墓库' },
    ],
  },
  {
    title: '子平真诠',
    color: '#6B4423',
    pages: [
      { left: '论用神', right: '八字用神，专求月令\n以日干配月令地支\n而生克不同，格局分焉' },
      { left: '论格局', right: '官以克身，虽与七煞有别\n然受克则一，岂可以为我用\n故须伤官以制之' },
      { left: '论运', right: '命之格局，成于八字\n运喜扶助，忌冲破\n\n——沈孝瞻原著' },
    ],
  },
];

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
            {BOOKS.map((book, i) => (
              <div
                key={book.title}
                className="classics-loader-book"
                style={{ '--i': i, '--book-color': book.color }}
              >
                {/* 书脊 */}
                <div className="classics-loader-spine" />
                {/* 左页（封面/固定页） */}
                <div className="classics-loader-page-left">
                  <div className="page-content-vertical">
                    <span className="book-title">{book.title}</span>
                  </div>
                </div>
                {/* 右页区域 */}
                <div className="classics-loader-right-section">
                  {/* 底层页面（最内页） */}
                  <div className="classics-loader-page-back">
                    <div className="page-lines" />
                  </div>
                  {/* 可翻动的页 */}
                  {book.pages.map((page, pageIdx) => (
                    <div
                      key={pageIdx}
                      className={`classics-loader-page classics-loader-page-${pageIdx + 1}`}
                    >
                      <div className="classics-loader-page-shadow" />
                      <div className="page-inner">
                        <div className="page-left-text">{page.left}</div>
                        <div className="page-right-text">{page.right}</div>
                        <div className="page-texture" />
                      </div>
                    </div>
                  ))}
                </div>
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
