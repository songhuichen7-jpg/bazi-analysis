// frontend/src/components/landing/LandingHome.jsx
//
// 访客介绍页 — 编辑设计 / 留白主导 / 大字宋体 / 卡片作为"展品"。
//
// 一页式克制叙事：
//   1. Hero          命 · 盘 · 读 + 一个理性的命理工具 + 命盘档案双框 mockup
//   2. 二十种人格    给你的命盘一个名字 + 4 张卡片图鉴
//   3. 好玩问法      电影 / 音乐 / 起卦卡片
//   4. 关系          你和 TA 是哪种搭子 + 合盘卡 + chip
//   5. 凭据          古籍真本 + 4 个数字
//   6. 时序收尾      万事有时 + CTA
//
// 设计语言: 超大宋体衬线 (Songti SC) + 黑/暖灰为主 + 暖米底 + 大留白.
// 卡片本身保留产品标志性的暖色, 但页面 chrome 几乎是黑白灰.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore.js';
import { cardIllustrationSrc } from '../../lib/cardArt.js';
import { MediaCard } from '../MediaCard.jsx';
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

// 二十种人格 —— 完整目录与 server/app/data/cards/types.json 对齐，
// 用于 hero 下面那条"无限左右轮播"。每条只用：传播名 + 短 tag +
// 主题色 + 真实插画文件名（来自 /static/cards/illustrations/）。
const PERSONA_POOL = [
  { id: '01', name: '春笋',   suffix: '参天型', theme: '#2D6A4F', illustration: '01-chunsun.png' },
  { id: '02', name: '橡子',   suffix: '扎根型', theme: '#1B4332', illustration: '02-xiangzi.png' },
  { id: '03', name: '萨摩耶', suffix: '绕指型', theme: '#52B788', illustration: '03-samoye.png' },
  { id: '04', name: '含羞草', suffix: '攀藤型', theme: '#2D7D53', illustration: '04-hanxiucao.png' },
  { id: '05', name: '火烈鸟', suffix: '自燃型', theme: '#F5A623', illustration: '05-huolieniao.png' },
  { id: '06', name: '热可可', suffix: '蓄光型', theme: '#C47D0E', illustration: '06-rekeke.png' },
  { id: '07', name: '萤火虫', suffix: '熔铸型', theme: '#4A9BE8', illustration: '07-yinghuochong.png' },
  { id: '08', name: '小夜灯', suffix: '守焰型', theme: '#2B6CB0', illustration: '08-xiaoyedeng.png' },
  { id: '09', name: '大象',   suffix: '砥柱型', theme: '#A0785A', illustration: '09-daxiang.png' },
  { id: '10', name: '松鼠',   suffix: '蓄土型', theme: '#7A5438', illustration: '10-songshu.png' },
  { id: '11', name: '多肉',   suffix: '慢养型', theme: '#D4A574', illustration: '11-duorou.png' },
  { id: '12', name: '树懒',   suffix: '稳田型', theme: '#A67C4E', illustration: '12-shulan.png' },
  { id: '13', name: '刺猬',   suffix: '锋刃型', theme: '#4A7BA8', illustration: '13-ciwei.png' },
  { id: '14', name: '河豚',   suffix: '藏锋型', theme: '#2C5282', illustration: '14-hetun.png' },
  { id: '15', name: '琉璃',   suffix: '通透型', theme: '#9B7AC4', illustration: '15-liuli.png' },
  { id: '16', name: '猫',     suffix: '柔水型', theme: '#6B4E99', illustration: '16-mao.png' },
  { id: '17', name: '水獭',   suffix: '游溪型', theme: '#1A759F', illustration: '17-shuita.png' },
  { id: '18', name: '章鱼',   suffix: '深潜型', theme: '#0D4F72', illustration: '18-zhangyu.png' },
  { id: '19', name: '水母',   suffix: '随流型', theme: '#4AC4C0', illustration: '19-shuimu.png' },
  { id: '20', name: '蒲公英', suffix: '播种型', theme: '#2A8F8C', illustration: '20-pugongying.png' },
];

