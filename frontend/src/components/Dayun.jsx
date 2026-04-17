import { useAppStore } from '../store/useAppStore';
import DayunStepBody from './DayunStepBody';

export default function Dayun() {
  const dayun = useAppStore(s => s.dayun);
  const openIdx = useAppStore(s => s.dayunOpenIdx);
  const setOpenIdx = useAppStore(s => s.setDayunOpenIdx);
  const streaming = useAppStore(s => s.dayunStreaming);

  const onClick = (i) => {
    if (streaming) return;
    setOpenIdx(openIdx === i ? null : i);
  };

  return (
    <div style={{ marginBottom:32 }}>
      <div className="section-num" style={{ marginBottom:12 }}>大 运（十年一步）</div>
      <div className="year-grid">
        {dayun.map((d, i) => {
          const isOpen = openIdx === i;
          const isDisabled = streaming && !isOpen;
          return (
            <div
              key={i}
              className={'ycell dayun-cell'
                + (d.current ? ' current' : '')
                + (isDisabled ? ' disabled' : '')}
              data-idx={i}
              data-ref={`dayun.${i}`}
              onClick={() => onClick(i)}
              title={isDisabled ? '正在生成中，请稍候' : ''}
              style={{ position:'relative' }}
            >
              <div className="age">{d.age}岁起</div>
              <div className="gz">{d.gz}</div>
              <div className="ss">{d.ss}</div>
              <div className="dayun-caret" style={{ position:'absolute', top:4, right:6, fontSize:10, opacity:.5 }}>
                {isOpen ? '▾' : '▸'}
              </div>
            </div>
          );
        })}
        {openIdx !== null && <DayunStepBody idx={openIdx} />}
      </div>
    </div>
  );
}
