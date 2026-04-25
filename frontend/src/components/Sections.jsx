import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { fetchSections } from '../lib/api';
import { RichText } from './RefChip';
import { SkeletonProgress } from './Skeleton';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';

const SECTION_TOTAL_STEPS = 5;
const SECTION_ESTIMATED_DURATION_MS = 30000;
const SECTION_PROGRESS_TICK_MS = 1000;

function estimateSectionStep(elapsedMs) {
  const ratio = Math.max(0, elapsedMs) / SECTION_ESTIMATED_DURATION_MS;
  return Math.min(SECTION_TOTAL_STEPS, Math.floor(ratio * (SECTION_TOTAL_STEPS - 1)) + 1);
}

function SectionsLoadingProgress() {
  const [step, setStep] = useState(1);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setStep(estimateSectionStep(Date.now() - startedAt));
    }, SECTION_PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <SkeletonProgress
      label="正在研读命盘…"
      subLabel={`首次加载约需 30 秒，正在生成第 ${step}/${SECTION_TOTAL_STEPS} 段`}
      linesCount={3}
    />
  );
}

export default function Sections() {
  const sections = useAppStore(s => s.sections);
  const loading  = useAppStore(s => s.sectionsLoading);
  const error    = useAppStore(s => s.sectionsError);
  const setSections = useAppStore(s => s.setSections);
  const setSectionsLoading = useAppStore(s => s.setSectionsLoading);
  const setSectionsError = useAppStore(s => s.setSectionsError);
  const currentId = useAppStore(s => s.currentId);
  const llmEnabled = useAppStore(s => s.llmEnabled);

  const nextStep = Math.min(sections.length + 1, SECTION_TOTAL_STEPS);

  async function retrySections() {
    if (!currentId) return;
    setSections([]);
    setSectionsError(null);
    setSectionsLoading(true);
    try {
      const resp = await fetchSections(currentId);
      if (resp.sections?.length) setSections(resp.sections);
      else setSectionsError(resp.error || 'unknown');
    } catch (e) {
      setSectionsError(e.message || String(e));
    } finally {
      setSectionsLoading(false);
    }
  }

  if (!llmEnabled && !sections.length) return null;

  if (!loading && !error && !sections.length) {
    return (
      <div id="sections" className="reading-cta-card fade-in">
        <div className="section-num" style={{ marginBottom: 10 }}>命 盘 解 读</div>
        <div className="reading-cta-title serif">先看命盘，有需要再展开完整解读</div>
        <p className="reading-cta-copy">
          这里会生成五段更完整的文字分析。它不是首屏必读内容，所以默认按需生成。
        </p>
        <button className="btn-inline" onClick={() => void retrySections()}>
          生成命盘解读
        </button>
      </div>
    );
  }

  if (error) {
    const uiError = friendlyError(error, 'sections');
    return (
      <div id="sections">
        <ErrorState
          title={uiError.title}
          detail={uiError.detail}
          retryable={uiError.retryable}
          onRetry={uiError.retryable ? retrySections : undefined}
        />
      </div>
    );
  }

  if (loading && !sections.length) {
    return (
      <div id="sections" className="fade-in">
        <SectionsLoadingProgress />
      </div>
    );
  }

  return (
    <div id="sections" className={!loading && sections.length ? 'fade-in' : ''}>
      {sections.map((s, i) => (
        <div className="section-card fade-in" key={i}>
          <div className="section-num">§ {String(i+1).padStart(2,'0')}</div>
          <h3 className="serif" style={{ fontSize:16, margin:'8px 0' }}>{s.title}</h3>
          <p style={{ fontSize:13, lineHeight:1.9 }}><RichText text={s.body} /></p>
        </div>
      ))}
      {loading && sections.length ? (
        <SkeletonProgress
          subLabel={`正在生成第 ${nextStep}/${SECTION_TOTAL_STEPS} 段…`}
          linesCount={2}
          offset={sections.length}
        />
      ) : null}
    </div>
  );
}
