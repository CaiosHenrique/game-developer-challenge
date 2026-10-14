import { expect, test, type Page } from '@playwright/test';
import type { MatchRecord } from '../src/api/contracts.ts';
import { STORAGE_KEYS } from '../src/storage/localStore.ts';
import { lastResult, serverCopies } from './api.ts';
import {
  collectProblems,
  finishMatch,
  getState,
  lifecycle,
  startGame,
  step,
  waitForMatch,
} from './helpers.ts';

/**
 * React Strict Mode, for real: the `chromium-strict` project serves a development build of the
 * e2e app (`npm run build:e2e:dev`), where <StrictMode> mounts, unmounts and mounts again every
 * effect. Each test first proves it runs there: React reports a development bundle to the
 * DevTools hook (bundleType 1; production reports 0).
 */

declare global {
  interface Window {
    /** Bundle types React registered with the (stand-in) DevTools hook: 1 dev, 0 production. */
    __reactBundleTypes?: number[];
  }
}

const canvases = (page: Page) => page.locator('canvas');

/** Counts the match submissions (PUT) the page sends, whoever answers them. */
function countSubmissions(page: Page): { count: () => number } {
  let puts = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname.startsWith('/api/matches/')) {
      puts += 1;
    }
  });
  return { count: () => puts };
}

async function expectDevelopmentReact(page: Page) {
  expect(await page.evaluate(() => window.__reactBundleTypes)).toEqual([1]);
}

