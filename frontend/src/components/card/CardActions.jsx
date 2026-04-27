// frontend/src/components/card/CardActions.jsx
export function CardActions({ onSave, onShare, onInvitePair }) {
  return (
    <div className="card-actions">
      <button type="button" className="action-save" onClick={onSave}>
        💾 保存到相册
      </button>
      <button type="button" className="action-share" onClick={onShare}>
        🔗 分享
      </button>
      <button
        type="button"
        className="action-pair disabled"
        disabled
        title="合盘功能即将开放"
        onClick={onInvitePair}
      >
        💞 邀请合盘
      </button>
    </div>
  );
}
