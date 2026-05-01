import { useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { buildUserMenuProfile, reduceUserMenuOpen } from '../lib/userMenu';
import { updateProfile, uploadAvatar } from '../lib/api';
import { friendlyError } from '../lib/errorMessages';

export default function UserMenu() {
  const user = useAppStore((s) => s.user);
  const patchUser = useAppStore((s) => s.patchUser);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const [open, dispatch] = useReducer(reduceUserMenuOpen, false);

  // 内联编辑昵称的 controlled state — 打开 panel 时初始化为当前昵称
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) {
      setEditingName(false);
      setDraftName('');
      setErrorMsg('');
      return undefined;
    }
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

  function startRename() {
    setDraftName(user.nickname || '');
    setErrorMsg('');
    setEditingName(true);
  }

  async function commitRename() {
    const next = draftName.trim();
    if (next === (user.nickname || '').trim()) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const updated = await updateProfile({ nickname: next });
      patchUser({ nickname: updated.nickname, avatar_url: updated.avatar_url });
      setEditingName(false);
    } catch (e) {
      setErrorMsg(friendlyError(e, 'profile').title);
    } finally {
      setSaving(false);
    }
  }

  function cancelRename() {
    setEditingName(false);
    setDraftName('');
    setErrorMsg('');
  }

  async function onAvatarFile(file) {
    if (!file) return;
    setUploading(true);
    setErrorMsg('');
    try {
      const updated = await uploadAvatar(file);
      patchUser({ nickname: updated.nickname, avatar_url: updated.avatar_url });
    } catch (e) {
      setErrorMsg(friendlyError(e, 'profile').title);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        className="user-menu-trigger"
        onClick={() => dispatch({ type: 'toggle' })}
        aria-expanded={open}
        title={profile.displayName}
      >
        <span className="user-avatar">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" draggable="false" />
          ) : (
            profile.avatarLabel
          )}
        </span>
      </button>
      {open ? (
        <div className="user-menu-dropdown user-center" role="dialog" aria-label="用户中心">
          {/* 头像区 — 大头像，hover 浮"换头像"覆盖层；点击即唤起选图 */}
          <div className="user-center-head">
            <label className={'user-center-avatar' + (uploading ? ' is-uploading' : '')}>
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="头像" draggable="false" />
              ) : (
                <span className="user-center-avatar-fallback">{profile.avatarLabel}</span>
              )}
              <span className="user-center-avatar-overlay">
                {uploading ? '上传中…' : '换头像'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => onAvatarFile(e.target.files?.[0])}
                hidden
              />
            </label>
          </div>

          {/* 昵称区 — 默认展示，点击 ✎ 进入编辑 */}
          {editingName ? (
            <div className="user-center-name-edit">
              <input
                className="user-center-name-input"
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                  if (e.key === 'Escape') cancelRename();
                }}
                placeholder="给自己起个名字"
                maxLength={40}
                disabled={saving}
              />
              <div className="user-center-name-actions">
                <button
                  type="button"
                  className="btn-inline"
                  onClick={() => void commitRename()}
                  disabled={saving}
                >{saving ? '保存中…' : '保存'}</button>
                <button
                  type="button"
                  className="user-center-link"
                  onClick={cancelRename}
                  disabled={saving}
                >取消</button>
              </div>
            </div>
          ) : (
            <div className="user-center-name">
              <span className="user-center-name-text">{profile.displayName}</span>
              <button
                type="button"
                className="user-center-name-edit-btn"
                onClick={startRename}
                title="编辑昵称"
                aria-label="编辑昵称"
              >✎</button>
            </div>
          )}

          {profile.maskedPhone ? (
            <div className="user-center-phone muted">{profile.maskedPhone}</div>
          ) : (
            profile.isGuest ? (
              <div className="user-center-phone muted">访客模式 · 数据只在这台设备</div>
            ) : null
          )}

          {errorMsg ? (
            <div className="user-center-error" role="alert">{errorMsg}</div>
          ) : null}

          <div className="user-menu-sep" />

          <button
            className="user-menu-logout"
            onClick={async () => {
              dispatch({ type: 'logout' });
              await logout();
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
