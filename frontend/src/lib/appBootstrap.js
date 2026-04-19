import { clearAuthSessionHint, hasAuthSessionHint, setAuthSessionHint } from './authSessionHint.js';
import { clearAuthPhoneHint, readAuthPhoneHint } from './authPhoneHint.js';

export async function bootstrapAuthGate({ store, me }) {
  if (!hasAuthSessionHint()) {
    store.getState().setUser(null);
    return null;
  }

  try {
    const result = await me();
    if (!result) {
      clearAuthSessionHint();
      clearAuthPhoneHint();
      store.getState().setUser(null);
      return null;
    }
    setAuthSessionHint();
    const phone = readAuthPhoneHint();
    store.getState().setUser(result.user ? { ...result.user, ...(phone ? { phone } : {}) } : null);
    return result.user || null;
  } catch (error) {
    store.getState().setUser(null);
    store.getState().setAppNotice({
      title: '登录状态检查失败',
      detail: error?.message || String(error),
      retryable: true,
    });
    return null;
  }
}
