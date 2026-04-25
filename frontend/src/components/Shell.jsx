import { useRef, useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import Chart from './Chart';
import Force from './Force';
import { BirthHeader, MetaGrid } from './Meta';
import Dayun from './Dayun';
import Chat from './Chat';
import { clearSession } from '../lib/persistence';
import ChartSwitcher from './ChartSwitcher';
import { buildChartVisibility } from '../lib/chartVisibility';
import { getShellTopbarClassName } from '../lib/shellChrome';
import ClassicsPanel from './ClassicsPanel';

const MIN_RIGHT = 320;
const MAX_RIGHT = 780;
const DEFAULT_RIGHT = 560;

export default function Shell() {
  const view = useAppStore(s => s.view);
  const setView = useAppStore(s => s.setView);
  const meta = useAppStore(s => s.meta);
  const force = useAppStore(s => s.force);
  const guards = useAppStore(s => s.guards);
  const user = useAppStore(s => s.user);
  const reset = useAppStore(s => s.reset);
  const setAppNotice = useAppStore(s => s.setAppNotice);
  const startNewChart = useAppStore(s => s.startNewChart);
  const visibility = buildChartVisibility({ meta, force, guards });
  const topbarClassName = getShellTopbarClassName(!!user);

  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_RIGHT);

  const onMouseDown = useCallback((e) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = rightWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [rightWidth]);

  useEffect(() => {
    if (view !== 'chart' && view !== 'timing') {
      setView('chart');
    }
  }, [view, setView]);

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX; // dragging left = wider right
      const next = Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, startWidth.current + delta));
      setRightWidth(next);
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onReset = () => {
    if (!confirm('清空所有命盘和聊天记录？')) return;
    clearSession({ onError: setAppNotice });
    reset();
  };

  return (
    <div className="screen active">
      <div className="shell-layout" style={{ gridTemplateColumns: `1fr 6px ${rightWidth}px` }}>
        {/* LEFT PANE */}
        <div className="left-pane">
          <div className="left-topbar">
            <div className={topbarClassName}>
              <div className="serif" style={{ fontSize:16 }}>{(meta?.rizhuGan || meta?.rizhu?.[0] || '命')} · 命</div>
              <div className="view-switch">
                <div className={'view-item' + (view === 'chart' ? ' active' : '')} onClick={() => setView('chart')}>命 盘</div>
                <div className={'view-item' + (view === 'timing' ? ' active' : '')} onClick={() => setView('timing')}>流 年</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <ChartSwitcher onNewChart={() => startNewChart()} />
                <button className="muted" style={{ fontSize:11 }} onClick={onReset} title="清空所有命盘">×</button>
              </div>
            </div>
          </div>

          <div className="view" style={{ display: view === 'chart' ? 'block' : 'none' }}>
            <div className="left-content fade-in">
              <BirthHeader />
              <Chart />
              <MetaGrid />
              {visibility.showForce ? <div className="divider" /> : null}
              {visibility.showForce ? (
                <div>
                  <div className="section-num" style={{ marginBottom:18 }}>十神力量</div>
                  <Force />
                </div>
              ) : null}
              <div className="divider" />
              <ClassicsPanel />
              <div className="quote-mark">命 不 是 判 决 书 · 是 一 张 地 形 图</div>
            </div>
          </div>

          <div className="view" style={{ display: view === 'timing' ? 'block' : 'none' }}>
            <div className="left-content fade-in">
              <Dayun />
            </div>
          </div>
        </div>

        {/* RESIZE HANDLE */}
        <div className="resize-handle" onMouseDown={onMouseDown} />

        <Chat />
      </div>
    </div>
  );
}