const RELATION_CATEGORIES = [
  { mark: '01', label: '天作' },
  { mark: '02', label: '滋养' },
  { mark: '03', label: '火花' },
  { mark: '04', label: '镜像' },
  { mark: '05', label: '同频' },
];

const TRUST_METRICS = [
  { value: '20', label: '种基础人格' },
  { value: '200', label: '组人格细标签' },
  { value: '5', label: '部古籍真本' },
  { value: '210', label: '种关系组合' },
];

const PLAY_CARDS = [
  {
    kind: 'movie',
    mark: 'MOVIE',
    prompt: '用一部电影形容我这盘。',
    title: '花样年华',
    subtitle: '王家卫',
    cta: '豆瓣搜索',
    note: '克制、绕远，但情绪一直在场。',
  },
  {
    kind: 'song',
    mark: 'MUSIC',
    prompt: '用一首歌形容我的关系模式。',
    title: '慢慢喜欢你',
    subtitle: '莫文蔚',
    cta: '网易云搜索',
    note: '不是一眼上头，是越相处越有温度。',
  },
  {
    kind: 'gua',
    mark: 'GUA',
    prompt: '这件事现在要不要推进？',
    symbol: '䷷',
    title: '旅',
    subtitle: '上离 · 下艮',
    guaci: '小亨，旅贞吉。',
    note: '可以走，但每一步都要明慎。',
  },
  {
    kind: 'weather',
    mark: 'WEATHER',
    prompt: '用一种天气形容我现在的状态。',
    title: '雨后初雾',
    subtitle: '慢下来，光会回来',
    note: '不是低气压，是身体在重新调光。',
  },
  {
    // 注意 kind: 'scent' — MediaCard 的 atmosphere asset map 用的是 scent，
    // 之前 landing 用 'perfume' 不会被 pickAtmosphereAsset 命中。
    kind: 'scent',
    mark: 'SCENT',
    prompt: '用一种气味形容我这盘。',
    title: '冷茶白花',
    subtitle: '雨后石板 · 淡淡焚香',
    note: '清冷，但靠近之后有很柔软的余温。',
  },
  {
    kind: 'book',
    mark: 'BOOK',
    prompt: '推荐一本书让我读懂自己。',
    title: '传道书',
    subtitle: '凡事都有定时',
    note: '「有时」二字也是从这一段里取来。',
  },
];

function Eyebrow({ children }) {
  return <p className="landing-eyebrow">{children}</p>;
}

function MiniGuaCard({ card }) {
  return (
    <div className="landing-play-gua">
      <div className="landing-play-gua-header">
        <span className="landing-play-gua-symbol">{card.symbol}</span>
        <div>
          <div className="landing-play-gua-name">{card.title}</div>
          <div className="landing-play-gua-sub">{card.subtitle}</div>
        </div>
      </div>
      <div className="landing-play-gua-text">
        <b>卦辞：</b>{card.guaci}
      </div>
    </div>
  );
}

function PlayCardPreview({ card }) {
  return (
    <article className={`landing-play-card landing-play-card-${card.kind}`}>
      <div className="landing-play-card-head">
        <span>{card.mark}</span>
        <span>有时</span>
      </div>
      <p className="landing-play-prompt">「{card.prompt}」</p>
      <div className="landing-play-object">
        {card.kind === 'gua' ? (
          <MiniGuaCard card={card} />
        ) : (
          <MediaCard kind={card.kind} title={card.title} subtitle={card.subtitle} />
        )}
      </div>
      <p className="landing-play-note">{card.note}</p>
    </article>
  );
}

