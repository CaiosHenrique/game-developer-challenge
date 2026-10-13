import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG } from '../src/game/config.ts';
import type { GameStateSnapshot } from '../src/game/testHooks.ts';
import { collectProblems, getState, startGame, step, stepUntilHit } from './helpers.ts';

/** Wood splinters at hits on ships: three per hit, 30 ticks, none for islands or expired balls. */

const DEBRIS_TICKS = 30;
const PLAYER_MAX_HP = DEFAULT_GAME_CONFIG.player.maxHp;

type Point = { x: number; y: number };
const debrisOf = (state: GameStateSnapshot) => state.render!.debris;

/** Steps one tick at a time while the player's balls are in flight; the most splinters seen. */
function flyBallsOut(page: Page) {
  return page.evaluate(() => {
    const api = window.__pirateTest!;
    let most = 0;
    for (let i = 0; i < 300 && api.getState().projectiles.length > 0; i += 1) {
      api.step(1);
      most = Math.max(most, api.getState().render!.debris.length);
    }
    return { most, state: api.getState() };
  });
}

/** Three pieces start at one point, then move apart in clearly different directions. */
async function expectSpreadFrom(page: Page, origin: Point) {
  const later = debrisOf(await step(page, 10));
  expect(later).toHaveLength(3);
  const angles = later.map((piece) => {
    expect(Math.hypot(piece.x - origin.x, piece.y - origin.y)).toBeGreaterThan(5);
    return Math.atan2(piece.y - origin.y, piece.x - origin.x);
  });
  for (let i = 0; i < angles.length; i += 1) {
    for (let j = i + 1; j < angles.length; j += 1) {
      const gap = Math.abs(
        Math.atan2(Math.sin(angles[i]! - angles[j]!), Math.cos(angles[i]! - angles[j]!)),
      );
      expect(gap).toBeGreaterThan(1.5);
    }
  }
}

test.describe('hit splinters', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('a hit on the player throws three splinters for 30 ticks; the tint is unchanged', async ({
    page,
  }) => {
    await startGame(page, '?scenario=chaser-ahead');
    const hit = await stepUntilHit(page, 'player');
    const pieces = debrisOf(hit);
    expect(pieces).toHaveLength(3);
    expect(new Set(pieces.map((piece) => `${piece.x},${piece.y}`)).size).toBe(1); // one point
    expect(hit.render!.hitFlashShips).toEqual([0]); // the P2 tint is still there
    expect(hit.render!.shipStages[0]).toBe(0); // 135 / 150: still intact
    expect(hit.render!.healthBars).toBe(1); // the rammed chaser is gone

    await expectSpreadFrom(page, pieces[0]!);
    expect(debrisOf(await step(page, DEBRIS_TICKS - 11))).toHaveLength(3); // tick 29
    expect(debrisOf(await step(page, 1))).toEqual([]); // tick 30
  });

  test('a hit on an enemy throws three splinters too; no tint, damage stage shown', async ({
    page,
  }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await page.keyboard.down('Space');
    const hit = await stepUntilHit(page, 'enemy');
    await page.keyboard.up('Space');

    const enemy = hit.enemies[0]!;
    expect(hit.player.hp).toBe(PLAYER_MAX_HP);
    expect(debrisOf(hit)).toHaveLength(3);
    expect(hit.render!.hitFlashShips).toEqual([]);
    expect(hit.render!.shipStages[enemy.id]).toBe(1); // 15 / 40: damaged
    expect(hit.render!.healthBars).toBe(2);
    await expectSpreadFrom(page, debrisOf(hit)[0]!);
  });

  test('a ball that expires at the end of its range throws no splinters', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await page.keyboard.down('KeyD');
    await step(page, 40); // face right, along open water
    await page.keyboard.up('KeyD');
    await page.keyboard.down('Space');
    await step(page, 1);
    await page.keyboard.up('Space');

    const { most, state } = await flyBallsOut(page);
    expect(state.projectilesRemoved.expired).toBe(1);
    expect(state.projectilesRemoved.ship).toBe(0);
    expect(most).toBe(0);
  });

  test('a ball stopped by an island throws no splinters', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    let state = await getState(page);
    await page.keyboard.down('KeyA');
    while (state.player.heading > -Math.PI / 4) state = await step(page, 1);
    await page.keyboard.up('KeyA');
    await page.keyboard.down('Space');
    await step(page, 1);
    await page.keyboard.up('Space');

    const result = await flyBallsOut(page);
    expect(result.state.projectilesRemoved.island).toBe(1);
    expect(result.most).toBe(0);
  });

  test('with reduced motion no splinters are thrown; the hit tint remains', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startGame(page, '?scenario=chaser-ahead');
    await page.keyboard.down('Space');
    const enemyHit = await stepUntilHit(page, 'enemy');
    await page.keyboard.up('Space');
    expect(debrisOf(enemyHit)).toEqual([]);

    // A fresh match for the ram: the first match's chaser may already be sunk by a ball in
    // flight. The reduced-motion preference stays emulated on the page.
    await startGame(page, '?scenario=chaser-ahead');
    const playerHit = await stepUntilHit(page, 'player');
    expect(debrisOf(playerHit)).toEqual([]);
    expect(playerHit.render!.hitFlashShips).toEqual([0]);
  });

  test('splinters reuse the effect pool: repeated hits create no new objects', async ({ page }) => {
    await startGame(page, '?scenario=shooter-far');
    const children: number[] = [];
    for (let hits = 0; hits < 6; hits += 1) {
      const hit = await stepUntilHit(page, 'player', 900);
      expect(debrisOf(hit)).toHaveLength(3);
      await step(page, DEBRIS_TICKS); // the splinters finish
      // Muzzle flashes and hit sparks fade with real frames: wait until none is left.
      await page.waitForFunction(() => window.__pirateTest!.getState().render!.effects === 0);
      const settled = await getState(page);
      expect(debrisOf(settled)).toEqual([]);
      children.push(settled.render!.dynamicChildren);
    }
    // Once the first hit has filled the pool, every later hit reuses the same sprites.
    expect(new Set(children.slice(1)).size).toBe(1);
    expect(children[5]).toBe(children[1]);
  });
});
