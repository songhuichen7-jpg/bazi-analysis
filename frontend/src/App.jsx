import { Routes, Route, Navigate } from 'react-router-dom';
import { CardScreen } from './components/card/CardScreen.jsx';
import { HepanScreen } from './components/hepan/HepanScreen.jsx';
import { LandingHome } from './components/landing/LandingHome.jsx';
import AppShell from './components/AppShell.jsx';
import LegalPage from './components/LegalPage.jsx';
import PricingPage from './components/PricingPage.jsx';
import MyHepanPage from './components/hepan/MyHepanPage.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function App() {
  // ErrorBoundary 在 Routes 外面 — 任何路由层 / 页面组件 render 阶段抛错
  // 都会被它兜住，不再白屏。事件 handler / async 异常不在它范围内（那
  // 些是单点错误，由各自的 try/catch + ErrorState toast 处理）。
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingHome />} />
        <Route path="/card/:slug" element={<CardScreen />} />
        {/* /hepan/mine 在 :slug 之前 — react-router v6 实际按特定度排，但显式
            摆前面读起来更清楚：mine 是登录用户的列表，slug 是分享链接。 */}
        <Route path="/hepan/mine" element={<MyHepanPage />} />
        <Route path="/hepan/:slug" element={<HepanScreen />} />
        <Route path="/legal/:slug" element={<LegalPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/app/*" element={<AppShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
