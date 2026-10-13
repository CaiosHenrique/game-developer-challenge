import type { Locator, Page } from '@playwright/test';

type Point = { x: number; y: number };

/**
 * Multi-finger touch input through the Chrome DevTools Protocol. The browser itself turns
 * these touches into touch and pointer events (pointerType "touch"), exactly as for a real
 * finger, so the app's handlers are exercised end to end.
 *
 * `touchStart` / `touchMove` carry every finger currently on the screen. Lifting is done
 * with `touchEnd` carrying the lifted finger: verified in Chromium (Edge) that this releases
 * exactly that finger while the others stay down (a `touchMove` without it released the
 * wrong finger).
 */
export async function touchScreen(page: Page) {
  const client = await page.context().newCDPSession(page);
  const fingers = new Map<number, Point>();

  const send = (type: 'touchStart' | 'touchMove') =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...fingers].map(([id, point]) => ({ id, x: point.x, y: point.y })),
    });

  /** Lifts one finger: the other fingers stay down. */
  const lift = async (finger: number) => {
    const point = fingers.get(finger);
    if (!point) return;
    fingers.delete(finger);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ id: finger, x: point.x, y: point.y }],
    });
  };

  const centre = async (target: Locator): Promise<Point> => {
    const box = await target.boundingBox();
    if (!box) throw new Error('touch target is not visible');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  return {
    /** Puts a finger down on the centre of an element. */
    async down(finger: number, target: Locator) {
      fingers.set(finger, await centre(target));
      await send('touchStart');
    },
    /** Slides a finger to a point on the screen. */
    async move(finger: number, point: Point) {
      fingers.set(finger, point);
      await send('touchMove');
    },
    /** Lifts one finger; the others stay down. */
    async up(finger: number) {
      await lift(finger);
    },
    /** A short tap with a finger that is not otherwise down. */
    async tap(finger: number, target: Locator) {
      fingers.set(finger, await centre(target));
      await send('touchStart');
      await lift(finger);
    },
    /** The system cancels every touch (e.g. an incoming call or a gesture takeover). */
    async cancelAll() {
      fingers.clear();
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },
  };
}
