// frontend/src/components/card/BirthForm.jsx
import { useState } from 'react';
import { useCardStore } from '../../store/useCardStore.js';
import { TimeSegmentPicker } from './TimeSegmentPicker.jsx';

export function validateBirthInput({ year, month, day }) {
  if (!year || !month || !day) return { ok: false, error: '请填写完整的年份/月份/日期' };
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return { ok: false, error: '年份范围 1900-2100' };
  if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, error: '月份无效' };
  const daysInMonth = new Date(y, m, 0).getDate();
  if (!Number.isInteger(d) || d < 1 || d > daysInMonth) return { ok: false, error: `${y}年${m}月无此日期` };
  return { ok: true };
}

export function BirthForm({ onSubmit }) {
  const { birth, nickname, setBirthField, setNickname, selectTimeSegment, clearTimeSegment } = useCardStore();
  const [formError, setFormError] = useState(null);
  const [showTime, setShowTime] = useState(false);
  const [timeMode, setTimeMode] = useState('segment');

  function handleSubmit(e) {
    e.preventDefault();
    const check = validateBirthInput(birth);
    if (!check.ok) { setFormError(check.error); return; }
    setFormError(null);
    onSubmit();
  }

  return (
    <form className="birth-form" onSubmit={handleSubmit}>
      <div className="date-row">
        <input aria-label="年" type="number" placeholder="年" value={birth.year}
               onChange={e => setBirthField('year', e.target.value)} required />
        <input aria-label="月" type="number" min="1" max="12" placeholder="月"
               value={birth.month} onChange={e => setBirthField('month', e.target.value)} required />
        <input aria-label="日" type="number" min="1" max="31" placeholder="日"
               value={birth.day} onChange={e => setBirthField('day', e.target.value)} required />
      </div>

      <button type="button" className="toggle-time" onClick={() => setShowTime(s => !s)}>
        {showTime ? '−' : '+'} 出生时间（可选，更准）
      </button>

      {showTime && (
        <div className="time-block">
          <div className="mode-toggle">
            <label><input type="radio" checked={timeMode === 'segment'}
                          onChange={() => { setTimeMode('segment'); clearTimeSegment(); }} /> 选时段</label>
            <label><input type="radio" checked={timeMode === 'precise'}
                          onChange={() => { setTimeMode('precise'); clearTimeSegment(); }} /> 精确时间</label>
          </div>
          {timeMode === 'segment' ? (
            <TimeSegmentPicker selected={birth.timeSegment} onSelect={selectTimeSegment} />
          ) : (
            <input type="time" aria-label="出生时刻" onChange={e => {
              const [h, m] = e.target.value.split(':').map(Number);
              setBirthField('hour', h); setBirthField('minute', m || 0);
            }} />
          )}
        </div>
      )}

      <input aria-label="昵称" type="text" placeholder="昵称（可选）" maxLength={10}
             value={nickname} onChange={e => setNickname(e.target.value)} />

      {formError && <div className="form-error" role="alert">{formError}</div>}
      <button type="submit" className="primary-cta">查看我的类型</button>
    </form>
  );
}
