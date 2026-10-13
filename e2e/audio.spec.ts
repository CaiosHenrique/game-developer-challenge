import { expect, test, type Page } from '@playwright/test';
import type { PlayRecord } from '../src/game/audio/AudioEngine.ts';
import { SOUND_IDS } from '../src/game/audio/soundMap.ts';
import {
  collectProblems,
  finishMatch,
  getState,
  startGame,
  step,
  stepUntilHit,
  waitForMatch,
} from './helpers.ts';

/**
 * Sound effects, observed through the e2e build's record of requested sounds and their
 * outcome (`window.__pirateAudio`); no sound device is needed, nothing depends on hearing.
 */

const audioState = (page: Page) => page.evaluate(() => window.__pirateAudio!.state());
const records = (page: Page): Promise<PlayRecord[]> =>
  page.evaluate(() => window.__pirateAudio!.records());
const clearRecords = (page: Page) => page.evaluate(() => window.__pirateAudio!.clearRecords());
const played = async (page: Page) =>
  (await records(page)).filter((record) => record.status === 'played').map((record) => record.id);

/** Waits until the background loading of the sounds is over. */
async function audioReady(page: Page) {
  await page.waitForFunction(() => window.__pirateAudio!.state().status === 'ready');
}

async function fire(page: Page, key: 'Space' | 'KeyQ') {
  await page.keyboard.down(key);
  await step(page, 1);
  await page.keyboard.up(key);
}

const pauseDialog = (page: Page) => page.getByRole('dialog', { name: 'Paused' });
const muteSwitch = (page: Page) => page.getByRole('button', { name: 'Mute sound effects' });

