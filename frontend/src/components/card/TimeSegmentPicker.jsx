// frontend/src/components/card/TimeSegmentPicker.jsx
export const TIME_SEGMENTS = [
  { label: '凌晨', range: '00:00 - 04:59', hour: 2 },
  { label: '早上', range: '05:00 - 08:59', hour: 6 },
  { label: '上午', range: '09:00 - 12:59', hour: 10 },
  { label: '下午', range: '13:00 - 16:59', hour: 14 },
  { label: '傍晚', range: '17:00 - 20:59', hour: 18 },
  { label: '深夜', range: '21:00 - 23:59', hour: 22 },
];

export function TimeSegmentPicker({ selected, onSelect }) {
  return (
    <div className="time-segment-picker" role="radiogroup">
      {TIME_SEGMENTS.map(seg => (
        <button
          key={seg.label}
          type="button"
          role="radio"
          aria-checked={selected === seg.label}
          className={selected === seg.label ? 'is-selected' : ''}
          onClick={() => onSelect(seg.label)}
        >
          <span className="label">{seg.label}</span>
          <span className="range">{seg.range}</span>
        </button>
      ))}
    </div>
  );
}
