function isUnauthorized(error) {
  return error?.status === 401 || /HTTP 401/.test(error?.message || '');
}

export async function bootstrapAuthGate({ store, me }) {
  try {
    const result = await me();
    store.getState().setUser(result.user || null);
    await store.getState().syncChartsFromServer();
    return result.user || null;
  } catch (error) {
    store.getState().setUser(null);
    if (isUnauthorized(error)) {
      store.setState({ screen: 'auth' });
      return null;
    }
    store.getState().setAppNotice({
      title: '登录状态检查失败',
      detail: error?.message || String(error),
      retryable: true,
    });
    store.setState({ screen: 'auth' });
    return null;
  }
}
