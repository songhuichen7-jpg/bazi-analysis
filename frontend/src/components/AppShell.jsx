import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import FormScreen, { LandingScreen, LoadingScreen } from './FormScreen';
import Shell from './Shell';
import AuthScreen from './AuthScreen';
import { fetchHealth, me } from '../lib/api';
import { bootstrapAuthGate } from '../lib/appBootstrap';
import { scrollAndFlash } from '../lib/parseRef';
import ErrorState from './ErrorState';
import UserMenu from './UserMenu';

export default function AppShell() {
  const screen = useAppStore(s => s.screen);
  const user = useAppStore(s => s.user);
  const appNotice = useAppStore(s => s.appNotice);
  const clearAppNotice = useAppStore(s => s.clearAppNotice);
  const currentId = useAppStore(s => s.currentId);
  const meta = useAppStore(s => s.meta);
  const ensureConversation = useAppStore(s => s.ensureConversation);
  const loadMessages = useAppStore(s => s.loadMessages);
  const loadClassics = useAppStore(s => s.loadClassics);
  const classics = useAppStore(s => s.classics);

  useEffect(() => {
    fetchHealth().then(j => {
      const llmEnabled = typeof j.llm?.hasKey === 'boolean' ? j.llm.hasKey : true;
      useAppStore.getState().setLlmStatus(llmEnabled);
      if (j.llm?.hasKey) console.log('[LLM] enabled:', j.llm.model);
    }).catch(() => {});

    ['conversations','chatHistory','gua','gua-history'].forEach(k => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    void bootstrapAuthGate({ store: useAppStore, me });

    const onRefClick = (e) => scrollAndFlash(e.detail?.id);
    window.addEventListener('bazi:ref-click', onRefClick);

    return () => { window.removeEventListener('bazi:ref-click', onRefClick); };
  }, []);

  useEffect(() => {
    if (!currentId || !meta) return;
    (async () => {
      if (classics?.status === 'idle' && !(classics?.items || []).length) {
        void loadClassics(currentId);
      }
      const result = await ensureConversation(currentId);
      if (useAppStore.getState().skipConversationHydration) {
        useAppStore.setState({ skipConversationHydration: false });
        return;
      }
      if (result?.conversationId && !result.created) {
        await loadMessages(result.conversationId);
      }
    })().catch(e => console.error('[App] load conversations failed', e));
  }, [classics, currentId, meta, ensureConversation, loadClassics, loadMessages]);

  let content = null;
  if (screen === 'auth') content = <AuthScreen />;
  else if (screen === 'landing') content = <LandingScreen />;
  else if (screen === 'input') content = <FormScreen />;
  else if (screen === 'loading') content = <LoadingScreen />;
  else if (screen === 'shell') content = <Shell />;

  return (
    <>
      {content}
      {user && screen !== 'auth' && screen !== 'landing' ? (
        <div className="app-header">
          <UserMenu />
        </div>
      ) : null}
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
