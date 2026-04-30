// frontend/src/components/landing/LandingHome.jsx
//
// 访客介绍页 — 编辑设计 / 留白主导 / 大字宋体 / 卡片作为"展品"。
//
// 一页式克制叙事：
//   1. Hero          命 · 盘 · 读 + 一个理性的命理工具 + 命盘档案双框 mockup
//   2. 二十种人格    给你的命盘一个名字 + 4 张卡片图鉴
//   3. 关系          你和 TA 是哪种搭子 + 合盘卡 + chip
//   4. 凭据          古籍真本 + 4 个数字
//   5. 时序收尾      万事有时 + CTA
//
// 设计语言: 超大宋体衬线 (Songti SC) + 黑/暖灰为主 + 暖米底 + 大留白.
// 卡片本身保留产品标志性的暖色, 但页面 chrome 几乎是黑白灰.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore.js';
import { CosmicCardPreview } from './CosmicCardPreview.jsx';
import { HepanCardPreview } from './HepanCardPreview.jsx';

// Hero mockup 轮播：左边一柱日干 + 日支 + 格局，右边配一句"有意思"的问题。
// 每条 scene 都展示产品的一种用法，让访客一眼看到能问什么。
const HERO_SCENES = [
  { gan: '丁', zhi: '酉', geju: '食神格', question: '用一首歌形容我这盘。' },
  { gan: '庚', zhi: '午', geju: '阳刃格', question: '用一部电影形容这种性格。' },
  { gan: '甲', zhi: '子', geju: '正印格', question: '推荐一本书让我读懂自己。' },
  { gan: '戊', zhi: '寅', geju: '偏官格', question: '今年的桃花会怎么开？' },
  { gan: '乙', zhi: '巳', geju: '伤官格', question: '我和 TA 是哪种搭子？' },
];
const HERO_SCENE_INTERVAL_MS = 4200;
const HERO_FADE_MS = 460;

const SHOWCASE_TYPES = [
  { id: '01', name: '春笋', suffix: '反脆弱型', oneLiner: '越压越往上长', theme: '#2D6A4F', illust: 'bamboo' },
  { id: '03', name: '萨摩耶', suffix: '天生享乐家', oneLiner: '看着随和，底线焊死', theme: '#52B788', illust: 'samoye' },
  { id: '08', name: '小夜灯', suffix: '灵感深潜者', oneLiner: '光不大，但一直亮着', theme: '#2B6CB0', illust: 'lamp' },
  { id: '20', name: '蒲公英', suffix: '风一吹就上路', oneLiner: '轻得像没事', theme: '#4AC4C0', illust: 'dandelion' },
];

const RELATION_CATEGORIES = [
  { emoji: '🤝', label: '天作' },
  { emoji: '🌱', label: '滋养' },
  { emoji: '🔥', label: '火花' },
  { emoji: '🪞', label: '镜像' },
  { emoji: '🔄', label: '同频' },
];

const TRUST_METRICS = [
  { value: '20', label: '种基础人格' },
  { value: '200', label: '组人格细标签' },
  { value: '5', label: '部古籍真本' },
  { value: '210', label: '种关系组合' },
];

function Eyebrow({ children }) {
  return <p className="landing-eyebrow">{children}</p>;
}

