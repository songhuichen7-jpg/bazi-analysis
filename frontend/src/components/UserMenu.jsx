import { useEffect, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { buildUserMenuProfile, reduceUserMenuOpen } from '../lib/userMenu';

export default function UserMenu() {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, dispatch] = useReducer(reduceUserMenuOpen, false);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        dispatch({ type: 'outside' });
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!user) return null;

  const profile = buildUserMenuProfile(user);

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        className="user-menu-trigger"
        onClick={() => dispatch({ type: 'toggle' })}
        aria-expanded={open}
        title={profile.displayName}
      >
        <span className="user-avatar">{profile.avatarLabel}</span>
      </button>
      {open ? (
        <div className="user-menu-dropdown">
          <div className="user-menu-name">{profile.displayName}</div>
          {profile.maskedPhone ? <div className="user-menu-phone muted">{profile.maskedPhone}</div> : null}
          <div className="user-menu-sep" />
          <button
            className="user-menu-logout"
            onClick={async () => {
              dispatch({ type: 'logout' });
              await logout();
              // 退出后跳访客首页, 不要停在 /app 让 AppShell 渲染内部旧 landing screen
              navigate('/', { replace: true });
            }}
          >
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
