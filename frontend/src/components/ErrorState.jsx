export default function ErrorState({
  title,
  detail = '',
  retryable = false,
  onRetry,
  retryLabel = '再试一次',
  onDismiss,
  variant = 'inline',
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
        {(retryable && onRetry) || onDismiss ? (
          <div className="error-state-actions">
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
