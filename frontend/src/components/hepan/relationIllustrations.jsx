// frontend/src/components/hepan/relationIllustrations.jsx
//
// 6 占位 SVG 对应 6 大关系类型 (spec 04 §四). 抽象几何/概念可视化，
// 不是 AI 生成的成品图. 后续替换为 AI 图时只需把对应 case 换成 <img>.
//
// All SVGs use currentColor so the parent's --card-accent drives the hue.

function Tianzuo() {
  // 天作搭子 — 天干合: 两环交叠 (Vesica Piscis), 强调 "天然吸引"
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="38" cy="50" r="22" opacity="0.85" />
      <circle cx="62" cy="50" r="22" opacity="0.85" />
      <circle cx="50" cy="50" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Mirror() {
  // 镜像搭子 — 同天干: 对称镜像
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="50" y1="14" x2="50" y2="86" strokeDasharray="3 4" opacity="0.4" />
      <circle cx="32" cy="50" r="14" />
      <circle cx="68" cy="50" r="14" />
      <circle cx="32" cy="50" r="3" fill="currentColor" stroke="none" />
      <circle cx="68" cy="50" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Tongpin() {
  // 同频搭子 — 同五行异阴阳: 两条同步波形
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M14 38 Q 32 22, 50 38 T 86 38" />
      <path d="M14 62 Q 32 78, 50 62 T 86 62" opacity="0.8" />
    </svg>
  );
}

function Ziyang() {
  // 滋养搭子 — 相生: 单向能量流 (一方给一方)
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="28" cy="50" r="14" />
      <circle cx="72" cy="50" r="14" opacity="0.6" />
      <path d="M44 50 L 60 50" strokeWidth="2.6" />
      <path d="M54 44 L 60 50 L 54 56" strokeWidth="2.6" />
      <path d="M21 44 Q 28 38, 35 44" opacity="0.5" />
      <path d="M21 56 Q 28 62, 35 56" opacity="0.5" />
    </svg>
  );
}

function Huohua() {
  // 火花搭子 — 相克: 两点撞出火花
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="32" cy="56" r="11" />
      <circle cx="68" cy="56" r="11" />
      <g strokeWidth="2.5">
        <line x1="50" y1="40" x2="50" y2="20" />
        <line x1="40" y1="42" x2="32" y2="22" />
        <line x1="60" y1="42" x2="68" y2="22" />
        <line x1="44" y1="36" x2="38" y2="14" opacity="0.7" />
        <line x1="56" y1="36" x2="62" y2="14" opacity="0.7" />
      </g>
    </svg>
  );
}

function Hubu() {
  // 互补搭子 — 各有所长: 拼图 (concept: yin-yang style without circle)
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 50 H 42 V 36 a 6 6 0 0 1 12 0 V 50 H 78" strokeLinejoin="round" />
      <path d="M22 50 H 42 V 64 a 6 6 0 0 0 12 0 V 50 H 78" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

const REGISTRY = {
  '天作搭子': Tianzuo,
  '镜像搭子': Mirror,
  '同频搭子': Tongpin,
  '滋养搭子': Ziyang,
  '火花搭子': Huohua,
  '互补搭子': Hubu,
};

export function RelationIllustration({ category, className }) {
  const Cmp = REGISTRY[category] || Hubu;
  return (
    <div className={className} aria-hidden="true">
      <Cmp />
    </div>
  );
}
