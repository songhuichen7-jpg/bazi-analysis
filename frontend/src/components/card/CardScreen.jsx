// frontend/src/components/card/CardScreen.jsx
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useCardStore } from '../../store/useCardStore.js';
import { Card } from './Card.jsx';
import { CardActions } from './CardActions.jsx';
import { CardSkeleton } from './CardSkeleton.jsx';
import { UpgradeCTA } from './UpgradeCTA.jsx';
import { saveCardAsImage } from '../../lib/saveImage.js';
import { configureWxShare, copyShareLink, isWeChatBrowser } from '../../lib/wxShare.js';
import { track } from '../../lib/analytics.js';

export function CardScreen() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const { card, preview, loading, error, loadPreview } = useCardStore();
  const cardRef = useRef(null);

  useEffect(() => {
    if (!card && slug) loadPreview(slug);
  }, [slug, card, loadPreview]);

  useEffect(() => {
    if (!card) return;
    track('card_view', {
      type_id: card.type_id,
      share_slug: card.share_slug,
      from: searchParams.get('from') || 'direct',
    });
    configureWxShare(card, {
      onShare: (channel) => track('card_share', {
        type_id: card.type_id,
        channel,
        share_slug: card.share_slug,
      }),
    }).catch(() => { /* silent */ });
  }, [card, searchParams]);

  if (loading) return <CardSkeleton />;
  if (error) return <div className="form-error" role="alert">{error}</div>;

  if (card) {
    const handleSave = async () => {
      if (!cardRef.current) return;
      await saveCardAsImage(cardRef.current, {
        typeId: card.type_id,
        cosmicName: card.cosmic_name,
        onTrack: () => track('card_save', {
          type_id: card.type_id,
          share_slug: card.share_slug,
        }),
      });
    };

    const handleShare = async () => {
      if (isWeChatBrowser()) {
        alert('点击右上角「...」选择分享到朋友圈或好友');
      } else {
        const copied = await copyShareLink(window.location.href, {
          clipboard: navigator.clipboard,
          notify: window.alert.bind(window),
        });
        if (!copied) return;

        await track('card_share', {
          type_id: card.type_id,
          channel: 'clipboard',
          share_slug: card.share_slug,
        });
      }
    };

    return (
      <main className="card-screen">
        <Card ref={cardRef} card={card} />
        <CardActions
          onSave={handleSave}
          onShare={handleShare}
          onInvitePair={() => alert('合盘功能即将开放')}
        />
        <UpgradeCTA typeId={card.type_id} />
      </main>
    );
  }

  if (preview) {
    return (
      <main className="card-preview">
        <p className="preview-notice">
          这是{preview.nickname ? ` @${preview.nickname} ` : '一位朋友'}的命盘卡
        </p>
        <img src={preview.illustration_url} alt={preview.cosmic_name} />
        <h2>{preview.cosmic_name}</h2>
        <p>· {preview.suffix} ·</p>
        <Link to="/" className="primary-cta">查看我的类型 →</Link>
      </main>
    );
  }

  return <CardSkeleton />;
}
