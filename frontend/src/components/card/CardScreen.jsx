// frontend/src/components/card/CardScreen.jsx
import { useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCardStore } from '../../store/useCardStore.js';
import { Card } from './Card.jsx';
import { CardActions } from './CardActions.jsx';
import { CardSkeleton } from './CardSkeleton.jsx';
import { UpgradeCTA } from './UpgradeCTA.jsx';

export function CardScreen() {
  const { slug } = useParams();
  const { card, preview, loading, error, loadPreview } = useCardStore();
  const cardRef = useRef(null);

  // If arrived via share link without an in-memory card, load preview
  useEffect(() => {
    if (!card && slug) loadPreview(slug);
  }, [slug, card, loadPreview]);

  if (loading) return <CardSkeleton />;
  if (error) return <div className="form-error" role="alert">{error}</div>;

  // Full card: user just submitted their own birth data
  if (card) {
    return (
      <main className="card-screen">
        <Card ref={cardRef} card={card} />
        <CardActions
          onSave={() => { /* Wired in Task 31 */ }}
          onShare={() => { /* Wired in Task 31 */ }}
          onInvitePair={() => alert('合盘功能即将开放')}
        />
        <UpgradeCTA typeId={card.type_id} />
      </main>
    );
  }

  // Share-link preview: partial card, CTA to try own
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
