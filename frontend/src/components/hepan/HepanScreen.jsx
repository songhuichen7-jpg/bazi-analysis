// frontend/src/components/hepan/HepanScreen.jsx
//
// /hepan/:slug — opens an A-created invite. Two modes:
//   - status='pending': show A's profile + form for B to fill in
//   - status='completed': show the rendered HepanCard
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { getHepan, postHepanComplete } from '../../lib/hepanApi.js';
import { track } from '../../lib/analytics.js';
import { saveCardAsImage } from '../../lib/saveImage.js';
import { HepanCard } from './HepanCard.jsx';
import HepanChat from './HepanChat.jsx';
import HepanReadingPanel from './HepanReadingPanel.jsx';
import HepanBFunnel from './HepanBFunnel.jsx';
import { downloadHepanMarkdown } from '../../lib/hepanExport.js';
import { rememberBBirth } from '../../lib/hepanBContext.js';

export function HepanScreen() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const [hepan, setHepan] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const cardRef = useRef(null);

  // form state for B
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [hour, setHour] = useState('');
  const [nickname, setNickname] = useState('');
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setLoading(true);
    getHepan(slug)
      .then(data => {
        if (cancelled) return;
        setHepan(data);
        setError(null);
        track('hepan_view', {
          slug,
          status: data.status,
          from: searchParams.get('from') || 'direct',
        });
      })
      .catch(e => {
        if (cancelled) return;
        setError(e.message || '邀请链接打不开');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    // 拆开校验 — 一锅炖会让"年填了但越界"的人看到"年月日都要填"的错误，
    // 莫名其妙。分三档分别说话。
    if (!y || !m || !d) {
      setFormError('生日填写不完整，年月日都要填。');
      return;
    }
    if (y < 1900 || y > 2100) {
      setFormError('出生年份要在 1900-2100 之间。');
      return;
    }
    if (m < 1 || m > 12) {
      setFormError('月份要在 1-12 之间。');
      return;
    }
    if (d < 1 || d > 31) {
      setFormError('日期要在 1-31 之间。');
      return;
    }
    const h = hour === '' ? -1 : parseInt(hour, 10);
    if (hour !== '' && (h < 0 || h > 23)) {
      setFormError('时辰填 0-23 之间，或者留空表示不知道。');
      return;
    }

    setSubmitting(true);
    try {
      const birth = { year: y, month: m, day: d, hour: h, minute: 0 };
      const data = await postHepanComplete(slug, {
        birth,
        nickname: nickname.trim() || null,
      });
      setHepan(data);
      // 给 HepanBFunnel 记一笔 — 服务端只存 birth_hash，本地这一份是
      // 之后 "用 B 的生日发邀请 / 跳 /app 预填表单" 的唯一来源（TTL 24h）
      rememberBBirth(slug, birth);
      track('hepan_complete', {
        slug,
        category: data.category,
        state_pair: data.state_pair,
      });
    } catch (e) {
      setFormError(e.message || '提交失败，再试一次。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveHepan() {
    if (!cardRef.current || !hepan) return;
    await saveCardAsImage(cardRef.current, {
      typeId: `${hepan.a?.type_id || ''}x${hepan.b?.type_id || ''}`,
      cosmicName: hepan.label || 'hepan',
      onTrack: () => track('hepan_card_save', {
        slug,
        category: hepan.category,
        state_pair: hepan.state_pair,
      }),
    });
  }

  // 文字版导出 — markdown：卡片 + 完整解读 + 创建者的对话历史。
  // 创建者拿全套；非创建者只拿卡片 + reading（如果有）。
  const [exporting, setExporting] = useState(false);
  async function handleExportText() {
    if (!hepan || exporting) return;
    setExporting(true);
    try {
      await downloadHepanMarkdown({ slug, isCreator: !!hepan.is_creator });
      track('hepan_text_export', { slug, is_creator: !!hepan.is_creator });
    } catch (e) {
      console.error('[hepan] export failed', e);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <main className="hepan-screen hepan-screen-narrow hepan-loading"><p>正在打开邀请…</p></main>;
  }

  if (error) {
    return (
      <main className="hepan-screen hepan-screen-narrow hepan-error" role="alert">
        <h1>邀请链接打不开</h1>
        <p>{error}</p>
        <Link to="/" className="primary-cta">回到首页 →</Link>
      </main>
    );
  }

  if (!hepan) return null;

  if (hepan.status === 'completed') {
    return (
      // 左右两栏：左边 sticky 摆卡片 + 导出按钮；右边滚 reading + chat。
      // 视觉上模仿主 app 的 Shell（左命盘右对话），但 hepan 是阅读优先，
      // 所以右边占主视区，卡片在左边做"身份证"样的 sticky 锚定。
      <main className="hepan-screen hepan-screen-split">
        <div className="hepan-stage hepan-stage-left">
          <HepanCard ref={cardRef} hepan={hepan} />
          <div className="hepan-cta-block">
            <button
              type="button"
              className="hepan-save-button"
              onClick={handleSaveHepan}
            >
              导出合盘图
            </button>
            <button
              type="button"
              className="hepan-export-text-button"
              onClick={handleExportText}
              disabled={exporting}
              title="把卡片 + 完整解读 + 对话历史打包成 markdown 下载"
            >
              {exporting ? '打包中…' : '导出全文 (Markdown)'}
            </button>
          </div>
        </div>
        <div className="hepan-stage hepan-stage-right">
          {/* B 引流面板 — 只在非创建者视角出现。位置故意排在 reading 上面：
              B 没有 unlock 完整解读的入口（要么 401 要么 paywall），所以
              首屏的视觉权重应该让给"邀请朋友 / 看自己完整命盘"两个能往
              前走的动作。A 看自己的盘时这块不出现 — A 走的是 chat 路径。 */}
          {!hepan.is_creator ? <HepanBFunnel hepan={hepan} slug={slug} /> : null}

          {/* 完整解读 — Plan 5+ 付费功能。lite / 未登录会被后端 402 / 401，
              HepanReadingPanel 内部接 friendlyError 走 paywall toast */}
          <HepanReadingPanel slug={slug} />

          {/* 多轮对话 — 只有创建者本人能进。后端 is_creator 决定是否挂出，
              HepanChat 内部 401/404 fallback 是双重保险（万一接口先回但
              is_creator 还没传到）。B 跟匿名访客不会看到这个区块。 */}
          {hepan.is_creator ? <HepanChat slug={slug} hepan={hepan} /> : null}
        </div>
      </main>
    );
  }

  // pending: show A's profile + B's form
  // 游客账号默认 nickname 是字符串 "游客" — 直接显示成 "@游客 邀请你来合盘"
  // 又冷又像群发，导致 B 转化率掉。这里做一道 fallback：把 "游客" / 空 当
  // null 处理，优先用 cosmic_name（小夜灯 / 多肉 这类有人味的代号）。
  const _aNick = hepan.a?.nickname;
  const _meaningfulNick = _aNick && _aNick !== '游客' ? _aNick : null;
  const inviterName = _meaningfulNick || hepan.a?.cosmic_name || '一位朋友';
  const inviterCosmic = hepan.a?.cosmic_name || '?';

  return (
    <main className="hepan-screen hepan-screen-narrow hepan-invite">
      <header className="hepan-invite-head">
        <p className="hepan-invite-kicker">邀请合盘</p>
        <h1>
          @{inviterName} 邀请你来合盘
        </h1>
        <p className="hepan-invite-sub">
          TA 是 <strong>{inviterCosmic}</strong>。填上你的生日，看看你们是哪种搭子。
        </p>
      </header>

      {/* noValidate — 整站错误样式都是自定义 .hepan-form-error；不让浏览
          器原生气泡跳出来抢走焦点。所有校验在 handleSubmit 里走一遍。 */}
      <form className="hepan-form" onSubmit={handleSubmit} noValidate>
        <div className="hepan-form-row">
          <input aria-label="年" type="number" min="1900" max="2100" placeholder="年"
                 value={year} onChange={e => setYear(e.target.value)} />
          <input aria-label="月" type="number" min="1" max="12" placeholder="月"
                 value={month} onChange={e => setMonth(e.target.value)} />
          <input aria-label="日" type="number" min="1" max="31" placeholder="日"
                 value={day} onChange={e => setDay(e.target.value)} />
          <input aria-label="时（可选）" type="number" min="0" max="23" placeholder="时"
                 value={hour} onChange={e => setHour(e.target.value)} />
        </div>
        <div className="hepan-form-row hepan-form-row-text">
          <input aria-label="昵称" type="text" placeholder="你的昵称（可选）"
                 maxLength={10}
                 value={nickname} onChange={e => setNickname(e.target.value)} />
        </div>
        {formError ? <p className="hepan-form-error">{formError}</p> : null}
        <button type="submit" className="hepan-form-submit" disabled={submitting}>
          {submitting ? '正在合盘…' : '看我们是哪种搭子 →'}
        </button>
        <p className="hepan-privacy-note">
          生日仅用于排盘，原始日期不会被保存。
        </p>
      </form>
    </main>
  );
}
