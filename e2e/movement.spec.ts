import { expect, test, type Page } from '@playwright/test';
import type { Aabb, Circle } from '../src/game/sim/geometry.ts';
import { advance, collectProblems, getState, startGame } from './helpers.ts';

const STEP_MS = 1000 / 60;

/** Signed gap between a circle and a box: positive when apart, negative when overlapping. */
function gap(circle: Circle, box: Aabb): number {
  const dx = Math.max(box.minX - circle.x, 0, circle.x - box.maxX);
  const dy = Math.max(box.minY - circle.y, 0, circle.y - box.maxY);
  return Math.hypot(dx, dy) - circle.radius;
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  const state = await advance(page, ms);
  await page.keyboard.up(key);
  return state;
}

test.describe('player movement', () => {
  let problems: string[];

  test.beforeEach(async ({ page }) => {
    problems = collectProblems(page);
    await startGame(page, '?scenario=open-sea');
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('sails forward along its heading and coasts to a stop', async ({ page }) => {
    const start = await getState(page);
    const moving = await hold(page, 'KeyW', 1000);

    expect(moving.player.y).toBeLessThan(start.player.y - 50);
    expect(moving.player.x).toBeCloseTo(start.player.x, 5);
    expect(moving.player.heading).toBe(start.player.heading);
    expect(moving.player.speed).toBeGreaterThan(0);

    const stopped = await advance(page, 3000);
    expect(stopped.player.speed).toBe(0);
    const stoppedY = stopped.player.y;
    expect((await advance(page, 500)).player.y).toBe(stoppedY);
  });

  test('rotates both ways in place, at the same rate', async ({ page }) => {
    const start = await getState(page);
    const right = await hold(page, 'KeyD', 500);
    const turnedRight = right.player.heading - start.player.heading;
    expect(turnedRight).toBeGreaterThan(0);

    const left = await hold(page, 'ArrowLeft', 1000);
    expect(left.player.heading - right.player.heading).toBeCloseTo(-2 * turnedRight, 6);

    // Rotating without sailing does not move the ship.
    expect(left.player.x).toBe(start.player.x);
    expect(left.player.y).toBe(start.player.y);
  });

  test('sails and turns at the same time', async ({ page }) => {
    const start = await getState(page);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    // Short enough that the ship turns less than 90 degrees, so it still heads up and right.
    const state = await advance(page, 400);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    expect(state.player.heading).toBeGreaterThan(start.player.heading);
    expect(state.player.heading).toBeLessThan(Math.PI / 2);
    expect(state.player.x).toBeGreaterThan(start.player.x);
    expect(state.player.y).toBeLessThan(start.player.y);
  });

  test('stays inside the arena', async ({ page }) => {
    // Sail up into the top edge.
    let state = await hold(page, 'KeyW', 8000);
    const top = Math.min(...state.player.hull.map((c) => c.y - c.radius));
    expect(top).toBeGreaterThanOrEqual(state.arena.minY - 0.01);
    expect(top).toBeLessThan(state.arena.minY + 1);

    // Turn right (90 degrees) and sail into the right edge.
    while (state.player.heading < Math.PI / 2) state = await hold(page, 'KeyD', STEP_MS);
    state = await hold(page, 'KeyW', 8000);
    const right = Math.max(...state.player.hull.map((c) => c.x + c.radius));
    expect(right).toBeLessThanOrEqual(state.arena.maxX + 0.01);
    expect(right).toBeGreaterThan(state.arena.maxX - 1);
    for (const circle of state.player.hull) {
      expect(circle.y - circle.radius).toBeGreaterThanOrEqual(state.arena.minY - 0.01);
    }
  });

  test('cannot sail through an island', async ({ page }) => {
    // Face up-left, towards the right shore of the grass island.
    let state = await getState(page);
    while (state.player.heading > -Math.PI / 4) state = await hold(page, 'KeyA', STEP_MS);

    const island = state.islands[0]!;
    let closest = Infinity;
    await page.keyboard.down('KeyW');
    for (let sample = 0; sample < 40; sample += 1) {
      state = await advance(page, 100);
      for (const circle of state.player.hull) {
        const distance = gap(circle, island);
        expect(distance).toBeGreaterThan(-0.5);
        closest = Math.min(closest, distance);
      }
    }
    await page.keyboard.up('KeyW');

    // The hull reached the shore (contact) and never overlapped it.
    expect(closest).toBeLessThan(1);
  });
});

test('game keys are only captured while a match is on screen', async ({ page }) => {
  const problems = collectProblems(page);
  const trackPrevented = () =>
    page.evaluate(() =>
      window.addEventListener('keydown', (event) => {
        document.body.dataset.lastKeyPrevented = String(event.defaultPrevented);
      }),
    );
  const lastPrevented = () => page.evaluate(() => document.body.dataset.lastKeyPrevented);

  await page.goto('/');
  await trackPrevented();
  await page.keyboard.press('ArrowUp');
  expect(await lastPrevented()).toBe('false');

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
  await trackPrevented(); // registered after the game's own listener
  await page.keyboard.press('ArrowUp');
  expect(await lastPrevented()).toBe('true');

  await page.getByRole('button', { name: 'Main Menu' }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  expect(await lastPrevented()).toBe('false');
  expect(problems).toEqual([]);
});
