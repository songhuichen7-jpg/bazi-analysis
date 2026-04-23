// frontend/src/components/card/Card.jsx
import { forwardRef } from 'react';

const CATEGORIES = ['性格', '关系', '事业'];

export const Card = forwardRef(function Card({ card }, ref) {
  return (
    <article
      ref={ref}
      className="card"
      data-state={card.state}
      data-type-id={card.type_id}
      style={{ '--theme': card.theme_color }}
    >
      <header>
        <span className="brand">查八字</span>
        <span className="type-id">{card.type_id} / 20</span>
      </header>

      <figure className="illustration">
        <img src={card.illustration_url} alt={card.cosmic_name} />
      </figure>

      <h1 className="cosmic-name">{card.cosmic_name}</h1>
      <p className="suffix">· {card.suffix} ·</p>
      <p className="one-liner">{card.one_liner}</p>

      <ul className="subtags">
        {card.subtags.map((t, i) => (
          <li key={i} data-category={CATEGORIES[i]}>{t}</li>
        ))}
      </ul>

      <blockquote className="golden-line">" {card.golden_line}</blockquote>

      <footer>
        <span>查八字 · chabazi.com</span>
      </footer>
    </article>
  );
});
