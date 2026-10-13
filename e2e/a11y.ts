import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * Runs axe (every rule it enables by default: WCAG 2.x A/AA and best practices) on the page
 * as it is now. The full results are attached to the test report; violations fail the test
 * with their rule, impact, elements and help link.
 */
export async function expectNoAxeViolations(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`axe ${state}`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  const report = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    url: violation.helpUrl,
    elements: violation.nodes.map((node) => ({
      target: node.target.join(' '),
      summary: node.failureSummary,
    })),
  }));
  expect(report, `axe violations in "${state}"`).toEqual([]);
}

/**
 * Whether the focused element shows the game's focus ring: it matches `:focus-visible` and
 * has the 3 px outline the menus use (not only the browser's default ring).
 */
export function focusRing(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
    };
  });
}

/**
 * WCAG contrast of an element's text against what is drawn right behind its strokes, for
 * text over images (which axe cannot measure). Screenshot A (text as rendered) finds the
 * core of the strokes: pixels close to the text colour. Screenshot B (the same box with the
 * text colour transparent, its shadow or outline still drawn) shows what is behind each of
 * those pixels, so an outline or halo counts as the text's background, as WCAG treats a
 * halo. Returns the 10th percentile of the ratios.
 */
export async function textContrastOverImage(page: Page, selector: string): Promise<number> {
  const element = page.locator(selector).first();
  const { color, box } = await element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return {
      color: getComputedStyle(node).color,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  const rendered = await page.screenshot({ clip: box, scale: 'css' });
  await element.evaluate((node) => ((node as HTMLElement).style.color = 'transparent'));
  const behind = await page.screenshot({ clip: box, scale: 'css' });
  await element.evaluate((node) => ((node as HTMLElement).style.color = ''));
  return page.evaluate(
    async ({ renderedPng, behindPng, color }) => {
      const read = async (base64: string) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const text = await read(renderedPng);
      const back = await read(behindPng);
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (r: number, g: number, b: number) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const [r, g, b] = color.match(/[0-9]+/g)!.map(Number) as [number, number, number];
      const textLuminance = luminance(r, g, b);
      const ratios: number[] = [];
      for (let i = 0; i < text.length; i += 4) {
        const distance =
          Math.abs(text[i]! - r) + Math.abs(text[i + 1]! - g) + Math.abs(text[i + 2]! - b);
        if (distance >= 60) continue; // not the core of a stroke
        const behindLuminance = luminance(back[i]!, back[i + 1]!, back[i + 2]!);
        const lighter = Math.max(textLuminance, behindLuminance);
        const darker = Math.min(textLuminance, behindLuminance);
        ratios.push((lighter + 0.05) / (darker + 0.05));
      }
      if (ratios.length === 0) throw new Error('no text pixels found');
      ratios.sort((x, y) => x - y);
      return ratios[Math.floor(ratios.length * 0.1)]!;
    },
    { renderedPng: rendered.toString('base64'), behindPng: behind.toString('base64'), color },
  );
}