test.describe('sound effects', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('nothing is requested before Play; Play unlocks the audio and loads every sound', async ({
    page,
  }) => {
    await page.goto('/?scenario=open-sea&clock=manual');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(await audioState(page)).toMatchObject({ status: 'locked', loaded: 0 });
    expect(await records(page)).toEqual([]);

    await page.getByRole('button', { name: 'Play' }).click();
    await waitForMatch(page);
    await audioReady(page);
    expect(await audioState(page)).toMatchObject({ status: 'ready', loaded: SOUND_IDS.length });
    // The match started: game_start was requested once (maybe before its file had loaded).
    expect((await records(page)).filter((record) => record.id === 'game_start')).toHaveLength(1);
  });

  test('the front gun and a broadside request their own sounds', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await audioReady(page);
    await clearRecords(page);

    await fire(page, 'Space');
    await fire(page, 'KeyQ');
    expect(await played(page)).toEqual(['cannon_fire_1', 'cannon_broadside']);
  });

  test('hits on a ship, a sunk ship and its point request their sounds', async ({ page }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await audioReady(page);
    await page.keyboard.down('Space');
    await stepUntilHit(page, 'enemy');
    expect(await played(page)).toContain('ship_wood_hit_1');

    await clearRecords(page);
    await page.evaluate(() => {
      const api = window.__pirateTest!;
      for (let i = 0; i < 600 && api.getState().enemies.length > 0; i += 1) api.step(1);
    });
    await page.keyboard.up('Space');
    expect((await getState(page)).score).toBe(1);
    expect(await played(page)).toEqual(expect.arrayContaining(['ship_explosion_1', 'score_point']));
  });

  test('a ram is one collision sound, without a wood hit or an explosion', async ({ page }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await audioReady(page);
    await clearRecords(page);
    await stepUntilHit(page, 'player');
    expect((await records(page)).map((record) => record.id)).toEqual(['ship_collision']);
  });

  test('the end of a match: time up completes, a sinking is game over, then silence', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await audioReady(page);
    await clearRecords(page);
    await finishMatch(page);
    expect((await records(page)).map((record) => record.id)).toEqual(['game_complete']);

    await startGame(page, '?scenario=last-stand&resultDelay=60000');
    await audioReady(page);
    await clearRecords(page);
    const sunk = await stepUntilHit(page, 'player');
    expect(sunk.phase).toBe('ended');
    expect((await records(page)).map((record) => record.id)).toEqual(['game_over']);
    await step(page, 120); // an ended match is frozen: nothing more is requested
    expect((await records(page)).map((record) => record.id)).toEqual(['game_over']);
  });

  test('pause stops what plays and blocks sounds; resume lets them through again', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await audioReady(page);
    await fire(page, 'KeyQ');
    expect((await audioState(page)).active).toBeGreaterThan(0);
    await clearRecords(page);

    await page.keyboard.press('KeyP');
    await expect(pauseDialog(page)).toBeVisible();
    expect(await played(page)).toEqual(['game_pause']);
    expect((await audioState(page)).active).toBeLessThanOrEqual(1); // the pause cue only
    // While paused, time does not move (Space would press the focused Resume button).
    await step(page, 60);
    expect((await records(page)).map((record) => record.id)).toEqual(['game_pause']);

    await page.keyboard.press('Escape');
    await expect(pauseDialog(page)).toHaveCount(0);
    await fire(page, 'Space');
    expect(await played(page)).toEqual(['game_pause', 'game_resume', 'cannon_fire_1']);
  });

  test('mute by keyboard: at once, stated to assistive technology, kept after a reload', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await audioReady(page);
    await fire(page, 'KeyQ');

    await page.keyboard.press('KeyP');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(muteSwitch(page)).toBeFocused();
    await expect(muteSwitch(page)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(muteSwitch(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await audioState(page)).toMatchObject({ muted: true, active: 0 });

    await clearRecords(page);
    await page.keyboard.press('Escape');
    await fire(page, 'Space');
    expect(await records(page)).toEqual([
      { id: 'game_resume', status: 'muted' },
      { id: 'cannon_fire_1', status: 'muted' },
    ]);

    // Kept on the device: a new page load starts muted.
    await startGame(page, '?scenario=open-sea');
    expect((await audioState(page)).muted).toBe(true);
    await page.keyboard.press('KeyP');
    await expect(muteSwitch(page)).toHaveAttribute('aria-pressed', 'true');

    // Unmuting replays nothing that was muted; new sounds play again.
    await muteSwitch(page).click();
    await expect(muteSwitch(page)).toHaveAttribute('aria-pressed', 'false');
    await audioReady(page);
    await clearRecords(page);
    await page.keyboard.press('Escape');
    expect(await played(page)).toEqual(['game_resume']);
  });

  test('Play Again starts clean: one sound per event, nothing left from the last match', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    await audioReady(page);
    await finishMatch(page);
    await page.getByRole('button', { name: 'Play Again' }).click();
    const state = await waitForMatch(page);
    expect(state.liveRuntimes).toBe(1);
    await clearRecords(page);
    expect((await audioState(page)).active).toBeLessThanOrEqual(1); // at most the new game_start

    await fire(page, 'Space');
    expect(await records(page)).toEqual([{ id: 'cannon_fire_1', status: 'played' }]);
  });

  test('sound files that cannot be decoded leave the game silent, playable and quiet', async ({
    page,
  }) => {
    // On the context: the sound files are fetched through the mock API's service worker.
    await page
      .context()
      .route('**/game/sounds/*.wav', (route) =>
        route.fulfill({ status: 200, contentType: 'audio/wav', body: 'not audio' }),
      );
    await startGame(page, '?scenario=open-sea');
    await audioReady(page);
    expect((await audioState(page)).loaded).toBe(0);

    await page.keyboard.down('KeyW');
    const sailed = await step(page, 60);
    await page.keyboard.up('KeyW');
    expect(sailed.player.speed).toBeGreaterThan(0);
    await fire(page, 'Space');
    expect((await records(page)).at(-1)).toEqual({ id: 'cannon_fire_1', status: 'not-loaded' });
  });

  test('a browser without Web Audio plays the game silently and quietly', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { AudioContext?: unknown }).AudioContext;
      delete (window as { webkitAudioContext?: unknown }).webkitAudioContext;
    });
    await startGame(page, '?scenario=open-sea');
    expect((await audioState(page)).status).toBe('unavailable');
    await fire(page, 'Space');
    expect((await getState(page)).shotsFired.front).toBe(1);
    expect((await records(page)).at(-1)).toEqual({ id: 'cannon_fire_1', status: 'unavailable' });
  });
});
