// frontend/src/components/hepan/HepanCard.jsx
//
// Spec: PM/specs/03_卡片与分享系统.md §三 + 04b §四 展示结构.
//   头部: 双方编号 + ⚡🔋 状态徽章
//   昵称行: @A × @B
//   关系标签 (大字)
//   3 子标签 chip
//   双方角色对照 (A 角色 / B 角色)
//   描述 + 04b 修饰句
//   CTA 金句
//   底部: 有时 · youshi.app
//
// 视觉复用 share-card 设计语言, 使用 pair_theme_color (两侧主题色融合)。
import { forwardRef } from 'react';
import { RelationIllustration } from './relationIllustrations.jsx';

export const HepanCard = forwardRef(function HepanCard({ hepan }, ref) {
  const a = hepan.a;
  const b = hepan.b;
  const totalTypes = '20';

  return (
    <article
      ref={ref}
      className="hepan-card"
      data-category={hepan.category}
      style={{
        '--theme': hepan.pair_theme_color || '#b07a3c',
        '--theme-a': a?.theme_color || '#b07a3c',
        '--theme-b': b?.theme_color || '#b07a3c',
      }}
    >
      <header className="hepan-card-head">
        <span className="hepan-card-brand">有时合盘</span>
        <span className="hepan-card-typeids">
          <span className="hepan-side-mark hepan-side-a">{a?.type_id || '--'}</span>
          <span className="hepan-x">×</span>
          <span className="hepan-side-mark hepan-side-b">{b?.type_id || '--'}</span>
          <em>/ {totalTypes}</em>
        </span>
      </header>

      <div className="hepan-state-row">
        <span className="hepan-state-pair">{hepan.state_pair}</span>
        <span className="hepan-state-label">{hepan.state_pair_label}</span>
      </div>

      <div className="hepan-nicks">
        <span className="hepan-nick hepan-nick-a">@{a?.nickname || '邀请人'}</span>
        <span className="hepan-x">×</span>
        <span className="hepan-nick hepan-nick-b">@{b?.nickname || '你'}</span>
      </div>

      <RelationIllustration
        category={hepan.category}
        className="hepan-card-illustration"
      />

      <h1 className="hepan-card-label">{hepan.label}</h1>

      <ul className="hepan-card-subtags">
        {(hepan.subtags || []).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>

      <div className="hepan-roles">
        <div className="hepan-role hepan-role-a">
          <span className="hepan-role-cosmic">{a?.cosmic_name || '?'}</span>
          <span className="hepan-role-text">{a?.role}</span>
        </div>
        <div className="hepan-role-divider" aria-hidden="true" />
        <div className="hepan-role hepan-role-b">
          <span className="hepan-role-cosmic">{b?.cosmic_name || '?'}</span>
          <span className="hepan-role-text">{b?.role}</span>
        </div>
      </div>

      <div className="hepan-copy-stack">
        {hepan.description ? (
          <p className="hepan-description">{hepan.description}</p>
        ) : null}

        {hepan.modifier ? (
          <p className="hepan-modifier">{hepan.modifier}</p>
        ) : null}

        {hepan.cta ? (
          <blockquote className="hepan-cta">
            <span className="hepan-quote">"</span>{hepan.cta}
          </blockquote>
        ) : null}
      </div>

      <footer className="hepan-card-foot">
        <span>有时 · 合盘图鉴</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
});
