import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

export default function ConversationSwitcher({ disabled }) {
  const conversations = useAppStore(s => s.conversations) || [];
  const currentId = useAppStore(s => s.currentConversationId);
  const currentChartId = useAppStore(s => s.currentId);
  const newConversationOnServer = useAppStore(s => s.newConversationOnServer);
  const selectConversation = useAppStore(s => s.selectConversation);
  const deleteConversationOnServer = useAppStore(s => s.deleteConversationOnServer);
  const renameConversationOnServer = useAppStore(s => s.renameConversationOnServer);

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

  async function onNew(e) {
    e?.stopPropagation?.();
    if (!currentChartId) return;
    const count = conversations.length;
    await newConversationOnServer(currentChartId, `对话 ${count + 1}`);
    setOpen(false);
  }

  async function onSwitch(id) {
    if (id === currentId) { setOpen(false); return; }
    await selectConversation(id);
    setOpen(false);
  }

  async function onDelete(e, id) {
    e.stopPropagation();
    if (!currentChartId) return;
    if (conversations.length <= 1) {
      if (!confirm('这是最后一个对话，删除后会开一个新的，确定吗？')) return;
    } else {
      if (!confirm('删除这个对话？30 天内可在「已删除」里恢复。')) return;
    }
    await deleteConversationOnServer(currentChartId, id);
  }

  function startRename(e, conv) {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditingLabel(conv.label || '');
  }

  async function commitRename() {
    if (editingId && editingLabel.trim()) {
      await renameConversationOnServer(editingId, editingLabel.trim());
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
              const preview = '';   // server items don't ship preview; out of scope for Plan 6
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
