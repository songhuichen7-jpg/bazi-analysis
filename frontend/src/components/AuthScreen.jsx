import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { fetchConfig, guestLogin } from '../lib/api';
import { setAuthSessionHint } from '../lib/authSessionHint.js';
import { clearAuthPhoneHint, writeAuthPhoneHint } from '../lib/authPhoneHint.js';
import SmsSendForm from './SmsSendForm';
import RegisterForm from './RegisterForm';
import LoginForm from './LoginForm';
import { friendlyError } from '../lib/errorMessages.js';

export default function AuthScreen() {
  const setUser = useAppStore(s => s.setUser);
  const setScreen = useAppStore(s => s.setScreen);

  const [mode, setMode] = useState('register');
  const [phone, setPhone] = useState('');
  const [requireInvite, setRequireInvite] = useState(false);
  const [guestLoginEnabled, setGuestLoginEnabled] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState('');

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        setRequireInvite(!!config.require_invite);
        setGuestLoginEnabled(!!config.guest_login_enabled);
      })
      .catch(() => {});
  }, []);

  async function onAuthSuccess(user) {
    const normalizedPhone = String(phone || '').trim();
    setAuthSessionHint();
    writeAuthPhoneHint(normalizedPhone);
    setUser(normalizedPhone ? { ...user, phone: normalizedPhone } : user);
    setScreen('input');
  }

  async function onGuestLogin() {
    if (guestLoading) return;
    setGuestError('');
    setGuestLoading(true);
    try {
      const result = await guestLogin();
      setAuthSessionHint();
      clearAuthPhoneHint();
      setUser(result.user || null);
      setScreen('input');
    } catch (error) {
      setGuestError(friendlyError(error, 'auth').title);
    } finally {
      setGuestLoading(false);
    }
  }

  return (
    <div className="screen active">
      <div className="center-wrap">
        <div className="auth-wrap fade-in">
          <div className="section-num" style={{ marginBottom: 24 }}>先登录，再开始排盘</div>
          <h1 className="serif auth-title">把你的命盘存在你自己的账号里</h1>
          <p className="auth-subtitle">
            用短信验证码注册或登录。登录后，命盘、对话和起卦记录都会跟着这个账号走。
          </p>

          <div className="auth-toggle">
            <button
              className={'auth-toggle-btn' + (mode === 'register' ? ' active' : '')}
              onClick={() => setMode('register')}
              disabled={guestLoading}
            >
              注册
            </button>
            <button
              className={'auth-toggle-btn' + (mode === 'login' ? ' active' : '')}
              onClick={() => setMode('login')}
              disabled={guestLoading}
            >
              登录
            </button>
            {guestLoginEnabled ? (
              <button
                className="auth-toggle-btn"
                onClick={() => void onGuestLogin()}
                disabled={guestLoading}
              >
                {guestLoading ? '进入体验中…' : '先体验一下'}
              </button>
            ) : null}
          </div>

          <div className="auth-panel">
            <SmsSendForm
              phone={phone}
              onPhoneChange={setPhone}
              purpose={mode}
            />

            <div className="divider auth-divider" />

            {mode === 'register' ? (
              <RegisterForm
                phone={phone}
                requireInvite={requireInvite}
                onSuccess={onAuthSuccess}
              />
            ) : (
              <LoginForm
                phone={phone}
                onSuccess={onAuthSuccess}
              />
            )}

            {guestError ? (
              <div className="auth-inline-error">{guestError}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
