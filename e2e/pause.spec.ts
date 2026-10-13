import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG } from '../src/game/config.ts';
import { collectProblems, getState, startGame, step } from './helpers.ts';

const SPS = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;

const pauseDialog = (page: Page) => page.getByRole('dialog', { name: 'Paused' });
const liveRegion = (page: Page) => page.getByRole('status');

/** Simulates the page becoming hidden or visible again (headless pages stay visible). */
function setVisibility(page: Page, state: 'hidden' | 'visible') {
  return page.evaluate((visibility) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.describe('pause', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('P pauses the real-time clock and resuming does not catch up', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await page.evaluate(() => window.__pirateTest!.setManualClock(false)); // real time
    await page.waitForTimeout(300);

    await page.keyboard.press('KeyP');
    await expect(pauseDialog(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    const pausedAt = (await getState(page)).tick;
    expect((await getState(page)).pauseReason).toBe('manual');

    await page.waitForTimeout(1000);
    expect((await getState(page)).tick).toBe(pausedAt);
    expect((await step(page, 60)).tick).toBe(pausedAt); // the test clock is frozen too

    // Mark the tick and the time at the very moment P is pressed to resume.
    await page.evaluate(() => {
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.code !== 'KeyP') return;
          const mark = { at: performance.now(), tick: window.__pirateTest!.getState().tick };
          (window as unknown as { resumeMark: typeof mark }).resumeMark = mark;
        },
        { capture: true, once: true },
      );
    });
    await page.keyboard.press('KeyP');
    await expect(pauseDialog(page)).toHaveCount(0);
    const { simulatedSteps, elapsedMs } = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const mark = (window as unknown as { resumeMark: { at: number; tick: number } }).resumeMark;
      return {
        simulatedSteps: window.__pirateTest!.getState().tick - mark.tick,
        elapsedMs: performance.now() - mark.at,
      };
    });
    // No more steps than the real time since resuming allows (plus frame granularity):
    // catching up the second spent paused would add about 60 steps at once.
    expect(simulatedSteps).toBeLessThanOrEqual((elapsedMs / 1000) * SPS + 2);
    await page.waitForTimeout(300);
    expect((await getState(page)).tick).toBeGreaterThan(pausedAt);
  });

  test('keys do nothing while paused, and held keys must be pressed again', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await page.keyboard.down('KeyW');
    const sailing = await step(page, 30);
    expect(sailing.player.speed).toBeGreaterThan(0);

    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyQ'); // a broadside, while paused
    expect((await step(page, 60)).tick).toBe(sailing.tick);

    await page.keyboard.press('KeyP'); // resume with W still physically held
    const after = await step(page, 30);
    await page.keyboard.up('KeyW');
    expect(after.player.speed).toBeLessThan(sailing.player.speed); // coasting, not sailing
    expect(after.shotsFired).toEqual({ front: 0, left: 0, right: 0 });
    expect(after.projectiles).toEqual([]);
  });

  test('losing focus or hiding the page pauses; coming back does not resume', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const start = await step(page, 10);

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(pauseDialog(page)).toContainText('lost focus');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    let state = await step(page, 60);
    expect(state.pauseReason).toBe('blur');
    expect(state.tick).toBe(start.tick);

    await page.getByRole('button', { name: 'Resume' }).click();
    expect((await step(page, 10)).tick).toBe(start.tick + 10);

    await setVisibility(page, 'hidden');
    await expect(pauseDialog(page)).toContainText('page was hidden');
    await setVisibility(page, 'visible');
    state = await step(page, 60);
    expect(state.pauseReason).toBe('hidden');
    expect(state.tick).toBe(start.tick + 10);

    await page.keyboard.press('Escape');
    await expect(pauseDialog(page)).toHaveCount(0);
    expect((await step(page, 5)).tick).toBe(start.tick + 15);
  });

  test('the pause button opens a dialog that keeps keyboard focus', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await page.getByRole('button', { name: 'Pause' }).click();
    const resume = page.getByRole('button', { name: 'Resume' });
    const menu = pauseDialog(page).getByRole('button', { name: 'Main Menu' });
    await expect(resume).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(menu).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(resume).toBeFocused(); // wraps around instead of leaving the dialog
    await page.keyboard.press('Shift+Tab');
    await expect(menu).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(pauseDialog(page)).toHaveCount(0);
    await page.keyboard.press('KeyP');
    await expect(pauseDialog(page)).toBeVisible();
  });
});

test.describe('announcements', () => {
  test('the live region only announces discrete events', async ({ page }) => {
    const problems = collectProblems(page);
    await startGame(page, '?scenario=open-sea');
    await expect(liveRegion(page)).toHaveText('');

    // Ten quiet seconds, one step at a time: the clock is never announced.
    await page.evaluate(() => {
      for (let i = 0; i < 600; i += 1) window.__pirateTest!.step(1);
    });
    await expect(liveRegion(page)).toHaveText('');

    await page.keyboard.press('KeyP');
    await expect(liveRegion(page)).toHaveText('Game paused.');
    await page.keyboard.press('KeyP');
    await expect(liveRegion(page)).toHaveText('Game resumed.');

    await step(page, 80 * SPS); // 110 s left -> 30 s left
    await expect(liveRegion(page)).toHaveText('30 seconds left.');
    await step(page, 20 * SPS);
    await expect(liveRegion(page)).toHaveText('10 seconds left.');
    await step(page, 10 * SPS);
    await expect(liveRegion(page)).toHaveText('Battle complete. Final score 0.');
    expect(problems).toEqual([]);
  });

  test('score and low health are announced', async ({ page }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await page.keyboard.down('Space');
    await page.evaluate(() => {
      const api = window.__pirateTest!;
      while (api.getState().score === 0) api.step(1);
    });
    await page.keyboard.up('Space');
    await expect(liveRegion(page)).toHaveText('Score 1.');

    await startGame(page, '?scenario=last-stand'); // starts at one ram's worth of health
    await expect(liveRegion(page)).toHaveText('Health low.');
  });
});
