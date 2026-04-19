function normalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length === 11) return digits;
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2);
  return '';
}

export function reduceUserMenuOpen(open, action) {
  if (action?.type === 'toggle') return !open;
  if (action?.type === 'outside' || action?.type === 'logout') return false;
  return open;
}

export function buildUserMenuProfile(user = {}) {
  const nickname = String(user?.nickname || '').trim();
  const phoneLast4 = String(user?.phone_last4 || '').trim();
  const normalizedPhone = normalizePhone(user?.phone);

  return {
    avatarLabel: nickname ? Array.from(nickname)[0] : (phoneLast4 || '命'),
    displayName: nickname || `尾号 ${phoneLast4 || '用户'}`,
    maskedPhone: normalizedPhone
      ? `+86 ${normalizedPhone.slice(0, 3)} *** ${normalizedPhone.slice(-4)}`
      : (phoneLast4 ? `+86 *** *** ${phoneLast4}` : ''),
  };
}
