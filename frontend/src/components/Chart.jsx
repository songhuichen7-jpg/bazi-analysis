import { useAppStore } from '../store/useAppStore';

export default function Chart() {
  const paipan = useAppStore(s => s.paipan);
  if (!paipan?.sizhu) return null;

  const labels = [['年','year'],['月','month'],['日','day'],['时','hour']];
  return (
    <div className="pillars">
      {labels.map(([lab, key]) => {
        const raw = paipan.sizhu[key];
        const unknown = raw == null; // null/undefined → 时柱未知
        const gz = unknown ? '——' : (raw || '  ');
        const ssRaw = key === 'day' ? '日主' : (paipan.shishen?.[key] || '');
        const ss = unknown ? '未知' : ssRaw;
        const cg = unknown ? '' : (paipan.cangGan?.[key] || []).join(' · ');
        return (
          <div className="pillar" key={key}>
            <div className="section-num" style={{ marginBottom:8 }}>{lab}</div>
            <div className="pillar-cell">
              <div className="pillar-gan">
                <div className="pillar-char" data-ref={unknown ? undefined : `pillar.${key}.gan`}>{gz[0]}</div>
                <div className="pillar-ss" data-ref={!unknown && ss && ss !== '日主' ? `shishen.${ss}` : undefined}>{ss}</div>
              </div>
              <div className="pillar-zhi">
                <div className="pillar-char" data-ref={unknown ? undefined : `pillar.${key}.zhi`}>{gz[1]}</div>
                <div className="pillar-cg">{cg}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
