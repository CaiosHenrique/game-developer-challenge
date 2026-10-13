import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import {
  environment,
  frameRecorder,
  frameStats,
  measureRefreshMs,
  memoryAfterGc,
  openCdp,
  startRecording,
  stopRecording,
  type FrameStats,
} from './perf.ts';

/**
 * Performance and memory audit of the game (`npm run perf`). Every scenario runs the real
 * game: real clock, real keyboard input, real rendering. The e2e test hooks are only read
 * (entity counts) and used to finish matches quickly in the memory cycles.
 * Results go to docs/perf/<project>.json. Settings (environment variables):
 * PERF_RUNS (default 3 headed, 1 headless), PERF_MATCH_SECONDS (default 180).
 */

/** Match length, within the Options limits (60 to 180 s). */
const MATCH_SECONDS = Math.min(180, Math.max(60, Number(process.env.PERF_MATCH_SECONDS ?? 180)));
const STABILIZATION_MS = 3000;
const PAUSE_MS = 3000;
const CYCLES = 6;
const CYCLE_SECONDS = 20;
const QUICK_CYCLES = 20;
const OPTIONS_KEY = 'pirate-battle.options.v1';

const runsFor = (testInfo: TestInfo) =>
  Number(process.env.PERF_RUNS ?? (testInfo.project.name === 'edge-headed' ? 3 : 1));

type Results = Record<string, unknown>;
const results: Results = {};

test.describe.configure({ mode: 'serial' });

/** A fresh browser context (cold start: no cache, no service worker, empty storage). */
async function freshPage(browser: Browser, testInfo: TestInfo) {
  const { baseURL, viewport } = testInfo.project.use;
  const context = await browser.newContext({ baseURL, viewport });
  await context.addInitScript(frameRecorder);
  // Match length MATCH_SECONDS (3 minutes by default), enemies every 5 s (the default).
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: OPTIONS_KEY,
    value: JSON.stringify({ sessionSeconds: MATCH_SECONDS, spawnIntervalSeconds: 5 }),
  });
  const page = await context.newPage();
  const problems: string[] = [];
  const aborted: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  // Aborted requests are expected (TanStack Query cancels list requests it replaces, e.g.
  // after a confirmed submission); any other network failure is a problem.
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    if (reason === 'net::ERR_ABORTED') aborted.push(request.url());
    else problems.push(`request failed (${reason}): ${request.url()}`);
  });
  return { context, page, problems, aborted };
}

const now = (page: Page) => page.evaluate(() => performance.now());

/** The menu is interactive and its ranking answered (a list, or an empty one). */
async function waitForMenu(page: Page) {
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.records').first()).toBeVisible({ timeout: 20_000 });
}

/** Starts a match from the menu; returns the time from the click to the running match. */
async function enterMatch(page: Page) {
  const clicked = await now(page);
  await page.getByRole('button', { name: 'Play' }).click();
  const running = await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="game-host"] canvas') !== null &&
      window.__pirateTest?.getState().phase === 'running'
        ? performance.now()
        : false,
    undefined,
    { polling: 'raf', timeout: 20_000 },
  );
  return Math.round(((await running.jsonValue()) as number) - clicked);
}

/** Holds W, alternates turns and fires every gun, until `stop()`; idle while `paused()`. */
async function playInput(page: Page, stop: () => boolean, paused: () => boolean) {
  let round = 0;
  while (!stop()) {
    if (paused()) {
      await page.waitForTimeout(100);
      continue;
    }
    const turn = round % 2 === 0 ? 'KeyD' : 'KeyA';
    await page.keyboard.down('KeyW');
    await page.keyboard.down(turn);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await page.keyboard.press(round % 2 === 0 ? 'KeyE' : 'KeyQ');
    await page.waitForTimeout(300);
    await page.keyboard.up(turn);
    await page.waitForTimeout(300);
    round += 1;
  }
  await page.keyboard.up('KeyW');
}

type Sample = {
  t: number;
  costMs: number;
  phase: string;
  tick: number;
  pauseReason: string | null;
  enemies: number;
  projectiles: number;
  effects: number | null;
  dynamicChildren: number | null;
};

