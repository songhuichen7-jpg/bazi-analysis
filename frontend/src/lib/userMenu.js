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

  return {
    avatarUrl,
    avatarLabel: nickname ? Array.from(nickname)[0] : (isGuest ? '游' : (phoneLast4 || '命')),
    displayName: nickname || fallbackName,
    isGuest,
    maskedPhone: isGuest
      ? ''   // 访客不展示伪号
      : normalizedPhone
        ? `+86 ${normalizedPhone.slice(0, 3)} *** ${normalizedPhone.slice(-4)}`
        : (phoneLast4 ? `+86 *** *** ${phoneLast4}` : ''),
  };
}
