import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteHepanInvite, getHepanMine } from '../../lib/hepanApi.js';
import { formatYearMonthDay } from '../../lib/userMenu.js';

// /hepan/mine — 登录用户的"我邀请过的合盘"管理页。
// 命盘页 top-bar 的 HepanInviteButton 弹窗里有简版历史；这一页是完整版：
// 按状态分组（等回复 / 已合）、有 reading 状态徽章、有删除入口。
//
// 软删后行立刻消失（局部更新），不重新拉接口；完整刷新走 F5。
export default function MyHepanPage() {
  const [items, setItems] = useState(null);  // null = 加载中；[] = 空
  const [error, setError] = useState('');
  const [busySlug, setBusySlug] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getHepanMine();
        if (!cancelled) setItems(data?.items || []);
      } catch (e) {
        if (cancelled) return;
        if (e?.status === 401) {
          // 没登录直接踢回首页 — 这页不展示给匿名用户
          navigate('/', { replace: true });
          return;
        }
        setError(e?.message || '拉取失败');
        setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  function goBack() {
    const idx = typeof window !== 'undefined' ? window.history.state?.idx : undefined;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/app', { replace: true });
  }

  async function copyUrl(slug) {
    const url = `${window.location.origin}/hepan/${slug}`;
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  async function onDelete(slug) {
    if (busySlug) return;
    if (!window.confirm('删除这条邀请？删除后链接立即失效，对方无法再打开。')) return;
    setBusySlug(slug);
    setError('');
    try {
      await deleteHepanInvite(slug);
      setItems((prev) => (prev || []).filter((it) => it.slug !== slug));
    } catch (e) {
      setError(e?.message || '删除失败');
    } finally {
      setBusySlug(null);
    }
  }

  if (items === null) {
    return (
      <div className="screen active mine-screen">
        <div className="mine-wrap">
          <button className="legal-back" type="button" onClick={goBack}>← 返回</button>
          <h1 className="serif mine-title">我的合盘</h1>
          <p className="muted mine-loading">正在加载…</p>
        </div>
      </div>
    );
  }

  // 按状态分组 — 没回的放上面（用户多半在等 B 填）
  const pending = items.filter((it) => it.status === 'pending');
  const completed = items.filter((it) => it.status === 'completed');

  return (
    <div className="screen active mine-screen">
      <div className="mine-wrap">
        <button className="legal-back" type="button" onClick={goBack}>← 返回</button>
        <div className="legal-eyebrow">我 邀 请 过 的</div>
        <h1 className="serif mine-title">我的合盘</h1>
        <p className="mine-lede muted">
          每条邀请背后都是一段关系。可以复制链接重发、看完整解读，或撤回不再有效的邀请。
        </p>

        {error ? <div className="user-center-error" role="alert">{error}</div> : null}

        {items.length === 0 ? (
          <div className="mine-empty">
            <p>你还没邀请过谁。</p>
            <p className="muted">从命盘页的「合盘」按钮发一条邀请试试。</p>
            <Link to="/app" className="btn-primary mine-empty-cta">回到命盘 →</Link>
          </div>
        ) : (
          <div className="mine-groups">
            {pending.length ? (
              <MineGroup
                title="等回复"
                hint="对方还没填生日 — 链接还能再复制一次发出去。"
                items={pending}
                busySlug={busySlug}
                onCopy={copyUrl}
                onDelete={onDelete}
              />
            ) : null}
            {completed.length ? (
              <MineGroup
                title="已合"
                hint="可以打开看双方关系卡片 + 完整解读。"
                items={completed}
                busySlug={busySlug}
                onCopy={copyUrl}
                onDelete={onDelete}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function MineGroup({ title, hint, items, busySlug, onCopy, onDelete }) {
  return (
    <section className="mine-group">
      <header className="mine-group-head">
        <h2 className="mine-group-title">{title}</h2>
        <span className="mine-group-count muted">{items.length}</span>
        <p className="mine-group-hint muted">{hint}</p>
      </header>
      <ul className="mine-list">
        {items.map((it) => (
          <MineRow
            key={it.slug}
            item={it}
            busy={busySlug === it.slug}
            onCopy={() => onCopy(it.slug)}
            onDelete={() => onDelete(it.slug)}
          />
        ))}
      </ul>
    </section>
  );
}

function MineRow({ item, busy, onCopy, onDelete }) {
  const completed = item.status === 'completed';
  const created = formatYearMonthDay(item.created_at);
  const aName = item.a_nickname || '我';
  const bName = item.b_nickname || (completed ? '对方' : '?');
  return (
    <li
      className={'mine-row mine-row-' + item.status}
      style={item.pair_theme_color ? { '--pair-theme': item.pair_theme_color } : undefined}
    >
      <div className="mine-row-left">
        <div className="mine-row-headline">
          <span className="mine-row-pair">
            <span className="serif">{item.a_cosmic_name || '?'}</span>
            <span className="mine-row-x"> × </span>
            <span className="serif">{item.b_cosmic_name || '?'}</span>
          </span>
          {completed && item.label ? (
            <span className="mine-row-label">「{item.label}」</span>
          ) : null}
        </div>
        <div className="mine-row-meta muted">
          <span>@{aName} × @{bName}</span>
          <span className="mine-row-dot">·</span>
          <span>发于 {created}</span>
          {item.share_count > 0 ? (
            <>
              <span className="mine-row-dot">·</span>
              <span>访问 {item.share_count} 次</span>
            </>
          ) : null}
          {completed ? (
            item.has_reading ? (
              <>
                <span className="mine-row-dot">·</span>
                <span className="mine-row-tag mine-row-tag-read">完整解读 已生成</span>
              </>
            ) : (
              <>
                <span className="mine-row-dot">·</span>
                <span className="mine-row-tag mine-row-tag-unread">完整解读 未读</span>
              </>
            )
          ) : null}
        </div>
      </div>
      <div className="mine-row-actions">
        <Link className="btn-inline" to={`/hepan/${item.slug}`}>查看</Link>
        <button type="button" className="user-center-link" onClick={onCopy}>
          复制链接
        </button>
        <button
          type="button"
          className="user-center-link mine-row-delete"
          onClick={onDelete}
          disabled={busy}
          title="删除后链接立即失效"
        >{busy ? '删除中…' : '删除'}</button>
      </div>
    </li>
  );
}