const sample = (page: Page): Promise<Sample> =>
  page.evaluate(() => {
    const start = performance.now();
    const state = window.__pirateTest!.getState();
    return {
      t: performance.now(),
      costMs: performance.now() - start,
      phase: state.phase,
      tick: state.tick,
      pauseReason: state.pauseReason,
      enemies: state.enemies.length,
      projectiles: state.projectiles.length,
      effects: state.render?.effects ?? null,
      dynamicChildren: state.render?.dynamicChildren ?? null,
    };
  });

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : null;
};
const spread = (values: number[]) => ({
  median: median(values),
  min: values.length ? Math.min(...values) : null,
  max: values.length ? Math.max(...values) : null,
  n: values.length,
});

/** Writes what was measured so far (each test adds its part) to docs/perf/<project>.json. */
function save(testInfo: TestInfo) {
  const directory = path.resolve('docs/perf');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${testInfo.project.name}.json`),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...results }, null, 2)}\n`,
  );
}

type StartupRun = {
  responseEndMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  menuReadyMs: number;
  rankingReadyMs: number;
  consoleProblems: string[];
  abortedRequests: number;
};

test('startup: cold load to an interactive menu', async ({ browser }, testInfo) => {
  const runs: StartupRun[] = [];
  for (let run = 0; run < runsFor(testInfo); run += 1) {
    const { context, page, problems, aborted } = await freshPage(browser, testInfo);
    await page.goto('/');
    await waitForMenu(page);
    if (run === 0) {
      await page.bringToFront();
      results.environment = await environment(
        page,
        browser,
        testInfo.project.use.headless !== false,
      );
      results.refreshMs = Math.round((await measureRefreshMs(page)) * 100) / 100;
    }
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        'navigation',
      )[0] as PerformanceNavigationTiming;
      return {
        responseEndMs: Math.round(navigation.responseEnd),
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadMs: Math.round(navigation.loadEventEnd),
        menuReadyMs: Math.round(window.__perf!.marks.menuReady ?? -1),
        rankingReadyMs: Math.round(window.__perf!.marks.rankingReady ?? -1),
      };
    });
    runs.push({ ...timing, consoleProblems: problems, abortedRequests: aborted.length });
    await context.close();
  }
  results.startup = {
    runs,
    summary: Object.fromEntries(
      ['responseEndMs', 'domContentLoadedMs', 'loadMs', 'menuReadyMs', 'rankingReadyMs'].map(
        (key) => [key, spread(runs.map((run) => run[key as keyof StartupRun] as number))],
      ),
    ),
  };
  save(testInfo);
});

