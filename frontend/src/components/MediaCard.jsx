import { useEffect, useState } from 'react';
import {
  buildSearchUrl,
  fetchMediaCover,
  MEDIA_LABELS,
  pickAtmosphereAsset,
} from '../lib/mediaCard';

const KIND_ICON = {
  song: '♪',
  movie: '🎬',
  book: '📖',
  weather: '☁',
  scent: '◌',
};

const KIND_FALLBACK_GRADIENT = {
  song:  ['#3a4d6f', '#7b9ec5'],   // 冷海蓝
  movie: ['#5a3e2c', '#a87a4a'],   // 暖木色
  book:  ['#4d4a36', '#a89c66'],   // 沙金
  weather: ['#314452', '#94a8a8'],  // 雨后灰蓝
  scent: ['#473c32', '#b7a179'],    // 冷茶木香
};

export function MediaCard({ kind, title, subtitle }) {
  const safeTitle = String(title || '').trim();
  const safeSub = String(subtitle || '').trim();
  const [cover, setCover] = useState(null);
  const { url, label } = safeTitle
    ? buildSearchUrl(kind, safeTitle, safeSub)
    : { url: '', label: '' };
  const isSemanticCard = kind === 'weather' || kind === 'scent';
  const isAtmosphereCard = kind === 'weather' || kind === 'scent' || kind === 'book';

  useEffect(() => {
    if (!safeTitle || isSemanticCard) {
      return undefined;
    }
    let cancelled = false;
    fetchMediaCover(kind, safeTitle, safeSub).then((data) => {
      if (!cancelled) setCover(data || null);
    });
    return () => { cancelled = true; };
  }, [kind, safeTitle, safeSub, isSemanticCard]);

  if (!safeTitle) return null;

  // For movies: when the LLM gave no director (subtitle empty) but TMDB
  // returned a release year, surface that as the subtitle instead so the
  // card has more than just a one-line title.
  const displaySub = safeSub || (cover?.year ? cover.year : '');

  const colors = cover?.dominantHex && cover?.secondaryHex
    ? [cover.dominantHex, cover.secondaryHex]
    : (KIND_FALLBACK_GRADIENT[kind] || KIND_FALLBACK_GRADIENT.song);
  const atmosphereAsset = isAtmosphereCard
    ? pickAtmosphereAsset(kind, safeTitle, displaySub)
    : null;

  const cardStyle = {
    background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`,
    ...(atmosphereAsset ? { '--media-atmosphere': `url("${atmosphereAsset.src}")` } : {}),
  };
  const CardTag = url ? 'a' : 'div';
  const cardLinkProps = url
    ? { href: url, target: '_blank', rel: 'noopener noreferrer' }
    : { role: 'group' };

  return (
    <CardTag
      {...cardLinkProps}
      className={`media-card media-card-${kind}`}
      style={cardStyle}
      onClick={(e) => { if (!url) e.preventDefault(); }}
    >
      <div className="media-card-thumb" aria-hidden="true">
        {atmosphereAsset?.src ? (
          <img src={atmosphereAsset.src} alt="" loading="lazy" />
        ) : cover?.url ? (
          <img src={cover.url} alt="" loading="lazy" />
        ) : (
          <span className="media-card-icon">{KIND_ICON[kind] || '·'}</span>
        )}
      </div>
      <div className="media-card-meta">
        <div className="media-card-title">{safeTitle}</div>
        {displaySub ? <div className="media-card-sub">{displaySub}</div> : null}
      </div>
      <div className="media-card-cta" aria-hidden="true">
        <span className="media-card-cta-label">{label || `${MEDIA_LABELS[kind] || ''}搜索`}</span>
        <span className="media-card-cta-arrow">↗</span>
      </div>
    </CardTag>
  );
}
