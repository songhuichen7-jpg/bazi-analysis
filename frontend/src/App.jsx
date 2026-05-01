import { Routes, Route, Navigate } from 'react-router-dom';
import { CardScreen } from './components/card/CardScreen.jsx';
import { HepanScreen } from './components/hepan/HepanScreen.jsx';
import { LandingHome } from './components/landing/LandingHome.jsx';
import AppShell from './components/AppShell.jsx';
import LegalPage from './components/LegalPage.jsx';

export const ROUTES = ['/', '/card/:slug', '/hepan/:slug', '/legal/:slug', '/app/*'];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingHome />} />
      <Route path="/card/:slug" element={<CardScreen />} />
      <Route path="/hepan/:slug" element={<HepanScreen />} />
      <Route path="/legal/:slug" element={<LegalPage />} />
      <Route path="/app/*" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
