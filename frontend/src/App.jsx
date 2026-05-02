import { Routes, Route, Navigate } from 'react-router-dom';
import { CardScreen } from './components/card/CardScreen.jsx';
import { HepanScreen } from './components/hepan/HepanScreen.jsx';
import { LandingHome } from './components/landing/LandingHome.jsx';
import AppShell from './components/AppShell.jsx';
import LegalPage from './components/LegalPage.jsx';
import PricingPage from './components/PricingPage.jsx';
import MyHepanPage from './components/hepan/MyHepanPage.jsx';

export default function App() {
  return (
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
  );
}
