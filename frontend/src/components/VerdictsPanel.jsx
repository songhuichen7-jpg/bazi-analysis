import { useAppStore } from '../store/useAppStore';
import { RichText } from './RefChip';
import { SkeletonProgress } from './Skeleton';
import ErrorState from './ErrorState';
import { friendlyError } from '../lib/errorMessages';

export default function VerdictsPanel() {
  const verdicts = useAppStore((s) => s.verdicts);
  const currentId = useAppStore((s) => s.currentId);
  const loadVerdicts = useAppStore((s) => s.loadVerdicts);
  const llmEnabled = useAppStore((s) => s.llmEnabled);

  const status = verdicts?.status || 'idle';
  const body = verdicts?.body || '';
  const error = verdicts?.lastError || null;
  const isStreaming = status === 'streaming';
  const isWaiting = isStreaming && !body;
  const panelClass = status === 'done' ? 'verdicts-panel fade-in' : 'verdicts-panel';
  const uiError = error ? friendlyError(error, 'verdicts') : null;

  if (!llmEnabled && !body) return null;
  if (status === 'idle' && !body && !error) return null;

  return (
    <div id="verdicts" className={panelClass}>
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <div>
          <div className="section-num">古 籍 判 词</div>
          <div className="serif" style={{ fontSize: 22, marginTop: 6 }}>古籍里的整体定性</div>
        </div>
        {status === 'error' && currentId && uiError?.retryable && (
          <button className="btn-inline" onClick={() => loadVerdicts(currentId)}>再试一次</button>
        )}
      </div>

      {status === 'error' ? (
        <ErrorState
          title={uiError.title}
          detail={uiError.detail}
          retryable={uiError.retryable}
          onRetry={uiError.retryable && currentId ? () => loadVerdicts(currentId) : undefined}
        />
      ) : null}

      {isWaiting ? (
        <div className="verdicts-pending-note" role="status">
          正在研读古籍判词，完成后会自动出现在这里。你可以先看命盘，或者直接开始提问。
        </div>
      ) : null}

      {body ? (
        <div className="verdicts-body fade-in">
          <RichText text={body} />
        </div>
      ) : null}
    </div>
  );
}
