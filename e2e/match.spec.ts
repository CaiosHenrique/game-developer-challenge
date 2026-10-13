import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG } from '../src/game/config.ts';
import { collectProblems, getState, startGame, step } from './helpers.ts';

const SPS = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;
const DURATION_TICKS = DEFAULT_GAME_CONFIG.match.durationSeconds * SPS;
const MAX_HP = DEFAULT_GAME_CONFIG.player.maxHp;
const RAM_DAMAGE = DEFAULT_GAME_CONFIG.enemies.chaser.impactDamage;

/** Steps one tick at a time (each step publishes to the HUD) until the match ends. */
function stepUntilEnded(page: Page, limit: number) {
  return page.evaluate((max) => {
    const api = window.__pirateTest!;
    for (let i = 0; i < max && api.getState().phase === 'running'; i += 1) api.step(1);
    return api.getState();
  }, limit);
}

test.describe('match lifecycle', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('the timer ends the match; the HUD and the end panel show the result', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const hud = page.getByRole('region', { name: 'Match status' });
    await expect(hud).toContainText('02:00');
    await expect(hud).toContainText(`${MAX_HP} / ${MAX_HP}`);

    let state = await step(page, DURATION_TICKS - 1);
    expect(state.phase).toBe('running');
    await expect(hud).toContainText('00:01');

    state = await step(page, 1);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('time');
    expect(state.endTick).toBe(DURATION_TICKS);
    await expect(hud).toContainText('00:00');

    const panel = page.getByRole('dialog', { name: 'Battle Complete' });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('end-score')).toHaveText('0');
    await expect(panel.getByTestId('end-time')).toHaveText('02:00');
    await expect(panel).toContainText('Time up');
    await expect(panel.getByRole('button', { name: 'Play Again' })).toBeFocused();
  });

  test('an ended match no longer reacts to input', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await step(page, DURATION_TICKS);
    const ended = await getState(page);

    for (const key of ['KeyW', 'KeyD', 'KeyQ', 'KeyE']) await page.keyboard.down(key);
    const after = await step(page, 120);
    for (const key of ['KeyW', 'KeyD', 'KeyQ', 'KeyE']) await page.keyboard.up(key);

    expect(after.tick).toBe(ended.tick);
    expect(after.player).toEqual(ended.player);
    expect(after.projectiles).toEqual([]);
    expect(after.shotsFired).toEqual(ended.shotsFired);
  });

  test('sinking ends the match by death and shows the wreck', async ({ page }) => {
    await startGame(page, '?scenario=last-stand');
    const state = await stepUntilEnded(page, 600);

    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('death');
    expect(state.player.hp).toBe(0);
    expect(state.render!.shipStages[0]).toBe(3); // wreck
    expect(state.render!.healthBars).toBe(0); // the sunk ship's bar is hidden
    const panel = page.getByRole('dialog', { name: 'Your Ship Sank' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Ship sunk');
    await expect(page.getByRole('region', { name: 'Match status' })).toContainText(`0 / ${MAX_HP}`);
  });

  test('the HUD is only updated when a shown value changes, not every frame', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const before = await getState(page);
    // 600 single steps, each followed by a HUD update attempt: only the clock changes,
    // once per simulated second.
    const after = await page.evaluate(() => {
      const api = window.__pirateTest!;
      for (let i = 0; i < 600; i += 1) api.step(1);
      return api.getState();
    });
    expect(after.hudEmissions - before.hudEmissions).toBe(10);
    await expect(page.getByRole('region', { name: 'Match status' })).toContainText('01:50');
  });

  test('ships show damage stages, fire and health bars', async ({ page }) => {
    await startGame(page, '?scenario=chaser-ahead');
    let state = await getState(page);
    expect(state.render!.healthBars).toBe(2); // player and chaser
    expect(state.render!.shipStages[1]).toBe(0);

    await page.keyboard.down('Space');
    await step(page, 1);
    await page.keyboard.up('Space');
    state = await page.evaluate(() => {
      const api = window.__pirateTest!;
      while (api.getState().enemies[0]!.hp === api.getState().enemies[0]!.maxHp) api.step(1);
      return api.getState();
    });
    const chaser = state.enemies[0]!;
    expect(chaser.hp).toBe(15); // 40 - 25: 37.5% left
    expect(state.render!.shipStages[chaser.id]).toBe(1);
    expect(state.render!.fires).toBe(1);
    expect(state.render!.shipStages[0]).toBe(0);
  });

  test('Play Again starts a fresh match with a single canvas', async ({ page }) => {
    // Every match on this page, including the next one, starts on the manual clock.
    await startGame(page, '?scenario=last-stand');
    const ended = await stepUntilEnded(page, 600);
    expect(ended.endReason).toBe('death');
    expect(ended.liveRuntimes).toBe(1);

    // Game keys are released at the end: Space (the front gun during play) now activates the
    // focused button instead of being captured by the game.
    await expect(page.getByRole('button', { name: 'Play Again' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('end-panel')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.waitForFunction(() => window.__pirateTest?.getState().phase === 'running');

    const fresh = await getState(page);
    // The previous runtime was destroyed (its canvas alone would vanish with its component).
    expect(fresh.liveRuntimes).toBe(1);
    expect(fresh.phase).toBe('running');
    expect(fresh.tick).toBe(0);
    expect(fresh.score).toBe(0);
    expect(fresh.player.hp).toBe(RAM_DAMAGE); // the scenario's starting health, restored
    expect(fresh.enemies).toHaveLength(1);
    expect(fresh.enemies[0]!.hp).toBe(fresh.enemies[0]!.maxHp);
    await expect(page.getByRole('region', { name: 'Match status' })).toContainText('02:00');

    // The Space press that started this match did not reach it: nothing was fired.
    const later = await step(page, 30);
    expect(later.shotsFired).toEqual({ front: 0, left: 0, right: 0 });
    expect(later.projectiles).toEqual([]);
  });
});
