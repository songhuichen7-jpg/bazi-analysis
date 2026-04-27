// frontend/src/components/card/CardActions.jsx
export function CardActions({ onSave, onShare, onInvitePair, disabled = false }) {
  return (
    <div className="card-actions">
      <button type="button" className="action-save" disabled={disabled} onClick={onSave}>
        <span>01</span>
        导出图片
      </button>
      <button type="button" className="action-share" disabled={disabled} onClick={onShare}>
        <span>02</span>
        复制链接
      </button>
      <button
        type="button"
        className="action-pair disabled"
        disabled
        title="合盘功能即将开放"
        onClick={onInvitePair}
      >
        <span>03</span>
        邀请合盘
      </button>
    </div>
  );
}
