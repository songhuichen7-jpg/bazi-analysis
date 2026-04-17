import { useEffect, useState } from 'react';
import { useAppStore, generateChartLabel } from '../store/useAppStore';
import { fetchCities, fetchPaipan, fetchSections } from '../lib/api';
import { MAX_CHARTS } from '../lib/constants';
import { friendlyError } from '../lib/errorMessages';

const LOADING_STAGES = ['真太阳时校正','四柱排定','藏干展开','力量擂台','格局识别','生成解读'];

export default function FormScreen() {
  const birthInfo   = useAppStore(s => s.birthInfo);
  const formError   = useAppStore(s => s.formError);
  const setFormError = useAppStore(s => s.setFormError);
  const setScreen   = useAppStore(s => s.setScreen);
  const setBirthInfo = useAppStore(s => s.setBirthInfo);
  const applyServerData = useAppStore(s => s.applyServerData);
  const setSections = useAppStore(s => s.setSections);
  const setSectionsLoading = useAppStore(s => s.setSectionsLoading);
  const setSectionsError = useAppStore(s => s.setSectionsError);
  const llmEnabled = useAppStore(s => s.llmEnabled);
  const charts = useAppStore(s => s.charts);
  const prepareNewChart = useAppStore(s => s.prepareNewChart);
  const finalizeChart = useAppStore(s => s.finalizeChart);
  const loadVerdicts = useAppStore(s => s.loadVerdicts);

  const [date, setDate]     = useState(birthInfo?.date || '1993-07-15');
  const [time, setTime]     = useState(birthInfo?.time || '14:30');
  const [hourUnknown, setHU] = useState(birthInfo?.hourUnknown || false);
  const [city, setCity]     = useState(birthInfo?.city || '长沙');
  const [gender, setGender] = useState(birthInfo?.gender || 'male');
  const [zi, setZi]         = useState(birthInfo?.ziConvention || 'early');
  const [trueSolar, setTS]  = useState(birthInfo?.trueSolar !== false);
  const [cities, setCities] = useState([]);

  useEffect(() => {
    fetchCities().then(j => setCities(j.cities || [])).catch(() => {});
  }, []);

  async function onSubmit() {
    setFormError(null);
    if (!date) return setFormError('请输入出生日期');
    if (!city.trim()) return setFormError('请输入出生地');
    const [y, mo, d] = date.split('-').map(Number);
    let h = -1, mi = 0;
    if (!hourUnknown) {
      if (!time) return setFormError('请输入出生时间或勾选"时辰未知"');
      [h, mi] = time.split(':').map(Number);
    }
    const payload = {
      year: y, month: mo, day: d, hour: h, minute: mi,
      city: city.trim(), gender, ziConvention: zi, useTrueSolarTime: trueSolar,
    };
    const birth = { date, time, hourUnknown, city: city.trim(), gender, ziConvention: zi, trueSolar };
    setBirthInfo(birth);

    // Check chart limit before proceeding
    if (Object.keys(charts).length >= MAX_CHARTS) {
      return setFormError(`最多保存 ${MAX_CHARTS} 份命盘，请先在右上角删除一份再新建。`);
    }

    const newId = prepareNewChart();
    setScreen('loading');
    const minDelay = new Promise(r => setTimeout(r, 1200));
    let stageI = 0;
    useAppStore.setState({ loadingStage: 0 });
    const stageTimer = setInterval(() => {
      stageI++;
      if (stageI < LOADING_STAGES.length) useAppStore.setState({ loadingStage: stageI });
      else clearInterval(stageTimer);
    }, 280);

    try {
      const [data] = await Promise.all([fetchPaipan(payload), minDelay]);
      applyServerData(data.ui);
      clearInterval(stageTimer);
      await new Promise(r => setTimeout(r, 250));
      finalizeChart(newId, birth, generateChartLabel(birth));
      setScreen('shell');

      // fire sections in background
      if (llmEnabled) {
        setSectionsLoading(true);
        setSections([]);
        void fetchSections(data.ui).then(resp => {
          if (resp.sections?.length) setSections(resp.sections);
          else setSectionsError(resp.error || 'unknown');
        }).catch(e => setSectionsError(e.message || String(e))).finally(() => setSectionsLoading(false));
        void loadVerdicts(newId);
      }
    } catch (e) {
      clearInterval(stageTimer);
      console.error(e);
      setFormError(friendlyError(e, 'paipan').title);
      setScreen('input');
    }
  }

  return (
    <div className="screen active">
      <div className="form-wrap fade-in">
        <div className="back-link" onClick={() => setScreen('landing')}>← 返回</div>
        <div className="section-num" style={{ marginBottom: 16 }}>Step 01</div>
        <h2 className="serif">生辰</h2>

        <div className="form-row">
          <label className="form-label">公历生日</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <div className="form-row" style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:16, alignItems:'end' }}>
          <div>
            <label className="form-label">出生时间</label>
            <input type="time" value={time} disabled={hourUnknown} onChange={e => setTime(e.target.value)} />
          </div>
          <label className="muted" style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, paddingBottom:8, cursor:'pointer' }}>
            <input type="checkbox" checked={hourUnknown} onChange={e => setHU(e.target.checked)} style={{ width:'auto' }} /> 时辰未知
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">出生地</label>
          <input type="text" value={city} onChange={e => setCity(e.target.value)}
                 placeholder="北京 / 上海 / 长沙 …（用于真太阳时校正）" list="city-list" />
          <datalist id="city-list">
            {cities.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>

        <div className="form-row">
          <label className="form-label">性别</label>
          <div style={{ display:'flex', gap:24, paddingTop:8 }}>
            <label style={{ fontSize:14, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="radio" name="g" value="male" checked={gender==='male'} onChange={() => setGender('male')} style={{ width:'auto' }} /> 男
            </label>
            <label style={{ fontSize:14, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="radio" name="g" value="female" checked={gender==='female'} onChange={() => setGender('female')} style={{ width:'auto' }} /> 女
            </label>
          </div>
        </div>

        <details style={{ marginTop:12, fontSize:12, color:'#666' }}>
          <summary style={{ cursor:'pointer', padding:'4px 0' }}>高级选项</summary>
          <div className="form-row" style={{ marginTop:12 }}>
            <label className="form-label">子时派</label>
            <div style={{ display:'flex', gap:24, paddingTop:8 }}>
              <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                <input type="radio" name="zi" value="early" checked={zi==='early'} onChange={() => setZi('early')} style={{ width:'auto' }} /> 早子时（23:00 归次日）
              </label>
              <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                <input type="radio" name="zi" value="late" checked={zi==='late'} onChange={() => setZi('late')} style={{ width:'auto' }} /> 晚子时（23:00 归本日）
              </label>
            </div>
          </div>
          <div className="form-row">
            <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="checkbox" checked={trueSolar} onChange={e => setTS(e.target.checked)} style={{ width:'auto' }} /> 修正真太阳时（推荐）
            </label>
          </div>
        </details>

        {formError && (
          <div style={{ marginTop:16, padding:'10px 12px', borderLeft:'3px solid #000', background:'#f7f5f2', fontSize:13, color:'#333' }}>{formError}</div>
        )}

        <div style={{ marginTop:48, display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div className="muted" style={{ fontSize:11, maxWidth:260, lineHeight:1.7 }}>我们只做排盘计算，不保存你的生辰数据。</div>
          <button className="btn-primary" onClick={onSubmit}>生成命盘 →</button>
        </div>
      </div>
    </div>
  );
}

export function LoadingScreen() {
  const loadingStage = useAppStore(s => s.loadingStage);
  return (
    <div className="screen active">
      <div className="center-wrap">
        <div style={{ textAlign:'center' }} className="fade-in">
          <div className="section-num" style={{ marginBottom:24 }}>计算中</div>
          <div className="serif" style={{ fontSize:22, marginBottom:48, height:28 }}>{LOADING_STAGES[loadingStage] || ''}</div>
          <div className="loading-stages">
            {LOADING_STAGES.map((_, i) => (
              <span key={i} className={i <= loadingStage ? 'on' : ''} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingScreen() {
  const setScreen = useAppStore(s => s.setScreen);
  return (
    <div className="screen active">
      <div className="center-wrap">
        <div className="landing fade-in">
          <div className="section-num" style={{ marginBottom:24 }}>命 · 盘 · 读</div>
          <h1 className="serif">一个<span className="muted">理性的</span>命理工具</h1>
          <p>不讲玄学。用子平真诠 + 现代结构化方法，把你的八字翻译成一份可以读、可以聊、可以对照的自我说明书。</p>
          <button className="btn-primary" onClick={() => setScreen('input')}>开始排盘 →</button>
          <div className="muted" style={{ fontSize:11, marginTop:80, letterSpacing:'.2em', lineHeight:1.8 }}>v0.1 · 原型 · 模型输出为示例</div>
        </div>
      </div>
    </div>
  );
}
