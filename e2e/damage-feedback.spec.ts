import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG, secondsToTicks } from '../src/game/config.ts';
import { collectProblems, startGame, step, stepUntilHit } from './helpers.ts';

/** Feedback of a hit on the player's ship: a short hull tint and a pulse of the health bar. */

const PLAYER_MAX_HP = DEFAULT_GAME_CONFIG.player.maxHp;
const RAM_DAMAGE = DEFAULT_GAME_CONFIG.enemies.chaser.impactDamage;
/** The tint lasts 0.3 s of simulation time. */
const FLASH_TICKS = secondsToTicks(0.3, DEFAULT_GAME_CONFIG.simulation.stepsPerSecond);

const healthBar = (page: Page) => page.locator('.hud-bar');
const animation = (page: Page) =>
  healthBar(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
const fillSource = (page: Page) => healthBar(page).locator('img').nth(1).getAttribute('src');

test.describe('damage feedback', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('a hit on the player tints its ship for 0.3 s and pulses the health bar once', async ({
    page,
  }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await expect(healthBar(page)).not.toHaveClass(/hud-bar-hit/);
    const fillBefore = await fillSource(page);

    const hit = await stepUntilHit(page, 'player');
    expect(hit.player.hp).toBe(PLAYER_MAX_HP - RAM_DAMAGE);
    expect(hit.hud.playerHits).toBe(1);
    expect(hit.render!.hitFlashShips).toEqual([0]);

    // The bar pulses once, briefly; its value and its colour are those of the new health.
    await expect(healthBar(page)).toHaveClass(/hud-bar-hit/);
    expect(await animation(page)).toEqual({ name: 'hud-hit-pulse', duration: '0.3s' });
    await expect(page.locator('.hud-bar-label')).toHaveText(
      `${PLAYER_MAX_HP - RAM_DAMAGE} / ${PLAYER_MAX_HP}`,
    );
    expect(await fillSource(page)).toBe(fillBefore); // still above 2/3: the same green art

    // The tint ends after 0.3 s of simulation time, not earlier.
    expect((await step(page, FLASH_TICKS - 1)).render!.hitFlashShips).toEqual([0]);
    expect((await step(page, 1)).render!.hitFlashShips).toEqual([]);
  });

  test('a hit on an enemy tints no ship and does not pulse the health bar', async ({ page }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await page.keyboard.down('Space');
    const hit = await stepUntilHit(page, 'enemy');
    await page.keyboard.up('Space');

    expect(hit.player.hp).toBe(PLAYER_MAX_HP);
    expect(hit.enemies[0]!.hp).toBeLessThan(hit.enemies[0]!.maxHp);
    expect(hit.render!.hitFlashShips).toEqual([]);
    expect(hit.hud.playerHits).toBe(0);
    await expect(healthBar(page)).not.toHaveClass(/hud-bar-hit/);
  });

  test('with reduced motion the bar does not pulse; the tint (colour only) remains', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startGame(page, '?scenario=chaser-ahead');
    const hit = await stepUntilHit(page, 'player');

    await expect(healthBar(page)).toHaveClass(/hud-bar-hit/);
    expect((await animation(page)).name).toBe('none');
    expect(hit.render!.hitFlashShips).toEqual([0]);
    expect((await step(page, FLASH_TICKS)).render!.hitFlashShips).toEqual([]);
  });

  test('a ship sunk by the hit shows no tint', async ({ page }) => {
    await startGame(page, '?scenario=last-stand&resultDelay=60000');
    const hit = await stepUntilHit(page, 'player');
    expect(hit.phase).toBe('ended');
    expect(hit.render!.hitFlashShips).toEqual([]);
  });
});