test('a three-minute match: entry, frames, entities, pause, end and navigation', async ({
  browser,
}, testInfo) => {
  const refreshMs = (results.refreshMs as number | undefined) ?? 16.67;
  const runs = [];
  for (let run = 0; run < runsFor(testInfo); run += 1) {
    const { context, page, problems, aborted } = await freshPage(browser, testInfo);
    await page.goto('/?scenario=endless-spawns');
    await waitForMenu(page);
    await page.bringToFront();

    await startRecording(page);
    const entryMs = await enterMatch(page);
    const matchStart = await now(page);
    let stop = false;
    let scriptedPause = false;
    const input = playInput(
      page,
      () => stop,
      () => scriptedPause,
    );

    const samples: Sample[] = [];
    let interrupted: string | null = null;
    let pauseCheck: { tickBefore: number; tickAfter: number } | null = null;
    while (true) {
      const current = await sample(page);
      samples.push(current);
      if (current.phase === 'ended') break;
      if (current.pauseReason && !scriptedPause) {
        interrupted = `paused by "${current.pauseReason}" (window lost focus or was hidden)`;
        break;
      }
      // One scripted pause a third of the way in; its frames are excluded (dialog shown).
      if (pauseCheck === null && current.t - matchStart > (MATCH_SECONDS * 1000) / 3) {
        scriptedPause = true;
        await page.waitForTimeout(800); // let the input loop release its keys
        await page.keyboard.press('KeyP');
        const tickBefore = (await sample(page)).tick;
        await page.waitForTimeout(PAUSE_MS);
        const tickAfter = (await sample(page)).tick;
        pauseCheck = { tickBefore, tickAfter };
        await page.keyboard.press('KeyP');
        scriptedPause = false;
      }
      await page.waitForTimeout(1000);
    }
    stop = true;
    await input;
    const { frames, longFrames } = await stopRecording(page);
    const ended = await now(page);

    const stabilization = frames.filter(
      ([t]) => t >= matchStart && t < matchStart + STABILIZATION_MS,
    );
    const steady = frames.filter(([t]) => t >= matchStart + STABILIZATION_MS && t <= ended);
    const counts = (key: 'enemies' | 'projectiles' | 'effects' | 'dynamicChildren') => {
      const values = samples.map((s) => s[key] ?? 0);
      return {
        max: Math.max(...values),
        average: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
      };
    };

    // End of the match, Result screen, back to the menu, then the other screens.
    let navigation = null;
    if (!interrupted) {
      // (The Result screen appears 1 s after the end, by design: not measured.)
      await page
        .getByRole('heading', { level: 1, name: 'Battle Complete' })
        .waitFor({ timeout: 10_000 });
      const toMenu = await now(page);
      await page.getByRole('button', { name: 'Main Menu' }).click();
      await waitForMenu(page);
      const menuBack = await now(page);
      await page.getByRole('button', { name: 'Options' }).click();
      await page.getByRole('heading', { level: 1, name: 'Options' }).waitFor();
      const optionsShown = await now(page);
      await page.getByRole('button', { name: 'Main Menu' }).click();
      await waitForMenu(page);
      const menuAgain = await now(page);
      await page.getByRole('tab', { name: 'Match History' }).click();
      await expect(
        page.getByRole('tabpanel', { name: 'Match History' }).locator('tbody tr').first(),
      ).toBeVisible();
      const historyShown = await now(page);
      navigation = {
        resultToMenuMs: Math.round(menuBack - toMenu),
        menuToOptionsMs: Math.round(optionsShown - menuBack),
        optionsToMenuMs: Math.round(menuAgain - optionsShown),
        historyTabMs: Math.round(historyShown - menuAgain),
      };
    }

    runs.push({
      valid: interrupted === null,
      interrupted,
      matchSeconds: Math.round((ended - matchStart) / 100) / 10,
      entryMs,
      stabilization: frameStats(stabilization, refreshMs),
      steady: frameStats(steady, refreshMs),
      longAnimationFrames: {
        supported: await page.evaluate(() => window.__perf!.longFramesSupported),
        count: longFrames.filter((f) => f.start >= matchStart && f.start <= ended).length,
        maxMs: Math.round(Math.max(0, ...longFrames.map((f) => f.duration))),
        // The frames of 100 ms or more, with the scripts they ran: what caused each hitch.
        over100ms: longFrames
          .filter((f) => f.start >= matchStart && f.start <= ended && f.duration >= 100)
          .slice(0, 20)
          .map((f) => ({
            atSecond: Math.round((f.start - matchStart) / 100) / 10,
            durationMs: Math.round(f.duration),
            blockingMs: Math.round(f.blocking),
            scripts: f.scripts,
          })),
      },
      pause: pauseCheck,
      entities: {
        samples: samples.length,
        enemies: counts('enemies'),
        projectiles: counts('projectiles'),
        effects: counts('effects'),
        displayObjects: counts('dynamicChildren'),
        sampleCostMs: spread(samples.map((s) => Math.round(s.costMs * 100) / 100)),
      },
      navigation,
      consoleProblems: problems,
      abortedRequests: aborted.length,
    });
    await context.close();
  }

  const valid = runs.filter((run) => run.valid);
  const pick = (get: (stats: FrameStats) => number | null) =>
    spread(valid.map((run) => get(run.steady)).filter((v): v is number => v !== null));
  results.match = {
    settings: {
      scenario: 'endless-spawns (the player cannot sink; enemies spawn as usual)',
      matchSeconds: MATCH_SECONDS,
      stabilizationMs: STABILIZATION_MS,
      scriptedPauseMs: PAUSE_MS,
    },
    runs,
    validRuns: valid.length,
    summary: {
      fpsAverage: pick((s) => s.fpsAverage),
      frameP50: pick((s) => s.frameMs.p50),
      frameP95: pick((s) => s.frameMs.p95),
      frameP99: pick((s) => s.frameMs.p99),
      frameMax: pick((s) => s.frameMs.max),
      missedRefreshes: pick((s) => s.missedRefreshes),
      over50ms: pick((s) => s.over50ms),
      entryMs: spread(valid.map((run) => run.entryMs)),
    },
  };
  save(testInfo);
  // While paused, the simulation did not advance.
  for (const run of runs.filter((run) => run.pause)) {
    expect(run.pause!.tickAfter).toBe(run.pause!.tickBefore);
  }
});

