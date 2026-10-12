import { useState } from 'react';
import { GameScreen } from './app/GameScreen.tsx';

type Screen = 'menu' | 'game';

export function App() {
  const [screen, setScreen] = useState<Screen>('menu');

  if (screen === 'game') return <GameScreen onExit={() => setScreen('menu')} />;

  // Provisional menu; the real main menu is built in M2.
  return (
    <main className="app">
      <h1>Pirate Battle</h1>
      <button type="button" onClick={() => setScreen('game')}>
        Play
      </button>
    </main>
  );
}
