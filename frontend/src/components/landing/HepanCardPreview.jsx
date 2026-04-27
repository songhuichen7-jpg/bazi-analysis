// frontend/src/components/landing/HepanCardPreview.jsx
//
// 静态合盘卡预览 (甲己合·撑腰搭子·双绽放) — 给 landing 第 03 段使用。
// 不依赖 hepan API，纯展示。复用 hepan-card 视觉语言但收紧字号给 landing 容器。
export function HepanCardPreview() {
  return (
    <article
      className="landing-hepan-preview"
      style={{
        '--theme-a': '#2D6A4F',
        '--theme-b': '#D4A574',
        '--theme': '#80875F',
      }}
    >
      <header className="landing-hepan-head">
        <span className="landing-hepan-brand">有时合盘</span>
        <span className="landing-hepan-typeids">
          <span style={{ color: 'var(--theme-a)' }}>01</span>
          <span className="landing-hepan-x">×</span>
          <span style={{ color: 'var(--theme-b)' }}>11</span>
          <em> / 20</em>
        </span>
      </header>
      <div className="landing-hepan-state">
        <span className="landing-hepan-state-icon">⚡⚡</span>
        <span>全力释放期</span>
      </div>
      <div className="landing-hepan-nicks">
        <span style={{ color: 'var(--theme-a)' }}>@小满</span>
        <span className="landing-hepan-x">×</span>
        <span style={{ color: 'var(--theme-b)' }}>@阿青</span>
      </div>
      <div className="landing-hepan-illust" aria-hidden="true">
        <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="38" cy="50" r="22" opacity="0.85" />
          <circle cx="62" cy="50" r="22" opacity="0.85" />
          <circle cx="50" cy="50" r="3" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <h3 className="landing-hepan-label">撑腰搭子</h3>
      <ul className="landing-hepan-subtags">
        <li>你顶我兜</li>
        <li>急的慢的</li>
        <li>吵完还在</li>
      </ul>
      <p className="landing-hepan-desc">
        你往前冲的时候从不回头，因为知道后面有人给你留着饭。
      </p>
      <blockquote className="landing-hepan-cta">
        <span className="landing-hepan-quote">"</span>你冲，我等你回来吃饭。
      </blockquote>
      <footer className="landing-hepan-foot">
        <span>有时 · 合盘图鉴</span>
        <span>youshi.app</span>
      </footer>
    </article>
  );
}
