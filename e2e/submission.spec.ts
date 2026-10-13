import { expect, test, type Page } from '@playwright/test';
import type { MatchRecord } from '../src/api/contracts.ts';
import { STORAGE_KEYS, type StoredResult } from '../src/storage/localStore.ts';
import { collectProblems, finishMatch, startGame, waitForMatch } from './helpers.ts';

declare global {
  interface Window {
    /** URLs of the API requests seen by a counting handler. */
    __apiCalls?: string[];
  }
}

test.use({ timezoneId: 'UTC', locale: 'en-US' });

const registration = (page: Page) => page.getByTestId('result-registration');
const historyPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Match History' });
const pendingBand = (page: Page) =>
  page.getByRole('region', { name: 'Battles waiting to be submitted' });

/**
 * Replaces the registration endpoint. Every request is counted; `count` then lets the
 * normal handler answer, the others answer with a failure (`commit-then-503` stores the
 * match first, like a server that fails after committing).
 */
async function overridePut(
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

const putCount = (page: Page) => page.evaluate(() => window.__apiCalls!.length);

/** The last finished match stored on this device. */
const lastResult = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as StoredResult | null,
    STORAGE_KEYS.lastResult,
  );

/** Matches still waiting in this device's queue. */
const queued = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]') as MatchRecord[],
    STORAGE_KEYS.pendingMatches,
  );

/** How many records the mock server holds for one match (never more than one). */
function serverCopies(page: Page, matchId: string): Promise<number> {
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

async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Main Menu' }).click();
  await page.getByRole('tab', { name: 'Match History' }).click();
}

