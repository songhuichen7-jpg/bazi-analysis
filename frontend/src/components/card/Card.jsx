// frontend/src/components/card/Card.jsx
import { forwardRef } from 'react';

const CATEGORIES = ['性格', '关系', '事业'];

export const Card = forwardRef(function Card({ card }, ref) {
  return (
    <article
      ref={ref}
      className="share-card"
      data-state={card.state}
      data-type-id={card.type_id}
      style={{ '--theme': card.theme_color }}
    >
      <div className="share-card-index" aria-hidden="true">
        <span>{card.day_stem}</span>
        <small>日主</small>
      </div>

      <header className="share-card-header">
        <span className="brand">查八字</span>
        <span className="type-id">命档 {card.type_id}</span>
      </header>

      <div className="share-card-kicker">命盘摘录</div>
      <div className="share-card-title-row">
        <div>
          <h1 className="cosmic-name">{card.cosmic_name}</h1>
          <p className="suffix">{card.suffix}</p>
        </div>
        <span className="share-card-stamp">{card.state}</span>
      </div>

      <div className="share-card-hero">
        <p className="one-liner">{card.one_liner}</p>
        <figure className="illustration">
          <img src={card.illustration_url} alt={card.cosmic_name} />
        </figure>
      </div>

      <div className="share-card-meta">
        <div>
          <span>日主</span>
          <strong>{card.day_stem}</strong>
        </div>
        <div>
          <span>格局</span>
          <strong>{card.ge_ju}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{card.state}</strong>
        </div>
        <div>
          <span>精度</span>
          <strong>{card.precision === '3-pillar' ? '三柱' : '四柱'}</strong>
        </div>
      </div>

      <ul className="subtags">
        {card.subtags.map((t, i) => (
          <li key={i}>
            <span className="subtag-index">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <span className="subtag-label">{CATEGORIES[i]}</span>
              <strong>{t}</strong>
            </div>
          </li>
        ))}
      </ul>

      <blockquote className="golden-line">{card.golden_line}</blockquote>

      <footer>
        <span>命不是判决书，是一张地形图</span>
        <span>chabazi.com</span>
      </footer>
    </article>
  );
});
