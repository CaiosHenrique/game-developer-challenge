import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { matchRecordFrom } from './api/matchRecord.ts';
import { MatchSubmitter } from './api/submissions.ts';
import { GameScreen } from './app/GameScreen.tsx';
import { MainMenu } from './app/MainMenu.tsx';
import { OptionsScreen } from './app/OptionsScreen.tsx';
import { ResultScreen, type SessionResult } from './app/ResultScreen.tsx';
import { navigate, useRoute, type MatchRequest, type Path } from './app/router.ts';
import type { MatchResult } from './game/hudStore.ts';
import { randomId } from './ids.ts';
import type { MockApiStatusStore } from './mocks/status.ts';
import { PendingSubmissions } from './storage/pendingSubmissions.ts';
import { SubmissionsContext } from './app/useSubmissions.ts';
import { configFromOptions, type GameOptions } from './game/options.ts';
import {
  loadOptions,
  loadOrCreatePlayer,
  STORAGE_KEYS,
  saveLastResult,
  saveOptions,
  type StoredResult,
} from './storage/localStore.ts';

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
 * - Its record is queued for the online ranking before it is sent; queued records are sent
 *   again when the app opens, when the browser comes back online and on Retry.
 */
export function App({ mockApi }: { mockApi: MockApiStatusStore }) {
  const route = useRoute();
  const mockApiStatus = useSyncExternalStore(mockApi.subscribe, mockApi.get);
  const queryClient = useQueryClient();
  const [submissions] = useState(() => {
    const queue = new PendingSubmissions();
    return { queue, submitter: new MatchSubmitter(queryClient, queue) };
  });
  const [options, setOptions] = useState<GameOptions>(() => loadOptions());
  /** Local, simulated identity used by the ranking and the match history. */
  const [player] = useState(() => loadOrCreatePlayer());
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  /** Match ids already processed in this session (guards Strict Mode and remounts). */
  const processedMatches = useRef(new Set<string>());

  const startMatch = useCallback(() => {
    // The match uses the options in effect now; later changes apply to the next match.
    navigate('/play', {
      match: { matchId: randomId(), options, config: configFromOptions(options) },
    });
  }, [options]);

  // Sends what is still queued from earlier sessions, and again whenever the browser is
  // back online. (The submitter never sends the same match twice at once.) Another tab
  // changing the stored queue updates this tab's view of it.
  useEffect(() => {
    const { queue, submitter } = submissions;
    submitter.submitAll();
    const onOnline = () => submitter.submitAll();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.pendingMatches || event.key === null) queue.refresh();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('storage', onStorage);
    };
  }, [submissions]);

  const handleMatchComplete = useCallback(
    (match: MatchRequest, result: MatchResult) => {
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

      // Queued first, sent after: a failed or interrupted send is never lost. Everything else
      // still queued is sent again too (never twice at once), so old pending matches resolve.
      const matchRecord = matchRecordFrom(record, player);
      if (matchRecord) submissions.queue.add(matchRecord);
      submissions.submitter.submitAll();
    },
    [player, submissions],
  );

  // `replace`: Back from the Result screen goes to the menu, never to the finished `/play`.
  const showResult = useCallback(() => navigate('/result', { replace: true }), []);
  const goHome = useCallback(() => navigate('/'), []);

  const handleSaveOptions = useCallback((next: GameOptions) => {
    setOptions(next);
    return saveOptions(next);
  }, []);

  return <SubmissionsContext value={submissions}>{screen()}</SubmissionsContext>;

  function screen() {
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
          <ResultScreen
            sessionResult={sessionResult}
            player={player}
            onPlayAgain={startMatch}
            onMainMenu={goHome}
          />
        );
      default:
        return (
          <MainMenu
            options={options}
            player={player}
            mockApi={mockApiStatus}
            onPlay={startMatch}
            onOptions={() => navigate('/options')}
          />
        );
    }
  }
}