test('repeated matches without a reload: memory and lifecycle', async ({ browser }, testInfo) => {
  const refreshMs = (results.refreshMs as number | undefined) ?? 16.67;
  const { context, page, problems, aborted } = await freshPage(browser, testInfo);
  await page.goto('/?scenario=endless-spawns');
  await waitForMenu(page);
  await page.bringToFront();
  const cdp = await openCdp(page);
  const counters = async () => ({
    ...(await memoryAfterGc(cdp)),
    canvases: await page.locator('canvas').count(),
  });

  const atMenu = [{ cycle: 0, ...(await counters()) }];
  const cycles = [];
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    await startRecording(page);
    const entryMs = await enterMatch(page);
    const liveRuntimes = await page.evaluate(() => window.__pirateTest!.getState().liveRuntimes);
    let stop = false;
    const input = playInput(
      page,
      () => stop,
      () => false,
    );
    await page.waitForTimeout(CYCLE_SECONDS * 1000);
    stop = true;
    await input;
    const { frames } = await stopRecording(page);
    const interrupted = await page.evaluate(() => window.__pirateTest!.getState().pauseReason);
    // Finish the match through the test hook (the rest of the 3 minutes, simulated at once).
    await page.evaluate(() => {
      const api = window.__pirateTest!;
      api.step(api.getState().remainingTicks);
    });
    await page
      .getByRole('heading', { level: 1, name: 'Battle Complete' })
      .waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await waitForMenu(page);
    atMenu.push({ cycle, ...(await counters()) });
    cycles.push({
      cycle,
      entryMs,
      liveRuntimesDuringMatch: liveRuntimes,
      interrupted,
      frames: frameStats(frames.slice(Math.round(STABILIZATION_MS / refreshMs)), refreshMs),
    });
  }

  // Many quick enter / leave cycles: one WebGL context each, released on leave.
  const beforeQuick = await counters();
  for (let index = 0; index < QUICK_CYCLES; index += 1) {
    await enterMatch(page);
    await page.locator('.game-toolbar').getByRole('button', { name: 'Main Menu' }).click();
    await waitForMenu(page);
  }
  const afterQuick = await counters();

  const heap = atMenu.slice(2).map((point) => point.jsHeapUsedMB ?? 0);
  results.cycles = {
    settings: { cycles: CYCLES, playedSecondsPerCycle: CYCLE_SECONDS, quickCycles: QUICK_CYCLES },
    atMenuAfterGc: atMenu,
    cycles,
    quickCycles: { before: beforeQuick, after: afterQuick },
    heapFromCycle2: {
      values: heap,
      rangeMB: Math.round((Math.max(...heap) - Math.min(...heap)) * 100) / 100,
      monotonicIncrease: heap.every((value, index) => index === 0 || value > heap[index - 1]!),
    },
    webglContextWarnings: problems.filter((message) => /WebGL/i.test(message)),
    consoleProblems: problems,
    abortedRequests: aborted.length,
  };
  await context.close();
  save(testInfo);
  expect(atMenu.every((point) => point.canvases === 0)).toBe(true);
  expect(afterQuick.canvases).toBe(0);
});
