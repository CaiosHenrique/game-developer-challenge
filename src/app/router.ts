import { useSyncExternalStore } from 'react';
import type { GameConfig } from '../game/config.ts';
import type { GameOptions } from '../game/options.ts';

export type Path = '/' | '/options' | '/play' | '/result';

const PATHS: readonly Path[] = ['/', '/options', '/play', '/result'];

/** A match the player asked for: the only thing that lets `/play` mount a game. */
export type MatchRequest = {
  matchId: string;
  /** Options in effect when the match was requested, and the config built from them. */
  options: GameOptions;
  config: GameConfig;
};

export type Route = {
  path: Path;
  /**
   * Set only by `navigate('/play', { match })`. Every other navigation (push, replace,
   * back, forward or a page load) has none, so a `/play` reached any other way cannot
   * start a game.
   */
  match: MatchRequest | null;
};

function normalize(pathname: string): Path {
  return PATHS.find((path) => path === pathname) ?? '/';
}

let current: Route = { path: normalize(window.location.pathname), match: null };
const listeners = new Set<() => void>();

function emit(next: Route): void {
  current = next;
  listeners.forEach((listener) => listener());
}

window.addEventListener('popstate', () => {
  emit({ path: normalize(window.location.pathname), match: null });
});

/** Changes the screen, keeping the query string (test scenarios rely on it). */
export function navigate(
  path: Path,
  { replace = false, match = null }: { replace?: boolean; match?: MatchRequest | null } = {},
): void {
  const url = `${path}${window.location.search}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  emit({ path, match: path === '/play' ? match : null });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}