test.describe('React Strict Mode (development build)', () => {
  let problems: string[];

  test.beforeEach(async ({ page }) => {
    problems = collectProblems(page);
    // A minimal stand-in for the React DevTools hook: React (development or production)
    // registers its renderer with it, telling which build it is.
    await page.addInitScript(() => {
      window.__reactBundleTypes = [];
      const noop = () => {};
      (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        isDisabled: false,
        renderers: new Map(),
        inject(renderer: { bundleType: number }) {
          window.__reactBundleTypes!.push(renderer.bundleType);
          return window.__reactBundleTypes!.length;
        },
        checkDCE: noop,
        onScheduleFiberRoot: noop,
        onCommitFiberRoot: noop,
        onCommitFiberUnmount: noop,
        onPostCommitFiberRoot: noop,
        setStrictMode: noop,
      };
    });
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('a match mounts twice, keeps one runtime and one canvas, and plays', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await expectDevelopmentReact(page);

    // The first runtime was destroyed while PixiJS was initializing; only the second runs.
    await expect
      .poll(() => lifecycle(page))
      .toEqual({
        constructed: 2,
        initialized: 1,
        disposedBeforeInit: 1,
        failed: 0,
        destroyed: 0,
        live: 1,
      });
    await expect(canvases(page)).toHaveCount(1);
    expect((await getState(page)).liveRuntimes).toBe(1);

    // The surviving runtime is the one wired to the keyboard and the clock.
    const before = await getState(page);
    await page.keyboard.down('KeyW');
    const after = await step(page, 30);
    await page.keyboard.up('KeyW');
    expect(after.tick).toBe(before.tick + 30);
    expect(after.player.y).toBeLessThan(before.player.y);

    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(canvases(page)).toHaveCount(0);
    await expect.poll(async () => (await lifecycle(page)).live).toBe(0);
  });

  test('repeated navigation leaves no runtime or canvas behind', async ({ page }) => {
    await page.goto('/?scenario=open-sea&clock=manual');
    await expectDevelopmentReact(page);
    const play = page.getByRole('button', { name: 'Play' });
    const mainMenu = page.getByRole('button', { name: 'Main Menu' });

    // Enter and leave with the Main Menu button.
    for (let round = 0; round < 3; round += 1) {
      await play.click();
      await waitForMatch(page);
      await expect(canvases(page)).toHaveCount(1);
      await expect.poll(async () => (await lifecycle(page)).live).toBe(1);
      await mainMenu.click();
      await expect(canvases(page)).toHaveCount(0);
      await expect.poll(async () => (await lifecycle(page)).live).toBe(0);
    }

    // Leave with the browser's Back button.
    await play.click();
    await waitForMatch(page);
    await page.goBack();
    await expect(canvases(page)).toHaveCount(0);
    await expect.poll(async () => (await lifecycle(page)).live).toBe(0);

    // Leave at once, while the runtime may still be initializing.
    for (let round = 0; round < 3; round += 1) {
      await play.click();
      await mainMenu.click();
    }

    // Play Again from the Result screen replaces the finished match.
    await play.click();
    await waitForMatch(page);
    await finishMatch(page);
    await page.getByRole('button', { name: 'Play Again' }).click();
    await waitForMatch(page);
    await expect(canvases(page)).toHaveCount(1);
    await expect.poll(async () => (await lifecycle(page)).live).toBe(1);
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(canvases(page)).toHaveCount(0);

    // Every runtime ever created has settled: initialized and destroyed, or torn down
    // before its initialization finished. None is left running.
    await expect
      .poll(async () => {
        const counts = await lifecycle(page);
        return counts.constructed - counts.initialized - counts.disposedBeforeInit;
      })
      .toBe(0);
    const counts = await lifecycle(page);
    expect(counts.live).toBe(0);
    expect(counts.failed).toBe(0);
    expect(counts.destroyed).toBe(counts.initialized);
    expect(counts.disposedBeforeInit).toBeGreaterThanOrEqual(5); // one per match at least
  });

  test('the end of a match stores one result and sends one submission', async ({ page }) => {
    const submissions = countSubmissions(page);
    // Counts the writes of a new last result (a later write only adds `submittedAt`).
    await page.addInitScript((key) => {
      const setItem = Storage.prototype.setItem;
      (window as unknown as { resultWrites: number }).resultWrites = 0;
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name === key && !('submittedAt' in (JSON.parse(value) as object))) {
          (window as unknown as { resultWrites: number }).resultWrites += 1;
        }
        return setItem.call(this, name, value);
      };
    }, STORAGE_KEYS.lastResult);

    await startGame(page, '?scenario=open-sea');
    await expectDevelopmentReact(page);
    await expect.poll(async () => (await lifecycle(page)).disposedBeforeInit).toBe(1);
    await finishMatch(page);
    await expect(page.getByTestId('result-registration')).toHaveText('Submitted');

    const { matchId } = (await lastResult(page))!;
    expect(
      await page.evaluate(() => (window as unknown as { resultWrites: number }).resultWrites),
    ).toBe(1);
    expect(submissions.count()).toBe(1);
    expect(await serverCopies(page, matchId)).toBe(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.pendingMatches),
    ).toBe('[]');
  });

  test('a match still queued when the app opens is sent once', async ({ page }) => {
    const submissions = countSubmissions(page);
    const player = { playerId: 'strict-player', playerName: 'Captain STRI' };
    const pending: MatchRecord = {
      matchId: 'strict-pending-1',
      playerId: player.playerId,
      playerName: player.playerName,
      finishedAt: '2026-10-13T12:00:00.000Z',
      score: 3,
      durationSeconds: 120,
      endReason: 'time',
      config: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
      configKey: '120s-5s',
    };
    // A match queued in an earlier session (written once, before the app's first load).
    await page.addInitScript(
      ({ keys, player, pending }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(keys.player, JSON.stringify(player));
        localStorage.setItem(keys.pendingMatches, JSON.stringify([pending]));
      },
      { keys: STORAGE_KEYS, player, pending },
    );

    // On start, the app sends the queue from an effect, which Strict Mode runs twice.
    await page.goto('/');
    await expectDevelopmentReact(page);
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.pendingMatches))
      .toBe('[]');
    expect(submissions.count()).toBe(1);
    expect(await serverCopies(page, pending.matchId)).toBe(1);
  });
});
