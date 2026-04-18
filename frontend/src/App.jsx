import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import FormScreen, { LandingScreen, LoadingScreen } from './components/FormScreen';
import Shell from './components/Shell';
import AuthScreen from './components/AuthScreen';
import { fetchHealth, me } from './lib/api';
import { bootstrapAuthGate } from './lib/appBootstrap';
import { scrollAndFlash } from './lib/parseRef';
import ErrorState from './components/ErrorState';

export default function App() {
  const screen = useAppStore(s => s.screen);
  const user = useAppStore(s => s.user);
  const appNotice = useAppStore(s => s.appNotice);
  const clearAppNotice = useAppStore(s => s.clearAppNotice);
  const currentId = useAppStore(s => s.currentId);
  const meta = useAppStore(s => s.meta);
  const ensureConversation = useAppStore(s => s.ensureConversation);
  const loadMessages = useAppStore(s => s.loadMessages);
  const logout = useAppStore(s => s.logout);

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

    // global ref-click handler: scroll + flash highlighted data-ref target
    const onRefClick = (e) => scrollAndFlash(e.detail?.id);
    window.addEventListener('bazi:ref-click', onRefClick);

    return () => { window.removeEventListener('bazi:ref-click', onRefClick); };
  }, []);

  // Plan 6: when the active chart is loaded, fetch its server-backed conversations
  useEffect(() => {
    if (!currentId || !meta) return;
    (async () => {
      const result = await ensureConversation(currentId);
      if (useAppStore.getState().skipConversationHydration) {
        useAppStore.setState({ skipConversationHydration: false });
        return;
      }
      if (result?.conversationId && !result.created) {
        await loadMessages(result.conversationId);
      }
    })().catch(e => console.error('[App] load conversations failed', e));
  }, [currentId, meta, ensureConversation, loadMessages]);

  let content = null;
  if (screen === 'auth') content = <AuthScreen />;
  else if (screen === 'landing') content = <LandingScreen />;
  else if (screen === 'input') content = <FormScreen />;
  else if (screen === 'loading') content = <LoadingScreen />;
  else if (screen === 'shell') content = <Shell />;

  return (
    <>
      {content}
      {user && screen !== 'auth' ? (
        <button
          className="muted"
          onClick={() => void logout()}
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 110,
            fontSize: 11,
            letterSpacing: '.08em',
          }}
        >
          退出登录
        </button>
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
