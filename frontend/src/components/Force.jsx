import { useAppStore } from '../store/useAppStore';

export default function Force() {
  const force = useAppStore(s => s.force);
  return (
    <div className="force-grid">
      {force.map(f => {
        const w = Math.max(0, Math.min(10, f.val || 0)) * 10;
        return (
          <div className="force-row" key={f.name} data-ref={`shishen.${f.name}`}>
            <div className="force-name">{f.name}</div>
            <div className="force-bar-wrap">
              <div className="force-bar" style={{ width: w + '%' }} />
            </div>
            <div className="force-val">{(f.val || 0).toFixed?.(1) ?? f.val}</div>
          </div>
        );
      })}
    </div>
  );
}

function simplifyGuardNote(note) {
  // Strip LLM-facing instructions like "，分析时不能笼统称..."
  return String(note || '').replace(/[，,]\s*分析时.*/s, '').trim();
}

export function GuardList() {
  const guards = useAppStore(s => s.guards);
  return (
    <ul className="guard-list">
      {guards.map((g, i) => (
        <li key={i}>{simplifyGuardNote(g.note)}</li>
      ))}
    </ul>
  );
}
