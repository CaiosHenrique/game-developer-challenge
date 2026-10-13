import { expect, test, type Page } from '@playwright/test';
import { collectProblems, getState, startGame, step } from './helpers.ts';
import { touchScreen } from './touch.ts';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('touch controls', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('the mobile project emulates a touch phone held in landscape', async ({ page }) => {
    await page.goto('/');
    const device = await page.evaluate(() => ({
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      touchPoints: navigator.maxTouchPoints,
      landscape: matchMedia('(orientation: landscape)').matches,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
    }));
    expect(device).toEqual({
      coarsePointer: true,
      touchPoints: expect.any(Number),
      landscape: true,
      viewport: [863, 360],
      dpr: 2.625,
    });
    expect(device.touchPoints).toBeGreaterThan(0);
  });

  test('sails and turns with the touch buttons', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await expect(page.getByRole('button', { name: 'Sail forward', exact: true })).toBeVisible();
    const touch = await touchScreen(page);
    const start = await getState(page);

    await touch.down(1, button(page, 'Sail forward'));
    const sailing = await step(page, 30);
    expect(sailing.player.y).toBeLessThan(start.player.y);
    expect(sailing.player.heading).toBe(start.player.heading);
    await touch.up(1);

    await touch.down(1, button(page, 'Turn right'));
    const turned = await step(page, 20);
    expect(turned.player.heading).toBeGreaterThan(start.player.heading);
    await touch.up(1);
    await touch.down(2, button(page, 'Turn left'));
    expect((await step(page, 20)).player.heading).toBeLessThan(turned.player.heading);
    await touch.up(2);
  });

  test('two fingers sail and fire at the same time; lifting one keeps the other', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    const touch = await touchScreen(page);
    const start = await getState(page);

    await touch.down(1, button(page, 'Sail forward'));
    await touch.down(2, button(page, 'Fire front gun'));
    const both = await step(page, 30);
    expect(both.player.y).toBeLessThan(start.player.y);
    expect(both.shotsFired.front).toBe(1);

    await touch.up(2); // stop firing, keep sailing
    const sailing = await step(page, 60);
    expect(sailing.shotsFired.front).toBe(1);
    expect(sailing.player.speed).toBeGreaterThanOrEqual(both.player.speed);
    expect(sailing.player.y).toBeLessThan(both.player.y);
    await touch.up(1);
  });

  test('a cancelled touch or a finger sliding off releases the button', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const touch = await touchScreen(page);

    await touch.down(1, button(page, 'Sail forward'));
    const sailing = await step(page, 30);
    await touch.cancelAll();
    expect((await step(page, 30)).player.speed).toBeLessThan(sailing.player.speed);

    await touch.down(1, button(page, 'Sail forward'));
    const again = await step(page, 60);
    await touch.move(1, { x: 430, y: 200 }); // off the button, finger still down
    expect((await step(page, 30)).player.speed).toBeLessThan(again.player.speed);
    await touch.up(1);
  });

  test('a touch held through a pause or the end of the match stops acting', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const touch = await touchScreen(page);

    await touch.down(1, button(page, 'Sail forward'));
    const sailing = await step(page, 30);
    await touch.tap(2, button(page, 'Pause'));
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await expect(page.getByTestId('touch-controls')).toHaveCount(0);
    expect((await step(page, 60)).tick).toBe(sailing.tick);

    await touch.tap(2, button(page, 'Resume')); // finger 1 is still on the screen
    await expect(page.getByRole('button', { name: 'Sail forward', exact: true })).toBeVisible();
    const resumed = await step(page, 30);
    expect(resumed.player.speed).toBeLessThan(sailing.player.speed); // coasting
    await touch.up(1);

    await touch.down(1, button(page, 'Fire front gun'));
    await step(page, 1);
    const ended = await page.evaluate(() => {
      const api = window.__pirateTest!;
      api.step(api.getState().remainingTicks);
      return api.getState();
    });
    expect(ended.phase).toBe('ended');
    expect((await step(page, 120)).shotsFired).toEqual(ended.shotsFired);
    await touch.up(1);
  });

  test('releasing a touch button does not cancel the same key held on a keyboard', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea');
    const touch = await touchScreen(page);

    await page.keyboard.down('Space');
    await touch.down(1, button(page, 'Fire front gun'));
    expect((await step(page, 1)).shotsFired.front).toBe(1);
    await touch.up(1);
    // Still held on the keyboard: fires again when the 0.6 s cooldown ends.
    expect((await step(page, 36)).shotsFired.front).toBe(2);
    await page.keyboard.up('Space');
  });

  test('controls stay on screen and never overlap the HUD or the menu button', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const viewport = page.viewportSize()!;
    const boxes = async (selector: string) =>
      page.locator(selector).evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        }),
      );
    const controls = await boxes('.touch-button');
    const others = await boxes('.hud-health dd, .hud-counter dd, .hud-pause, .game-toolbar button');
    expect(controls).toHaveLength(6);
    for (const box of controls) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
      expect(box.right - box.left).toBeGreaterThanOrEqual(44); // touch target size
      for (const other of others) {
        const overlaps =
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top;
        expect(overlaps).toBe(false);
      }
    }
  });
});