export function LandingHome() {
  const navigate = useNavigate();
  const enterFromLanding = useAppStore(s => s.enterFromLanding);

  // Hero 轮播：next idx 由定时器推进；displayIdx 通过 out → swap → in
  // 三步切换，避免 key remount 那种"硬切"。phase 控制 CSS 类。
  const [nextIdx, setNextIdx] = useState(0);
  const [displayIdx, setDisplayIdx] = useState(0);
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    const id = setInterval(
      () => setNextIdx(i => (i + 1) % HERO_SCENES.length),
      HERO_SCENE_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (nextIdx === displayIdx) return;
    setPhase('out');
    const t = setTimeout(() => {
      setDisplayIdx(nextIdx);
      setPhase('in');
    }, HERO_FADE_MS);
    return () => clearTimeout(t);
  }, [nextIdx, displayIdx]);

  const scene = HERO_SCENES[displayIdx];

  // CTA: 先按用户态决定下一屏 (auth/input/shell), 再跳进 /app —— 跳过
  // AppShell 内部的旧 'landing' state, 直接到生日表单 / 登录 / 主壳.
  async function handleStart() {
    await enterFromLanding();
    navigate('/app');
  }

  return (
    <main className="landing-home">

      {/* ── 1. Hero ────────────────────────────────────────────────── */}
      <section className="landing-hero">
        <Eyebrow>有时 · 命有其时</Eyebrow>

        <h1 className="landing-display-title">
          一个<span className="landing-title-muted">理性</span>的命理工具
        </h1>

        <p className="landing-display-sub">
          万事都有它出现的时刻，<br />
          人也在自己的时序里慢慢展开。
        </p>

        <div className="landing-cta-row">
          <button type="button" className="landing-cta-primary" onClick={handleStart}>开始排盘 →</button>
        </div>

        {/* 命盘档案 + 对话 mockup — 双面板按 HERO_SCENES 同步轮播 */}
        <div className="landing-hero-mockup">
          <div className="landing-mockup-panel">
            <div className="landing-mockup-kicker">命 盘 档 案</div>
            <div className="landing-mockup-pillars" data-phase={phase}>
              <div className="landing-mockup-cell" style={{ '--cell-delay': '0ms' }}>{scene.gan}</div>
              <div className="landing-mockup-cell" style={{ '--cell-delay': '70ms' }}>{scene.zhi}</div>
              <div className="landing-mockup-cell landing-mockup-wide" style={{ '--cell-delay': '140ms' }}>{scene.geju}</div>
            </div>
            <div className="landing-mockup-lines" aria-hidden="true">
              <span /><span /><span style={{ width: '64%' }} />
            </div>
          </div>
          <div className="landing-mockup-panel">
            <div className="landing-mockup-kicker">对 话</div>
            <p className="landing-mockup-bubble" data-phase={phase}>
              {scene.question}
            </p>
          </div>
        </div>
      </section>

      {/* ── 2. 二十种人格 ──────────────────────────────────────────── */}
      <section className="landing-section">
        <Eyebrow>二十种命盘人格</Eyebrow>
        <h2 className="landing-section-title">
          给你的命盘<br />
          一个名字
        </h2>
        <p className="landing-section-sub">
          参天木 → 春笋。烛灯火 → 小夜灯。<br />
          二十种意象，让命理结构变成可以被记住的人。
        </p>

        <div id="gallery" className="landing-gallery-row">
          {SHOWCASE_TYPES.map((t, i) => (
            <div
              key={t.id}
              className={`landing-gallery-item ${i % 2 === 1 ? 'landing-gallery-offset' : ''}`}
            >
              <CosmicCardPreview
                id={t.id}
                name={t.name}
                suffix={t.suffix}
                oneLiner={t.oneLiner}
                theme={t.theme}
                illustKind={t.illust}
                size="small"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. 关系 ─────────────────────────────────────────────────── */}
      <section className="landing-section">
        <Eyebrow>你和 TA 的关系</Eyebrow>
        <h2 className="landing-section-title">
          不是合不合<br />
          是哪种搭子
        </h2>

        <div className="landing-hepan-grid">
          <div className="landing-hepan-text">
            <p>
              天作 · 滋养 · 火花 · 镜像 · 同频 ——<br />
              六大类、二一〇种关系。<br />
              每一对，都有自己的相处方式。
            </p>
            <div className="landing-relation-chips">
              {RELATION_CATEGORIES.map(c => (
                <span key={c.label} className="landing-relation-chip">
                  {c.emoji}<span>{c.label}</span>
                </span>
              ))}
            </div>
          </div>
          <HepanCardPreview />
        </div>
      </section>

      {/* ── 4. 凭据 ─────────────────────────────────────────────────── */}
      <section className="landing-section">
        <Eyebrow>凭 据</Eyebrow>
        <h2 className="landing-section-title">
          每一句古人说，<br />
          都查得到出处
        </h2>
        <p className="landing-section-sub">
          穷通宝鉴 · 子平真诠 · 滴天髓 ·<br />
          三命通会 · 渊海子平
        </p>

        <div className="landing-trust-grid">
          {TRUST_METRICS.map(m => (
            <div key={m.value} className="landing-metric">
              <div className="landing-metric-value">{m.value}</div>
              <div className="landing-metric-label">{m.label}</div>
            </div>
          ))}
        </div>

        <p className="landing-trust-note">
          来自哪本书、哪一章，都说清楚。
        </p>
      </section>

      {/* ── 5. 时序收尾 — 纯诗意收束, 无重复 CTA ────────────────────── */}
      <section className="landing-final">
        <Eyebrow>有 · 时</Eyebrow>
        <h2 className="landing-final-title">
          有时，<br />
          和自己的时间，<br />
          坐下来谈一谈。
        </h2>
        <p className="landing-final-foot">有时 · youshi.app</p>
      </section>

    </main>
  );
}
