import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useCardStore } from '../../store/useCardStore.js';
import { Card } from './Card.jsx';
import { CardActions } from './CardActions.jsx';
import { saveCardAsImage } from '../../lib/saveImage.js';
import { copyShareLink } from '../../lib/wxShare.js';
import { postHepanInvite } from '../../lib/hepanApi.js';
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
  const [inviting, setInviting] = useState(false);

  const activeCard = card && sourceChartId === currentId ? card : null;
  const canGenerate = !!birthInfo?.date && !!currentId;
  const shareUrl = buildShareUrl(activeCard);
  const archiveCode = activeCard?.type_id ? `命档 ${activeCard.type_id}` : '命档待生成';

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

  async function handleInvitePair() {
    if (!birthInfo?.date || inviting) return;
    setNotice('');
    setInviting(true);
    try {
      const [y, m, d] = birthInfo.date.split('-').map(s => parseInt(s, 10));
      const h = Number.isFinite(birthInfo.hour) ? birthInfo.hour : -1;
      const data = await postHepanInvite({
        birth: { year: y, month: m, day: d, hour: h, minute: birthInfo.minute || 0 },
        nickname: user?.nickname || null,
      });
      const inviteUrl = `${window.location.origin}/hepan/${data.slug}?from=invite`;
      const copied = await copyShareLink(inviteUrl, {
        clipboard: navigator.clipboard,
        notify: (message) => setNotice(message),
      });
      if (copied) {
        setNotice(`合盘邀请已复制：发给好友打开就能合盘。`);
        await track('hepan_invite_create', {
          slug: data.slug,
          a_type_id: data.a?.type_id,
        });
      }
    } catch (e) {
      setNotice(e.message || '邀请生成失败，再试一次。');
    } finally {
      setInviting(false);
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
                <header className="share-card-head">
                  <span className="share-card-brand">有时</span>
                  <span className="share-card-typeid">待定 <em>/ 20</em></span>
                </header>
                <figure className="share-card-illustration share-card-illustration-empty" aria-hidden="true" />
                <h1 className="share-card-name">待生成</h1>
                <p className="share-card-suffix">· 等一张命盘摘录 ·</p>
                <p className="share-card-oneliner">点右上角『生成卡片』，3 秒看到你的人格卡片。</p>
                <ul className="share-card-subtags share-card-subtags-empty" aria-hidden="true">
                  <li />
                  <li />
                  <li />
                </ul>
                <blockquote className="share-card-golden share-card-golden-empty" aria-hidden="true" />
                <footer className="share-card-foot">
                  <span>有时</span>
                  <span>youshi.app</span>
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
            inviting={inviting}
            onSave={handleSave}
            onShare={handleShare}
            onInvitePair={handleInvitePair}
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
