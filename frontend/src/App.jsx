import { Routes, Route, Navigate } from 'react-router-dom';
import { LandingScreen } from './components/card/LandingScreen.jsx';
import { CardScreen } from './components/card/CardScreen.jsx';
import AppShell from './components/AppShell.jsx';

export const ROUTES = ['/', '/card/:slug', '/app/*'];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingScreen />} />
      <Route path="/card/:slug" element={<CardScreen />} />
      <Route path="/app/*" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
