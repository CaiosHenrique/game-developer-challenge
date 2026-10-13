import { expect, type Page } from '@playwright/test';
import { getState, startGame, step } from './helpers.ts';

/**
 * Screenshot comparison options shared by the visual tests: CSS animations off, no text
 * caret, and at most 100 differing pixels. Measured on the reference environment: repeated
 * runs differ by 0 pixels, while small real changes differ by 900 to 2,400 pixels (a label
 * colour, one word, a button moved by 24 px). A 1% ratio (about 9,200 pixels on desktop)
 * let all of them pass, so it is not used.
 */
export const SCREENSHOT = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 100,
} as const;

/**
 * Waits until what is on screen is final: no pending network request, web fonts ready and
 * every image loaded and decoded. A broken image fails the test instead of being captured.
 */
export async function settleVisuals(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve, reject) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => reject(new Error(`image failed: ${image.src}`)), {
              once: true,
            });
          });
        }
        if (image.naturalWidth === 0) throw new Error(`image failed: ${image.src}`);
        await image.decode();
      }),
    );
  });
}

/** Ticks of the skirmish shown in the arena screenshots (before any shot is fired). */
export const ARENA_TICKS = 20;

/**
 * Opens the fixed `skirmish` scenario on the manual clock and advances it a fixed number of
 * ticks. Shots, hits and fire are animated with real time even on the manual clock, so the
 * arena is only captured while none exists: every ship whole, no ball, no effect.
 */
export async function openStableArena(page: Page): Promise<void> {
  await startGame(page, '?scenario=skirmish');
  const state = await step(page, ARENA_TICKS);
  expect(state.tick).toBe(ARENA_TICKS);
  expect(state.enemies).toHaveLength(4);
  expect(state.projectiles).toHaveLength(0);
  expect(state.enemyShotsFired).toBe(0);
  expect(Object.values(state.shotsFired).every((shots) => shots === 0)).toBe(true);
  expect(state.render?.effects).toBe(0);
  expect(state.render?.healthBars).toBe(5);
  expect((await getState(page)).tick).toBe(ARENA_TICKS); // the manual clock does not move
  await settleVisuals(page);
}
