import { Link } from 'react-router-dom';

// 错误展示组件 — 复用三种场景：
//   - inline：嵌在 Chat / Gua / Sections 等内容里，旁观可见
//   - toast：右上角浮层（AppShell 渲染 appNotice 时套这一变体）
//   - 任何带 cta 的 paywall 错误：在 Dismiss 按钮旁多一个跳 /pricing 的强调链接
export default function ErrorState({
  title,
  detail = '',
  retryable = false,
  onRetry,
  retryLabel = '再试一次',
  onDismiss,
  variant = 'inline',
  cta = null,    // { label: string, to: string } — 用 react-router 跳内部路径
}) {
  if (!title) return null;

  return (
    <div className={`error-state error-state-${variant} fade-in`} role="status" aria-live="polite">
      <div className="error-state-icon" aria-hidden="true">!</div>
      <div className="error-state-body">
        <div className="error-state-title">{title}</div>
        {detail ? (
          <details className="error-state-details">
            <summary>详情</summary>
            <div className="error-state-detail-text">{detail}</div>
          </details>
        ) : null}
        {(retryable && onRetry) || onDismiss || cta ? (
          <div className="error-state-actions">
            {cta && cta.to ? (
              // paywall 类错误的强调按钮，颜色跟主操作 (.btn-primary) 一致，
              // 点击跳到 /pricing 之后 toast 仍在屏幕上 — 让用户看完订阅
              // 方案返回时还能看到原始错误状态。Dismiss 按钮与之并列。
              <Link
                to={cta.to}
                className="btn-primary error-state-cta"
                onClick={() => onDismiss?.()}
              >{cta.label}</Link>
            ) : null}
            {retryable && onRetry ? (
              <button className="btn-inline" onClick={() => void onRetry()}>{retryLabel}</button>
            ) : null}
            {onDismiss ? (
              <button className="btn-inline error-state-dismiss" onClick={() => onDismiss()}>知道了</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
