import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore.js';
import { deleteHepanInvite, getHepanMine, postHepanInvite } from '../../lib/hepanApi.js';

// 合盘邀请按钮 — 命盘页 top-bar 唯一入口。点开弹层：
//   · 用当前命盘的 birth_input + user.nickname 自动 POST /api/hepan/invite
//   · 拿到 invite_url 后展示出来 + 复制 + 原生分享（Web Share API）
//   · 折叠区列出该用户过去发过的邀请，每条带状态徽章 + 复制
//
// 只在登录态 + 有当前命盘时显示。匿名用户（虽然后端允许）不在主流程入口出现 —
// 入口收敛到登录用户，能被 /api/hepan/mine 跟踪到。
export default function HepanInviteButton() {
  const meta = useAppStore((s) => s.meta);
  const user = useAppStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(null);   // { slug, url, full_url, a }
  const [history, setHistory] = useState([]);    // 过去的 invite 列表
  const [historyLoading, setHistoryLoading] = useState(false);
  const [copied, setCopied] = useState(null);    // slug 高亮"已复制"
  const rootRef = useRef(null);

  // 弹层打开/关闭：拉历史 + 关闭时清掉一次性状态
  // 注意 hooks 必须无条件调 — 不渲染按钮的判断放在所有 hooks 之后做。
  useEffect(() => {
    if (!open) {
      setError('');
      setInvite(null);
      setCopied(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const result = await getHepanMine();
        if (!cancelled) setHistory(result?.items || []);
      } catch { /* 静默 — 历史拉不到不阻塞主流程 */ }
      finally { if (!cancelled) setHistoryLoading(false); }
    })();
    function onDocClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => {
      cancelled = true;
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  // 没 user / 没 meta 不渲染按钮 — 命盘还没加载完时按钮没意义
  if (!user || !meta?.input) return null;

  async function generateInvite() {
    if (creating || !meta?.input) return;
    setCreating(true);
    setError('');
    try {
      const birth = {
        year: meta.input.year,
        month: meta.input.month,
        day: meta.input.day,
        hour: meta.input.hour ?? -1,
        minute: meta.input.minute ?? 0,
        city: meta.input.city || null,
      };
      const result = await postHepanInvite({
        birth,
        nickname: user.nickname || null,
      });
      const fullUrl = `${window.location.origin}${result.invite_url}`;
      setInvite({ ...result, full_url: fullUrl });
      // 历史前置插一条 — 不重新 fetch，避免用户看到"消失再出现"的闪烁
      setHistory((prev) => [{
        slug: result.slug,
        status: 'pending',
        a_nickname: result.a?.nickname || user.nickname || null,
        b_nickname: null,
        a_cosmic_name: result.a?.cosmic_name || '',
        b_cosmic_name: null,
        category: null,
        label: null,
        pair_theme_color: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        share_count: 0,
        has_reading: false,
      }, ...prev]);
    } catch (e) {
      setError(e?.message || '生成失败，再试一次');
    } finally {
      setCreating(false);
    }
  }

  // 复制时带上一句邀请话 — 用户粘到微信 / 飞书里直接就是 "@昵称 邀请你来
  // 合一盘 — URL"。比起裸 URL，对方收到时少一层"这是什么链接？"的猜测。
  // 想要纯 URL 的（粘到代码 / 文档里）可以二次手动选取删描述。
  function _composeShareText(url) {
    const name = (user.nickname || '').trim();
    const prefix = name && name !== '游客'
      ? `${name} 邀请你来合个盘`
      : '想跟你合个盘';
    return `${prefix} — ${url}`;
  }

  async function copyUrl(url, slug) {
    const text = _composeShareText(url);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(slug);
      setTimeout(() => setCopied((s) => s === slug ? null : s), 1800);
    } catch {
      // clipboard API 在 http 或私密模式下会拒绝；fallback 选中告知
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(slug); }
      catch { setError('浏览器拒绝了剪贴板访问 — 请长按 URL 手动复制'); }
      document.body.removeChild(ta);
      setTimeout(() => setCopied((s) => s === slug ? null : s), 1800);
    }
  }

  async function nativeShare(url, name) {
    if (!navigator.share) return copyUrl(url, '__share__');
    try {
      await navigator.share({
        title: '有时 · 邀请合盘',
        text: name ? `${name} 邀请你来合一盘 —` : '想跟你合一盘 —',
        url,
      });
    } catch { /* 用户取消 / 不支持 — 静默 */ }
  }

  async function deleteOne(slug) {
    if (!window.confirm('删除这条邀请？删除后链接立即失效，对方无法再打开。')) return;
    try {
      await deleteHepanInvite(slug);
      setHistory((prev) => prev.filter((it) => it.slug !== slug));
      // 如果删的是刚生成的当前 invite，清掉主区
      setInvite((cur) => (cur?.slug === slug ? null : cur));
    } catch (e) {
      setError(e?.message || '删除失败');
    }
  }

  return (
    <div className="hepan-invite-trigger" ref={rootRef}>
      <button
        type="button"
        className="btn-inline hepan-invite-button"
        onClick={() => setOpen((v) => !v)}
        title="给这盘的人发一份邀请，让 TA 跟你合盘"
      >合盘</button>

      {open ? (
        <div className="hepan-invite-popover" role="dialog" aria-label="邀请合盘">
          <div className="hepan-invite-head">
            <div className="hepan-invite-title">邀请合盘</div>
            <div className="hepan-invite-sub muted">
              用这盘的生日生成一条邀请链接。TA 打开链接填上自己的生日，你们的搭子类型就能合出来。
            </div>
          </div>

          {/* 当前生成的 invite — 占主视觉位置 */}
          {invite ? (
            <div className="hepan-invite-current">
              <div className="hepan-invite-url">{invite.full_url}</div>
              <div className="hepan-invite-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => copyUrl(invite.full_url, invite.slug)}
                >{copied === invite.slug ? '已复制 ✓' : '复制链接'}</button>
                {typeof navigator !== 'undefined' && 'share' in navigator ? (
                  <button
                    type="button"
                    className="btn-inline"
                    onClick={() => nativeShare(invite.full_url, user.nickname)}
                  >分享…</button>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary hepan-invite-generate"
              onClick={generateInvite}
              disabled={creating}
            >{creating ? '生成中…' : '生成邀请链接'}</button>
          )}

          {error ? <div className="user-center-error" role="alert">{error}</div> : null}

          {/* 历史折叠区 */}
          {history.length > 0 ? (
            <div className="hepan-invite-history">
              <div className="hepan-invite-history-head-row">
                <span className="hepan-invite-history-head muted">已发出的邀请</span>
                <Link className="hepan-invite-history-more" to="/hepan/mine">
                  全部 →
                </Link>
              </div>
              <ul className="hepan-invite-history-list">
                {history.slice(0, 5).map((it) => (
                  <HistoryRow
                    key={it.slug}
                    item={it}
                    copied={copied === it.slug}
                    onCopy={() => copyUrl(`${window.location.origin}/hepan/${it.slug}`, it.slug)}
                    onDelete={() => deleteOne(it.slug)}
                  />
                ))}
              </ul>
            </div>
          ) : !historyLoading ? null : (
            <div className="muted" style={{ fontSize: 11 }}>正在拉取历史…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function HistoryRow({ item, copied, onCopy, onDelete }) {
  const completed = item.status === 'completed';
  return (
    <li className={'hepan-invite-history-row hepan-invite-' + (completed ? 'done' : 'pending')}>
      <div className="hepan-invite-history-left">
        <span className={'hepan-invite-status hepan-invite-status-' + item.status}>
          {completed ? '已合' : '等回复'}
        </span>
        <span className="hepan-invite-history-name">
          {item.a_cosmic_name || '?'}
          {completed && item.b_cosmic_name ? <> × {item.b_cosmic_name}</> : null}
        </span>
        {completed && item.label ? (
          <span className="hepan-invite-history-label">· {item.label}</span>
        ) : null}
        {completed && item.has_reading ? (
          <span className="hepan-invite-history-tag" title="已生成过完整解读">已读</span>
        ) : null}
      </div>
      <div className="hepan-invite-history-actions">
        <button type="button" className="user-center-link" onClick={onCopy}>
          {copied ? '已复制' : '复制'}
        </button>
        <button
          type="button"
          className="user-center-link hepan-invite-row-delete"
          onClick={onDelete}
          title="删除后链接立即失效"
        >×</button>
      </div>
    </li>
  );
}
