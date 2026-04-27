import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useCardStore } from '../../store/useCardStore.js';
import { Card } from './Card.jsx';
import { CardActions } from './CardActions.jsx';
import { saveCardAsImage } from '../../lib/saveImage.js';
import { copyShareLink } from '../../lib/wxShare.js';
import { track } from '../../lib/analytics.js';

function buildShareUrl(card) {
  if (!card?.share_slug || typeof window === 'undefined') return '';
  return `${window.location.origin}/card/${card.share_slug}`;
}

export function CardWorkspace() {
  const cardRef = useRef(null);
  const currentId = useAppStore(s => s.currentId);
  const birthInfo = useAppStore(s => s.birthInfo);
  const meta = useAppStore(s => s.meta);
  const user = useAppStore(s => s.user);
  const card = useCardStore(s => s.card);
  const sourceChartId = useCardStore(s => s.sourceChartId);
  const loading = useCardStore(s => s.loading);
  const error = useCardStore(s => s.error);
  const generateFromBirthInfo = useCardStore(s => s.generateFromBirthInfo);
  const [notice, setNotice] = useState('');

  const activeCard = card && sourceChartId === currentId ? card : null;
  const canGenerate = !!birthInfo?.date && !!currentId;
  const shareUrl = buildShareUrl(activeCard);
  const archiveCode = activeCard?.type_id ? `命档 ${activeCard.type_id}` : '命档 --';

  async function handleGenerate() {
    setNotice('');
    await generateFromBirthInfo({
      chartId: currentId,
      birthInfo,
      nickname: user?.nickname || null,
    });
  }

  async function handleSave() {
    if (!cardRef.current || !activeCard) return;
    await saveCardAsImage(cardRef.current, {
      typeId: activeCard.type_id,
      cosmicName: activeCard.cosmic_name,
      onTrack: () => track('card_save', {
        type_id: activeCard.type_id,
        share_slug: activeCard.share_slug,
      }),
    });
  }

  async function handleShare() {
    if (!shareUrl || !activeCard) return;
    const copied = await copyShareLink(shareUrl, {
      clipboard: navigator.clipboard,
      notify: (message) => setNotice(message),
    });
    if (copied) {
      await track('card_share', {
        type_id: activeCard.type_id,
        channel: 'clipboard',
        share_slug: activeCard.share_slug,
      });
    }
  }

  return (
    <section className="card-workspace">
      <div className="card-workspace-head">
        <div>
          <div className="section-num" style={{ marginBottom: 10 }}>卡 片</div>
          <h2 className="serif">命盘摘录</h2>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!canGenerate || loading}
          onClick={handleGenerate}
        >
          {loading ? '生成中...' : activeCard ? '重新生成' : '生成卡片'}
        </button>
      </div>

      <div className="card-workspace-grid">
        <div className="card-document-stage">
          <div className="card-stage-rail" aria-hidden="true">
            <span>版式预览</span>
            <span>{archiveCode}</span>
          </div>
          <div className="card-stage-mat">
            {activeCard ? (
              <Card ref={cardRef} card={activeCard} />
            ) : (
              <article className="share-card share-card-empty">
                <div className="share-card-index" aria-hidden="true">
                  <span>{meta?.rizhuGan || meta?.rizhu?.[0] || '命'}</span>
                  <small>日主</small>
                </div>
                <header className="share-card-header">
                  <span>查八字</span>
                  <span>命档 --</span>
                </header>
                <div className="share-card-kicker">命盘摘录</div>
                <div className="share-card-title-row">
                  <div>
                    <h1 className="cosmic-name">{meta?.rizhu || '日主'}</h1>
                    <p className="suffix">{meta?.geju || '格局待定'}</p>
                  </div>
                  <span className="share-card-stamp">待定</span>
                </div>
                <p className="one-liner">一张从命盘里裁下来的纸面摘录，会落在这里。</p>
                <div className="share-card-empty-rules" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <footer>
                  <span>{birthInfo?.date || '未选择命盘'}</span>
                  <span>chabazi.com</span>
                </footer>
              </article>
            )}
          </div>
        </div>

        <aside className="card-side-panel">
          <div className="card-side-group">
            <div className="card-side-kicker">当前命盘</div>
            <dl className="card-facts">
              <div>
                <dt>日主</dt>
                <dd>{meta?.rizhu || '-'}</dd>
              </div>
              <div>
                <dt>格局</dt>
                <dd>{meta?.geju || '-'}</dd>
              </div>
              <div>
                <dt>生日</dt>
                <dd>{birthInfo?.date || '-'}</dd>
              </div>
            </dl>
          </div>

          <div className="card-side-kicker">操作</div>
          <CardActions
            disabled={!activeCard}
            onSave={handleSave}
            onShare={handleShare}
            onInvitePair={() => {}}
          />

          {shareUrl ? (
            <div className="share-link-box">{shareUrl}</div>
          ) : null}
          {notice ? <div className="card-notice">{notice}</div> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </aside>
      </div>
    </section>
  );
}
