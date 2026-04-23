// frontend/src/components/card/LandingScreen.jsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCardStore } from '../../store/useCardStore.js';
import { BirthForm } from './BirthForm.jsx';
import { CardSkeleton } from './CardSkeleton.jsx';
import { track } from '../../lib/analytics.js';

export function LandingScreen() {
  const navigate = useNavigate();
  const { loading, error, submitBirth } = useCardStore();

  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from') || 'direct';
    track('form_start', { from });
  }, []);

  async function handleSubmit() {
    const card = await submitBirth();
    if (card) navigate(`/card/${card.share_slug}`);
  }

  if (loading) return <CardSkeleton />;

  return (
    <main className="landing-screen">
      <header className="hero">
        <h1>查八字</h1>
        <p className="tagline">3 秒看你的人格图鉴</p>
      </header>
      <BirthForm onSubmit={handleSubmit} />
      {error && <div className="form-error" role="alert">{error}</div>}
    </main>
  );
}
