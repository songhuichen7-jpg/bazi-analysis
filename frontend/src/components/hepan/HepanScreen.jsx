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
import HepanReadingPanel from './HepanReadingPanel.jsx';

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
    if (!y || !m || !d || y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
      setFormError('生日填写不完整，年月日都要填。');
      return;
    }
    const h = hour === '' ? -1 : parseInt(hour, 10);
    if (hour !== '' && (h < 0 || h > 23)) {
      setFormError('时辰填 0-23 之间，或者留空表示不知道。');
      return;
    }

    setSubmitting(true);
    try {
      const data = await postHepanComplete(slug, {
        birth: { year: y, month: m, day: d, hour: h, minute: 0 },
        nickname: nickname.trim() || null,
      });
      setHepan(data);
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

  if (loading) {
    return <main className="hepan-screen hepan-loading"><p>正在打开邀请…</p></main>;
  }

  if (error) {
    return (
      <main className="hepan-screen hepan-error" role="alert">
        <h1>邀请链接打不开</h1>
        <p>{error}</p>
        <Link to="/" className="primary-cta">回到首页 →</Link>
      </main>
    );
  }

  if (!hepan) return null;

  if (hepan.status === 'completed') {
    return (
      <main className="hepan-screen">
        <HepanCard ref={cardRef} hepan={hepan} />
        <div className="hepan-cta-block">
          <button
            type="button"
            className="hepan-save-button"
            onClick={handleSaveHepan}
          >
            导出合盘图
          </button>
        </div>
        {/* 完整解读 — Plan 5+ 付费功能。lite / 未登录会被后端 402 / 401，
            HepanReadingPanel 内部接 friendlyError 走 paywall toast */}
        <HepanReadingPanel slug={slug} />
      </main>
    );
  }

  // pending: show A's profile + B's form
  const inviterName = hepan.a?.nickname || '一位朋友';
  const inviterCosmic = hepan.a?.cosmic_name || '?';

  return (
    <main className="hepan-screen hepan-invite">
      <header className="hepan-invite-head">
        <p className="hepan-invite-kicker">邀请合盘</p>
        <h1>
          @{inviterName} 邀请你来合盘
        </h1>
        <p className="hepan-invite-sub">
          TA 是 <strong>{inviterCosmic}</strong>。填上你的生日，看看你们是哪种搭子。
        </p>
      </header>

      <form className="hepan-form" onSubmit={handleSubmit}>
        <div className="hepan-form-row">
          <input aria-label="年" type="number" placeholder="年"
                 value={year} onChange={e => setYear(e.target.value)} required />
          <input aria-label="月" type="number" min="1" max="12" placeholder="月"
                 value={month} onChange={e => setMonth(e.target.value)} required />
          <input aria-label="日" type="number" min="1" max="31" placeholder="日"
                 value={day} onChange={e => setDay(e.target.value)} required />
          <input aria-label="时（可选）" type="number" min="0" max="23" placeholder="时"
                 value={hour} onChange={e => setHour(e.target.value)} />
        </div>
        <div className="hepan-form-row">
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
