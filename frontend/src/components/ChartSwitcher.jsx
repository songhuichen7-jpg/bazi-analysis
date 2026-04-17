import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { clearSession } from '../lib/persistence';
import { MAX_CHARTS } from '../lib/constants';

export default function ChartSwitcher({ onNewChart }) {
  const charts = useAppStore(s => s.charts);
  const currentId = useAppStore(s => s.currentId);
  const switchChart = useAppStore(s => s.switchChart);
  const deleteChart = useAppStore(s => s.deleteChart);
  const renameChart = useAppStore(s => s.renameChart);
  const setAppNotice = useAppStore(s => s.setAppNotice);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = charts[currentId];
  const sortedIds = Object.keys(charts).sort((a, b) => (charts[b].createdAt||0) - (charts[a].createdAt||0));
  const atLimit = sortedIds.length >= MAX_CHARTS;

  function startRename(id) {
    setEditingId(id);
    setEditVal(charts[id]?.label || '');
  }
  function commitRename(id) {
    if (editVal.trim()) renameChart(id, editVal.trim());
    setEditingId(null);
  }

  function onDelete(id, e) {
    e.stopPropagation();
    if (!confirm(`删除"${charts[id]?.label}"？`)) return;
    if (Object.keys(charts).length === 1) clearSession({ onError: setAppNotice });
    deleteChart(id);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <button
        className="chart-switcher-btn"
        onClick={() => setOpen(v => !v)}
        style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, cursor:'pointer',
                 background:'none', border:'1px solid var(--line)', padding:'4px 10px',
                 minHeight:44, color:'var(--ink)' }}
      >
        <span style={{ maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {current?.label || '—'}
        </span>
        <span style={{ opacity:.5 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{
          position:'absolute', top:'100%', right:0, zIndex:100,
          background:'#fff', border:'1px solid var(--line)', minWidth:220,
          maxHeight:'60vh', overflowY:'auto',
          boxShadow:'0 4px 16px rgba(0,0,0,.1)',
        }}>
          {/* + 新建 */}
          <div
            onClick={() => {
              if (atLimit) {
                setAppNotice({
                  title: `最多先留 ${MAX_CHARTS} 份命盘`,
                  detail: '请先删除一份，再新建新的命盘。',
                  retryable: false,
                });
                return;
              }
              setOpen(false);
              onNewChart?.();
            }}
            style={{
              padding:'12px 16px', borderBottom:'1px solid var(--line)',
              cursor:'pointer', fontSize:13, color: atLimit ? '#999' : 'var(--ink)',
              display:'flex', alignItems:'center', gap:8, minHeight:44,
            }}
          >
            <span>＋ 新建命盘</span>
            {atLimit && <span style={{ fontSize:11, color:'#c66' }}>（已达上限 {MAX_CHARTS}）</span>}
          </div>

          {sortedIds.map(id => {
            const c = charts[id];
            const isCur = id === currentId;
            return (
              <div
                key={id}
                onClick={() => { if (editingId !== id) { switchChart(id); setOpen(false); } }}
                style={{
                  padding:'10px 14px', cursor:'pointer', minHeight:44,
                  background: isCur ? '#f7f5f0' : '#fff',
                  borderBottom:'1px solid var(--line)',
                  display:'flex', alignItems:'center', gap:8,
                }}
              >
                {editingId === id ? (
                  <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitRename(id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename(id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{ flex:1, border:'1px solid var(--line)', padding:'2px 6px', fontSize:13 }}
                  />
                ) : (
                  <>
                    <div style={{ flex:1, overflow:'hidden' }}>
                      <div style={{ fontSize:13, fontWeight: isCur ? 600 : 400,
                                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {isCur && <span style={{ marginRight:5 }}>●</span>}{c.label}
                      </div>
                      <div style={{ fontSize:10, color:'var(--mute)', marginTop:2 }}>
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString('zh-CN') : ''}
                      </div>
                    </div>
                    <button
                      onDoubleClick={e => { e.stopPropagation(); startRename(id); }}
                      onClick={e => { e.stopPropagation(); startRename(id); }}
                      title="双击重命名"
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, opacity:.4, padding:'2px 4px', minHeight:28 }}
                    >✎</button>
                    <button
                      onClick={e => onDelete(id, e)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, opacity:.4, padding:'2px 4px', color:'#c66', minHeight:28 }}
                    >×</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
