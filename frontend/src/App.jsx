import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import FormScreen, { LandingScreen, LoadingScreen } from './components/FormScreen';
import Shell from './components/Shell';
import { loadSession, subscribeSave } from './lib/persistence';
import { fetchHealth, fetchSections } from './lib/api';
import { scrollAndFlash } from './lib/parseRef';
import ErrorState from './components/ErrorState';

export default function App() {
  const screen = useAppStore(s => s.screen);
  const appNotice = useAppStore(s => s.appNotice);
  const clearAppNotice = useAppStore(s => s.clearAppNotice);

  useEffect(() => {
    // LLM health
    fetchHealth().then(j => {
      useAppStore.getState().setLlmStatus(!!(j.llm && j.llm.hasKey));
      if (j.llm?.hasKey) console.log('[LLM] enabled:', j.llm.model);
    }).catch(() => {});

    // restore persisted session
    const saved = loadSession({
      onError: (notice) => useAppStore.getState().setAppNotice(notice),
    });
    if (saved?.version === 3 && saved.currentId && saved.charts?.[saved.currentId]) {
      useAppStore.getState().restoreFromSession(saved);
      const chart = saved.charts[saved.currentId];
      // If sections missing for active chart, try refetching once LLM is ready
      if ((!chart.sections?.length || !chart.verdicts?.items?.length) && chart.paipan) {
        const serverData = {
          PAIPAN: chart.paipan, FORCE: chart.force, GUARDS: chart.guards,
          DAYUN: chart.dayun, META: chart.meta,
        };
        const retry = setInterval(() => {
          const st = useAppStore.getState();
          if (st.llmEnabled) {
            clearInterval(retry);
            if (!chart.sections?.length) {
              st.setSectionsLoading(true);
              fetchSections(serverData)
                .then(r => r.sections?.length ? st.setSections(r.sections) : st.setSectionsError(r.error || 'unknown'))
                .catch(e => st.setSectionsError(e.message || String(e)))
                .finally(() => st.setSectionsLoading(false));
            }
            if (!chart.verdicts?.items?.length) {
              void st.loadVerdicts(saved.currentId);
            }
          }
        }, 200);
        setTimeout(() => clearInterval(retry), 3000);
      }
    } else if (saved?.birthInfo) {
      useAppStore.getState().setBirthInfo(saved.birthInfo);
    }

    // wire persistence subscribe
    const unsub = subscribeSave(useAppStore, {
      onError: (notice) => useAppStore.getState().setAppNotice(notice),
    });

    // global ref-click handler: scroll + flash highlighted data-ref target
    const onRefClick = (e) => scrollAndFlash(e.detail?.id);
    window.addEventListener('bazi:ref-click', onRefClick);

    return () => { unsub(); window.removeEventListener('bazi:ref-click', onRefClick); };
  }, []);

  let content = null;
  if (screen === 'landing') content = <LandingScreen />;
  else if (screen === 'input') content = <FormScreen />;
  else if (screen === 'loading') content = <LoadingScreen />;
  else if (screen === 'shell') content = <Shell />;

  return (
    <>
      {content}
      {appNotice ? (
        <div className="app-toast">
          <ErrorState
            variant="toast"
            title={appNotice.title}
            detail={appNotice.detail}
            retryable={false}
            onDismiss={clearAppNotice}
          />
        </div>
      ) : null}
    </>
  );
}