// 二十种人格 — 无限左右轮播。轨道把 PERSONA_POOL 拼两遍 → translate
// 到 -50% 后回到原点，看不到接缝。每个 item 用 nth-child 拿到一个
// "lane"（0..4），不同 lane 走不同的 Y-bob / 旋转 / 入场延迟，整列
// 不再是一条直线，而是"五条略微错位的呼吸线"。中心 spotlight 由
// CSS 浮层负责，让经过中央的人格感官上更亮、更近。
function PersonaMarquee() {
  // 拼两遍以实现无缝循环；React 不参与动画，全交给 CSS。
  const looped = [...PERSONA_POOL, ...PERSONA_POOL];
  return (
    <div className="landing-persona-marquee" aria-hidden="true">
      {/* 中央 spotlight: 顶层一个柔光带，给经过中心的项视觉权重 */}
      <div className="landing-persona-spotlight" />
      <div className="landing-persona-track">
        {looped.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            className="landing-persona-item"
            style={{
              '--persona-accent': p.theme,
              // lane 0..4 — 每张图属于一条"高度线"，错峰 Y-bob
              '--lane': (i % 5),
            }}
          >
            <div className="landing-persona-halo">
              <div className="landing-persona-illust">
                <img
                  src={cardIllustrationSrc(p.illustration)}
                  alt={p.name}
                  loading="lazy"
                  draggable="false"
                />
              </div>
            </div>
            <div className="landing-persona-name serif">{p.name}</div>
            <div className="landing-persona-suffix">{p.suffix}</div>
          </div>
        ))}
      </div>
    </div>
  );
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

        <div className="landing-cta-stack">
          <div className="landing-cta-row">
            <button type="button" className="landing-cta-primary" onClick={handleStart}>开始排盘 →</button>
          </div>
          {/* 副链接 — 给"想先看看再决定"的访客一条不打扰的明路。
           * 锚到 #gallery (二十种人格那一节),让他们顺着滚下去把后面
           * 介绍都看完。不点的人完全不被打扰。
           * 用 smooth scroll 而不是默认硬跳,跟整体沉静调性匹配;
           * reduced-motion 偏好时退回 instant。 */}
          <a
            href="#gallery"
            className="landing-cta-secondary"
            onClick={(e) => {
              const target = document.getElementById('gallery');
              if (!target) return;
              e.preventDefault();
              const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
              target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            }}
          >
            <span>先看看「有时」是什么</span>
            <span className="landing-cta-secondary-arrow" aria-hidden="true">↓</span>
          </a>
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

        <div id="gallery">
          <PersonaMarquee />
        </div>
      </section>

      {/* ── 3. 好玩问法 ─────────────────────────────────────────────── */}
      <section className="landing-section landing-play-section">
        <Eyebrow>对话里的小展品</Eyebrow>
        <h2 className="landing-section-title">
          把命盘问成<br />
          电影、音乐、天气、气味、书和一卦
        </h2>
        <p className="landing-section-sub">
          它不只给结论，也会把你的性格、关系和当下问题，<br />
          变成一张可以收藏的回答卡片。
        </p>

        <div className="landing-play-grid">
          {PLAY_CARDS.map(card => (
            <PlayCardPreview key={card.kind} card={card} />
          ))}
        </div>
      </section>

      {/* ── 4. 关系 ─────────────────────────────────────────────────── */}
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
              五大类、二一〇种关系变体。<br />
              每一对，都有自己的相处方式。
            </p>
            <div className="landing-relation-chips">
              {RELATION_CATEGORIES.map(c => (
                <span key={c.label} className="landing-relation-chip">
                  <em>{c.mark}</em><span>{c.label}</span>
                </span>
              ))}
            </div>
          </div>
          <HepanCardPreview />
        </div>
      </section>

      {/* ── 5. 凭据 ─────────────────────────────────────────────────── */}
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

      {/* ── 6. 时序收尾 — 纯诗意收束, 无重复 CTA ────────────────────── */}
      <section className="landing-final">
        <Eyebrow>有 · 时</Eyebrow>
        <h2 className="landing-final-title">
          有时，<br />
          和自己的时间，<br />
          坐下来谈一谈。
        </h2>
        <div className="landing-final-cta">
          <button type="button" className="landing-cta-quiet" onClick={handleStart}>
            开始排盘 →
          </button>
        </div>
        <footer className="landing-final-footer">
          <div className="landing-final-brand">
            <span>有时</span>
            <p>一个理性的命盘与关系解读工具</p>
          </div>
          <nav className="landing-final-links" aria-label="页脚链接">
            <Link to="/legal/about">关于</Link>
            <Link to="/legal/privacy">隐私政策</Link>
            <Link to="/legal/terms">服务条款</Link>
            <a href="mailto:songhuichen7@gmail.com?subject=有时%20·%20反馈">反馈</a>
          </nav>
        </footer>
      </section>

    </main>
  );
}
