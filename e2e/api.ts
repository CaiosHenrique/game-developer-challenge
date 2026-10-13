import type { Page } from '@playwright/test';
import type { MatchRecord } from '../src/api/contracts.ts';
import { STORAGE_KEYS, type StoredResult } from '../src/storage/localStore.ts';

/** Helpers shared by the tests of the ranking, history and match-submission API. */

declare global {
  interface Window {
    /** API requests recorded by a test (URLs or paths, depending on the recorder). */
    __apiCalls?: string[];
  }
}

/**
 * Replaces the registration endpoint. Every request is counted in `window.__apiCalls`;
 * `count` then lets the normal handler answer, the others answer with a failure
 * (`commit-then-503` stores the match first, like a server that fails after committing).
 */
export async function overridePut(
  page: Page,
  behavior: 'count' | '503' | 'commit-then-503' | '409',
): Promise<void> {
  await page.evaluate((kind) => {
    const { worker, http, HttpResponse, db } = window.__pirateMocks!;
    window.__apiCalls = [];
    worker.use(
      http.put('/api/matches/:matchId', async ({ request }) => {
        window.__apiCalls!.push(request.url);
        if (kind === 'count') return;
        if (kind === '409') {
          return HttpResponse.json(
            { error: { code: 'conflict', message: 'Another record already uses this match id.' } },
            { status: 409 },
          );
        }
        if (kind === 'commit-then-503') db.upsert((await request.clone().json()) as MatchRecord);
        return HttpResponse.json(
          { error: { code: 'unavailable', message: 'Down for repairs.' } },
          { status: 503 },
        );
      }),
    );
  }, behavior);
}

/** How many records the mock server holds for one match (never more than one). */
export function serverCopies(page: Page, matchId: string): Promise<number> {
  return page.evaluate(
    ({ matchId, playerKey }) => {
      const { playerId } = JSON.parse(localStorage.getItem(playerKey)!) as { playerId: string };
      return window
        .__pirateMocks!.db.playerMatches(playerId, 1, 50)
        .items.filter((match) => match.matchId === matchId).length;
    },
    { matchId, playerKey: STORAGE_KEYS.player },
  );
}

/** The last finished match stored on this device. */
export const lastResult = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as StoredResult | null,
    STORAGE_KEYS.lastResult,
  );

/**
 * Error responses make the browser log "Failed to load resource" for the request. They are
 * expected in tests of failures (the app handles them): they are removed from `problems`,
 * in place; anything else still fails the test.
 */
export function ignoreFailedResources(problems: string[]): void {
  problems.splice(
    0,
    problems.length,
    ...problems.filter((message) => !message.startsWith('Failed to load resource')),
  );
}