test.describe('match submission', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  /** Error responses make the browser log "Failed to load resource"; the app handles them. */
  function ignoreFailedResources() {
    problems.splice(
      0,
      problems.length,
      ...problems.filter((message) => !message.startsWith('Failed to load resource')),
    );
  }

  test('a finished match is submitted once and appears in both tabs', async ({ page }) => {
    // A setup no fixture uses, so the match is alone in its ranking.
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ sessionSeconds: 75, spawnIntervalSeconds: 2 }));
    }, STORAGE_KEYS.options);
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, 'count');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Submitted');
    expect(await putCount(page)).toBe(1);
    const { matchId, submittedAt } = (await lastResult(page))!;
    expect(submittedAt).toBeTruthy();
    expect(await queued(page)).toEqual([]);
    expect(await serverCopies(page, matchId)).toBe(1);

    await page.getByRole('button', { name: 'Main Menu' }).click();
    const ranking = page.getByRole('tabpanel', { name: 'Ranking' });
    await expect(ranking).toContainText('Matches of 75 s · enemies every 2 s');
    await expect(ranking.locator('tbody tr')).toHaveCount(1);
    await expect(ranking.locator('tbody tr')).toContainText(/1Captain [0-9A-Z]+ \(you\)001:15/);
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    await expect(historyPanel(page).locator('tbody tr')).toContainText('01:15Time up');
    await expect(pendingBand(page)).toHaveCount(0);
  });

  test('a failed submission stays queued through a reload, then is sent when the app opens', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Submitting…');
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    expect(await putCount(page)).toBe(3); // first send + 2 automatic retries
    const { matchId } = (await lastResult(page))!;
    expect((await queued(page)).map((match) => match.matchId)).toEqual([matchId]);

    // The pending submission never blocks the game.
    await page.getByRole('button', { name: 'Play Again' }).click();
    await waitForMatch(page);

    // A reload (the server works again) sends it when the app opens.
    await page.goto('/result');
    await expect(registration(page)).toHaveText('Submitted');
    expect(await queued(page)).toEqual([]);
    expect((await lastResult(page))!.submittedAt).toBeTruthy();
    expect(await serverCopies(page, matchId)).toBe(1);
    await openHistory(page);
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    await expect(pendingBand(page)).toHaveCount(0);
    ignoreFailedResources();
  });

  test('a server that commits then fails: retries and repeated Retry keep one record', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, 'commit-then-503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    const { matchId } = (await lastResult(page))!;
    expect(await putCount(page)).toBe(3);
    expect(await serverCopies(page, matchId)).toBe(1);

    // Retry, twice in a row: a single send (and its retries) runs.
    const retry = page.getByRole('button', { name: 'Retry' });
    await retry.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(registration(page)).toHaveText('Submitting…');
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    expect(await putCount(page)).toBe(6);
    expect(await serverCopies(page, matchId)).toBe(1);

    // The server recovers: Retry gets the record it already has.
    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    await retry.click();
    await expect(registration(page)).toHaveText('Submitted');
    expect(await serverCopies(page, matchId)).toBe(1);
    expect(await queued(page)).toEqual([]);
    await openHistory(page);
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    ignoreFailedResources();
  });

  test('a match the server already has is never listed twice in Match History', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, 'commit-then-503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    const { matchId } = (await lastResult(page))!;
    expect((await queued(page)).map((match) => match.matchId)).toEqual([matchId]);

    // Still queued on this device, but already in the server's list: shown once, there.
    await openHistory(page);
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    await expect(pendingBand(page)).toHaveCount(0);
    ignoreFailedResources();
  });

  test('Match History lists pending battles with a Retry', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    await openHistory(page);
    const band = pendingBand(page);
    await expect(band.getByRole('status')).toHaveText('1 battle waiting to be submitted');
    await expect(band.getByRole('listitem')).toContainText(
      '0 points · Not submitted yet: Down for repairs.',
    );
    await expect(historyPanel(page)).toContainText('No battles recorded yet.');

    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    await band.getByRole('button', { name: 'Retry' }).click();
    await expect(band).toHaveCount(0);
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    ignoreFailedResources();
  });

  test('the browser coming back online sends what is queued', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    await page.evaluate(() => {
      window.__pirateMocks!.worker.resetHandlers();
      window.dispatchEvent(new Event('online'));
    });
    await expect(registration(page)).toHaveText('Submitted');
    expect(await queued(page)).toEqual([]);
    ignoreFailedResources();
  });

  test('a conflict is shown as such, never retried automatically, and can be retried', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '409');
    await finishMatch(page);
    await expect(registration(page)).toHaveText(
      'Conflict: the online ranking holds a different record for this match.',
    );
    await page.waitForTimeout(2500); // longer than the first retry delay
    expect(await putCount(page)).toBe(1);
    expect(await queued(page)).toHaveLength(1);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => putCount(page)).toBe(2);
    await expect(registration(page)).toHaveText(
      'Conflict: the online ranking holds a different record for this match.',
    );
    ignoreFailedResources();
  });

  test('storage that stops accepting writes: the menu says data is kept in memory only', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      };
    });
    await finishMatch(page);
    await expect(page.getByTestId('result-saved')).toHaveText('No — kept for this session only');
    await expect(registration(page)).toHaveText('Submitted');
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(
      page.getByText('kept in memory only and reset when the page reloads'),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
  });

  test('pending battles are listed on the first page of Match History only', async ({ page }) => {
    // The player already has 12 matches on the server: two pages.
    await page.addInitScript(
      ({ playerKey, dbKey }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        const player = { playerId: 'e2e-player', playerName: 'Captain E2E' };
        localStorage.setItem(playerKey, JSON.stringify(player));
        const config = { sessionSeconds: 120, spawnIntervalSeconds: 5 };
        const records = Array.from({ length: 12 }, (_, index) => ({
          matchId: `own-${index}`,
          ...player,
          finishedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
          score: index,
          durationSeconds: 120,
          endReason: 'time',
          config,
          configKey: '120s-5s',
        }));
        localStorage.setItem(dbKey, JSON.stringify({ records }));
      },
      { playerKey: STORAGE_KEYS.player, dbKey: 'pirate-battle.mockdb.v1' },
    );
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    await openHistory(page);
    const panel = historyPanel(page);
    const pageStatus = panel.locator('.records-status');
    await expect(pageStatus).toHaveText('Page 1 of 2');
    await expect(pendingBand(page)).toBeVisible();
    await panel.getByRole('button', { name: 'Next match history page' }).click();
    await expect(pageStatus).toHaveText('Page 2 of 2');
    await expect(pendingBand(page)).toHaveCount(0);
    await panel.getByRole('button', { name: 'Previous match history page' }).click();
    await expect(pendingBand(page)).toBeVisible();
    ignoreFailedResources();
  });

  test('finishing a new match also sends the older pending ones', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    const first = (await lastResult(page))!.matchId;
    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());

    await page.getByRole('button', { name: 'Play Again' }).click();
    await waitForMatch(page);
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Submitted');
    const second = (await lastResult(page))!.matchId;
    await expect.poll(() => queued(page)).toEqual([]);
    expect(await serverCopies(page, first)).toBe(1);
    expect(await serverCopies(page, second)).toBe(1);
    ignoreFailedResources();
  });

  test('a confirmed match this device could not record is recovered from its stored result', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    // Storage keeps the result, but refuses the queue and then the confirmation.
    await page.evaluate(
      ({ queueKey, resultKey }) => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key === queueKey || (key === resultKey && value.includes('"submittedAt"'))) {
            throw new DOMException('Storage is full', 'QuotaExceededError');
          }
          setItem.call(this, key, value);
        };
      },
      { queueKey: STORAGE_KEYS.pendingMatches, resultKey: STORAGE_KEYS.lastResult },
    );
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Submitted'); // the server confirmed it
    const { matchId, submittedAt } = (await lastResult(page))!;
    expect(submittedAt).toBeUndefined();
    expect(await queued(page)).toEqual([]);
    expect(await serverCopies(page, matchId)).toBe(1);

    // After a reload nothing on this device says it was submitted: it can be submitted again.
    await page.goto('/result');
    await expect(registration(page)).toHaveText('Not submitted');
    await overridePut(page, 'count');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(registration(page)).toHaveText('Submitted');
    expect(await putCount(page)).toBe(1);
    expect(await serverCopies(page, matchId)).toBe(1); // recognised, not added twice
    const recovered = (await lastResult(page))!;
    expect(recovered.matchId).toBe(matchId);
    expect(recovered.submittedAt).toBeTruthy();
    expect(await queued(page)).toEqual([]);
  });

  test('an old result is submitted from the Result screen; a conflict keeps it queued', async ({
    page,
  }) => {
    // A result stored before submissions existed: never queued, never confirmed.
    const old: StoredResult = {
      matchId: 'old-match',
      finishedAt: '2026-10-01T10:00:00.000Z',
      score: 9,
      timePlayedSeconds: 120,
      reason: 'time',
      options: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
    };
    await page.addInitScript(
      ({ key, old }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key, JSON.stringify(old));
      },
      { key: STORAGE_KEYS.lastResult, old },
    );
    await page.goto('/result');
    await page.waitForFunction(() => window.__pirateMocks !== undefined);
    await expect(registration(page)).toHaveText('Not submitted');

    await overridePut(page, '409');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(registration(page)).toHaveText(
      'Conflict: the online ranking holds a different record for this match.',
    );
    // Not dropped: queued with the original match id, end time, duration and options.
    const [kept] = await queued(page);
    expect(kept).toMatchObject({
      matchId: 'old-match',
      finishedAt: old.finishedAt,
      durationSeconds: 120,
      endReason: 'time',
      config: old.options,
      score: 9,
    });

    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(registration(page)).toHaveText('Submitted');
    expect(await queued(page)).toEqual([]);
    expect(await serverCopies(page, 'old-match')).toBe(1);
    ignoreFailedResources();
  });

  test('two tabs with pending matches never lose one another', async ({ page, context }) => {
    const other = await context.newPage();
    const otherProblems = collectProblems(other);
    for (const tab of [page, other]) {
      await startGame(tab, '?scenario=open-sea');
      await overridePut(tab, '503');
    }
    for (const tab of [page, other]) {
      await finishMatch(tab);
      await expect(registration(tab)).toHaveText('Not submitted yet: Down for repairs.', {
        timeout: 10_000,
      });
    }
    const ids = async () => (await queued(page)).map((match) => match.matchId);
    expect(await ids()).toHaveLength(2);
    const [first, second] = await ids();

    // Each tab sends its own match; neither removal drops the other tab's match.
    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(registration(page)).toHaveText('Submitted');
    expect(await ids()).toEqual([second]);
    await other.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    await other.getByRole('button', { name: 'Retry' }).click();
    await expect(registration(other)).toHaveText('Submitted');
    expect(await ids()).toEqual([]);

    // The mock server, one per tab over the same storage, kept both confirmed matches.
    expect(await serverCopies(page, first!)).toBe(1);
    expect(await serverCopies(page, second!)).toBe(1);
    ignoreFailedResources();
    const unexpected = otherProblems.filter(
      (message) => !message.startsWith('Failed to load resource'),
    );
    expect(unexpected).toEqual([]);
  });

  test('the API rejects invalid records and a match id that differs from the URL', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__pirateMocks !== undefined);
    const record: MatchRecord = {
      matchId: 'api-check',
      playerId: 'e2e-player',
      playerName: 'Captain E2E',
      finishedAt: '2026-10-12T12:00:00.000Z',
      score: 4,
      durationSeconds: 120,
      endReason: 'time',
      config: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
      configKey: '120s-5s',
    };
    const put = (id: string, body: unknown) =>
      page.evaluate(
        async ({ id, body }) => {
          const response = await fetch(`/api/matches/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const json = (await response.json()) as { error?: { code: string } };
          return { status: response.status, code: json.error?.code };
        },
        { id, body },
      );
    expect(await put('other-id', record)).toEqual({ status: 400, code: 'match_id_mismatch' });
    expect(await put('api-check', { ...record, score: -1 })).toEqual({
      status: 400,
      code: 'invalid_request',
    });
    expect(await put('api-check', record)).toEqual({ status: 201, code: undefined });
    expect(await put('api-check', record)).toEqual({ status: 200, code: undefined });
    expect(await put('api-check', { ...record, score: 5 })).toEqual({
      status: 409,
      code: 'conflict',
    });
    ignoreFailedResources();
  });
});
