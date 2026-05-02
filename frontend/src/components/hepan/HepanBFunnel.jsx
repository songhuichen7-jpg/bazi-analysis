// frontend/src/components/hepan/HepanBFunnel.jsx
//
// B 引流面板 — 合盘"被邀请方"看完后能往前走的两条路：
//
//   1. 病毒环：用 B 自己的生日再发一条合盘邀请。B 刚刚体会过 "填完看到搭子
//      标签" 的爽点，把同样的体验转手给 B 的朋友最自然。每个 B 都能变成下
//      一个 A，是 hepan 模块最重要的增长杠杆。
//   2. 深度转化：跳进 /app，B 的生日已经预填到主命盘表单（hepanBContext
//      里临时存的），B 再补一下出生地 + 性别就能看自己完整命盘 → 进主产
//      品漏斗。
//
// 显示条件：is_creator === false（A 不需要这个面板，A 看到的是 chat）+
// status === 'completed'（pending 阶段 B 还没填生日，谈不上继续）。
//
// 局限：B 关掉浏览器再回来 readBBirthForSlug 拿不到生日，"邀请朋友" 按钮
// 会改成软引导（去 /app 创建自己的盘 + 从那里发起邀请）。"看完整命盘" 按
// 钮始终能用 — 没有生日就让 /app 的表单从头填。
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore.js';
import { postHepanInvite } from '../../lib/hepanApi.js';
import { readBBirthForSlug } from '../../lib/hepanBContext.js';
import { track } from '../../lib/analytics.js';

export default function HepanBFunnel({ hepan, slug }) {
  const user = useAppStore((s) => s.user);
  const setBirthInfo = useAppStore((s) => s.setBirthInfo);
  const setScreen = useAppStore((s) => s.setScreen);
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  if (!hepan?.b) return null;

  const b = hepan.b;
  const bBirth = readBBirthForSlug(slug);

  // 用 B 的生日发一条以 B 为发起方的邀请。POST /api/hepan/invite 是 optional_user
  // —— 匿名也能调，后端 user_id 留 NULL，不挡 B 自己没账号的情形。
  async function createMyInvite() {
    if (!bBirth || creating) return;
    setError('');
    setCreating(true);
    try {
      const result = await postHepanInvite({
        birth: bBirth,
        nickname: b.nickname || null,
      });
      const fullUrl = `${window.location.origin}${result.invite_url}`;
      setNewInvite({ ...result, full_url: fullUrl });
      track('hepan_b_invite_create', { from_slug: slug });
    } catch (e) {
      setError(e?.message || '生成失败，再试一次');
    } finally {
      setCreating(false);
    }
  }

  async function copyInvite() {
    if (!newInvite) return;
    const name = (b.nickname || '').trim();
    const prefix = name && name !== '游客'
      ? `${name} 邀请你来合个盘`
      : '想跟你合个盘';
    const text = `${prefix} — ${newInvite.full_url}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track('hepan_b_invite_copy', { from_slug: slug });
    } catch {
      // 浏览器 clipboard 拒绝（http / 私密模式）— textarea 兜底
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); }
      catch { setError('浏览器拒绝了剪贴板访问 — 请长按 URL 手动复制'); }
      document.body.removeChild(ta);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  // "看你完整命盘" — 把 B 的生日塞进主表单，跳 /app。出生地 + 性别 B 没填，
  // 留空让 FormScreen 用各自默认值（"长沙" / "male"），用户自己再确认。
  // 没 bBirth 时（24h 后回来 / 私密模式 / 强刷过 storage）就让 /app 重新走一遍
  // 表单 — 不是空跳，至少进了主产品漏斗。
  function viewMyChart() {
    if (bBirth) {
      const dateStr = `${bBirth.year}-${String(bBirth.month).padStart(2, '0')}-${String(bBirth.day).padStart(2, '0')}`;
      const hourValid = bBirth.hour >= 0 && bBirth.hour <= 23;
      const timeStr = hourValid
        ? `${String(bBirth.hour).padStart(2, '0')}:${String(bBirth.minute || 0).padStart(2, '0')}`
        : '';
      setBirthInfo({
        date: dateStr,
        time: timeStr,
        hourUnknown: !hourValid,
        // 留空让 FormScreen 走默认 — useState 初始化时 birthInfo?.city
        // 是 undefined 就 fallback 到 '长沙'
        city: '',
        gender: 'male',
        ziConvention: 'early',
        trueSolar: true,
      });
      // 强制让 AppShell 走表单分支 — 不然有命盘的话默认 shell。
      // B 是新流量，几乎都没账号 → 大概率会先撞 AuthScreen，过完 auth
      // 再回到这个 input 状态。
      setScreen('input');
    }
    track('hepan_b_view_chart', { from_slug: slug, has_prefill: !!bBirth });
    navigate('/app');
  }

  return (
    <section className="hepan-b-funnel">
      <div className="hepan-b-funnel-head">
        <span className="hepan-b-funnel-eyebrow">想接着往下走？</span>
        <h3 className="hepan-b-funnel-title serif">
          你是 <span style={{ color: b.theme_color || 'inherit' }}>{b.cosmic_name}</span>
        </h3>
        <p className="hepan-b-funnel-sub muted">
          这是这次合盘里给你的标签 — 想看完整命盘，或者把这个体验转手给你的朋友？
        </p>
      </div>

      <div className="hepan-b-funnel-actions">
        {bBirth ? (
          newInvite ? (
            <div className="hepan-b-funnel-share">
              <div className="hepan-b-funnel-share-head muted">
                你的合盘邀请已经生成
              </div>
              <code className="hepan-b-funnel-url" title={newInvite.full_url}>
                {newInvite.full_url}
              </code>
              <button
                type="button"
                className="btn-primary hepan-b-funnel-copy"
                onClick={copyInvite}
              >{copied ? '已复制 ✓' : '复制链接'}</button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary hepan-b-funnel-cta-primary"
              onClick={createMyInvite}
              disabled={creating}
            >{creating ? '生成中…' : '邀请别人也跟你合一盘 →'}</button>
          )
        ) : null}

        <button
          type="button"
          className="btn-inline hepan-b-funnel-cta-secondary"
          onClick={viewMyChart}
        >看你完整的命盘 →</button>

        {!user ? (
          <p className="hepan-b-funnel-soft-note muted">
            登录账号能保存这次合盘 + 对方下次合盘时收到提醒。
          </p>
        ) : null}
      </div>

      {error ? <p className="hepan-b-funnel-error" role="alert">{error}</p> : null}
    </section>
  );
}
