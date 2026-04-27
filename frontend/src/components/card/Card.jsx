// frontend/src/components/card/Card.jsx
//
// Spec: PM/specs/03_卡片与分享系统.md v4.0
// 卡片正面只展示传播名 + 十神后缀 + 一句话 + 3 子标签 + 金句 + 品牌。
// 不出现「日主」「格局」「五行生克」「参天木·绽放型」等命理术语（质检 #4）。
import { forwardRef } from 'react';

export const Card = forwardRef(function Card({ card }, ref) {
  const totalTypes = '20';
  return (
    <article
      ref={ref}
      className="share-card"
      data-state={card.state}
      data-type-id={card.type_id}
      style={{ '--theme': card.theme_color }}
    >
      <header className="share-card-head">
        <span className="share-card-brand">有时</span>
        <span className="share-card-typeid">
          {card.type_id} <em>/ {totalTypes}</em>
        </span>
      </header>

      <figure className="share-card-illustration">
        <img src={card.illustration_url} alt={card.cosmic_name} />
      </figure>

      <h1 className="share-card-name">{card.cosmic_name}</h1>
      <p className="share-card-suffix">· {card.suffix} ·</p>

      <p className="share-card-oneliner">{card.one_liner}</p>

      <ul className="share-card-subtags">
        {card.subtags.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>

      <blockquote className="share-card-golden">
        <span className="share-card-quote">"</span>
        {card.golden_line}
      </blockquote>

      <footer className="share-card-foot">
        <span>有时</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
});
