// frontend/src/components/landing/HepanCardPreview.jsx
//
// 静态合盘卡预览 (甲己合·撑腰搭子·双绽放) — 给 landing 第 03 段使用。
// 不依赖 hepan API，纯展示。复用 hepan-card 视觉语言但收紧字号给 landing 容器。
import { cardIllustrationSrc } from '../../lib/cardArt.js';

export function HepanCardPreview() {
  const category = '天作搭子';
  const aIllustration = cardIllustrationSrc('01-chunsun.png');
  const bIllustration = cardIllustrationSrc('08-xiaoyedeng.png');

  return (
    <article
      className="landing-hepan-preview"
      style={{
        '--theme-a': '#2D6A4F',
        '--theme-b': '#2B6CB0',
        '--theme': '#2C6B80',
      }}
    >
      <header className="landing-hepan-head">
        <span className="landing-hepan-brand">有时合盘</span>
        <span className="landing-hepan-typeids">
          <span style={{ color: 'var(--theme-a)' }}>01</span>
          <span className="landing-hepan-x">×</span>
          <span style={{ color: 'var(--theme-b)' }}>08</span>
          <em> / 20</em>
        </span>
      </header>
      <section className="landing-hepan-hero">
        <div className="landing-hepan-illust landing-hepan-pair-art" aria-hidden="true">
          <div className="landing-hepan-pair-line" />
          <div className="landing-hepan-pair-orbit" />
          <div className="landing-hepan-pair-side landing-hepan-pair-side-a">
            <img src={aIllustration} alt="" loading="lazy" decoding="async" />
          </div>
          <div className="landing-hepan-pair-side landing-hepan-pair-side-b">
            <img src={bIllustration} alt="" loading="lazy" decoding="async" />
          </div>
          <span className="landing-hepan-pair-spark" />
        </div>
        <div className="landing-hepan-hero-copy">
          <div className="landing-hepan-state">
            <span>绽放 × 蓄力</span>
            <span>{category}</span>
          </div>
          <h3 className="landing-hepan-label">撑腰搭子</h3>
          <div className="landing-hepan-nicks">
            <span style={{ color: 'var(--theme-a)' }}>@小满</span>
            <span className="landing-hepan-x">×</span>
            <span style={{ color: 'var(--theme-b)' }}>@阿青</span>
          </div>
        </div>
      </section>
      <ul className="landing-hepan-subtags">
        <li>一个往前长</li>
        <li>一个替你亮</li>
        <li>靠近后更稳</li>
      </ul>
      <p className="landing-hepan-desc">
        你们不是轰轰烈烈地相似，而是一个负责向上，一个负责照亮脚边。
      </p>
      <blockquote className="landing-hepan-cta">
        <span className="landing-hepan-quote">"</span>你冲，我在后面把灯留着。
      </blockquote>
      <footer className="landing-hepan-foot">
        <span>PAIR EDITION</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
}
