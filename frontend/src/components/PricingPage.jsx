import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { me as fetchMe } from '../lib/api';

// 三档参数硬编码 — 这是产品事实，不该在 runtime 拉。后端 core/quotas.py
// 是真相之源；这里把它转译成可阅读的中文卖点；改动后别忘了同步。
const TIERS = [
  {
    plan: 'lite',
    name: '免费体验',
    price: '¥0',
    cadence: '永久免费',
    rows: [
      ['对话', '30 / 天'],
      ['起卦', '3 / 天'],
      ['命盘', '2 张'],
      ['古籍 / 大运 / 流年', '基础'],
    ],
    note: '让你先把产品摸熟。',
  },
  {
    plan: 'standard',
    name: '标准',
    price: '¥19',
    cadence: '/ 月',
    rows: [
      ['对话', '150 / 天 (5×)'],
      ['起卦', '15 / 天'],
      ['命盘', '5 张'],
      ['古籍 / 大运 / 流年', '完整'],
    ],
    note: '一个家庭、几张盘聊得起。',
    highlighted: false,
  },
  {
    plan: 'pro',
    name: 'Pro',
    price: '¥69',
    cadence: '/ 月',
    rows: [
      ['对话', '600 / 天 (20×)'],
      ['起卦', '60 / 天'],
      ['命盘', '20 张'],
      ['模型档位', '高级 + 优先队列'],
    ],
    note: '重度使用 / 命理实践者。',
    highlighted: true,
  },
];

export default function PricingPage() {
  const navigate = useNavigate();
  const [currentPlan, setCurrentPlan] = useState(null);

  // 用户登录态下高亮当前档位 — 让 paywall 跳过来的用户一眼看到自己在哪。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchMe();
        if (!cancelled && result?.user?.plan) setCurrentPlan(result.user.plan);
      } catch { /* 未登录就让 currentPlan 留空 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  function goBack() {
    const idx = typeof window !== 'undefined' ? window.history.state?.idx : undefined;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  }

  return (
    <div className="screen active pricing-screen">
      <div className="pricing-wrap">
        <button className="legal-back" type="button" onClick={goBack}>← 返回</button>
        <div className="legal-eyebrow">套 餐 · 用 量</div>
        <h1 className="serif legal-title">三档方案</h1>
        <p className="pricing-lede">
          三档共享同一个产品 — 区别只在你能用得多少。<br />
          有时不卖功能，卖的是<em>陪你想清楚</em>这件事的容量。
        </p>

        <div className="pricing-grid">
          {TIERS.map((tier) => (
            <PricingCard
              key={tier.plan}
              tier={tier}
              isCurrent={currentPlan === tier.plan}
            />
          ))}
        </div>

        <div className="pricing-foot">
          <p>
            内测期间没有在线支付通道。需要升级 / 降级请发邮件至{' '}
            <a className="user-center-foot-link" href="mailto:songhuichen7@gmail.com?subject=有时%20·%20升级订阅">
              songhuichen7@gmail.com
            </a>
            ，作者人工开通。
          </p>
          <p className="muted">
            订阅按自然月计费；用量按北京日界（每天 0 点）重置。
          </p>
        </div>
      </div>
    </div>
  );
}

function PricingCard({ tier, isCurrent }) {
  const isLite = tier.plan === 'lite';
  return (
    <div className={
      'pricing-card'
      + (tier.highlighted ? ' is-highlighted' : '')
      + (isCurrent ? ' is-current' : '')
    }>
      <div className="pricing-card-name">{tier.name}</div>
      <div className="pricing-card-price">
        <span className="pricing-card-amount serif">{tier.price}</span>
        <span className="pricing-card-cadence muted">{tier.cadence}</span>
      </div>
      <ul className="pricing-card-rows">
        {tier.rows.map(([k, v]) => (
          <li key={k}>
            <span className="pricing-card-row-key muted">{k}</span>
            <span className="pricing-card-row-val">{v}</span>
          </li>
        ))}
      </ul>
      <div className="pricing-card-note muted">{tier.note}</div>
      <div className="pricing-card-cta">
        {isCurrent ? (
          <button type="button" className="btn-inline" disabled>当前所在档位</button>
        ) : isLite ? (
          <span className="muted" style={{ fontSize: 12 }}>无需开通</span>
        ) : (
          <a
            className="btn-primary"
            href={`mailto:songhuichen7@gmail.com?subject=有时%20·%20开通%20${tier.name}`}
          >
            联系作者升级
          </a>
        )}
      </div>
    </div>
  );
}
