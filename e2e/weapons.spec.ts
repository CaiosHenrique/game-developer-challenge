import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG } from '../src/game/config.ts';
import type { GameStateSnapshot } from '../src/game/testHooks.ts';
import { collectProblems, getState, startGame, step } from './helpers.ts';

const { front, side } = DEFAULT_GAME_CONFIG.weapons;
const STEPS_PER_SECOND = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;
const FRONT_COOLDOWN_TICKS = Math.round(front.cooldown * STEPS_PER_SECOND); // 36
const SIDE_COOLDOWN_TICKS = Math.round(side.cooldown * STEPS_PER_SECOND); // 90
const FRONT_LIFE_TICKS = Math.round((front.range / front.speed) * STEPS_PER_SECOND); // 74

/** Presses a key, runs `steps` simulation steps while it is held, then releases it. */
async function holdFor(page: Page, key: string, steps: number): Promise<GameStateSnapshot> {
  await page.keyboard.down(key);
  const state = await step(page, steps);
  await page.keyboard.up(key);
  return state;
}

function forwardOf(heading: number) {
  return { x: Math.sin(heading), y: -Math.cos(heading) };
}

test.describe('player weapons', () => {
  let problems: string[];

  test.beforeEach(async ({ page }) => {
    problems = collectProblems(page);
    await startGame(page, '?scenario=open-sea');
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('the front gun fires one ball from the bow along the heading', async ({ page }) => {
    const state = await holdFor(page, 'Space', 1);
    const { player } = state;
    const forward = forwardOf(player.heading);

    expect(state.shotsFired.front).toBe(1);
    expect(state.projectiles).toHaveLength(1);
    const ball = state.projectiles[0]!;
    expect(ball.weapon).toBe('front');
    expect(ball.x).toBeCloseTo(player.x + forward.x * front.muzzleOffset, 6);
    expect(ball.y).toBeCloseTo(player.y + forward.y * front.muzzleOffset, 6);
    expect(ball.vx).toBeCloseTo(forward.x * front.speed, 6);
    expect(ball.vy).toBeCloseTo(forward.y * front.speed, 6);

    // 6 steps = 0.1 s at the configured speed.
    const later = (await step(page, 6)).projectiles[0]!;
    expect(Math.hypot(later.x - ball.x, later.y - ball.y)).toBeCloseTo(front.speed * 0.1, 6);
  });

  test('broadsides fire three parallel balls across the current heading, also after turning', async ({
    page,
  }) => {
    await holdFor(page, 'KeyD', 20); // turn right ~0.8 rad first

    for (const [key, slot, sideSign] of [
      ['KeyQ', 'left', -1],
      ['KeyE', 'right', 1],
    ] as const) {
      const state = await holdFor(page, key, 1);
      const { player } = state;
      const forward = forwardOf(player.heading);
      // Starboard (right) is the heading rotated 90 degrees clockwise.
      const direction = { x: -forward.y * sideSign, y: forward.x * sideSign };
      const balls = state.projectiles.filter((ball) => ball.weapon === slot);

      expect(balls).toHaveLength(side.count);
      for (const ball of balls) {
        expect(ball.vx).toBeCloseTo(direction.x * side.speed, 6);
        expect(ball.vy).toBeCloseTo(direction.y * side.speed, 6);
        // Every ball starts on the muzzle line, beside the hull.
        const across = (ball.x - player.x) * direction.x + (ball.y - player.y) * direction.y;
        expect(across).toBeCloseTo(side.muzzleOffset, 6);
      }
      // Spread along the hull at the configured spacing.
      const along = balls
        .map((ball) => (ball.x - player.x) * forward.x + (ball.y - player.y) * forward.y)
        .sort((a, b) => a - b);
      expect(along[0]).toBeCloseTo(-side.spacing, 6);
      expect(along[1]).toBeCloseTo(0, 6);
      expect(along[2]).toBeCloseTo(side.spacing, 6);
    }
  });

  test('the front gun cooldown ends on an exact tick, whether held or pressed again', async ({
    page,
  }) => {
    await page.keyboard.down('Space');
    let state = await step(page, 1);
    const firedAt = state.tick - 1;
    expect(state.shotsFired.front).toBe(1);
    expect(state.weaponReadyAt.front).toBe(firedAt + FRONT_COOLDOWN_TICKS);

    state = await step(page, FRONT_COOLDOWN_TICKS - 1);
    expect(state.shotsFired.front).toBe(1);
    state = await step(page, 1);
    expect(state.shotsFired.front).toBe(2);

    // Releasing and pressing again does not skip the cooldown.
    await page.keyboard.up('Space');
    await step(page, 10);
    await page.keyboard.down('Space');
    state = await step(page, FRONT_COOLDOWN_TICKS - 11);
    expect(state.shotsFired.front).toBe(2);
    state = await step(page, 1);
    expect(state.shotsFired.front).toBe(3);
    await page.keyboard.up('Space');
  });

  test('each weapon has its own exact cooldown', async ({ page }) => {
    await holdFor(page, 'Space', 1);
    // The front gun is cooling down, but both broadsides can fire right away.
    let state = await holdFor(page, 'KeyQ', 1);
    expect(state.shotsFired.left).toBe(1);
    const leftFiredAt = state.tick - 1;
    state = await holdFor(page, 'KeyE', 1);
    expect(state.shotsFired.right).toBe(1);

    expect(state.weaponReadyAt.left).toBe(leftFiredAt + SIDE_COOLDOWN_TICKS);
    await page.keyboard.down('KeyQ');
    state = await step(page, leftFiredAt + SIDE_COOLDOWN_TICKS - state.tick);
    expect(state.shotsFired.left).toBe(1);
    state = await step(page, 1);
    expect(state.shotsFired.left).toBe(2);
    await page.keyboard.up('KeyQ');
  });

  test('balls expire at the end of their range', async ({ page }) => {
    await holdFor(page, 'KeyD', 40); // face right, along open water
    const fired = await holdFor(page, 'Space', 1);
    const start = fired.projectiles[0]!;

    let state = await step(page, FRONT_LIFE_TICKS - 1);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectilesRemoved.expired).toBe(0);
    const last = state.projectiles[0]!;

    state = await step(page, 1);
    expect(state.projectiles).toHaveLength(0);
    expect(state.projectilesRemoved).toEqual({
      island: 0,
      outOfBounds: 0,
      expired: 1,
      ship: 0,
      ownerDestroyed: 0,
    });
    const travelled = Math.hypot(last.x - start.x, last.y - start.y) + front.speed / 60;
    expect(Math.abs(travelled - front.range)).toBeLessThan(front.speed / 60);
  });

  test('islands stop balls before the end of their range', async ({ page }) => {
    let state = await getState(page);
    while (state.player.heading > -Math.PI / 4) state = await holdFor(page, 'KeyA', 1);
    state = await holdFor(page, 'Space', 1);
    const island = state.islands[0]!;

    let steps = 0;
    while (state.projectiles.length > 0) {
      for (const ball of state.projectiles) {
        const inside =
          ball.x > island.minX &&
          ball.x < island.maxX &&
          ball.y > island.minY &&
          ball.y < island.maxY;
        expect(inside).toBe(false);
      }
      state = await step(page, 1);
      steps += 1;
    }
    expect(state.projectilesRemoved).toEqual({
      island: 1,
      outOfBounds: 0,
      expired: 0,
      ship: 0,
      ownerDestroyed: 0,
    });
    expect(steps).toBeLessThan(FRONT_LIFE_TICKS);
  });

  test('balls leaving the arena are removed', async ({ page }) => {
    let state = await holdFor(page, 'Space', 1); // facing up from the arena center
    let steps = 0;
    while (state.projectiles.length > 0) {
      state = await step(page, 1);
      steps += 1;
    }
    expect(state.projectilesRemoved).toEqual({
      island: 0,
      outOfBounds: 1,
      expired: 0,
      ship: 0,
      ownerDestroyed: 0,
    });
    expect(steps).toBeLessThan(FRONT_LIFE_TICKS);
  });

  test('sails and fires at the same time', async ({ page }) => {
    const start = await getState(page);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    const state = await step(page, 30);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');

    expect(state.player.y).toBeLessThan(start.player.y - 10);
    expect(state.shotsFired.front).toBe(1);
  });

  test('projectile and effect sprites are released and reused', async ({ page }) => {
    /**
     * Effects fade in render (real) time, while the simulation only moves with `step`. Each
     * step call draws its events at once, so how many effects are on screen together depends
     * on whether the previous ones have faded: waiting for that (no effect left) before the
     * next step call makes every barrage need exactly the same sprites.
     */
    const effectsFaded = () =>
      expect.poll(async () => (await getState(page)).render!.effects).toBe(0);
    const barrage = async () => {
      for (const key of ['Space', 'KeyQ', 'KeyE']) await page.keyboard.down(key);
      const fired = (await step(page, 5 * STEPS_PER_SECOND)).render!;
      for (const key of ['Space', 'KeyQ', 'KeyE']) await page.keyboard.up(key);
      await effectsFaded();
      await step(page, 2 * STEPS_PER_SECOND); // every ball expires or hits something
      await effectsFaded();
      return { fired, end: (await getState(page)).render! };
    };

    const first = await barrage();
    expect(first.fired.effects).toBeGreaterThan(0);
    expect(first.end.projectileSprites).toBe(0);
    expect(first.end.effects).toBe(0);
    expect(first.end.pooledProjectileSprites).toBeGreaterThan(0);
    expect(first.end.pooledEffects).toBeGreaterThan(0);

    const second = await barrage();
    // The same barrage, so the same demand for sprites...
    expect(second.fired.effects).toBe(first.fired.effects);
    expect(second.fired.projectileSprites).toBe(first.fired.projectileSprites);
    expect(second.end.projectileSprites).toBe(0);
    expect(second.end.effects).toBe(0);
    // ...served by the pooled sprites: no new display objects were created.
    expect(second.end.dynamicChildren).toBe(first.end.dynamicChildren);
  });
});
