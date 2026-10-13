import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getAssetProgress,
  loadGameAssets,
  subscribeAssetProgress,
  type GameTextures,
} from '../game/assets.ts';
import { GameRuntime } from '../game/GameRuntime.ts';
import { HudStore, type MatchResult, type PauseReason } from '../game/hudStore.ts';
import {
  testManualClockFromQuery,
  testOptionsFromQuery,
  testResultDelayFromQuery,
} from '../game/scenarios.ts';
import { Dialog } from './Dialog.tsx';
import { Hud } from './Hud.tsx';
import type { MatchRequest } from './router.ts';
import { TouchControls } from './TouchControls.tsx';
import { PORTRAIT_TOUCH_QUERY, TOUCH_DEVICE_QUERY, useMediaQuery } from './useMediaQuery.ts';
import { useTouchTap } from './useTouchTap.ts';
import type { TouchAction } from '../game/touchInput.ts';

/** Time the ended match stays on screen (explosion, wreck) before the Result screen. */
export const RESULT_DELAY_MS = 1000;

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; textures: GameTextures };

type MatchCallbacks = {
  onExit: () => void;
  /** Called when the match ends (the parent processes each match id once). */
  onMatchComplete: (match: MatchRequest, result: MatchResult) => void;
  /** Called once the end of the match has been shown. */
  onShowResult: () => void;
};

/** One requested match: asset loading, then the game. Mounted once per match id. */
export function GameScreen({ match, ...callbacks }: { match: MatchRequest } & MatchCallbacks) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const progress = useSyncExternalStore(subscribeAssetProgress, getAssetProgress);

  useEffect(() => {
    let active = true;
    loadGameAssets().then(
      (textures) => active && setLoadState({ status: 'ready', textures }),
      () => active && setLoadState({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoadState({ status: 'loading' });
    setAttempt((value) => value + 1);
  };

  return (
    <main className="game-screen">
      {loadState.status === 'ready' ? (
        <Match textures={loadState.textures} match={match} {...callbacks} />
      ) : (
        <div className="game-toolbar">
          <button type="button" onClick={callbacks.onExit}>
            Main Menu
          </button>
        </div>
      )}

      {loadState.status === 'loading' && (
        <div className="game-message" role="status">
          <p>Loading assets… {Math.round(progress * 100)}%</p>
          <progress max={1} value={progress} aria-label="Asset loading progress" />
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="game-message" role="alert">
          <p>Failed to load the game assets. Check your connection and try again.</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </main>
  );
}

function Match({
  textures,
  match,
  onExit,
  onMatchComplete,
  onShowResult,
}: { textures: GameTextures; match: MatchRequest } & MatchCallbacks) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [failed, setFailed] = useState(false);
  const [store] = useState(() => new HudStore(GameRuntime.initialHud(match.config)));
  const hud = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const touchDevice = useMediaQuery(TOUCH_DEVICE_QUERY);
  const portraitTouch = useMediaQuery(PORTRAIT_TOUCH_QUERY);
  /** Latest orientation, read when the runtime finishes starting. */
  const portraitRef = useRef(portraitTouch);

  // Matches are played in landscape on touch devices: turning to portrait pauses an active
  // match (an existing pause keeps its reason). Turning back never resumes by itself.
  useEffect(() => {
    portraitRef.current = portraitTouch;
    if (portraitTouch) runtimeRef.current?.pause('orientation');
  }, [portraitTouch]);

  const touchDown = useCallback(
    (pointerId: number, action: TouchAction) => runtimeRef.current?.touchDown(pointerId, action),
    [],
  );
  const touchUp = useCallback((pointerId: number) => runtimeRef.current?.touchUp(pointerId), []);
  const releaseTouches = useCallback(() => runtimeRef.current?.releaseTouches(), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const debugColliders = new URLSearchParams(window.location.search).get('debug') === 'colliders';
    const runtime = new GameRuntime(host, textures, match.config, store, {
      debugColliders,
      simulation: testOptionsFromQuery(window.location.search),
      manualClock: testManualClockFromQuery(window.location.search),
    });
    runtimeRef.current = runtime;
    runtime
      .start()
      .then(() => {
        // Already in portrait when the match became ready: start paused.
        if (portraitRef.current) runtime.pause('orientation');
      })
      .catch(() => {
        runtime.destroy();
        setFailed(true);
      });
    return () => {
      runtime.destroy();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [textures, store, match.config]);

  // The match ended: hand the result over once, then show it after a short moment. The
  // timer is cancelled if the match is left (or unmounted) before it fires.
  useEffect(() => {
    if (!hud.result) return;
    onMatchComplete(match, hud.result);
    const delay = testResultDelayFromQuery(window.location.search) ?? RESULT_DELAY_MS;
    const timer = window.setTimeout(onShowResult, delay);
    return () => window.clearTimeout(timer);
  }, [hud.result, match, onMatchComplete, onShowResult]);

  return (
    <>
      <div ref={hostRef} className="game-host" data-testid="game-host" />
      <Hud hud={hud} onPause={() => runtimeRef.current?.pause('manual')} />
      {/* Discrete events only (score, time warnings, pause, low health, match end). */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {hud.announcement}
      </div>
      {hud.result ? null : hud.pauseReason ? (
        <PauseDialog
          reason={hud.pauseReason}
          onResume={() => runtimeRef.current?.resume()}
          onMainMenu={onExit}
        />
      ) : (
        <div className="game-toolbar">
          <button type="button" onClick={onExit}>
            Main Menu
          </button>
        </div>
      )}
      {touchDevice && hud.phase === 'running' && !hud.pauseReason && (
        <TouchControls onPress={touchDown} onRelease={touchUp} onReleaseAll={releaseTouches} />
      )}
      {portraitTouch && (
        <div className="rotate-prompt" role="alert">
          <p>Rotate your device to landscape to play.</p>
        </div>
      )}
      {failed && (
        <div className="game-message" role="alert">
          <p>The game could not start. Reload the page to try again.</p>
        </div>
      )}
    </>
  );
}

const PAUSE_MESSAGES: Record<PauseReason, string> = {
  manual: 'The battle is on hold.',
  blur: 'Paused because the game window lost focus.',
  hidden: 'Paused because the page was hidden.',
  orientation: 'Paused while the device was held in portrait.',
};

/** Pause dialog: only a player action (Resume, P or Esc) resumes the match. */
function PauseDialog({
  reason,
  onResume,
  onMainMenu,
}: {
  reason: PauseReason;
  onResume: () => void;
  onMainMenu: () => void;
}) {
  const resumeTap = useTouchTap(onResume);
  const mainMenuTap = useTouchTap(onMainMenu);
  return (
    <Dialog titleId="pause-title" descriptionId="pause-reason">
      <h2 id="pause-title">Paused</h2>
      <p id="pause-reason" className="end-details">
        {PAUSE_MESSAGES[reason]}
      </p>
      <p className="pause-hint">Press P or Esc to resume.</p>
      <div className="end-actions">
        <button type="button" {...resumeTap}>
          Resume
        </button>
        <button type="button" {...mainMenuTap}>
          Main Menu
        </button>
      </div>
    </Dialog>
  );
}
