// frontend/src/components/card/UpgradeCTA.jsx
import { Link } from 'react-router-dom';

export function UpgradeCTA({ typeId }) {
  return (
    <aside className="upgrade-cta">
      <p className="hook">🔒 你的命盘还有更多未解密...</p>
      <p className="detail">4 份深度报告 + AI 命盘对话</p>
      <Link to={`/app?type_id=${typeId}`} className="cta-link">
        注册解锁 →
      </Link>
    </aside>
  );
}
