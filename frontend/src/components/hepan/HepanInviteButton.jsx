import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore.js';
import {
  deleteHepanInvite,
  getHepanMine,
  getHepanMineCached,
  patchHepanMineCache,
  postHepanInvite,
} from '../../lib/hepanApi.js';

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
  // 缓存优先 — appBootstrap 跑过 inbox 检查后 _mineCache 就有数据，
  // 用户点开按钮第一帧就能看到历史，不用等网络。
  const [history, setHistory] = useState(() => getHepanMineCached()?.items || []);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [copied, setCopied] = useState(null);    // slug 高亮"已复制"
  const rootRef = useRef(null);
  const creatingRef = useRef(false);

  // 弹层打开/关闭：拉历史 + 关闭时清掉一次性状态
  // 注意 hooks 必须无条件调 — 不渲染按钮的判断放在所有 hooks 之后做。
  useEffect(() => {
    if (!open) {
      setError('');
      setCopied(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      // 已经有缓存数据先静默 revalidate — 不亮 spinner，避免"已经看到列表
      // 又跳成 loading"的闪。空缓存才走 loading 态。
      const hasCache = getHepanMineCached() != null;
      if (!hasCache) setHistoryLoading(true);
      try {
        const result = await getHepanMine();
        if (!cancelled) setHistory(result?.items || []);
      } catch { /* 静默 — 历史拉不到不阻塞主流程 */ }
      finally { if (!cancelled && !hasCache) setHistoryLoading(false); }
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
    if (creatingRef.current || !meta?.input) return;
    creatingRef.current = true;
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
      // 把"游客"过滤成 null — 游客账号默认 nickname 是字符串 "游客"，
      // 直接当邀请人名字会让 B 看到 "@游客 邀请你来合盘"，又冷又像群发，
      // 直接卡漏斗转化率。null 时后端 a_nickname 留空，前端展示
      // fallback 到 cosmic_name（小夜灯 / 多肉 这类有人味的代号）。
      const realNickname = user.nickname && user.nickname !== '游客'
        ? user.nickname
        : null;
      const result = await postHepanInvite({
        birth,
        nickname: realNickname,
      });
      const fullUrl = `${window.location.origin}${result.invite_url}`;
      setInvite({ ...result, full_url: fullUrl });
      // 历史前置插一条 — 不重新 fetch，避免用户看到"消失再出现"的闪烁
      const newRow = {
        slug: result.slug,
        status: 'pending',
        a_nickname: result.a?.nickname || realNickname || null,
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
        message_count: 0,
      };
      setHistory((prev) => [newRow, ...prev]);
      // 把同一行也塞进 module 级缓存，下次别处（MyHepanPage / 重开弹层）
      // 拿到的是包含新邀请的快照，不会"刚发完看不见"
      patchHepanMineCache((prev) => ({
        ...prev,
        items: [newRow, ...(prev.items || [])],
      }));
    } catch (e) {
      setError(e?.message || '生成失败，再试一次');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  // 单一 click 入口 — 之前 mousedown + click + popover 冒泡三个 handler
  // 都调 generateInvite,React 19 dev StrictMode 又把第一个 invocation
  // 的 ref 没及时同步给后续,实测点一下竟然连发 2 条 POST /invite。
  // 现在只保留 onClick,creatingRef + creating state 双重 gate 把重入卡死。
  function handleGenerateInviteClick(event) {
    event.stopPropagation();
    void generateInvite();
  }

  function handlePopoverClick(event) {
    // 阻止冒泡到 document mousedown 把弹层关掉,但不再代为触发 generateInvite
    // (避免跟按钮自己的 onClick 重复)
    event.stopPropagation();
  }

  function handleTriggerClick() {
    // 之前这里会 auto-fire generateInvite —— 跟弹层 useEffect 拉的 /mine 同
    // 时打两条并发请求,在 chart-load 期间 (classics 走 LLM 润色, conv 创建,
    // 多次 messages 拉取) Chrome HTTP/1 连接池被挤满,新请求会被排到末尾,
    // 实测过单条 POST 在浏览器侧滞留 51 秒才返回。
    //
    // 现在改成"用户主动点'生成邀请链接'才发请求" — 弹层先显示历史 + 描述,
    // 让用户有节奏地操作,顺便也能让"我只是想看历史"的人不被拖一条无用 POST。
    // 用户点"生成"时,bootstrap 早已跑完,连接池空闲,POST 直接秒回。
    setOpen(!open);
  }

  // 复制时带上一句邀请话 — 用户粘到微信 / 飞书里直接就是 "@昵称 邀请你来
  // 合一盘 — URL"。比起裸 URL，对方收到时少一层"这是什么链接？"的猜测。
  // 想要纯 URL 的（粘到代码 / 文档里）可以二次手动选取删描述。
  // 游客账号 nickname='游客' 时也走"想跟你合个盘"分支 — 跟 invite a_nickname
  // 的过滤逻辑保持一致，避免分享文案出现 "游客 邀请你来合个盘"。
  function _composeShareText(url) {
    const name = (user.nickname || '').trim();
    const meaningful = name && name !== '游客';
    const prefix = meaningful
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
        onClick={handleTriggerClick}
        title="给这盘的人发一份邀请，让 TA 跟你合盘"
        aria-label="打开合盘邀请"
      >合盘</button>

      {open ? (
        <div
          className="hepan-invite-popover"
          role="dialog"
          aria-label="邀请合盘"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handlePopoverClick}
        >
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
              onClick={handleGenerateInviteClick}
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

// 相对时间 — "5 分钟前 / 2 天前"。给历史行做行内时间戳，让用户能区分多条
// 同名待回复邀请（A 给 5 个朋友发，邀请没填都显示 "等回复 @小夜灯"，没法
// 区分哪条对哪人）。粒度刻意粗 — 精确分钟没用，知道是"刚发的"还是"很久
// 没回"就够了。
function _relativeTime(isoString) {
  if (!isoString) return '';
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  // 7 天以上转成日期 — 月/日，比"X 周前"信息量更大
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}.${day}`;
}

function HistoryRow({ item, copied, onCopy, onDelete }) {
  const completed = item.status === 'completed';
  const ts = _relativeTime(item.created_at);
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
        {ts ? (
          <span className="hepan-invite-history-time muted">· {ts}</span>
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
