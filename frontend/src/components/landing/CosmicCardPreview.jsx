// frontend/src/components/landing/CosmicCardPreview.jsx
//
// 静态卡片预览组件，专给 landing 页用。复用 share-card 的视觉语言但
// 不依赖 cardStore / API — landing 上展示的是预设示例。
//
// size:
//   'hero'  — 240px 宽 (Hero 区主角)
//   'small' — 自适应 flex (Gallery 4 张并排)

const ILLUSTRATIONS = {
  bamboo: () => (
    <svg viewBox="0 0 100 100" fill="none">
      <path d="M50 86 L50 36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 56 Q35 40 50 38 Q65 40 70 56" fill="currentColor" opacity="0.9" />
      <path d="M40 60 Q45 48 55 50" stroke="#fff" strokeWidth="1.5" fill="none" opacity="0.6" />
    </svg>
  ),
  samoye: () => (
    <svg viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="58" r="22" fill="#fffefa" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="42" cy="55" r="2.5" fill="#1f1610" />
      <circle cx="58" cy="55" r="2.5" fill="#1f1610" />
      <ellipse cx="50" cy="68" rx="5" ry="3" fill="#1f1610" />
      <path d="M28 42 Q24 30 32 26 Q38 30 36 42" fill="#fffefa" stroke="currentColor" strokeWidth="1.5" />
      <path d="M72 42 Q76 30 68 26 Q62 30 64 42" fill="#fffefa" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  lamp: () => (
    <svg viewBox="0 0 100 100" fill="none">
      <ellipse cx="50" cy="32" rx="22" ry="14" fill="currentColor" stroke="currentColor" strokeWidth="2" />
      <rect x="38" y="38" width="24" height="32" rx="3" fill="#fff5d6" stroke="currentColor" strokeWidth="2" />
      <rect x="32" y="68" width="36" height="8" rx="2" fill="currentColor" />
      <rect x="44" y="76" width="12" height="6" fill="currentColor" />
    </svg>
  ),
  puffer: () => (
    <svg viewBox="0 0 100 100" fill="none">
      <ellipse cx="50" cy="56" rx="26" ry="20" fill="#fff" stroke="currentColor" strokeWidth="2" />
      <circle cx="42" cy="50" r="2" fill="#1f1610" />
      <circle cx="58" cy="50" r="2" fill="#1f1610" />
      <path d="M46 60 Q50 64 54 60" stroke="#1f1610" strokeWidth="1.5" fill="none" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="30" y1="30" x2="35" y2="38" />
        <line x1="20" y1="40" x2="28" y2="44" />
        <line x1="70" y1="30" x2="65" y2="38" />
        <line x1="80" y1="40" x2="72" y2="44" />
      </g>
    </svg>
  ),
  dandelion: () => (
    <svg viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="14" fill="#fffefa" stroke="currentColor" strokeWidth="1.5" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M50 36 L50 18" /><path d="M50 64 L50 82" />
        <path d="M36 50 L18 50" /><path d="M64 50 L82 50" />
        <path d="M40 40 L28 28" /><path d="M60 40 L72 28" />
        <path d="M40 60 L28 72" /><path d="M60 60 L72 72" />
      </g>
    </svg>
  ),
};

export function CosmicCardPreview({
  id,
  name,
  suffix,
  oneLiner,
  subtags,
  golden,
  theme,
  illustKind,
  size = 'small',
}) {
  const Illust = ILLUSTRATIONS[illustKind] || ILLUSTRATIONS.bamboo;
  return (
    <article
      className={`landing-card-preview landing-card-${size}`}
      style={{ '--theme': theme }}
    >
      <header className="landing-card-head">
        <span>有时</span>
        <span className="landing-card-typeid">
          {id} <em>/ 20</em>
        </span>
      </header>
      <div className="landing-card-illustration" aria-hidden="true">
        <Illust />
      </div>
      <h3 className="landing-card-name">{name}</h3>
      <p className="landing-card-suffix">· {suffix} ·</p>
      <p className="landing-card-oneliner">{oneLiner}</p>
      {subtags && subtags.length === 3 ? (
        <ul className="landing-card-subtags">
          {subtags.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      ) : null}
      {golden ? (
        <blockquote className="landing-card-golden">
          <span className="landing-card-quote">"</span>{golden}
        </blockquote>
      ) : null}
      <footer className="landing-card-foot">
        <span>有时</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
}
