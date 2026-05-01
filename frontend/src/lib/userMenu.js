function normalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length === 11) return digits;
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2);
  return '';
}

export function reduceUserMenuOpen(open, action) {
  if (action?.type === 'toggle') return !open;
  if (action?.type === 'outside' || action?.type === 'logout' || action?.type === 'close') return false;
  return open;
}

const GUEST_PHONE_PREFIX = '99';   // server 给访客分配的伪手机号 99XXXXXXX

function isGuestPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith(GUEST_PHONE_PREFIX);
}

export function buildUserMenuProfile(user = {}) {
  const nickname = String(user?.nickname || '').trim();
  const phoneLast4 = String(user?.phone_last4 || '').trim();
  const normalizedPhone = normalizePhone(user?.phone);
  const avatarUrl = String(user?.avatar_url || '').trim() || null;
  // 访客没有真实手机号 — 后端塞的是 9912345678 这种伪号；前端不展示。
  const isGuest = isGuestPhone(user?.phone) || nickname === '游客';
  const fallbackName = isGuest ? '游客' : `尾号 ${phoneLast4 || '用户'}`;

  // 头像 fallback：有昵称用首字；游客固定 '游'；否则用尾号最后一位（保持单字符，不会撑爆 32×32 的圆头像）。
  const phoneFallbackInitial = phoneLast4 ? phoneLast4.slice(-1) : '';
  return {
    avatarUrl,
    avatarLabel: nickname
      ? Array.from(nickname)[0]
      : (isGuest ? '游' : (phoneFallbackInitial || '命')),
    displayName: nickname || fallbackName,
    isGuest,
    maskedPhone: isGuest
      ? ''   // 访客不展示伪号
      : normalizedPhone
        ? `+86 ${normalizedPhone.slice(0, 3)} *** ${normalizedPhone.slice(-4)}`
        : (phoneLast4 ? `+86 *** *** ${phoneLast4}` : ''),
    plan: user?.plan === 'pro' ? 'pro' : 'free',
    role: user?.role === 'admin' ? 'admin' : 'user',
  };
}

// 生日 / 加入时间 / 套餐期限统一格式化为「YYYY.MM」（中文环境最简洁）。
// 拿不到 / 解析失败 → 返回空字符串，让调用方决定是否兜底。
export function formatYearMonth(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}.${month}`;
}

// 触发浏览器直接下载一个 JSON Blob — 用于"导出我的数据"。
// fallbackName 不带 .json 后缀，方法内自动加。
export function downloadJsonBlob(data, fallbackName = 'bazi-export') {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fallbackName}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke 异步，立刻 revoke 在 Safari 上偶发让 download 提前中断 — 给 5s 缓冲。
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
