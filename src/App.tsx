import { useCallback, useEffect, useRef, useState } from 'react';
import { GameScreen } from './app/GameScreen.tsx';
import { MainMenu } from './app/MainMenu.tsx';
import { OptionsScreen } from './app/OptionsScreen.tsx';
import { ResultScreen, type SessionResult } from './app/ResultScreen.tsx';
import { navigate, useRoute, type MatchRequest, type Path } from './app/router.ts';
import type { MatchResult } from './game/hudStore.ts';
import { configFromOptions, type GameOptions } from './game/options.ts';
import {
  loadOptions,
  saveLastResult,
  saveOptions,
  type StoredResult,
} from './storage/localStore.ts';

/** A unique id per match (crypto.randomUUID needs a secure context; fall back otherwise). */
function newMatchId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Replaces the current history entry (e.g. a `/play` that has no match to show). */
function Redirect({ to }: { to: Path }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

/**
 * Screens and the match lifecycle.
 *
 * - A match exists only as a request made by Play / Play Again (`navigate('/play', { match })`).
 *   Reloading, deep-linking, Back or Forward to `/play` carry no request and redirect home.
 * - Leaving `/play` before the end (Main Menu, Back, reload) destroys the match: nothing saved.
 * - When a match ends, its result is processed once per match id: `finishedAt` is set here,
 *   the result is stored, and kept for this session even if storage fails.
 */
export function App() {
  const route = useRoute();
  const [options, setOptions] = useState<GameOptions>(() => loadOptions());
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  /** Match ids already processed in this session (guards Strict Mode and remounts). */
  const processedMatches = useRef(new Set<string>());

  const startMatch = useCallback(() => {
    // The match uses the options in effect now; later changes apply to the next match.
    navigate('/play', {
      match: { matchId: newMatchId(), options, config: configFromOptions(options) },
    });
  }, [options]);

  const handleMatchComplete = useCallback((match: MatchRequest, result: MatchResult) => {
    if (processedMatches.current.has(match.matchId)) return;
    processedMatches.current.add(match.matchId);
    const record: StoredResult = {
      matchId: match.matchId,
      finishedAt: new Date().toISOString(),
      score: result.score,
      timePlayedSeconds: result.timePlayedSeconds,
      reason: result.reason,
      options: match.options,
    };
    const outcome = saveLastResult(record);
    setSessionResult({ record, saved: outcome !== 'failed' });
  }, []);

  // `replace`: Back from the Result screen goes to the menu, never to the finished `/play`.
  const showResult = useCallback(() => navigate('/result', { replace: true }), []);
  const goHome = useCallback(() => navigate('/'), []);

  const handleSaveOptions = useCallback((next: GameOptions) => {
    setOptions(next);
    return saveOptions(next);
  }, []);

  switch (route.path) {
    case '/options':
      return <OptionsScreen options={options} onSave={handleSaveOptions} onBack={goHome} />;
    case '/play':
      return route.match ? (
        <GameScreen
          key={route.match.matchId}
          match={route.match}
          onExit={goHome}
          onMatchComplete={handleMatchComplete}
          onShowResult={showResult}
        />
      ) : (
        <Redirect to="/" />
      );
    case '/result':
      return (
        <ResultScreen sessionResult={sessionResult} onPlayAgain={startMatch} onMainMenu={goHome} />
      );
    default:
      return <MainMenu onPlay={startMatch} onOptions={() => navigate('/options')} />;
  }
}
