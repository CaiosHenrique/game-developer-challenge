import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG } from '../src/game/config.ts';
import { collectProblems, getState, startGame, step } from './helpers.ts';

const { chaser, shooter } = DEFAULT_GAME_CONFIG.enemies;
const FRONT_DAMAGE = DEFAULT_GAME_CONFIG.weapons.front.damage;
const PLAYER_MAX_HP = DEFAULT_GAME_CONFIG.player.maxHp;

/**
 * Runs one simulation step at a time inside the page (keys held by Playwright stay held)
 * until no enemy is left or `maxSteps` is reached, and returns per-step observations.
 */
function runUntilNoEnemies(page: Page, maxSteps: number) {
  return page.evaluate((limit) => {
    const api = window.__pirateTest!;
    const samples: {
      tick: number;
      enemyHp: number | null;
      distance: number | null;
      playerHp: number;
      islandOverlap: number;
    }[] = [];
    for (let i = 0; i < limit; i += 1) {
      api.step(1);
      const state = api.getState();
      const enemy = state.enemies[0];
      let islandOverlap = 0;
      for (const ship of state.enemies) {
        for (const circle of ship.hull) {
          for (const box of state.islands) {
            const dx = Math.max(box.minX - circle.x, 0, circle.x - box.maxX);
            const dy = Math.max(box.minY - circle.y, 0, circle.y - box.maxY);
            const inside =
              circle.x > box.minX &&
              circle.x < box.maxX &&
              circle.y > box.minY &&
              circle.y < box.maxY;
            const overlap = inside ? Infinity : circle.radius - Math.hypot(dx, dy);
            islandOverlap = Math.max(islandOverlap, overlap);
          }
        }
      }
      samples.push({
        tick: state.tick,
        enemyHp: enemy ? enemy.hp : null,
        distance: enemy ? Math.hypot(state.player.x - enemy.x, state.player.y - enemy.y) : null,
        playerHp: state.player.hp,
        islandOverlap,
      });
      if (state.enemies.length === 0) break;
    }
    return samples;
  }, maxSteps);
}

test.describe('enemies', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('the player sinks a chaser: exact damage per hit, one point, sprite released', async ({
    page,
  }) => {
    await startGame(page, '?scenario=chaser-ahead');
    await page.keyboard.down('Space');
    const samples = await runUntilNoEnemies(page, 600);
    await page.keyboard.up('Space');

    // Health only ever drops by whole hits of the front gun.
    const hpValues = [...new Set(samples.map((s) => s.enemyHp).filter((hp) => hp !== null))];
    expect(hpValues).toEqual([chaser.maxHp, chaser.maxHp - FRONT_DAMAGE]);
    const state = await getState(page);
    expect(state.enemies).toHaveLength(0);
    expect(state.score).toBe(1);
    expect(state.enemiesDestroyed).toEqual({ playerFire: 1, ramming: 0 });
    // Exactly the hits needed to sink it, each projectile removed on impact.
    expect(state.projectilesRemoved.ship).toBe(Math.ceil(chaser.maxHp / FRONT_DAMAGE));
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.render!.enemySprites).toBe(0);
    expect(state.render!.pooledEnemySprites).toBe(1);
  });

  test('a chaser turns towards the player and rams it once, without scoring', async ({ page }) => {
    await startGame(page, '?scenario=chaser-flank');
    const samples = await runUntilNoEnemies(page, 40 * 60);

    const distances = samples.map((s) => s.distance).filter((d) => d !== null);
    expect(distances.at(-1)!).toBeLessThan(distances[0]! - 300);
    let state = await getState(page);
    expect(state.enemies).toHaveLength(0);
    expect(state.player.hp).toBe(state.player.maxHp - chaser.impactDamage);
    expect(state.enemiesDestroyed).toEqual({ playerFire: 0, ramming: 1 });
    expect(state.score).toBe(0);

    state = await step(page, 120);
    expect(state.player.hp).toBe(state.player.maxHp - chaser.impactDamage);
  });

  test('a chaser sails around an island to reach the player, never overlapping it', async ({
    page,
  }) => {
    await startGame(page, '?scenario=chaser-behind-island');
    const samples = await runUntilNoEnemies(page, 40 * 60);

    expect(Math.max(...samples.map((s) => s.islandOverlap))).toBeLessThanOrEqual(1e-9);
    const state = await getState(page);
    expect(state.enemiesDestroyed.ramming).toBe(1);
  });

  test('a shooter closes in, stops near its preferred range and fires only in range', async ({
    page,
  }) => {
    await startGame(page, '?scenario=shooter-far');
    const result = await page.evaluate((steps) => {
      const api = window.__pirateTest!;
      const shots: { distance: number; offAxis: number }[] = [];
      let closest = Infinity;
      let previousShots = api.getState().enemyShotsFired;
      for (let i = 0; i < steps; i += 1) {
        api.step(1);
        const state = api.getState();
        const enemy = state.enemies[0]!;
        const dx = state.player.x - enemy.x;
        const dy = state.player.y - enemy.y;
        const distance = Math.hypot(dx, dy);
        closest = Math.min(closest, distance);
        if (state.enemyShotsFired > previousShots) {
          const towards = Math.atan2(dx, -dy);
          let offAxis = (towards - enemy.heading) % (2 * Math.PI);
          if (offAxis > Math.PI) offAxis -= 2 * Math.PI;
          if (offAxis < -Math.PI) offAxis += 2 * Math.PI;
          shots.push({ distance, offAxis: Math.abs(offAxis) });
          previousShots = state.enemyShotsFired;
        }
      }
      return { shots, closest, playerHp: api.getState().player.hp };
    }, 10 * 60);

    expect(result.shots.length).toBeGreaterThanOrEqual(2);
    for (const shot of result.shots) {
      expect(shot.distance).toBeLessThanOrEqual(shooter.attackRange);
      expect(shot.offAxis).toBeLessThanOrEqual(shooter.fireCone);
    }
    // It stops accelerating at its preferred range; braking is all that brings it closer.
    const { maxSpeed, deceleration } = shooter.movement;
    const braking = (maxSpeed * maxSpeed) / (2 * deceleration) + maxSpeed / 60;
    expect(result.closest).toBeGreaterThanOrEqual(shooter.preferredRange - braking);
    // Every hit costs exactly the shooter's weapon damage.
    expect((PLAYER_MAX_HP - result.playerHp) % shooter.weapon.damage).toBe(0);
    expect(result.playerHp).toBeLessThan(PLAYER_MAX_HP);
  });
});
