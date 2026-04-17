import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

export default function ConversationSwitcher({ disabled }) {
  const conversations = useAppStore(s => s.conversations) || [];
  const currentId = useAppStore(s => s.currentConversationId);
  const newConversation = useAppStore(s => s.newConversation);
  const switchConversation = useAppStore(s => s.switchConversation);
  const deleteConversation = useAppStore(s => s.deleteConversation);
  const renameConversation = useAppStore(s => s.renameConversation);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');
  const rootRef = useRef(null);

  const current = conversations.find(c => c.id === currentId);
  const currentLabel = current?.label || '默认对话';

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function onNew(e) {
    e?.stopPropagation?.();
    newConversation();
    setOpen(false);
  }

  function onSwitch(id) {
    if (id === currentId) { setOpen(false); return; }
    switchConversation(id);
    setOpen(false);
  }

  function onDelete(e, id) {
    e.stopPropagation();
    if (conversations.length <= 1) {
      // If last one, confirm stronger
      if (!confirm('这是最后一个对话，删除后会清空并开一个新的，确定吗？')) return;
    } else {
      if (!confirm('删除这个对话？不可恢复。')) return;
    }
    deleteConversation(id);
  }

  function startRename(e, conv) {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditingLabel(conv.label || '');
  }

  function commitRename() {
    if (editingId && editingLabel.trim()) {
      renameConversation(editingId, editingLabel.trim());
    }
    setEditingId(null);
    setEditingLabel('');
  }

  return (
    <div className="conv-switcher" ref={rootRef}>
      <button
        className="conv-trigger"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        title="切换对话"
      >
        <span className="conv-trigger-label">{currentLabel}</span>
        <span className="conv-trigger-caret">▾</span>
      </button>
      {open && (
        <div className="conv-dropdown">
          <button className="conv-new" onClick={onNew} disabled={disabled}>
            + 新建对话
          </button>
          <div className="conv-list">
            {conversations.slice().reverse().map(c => {
              const isActive = c.id === currentId;
              const isEditing = editingId === c.id;
              const preview = (c.messages || []).find(m => m.role === 'user' && typeof m.content === 'string')?.content || '（空）';
              return (
                <div
                  key={c.id}
                  className={'conv-item' + (isActive ? ' active' : '')}
                  onClick={() => !isEditing && onSwitch(c.id)}
                >
                  <div className="conv-item-main">
                    {isEditing ? (
                      <input
                        className="conv-rename-input"
                        autoFocus
                        value={editingLabel}
                        onChange={e => setEditingLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename();
                          else if (e.key === 'Escape') { setEditingId(null); setEditingLabel(''); }
                        }}
                        onBlur={commitRename}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <div className="conv-item-label">{c.label || '未命名'}</div>
                    )}
                    <div className="conv-item-preview">{String(preview).slice(0, 30)}</div>
                  </div>
                  <div className="conv-item-actions" onClick={e => e.stopPropagation()}>
                    <button className="conv-icon" title="重命名" onClick={(e) => startRename(e, c)}>✎</button>
                    <button className="conv-icon conv-icon-danger" title="删除" onClick={(e) => onDelete(e, c.id)}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
