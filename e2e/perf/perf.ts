import { execSync } from 'node:child_process';
import os from 'node:os';
import type { Browser, CDPSession, Page } from '@playwright/test';

/**
 * Measurement helpers of the performance audit. Nothing here is part of the game: the frame
 * recorder is injected by the tests, and the memory figures come from the Chrome DevTools
 * Protocol (Chromium only).
 */

declare global {
  interface Window {
    __perf?: {
      recording: boolean;
      /** [timestamp, valid] for every animation frame while recording. */
      frames: [number, 0 | 1][];
      marks: Record<string, number>;
      longFrames: {
        start: number;
        duration: number;
        blocking: number;
        /** Where the frame's time went: the scripts it ran (largest first), if any. */
        scripts: { invoker: string; source: string; duration: number }[];
      }[];
      longFramesSupported: boolean;
    };
  }
}

/**
 * Injected before the app loads. Records every animation frame (requestAnimationFrame
 * timestamps) while `recording` is on. A frame counts as valid only in the foreground with
 * nothing paused: page visible, window focused, no dialog (the pause dialog) on screen.
 * Also marks when the menu and the ranking become ready, and collects long animation
 * frames where the browser supports them (checked, never assumed).
 */
export function frameRecorder() {
  const perf: NonNullable<Window['__perf']> = {
    recording: false,
    frames: [],
    marks: {},
    longFrames: [],
    longFramesSupported: PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'),
  };
  window.__perf = perf;
  const loop = (time: number) => {
    if (perf.recording) {
      const valid =
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        document.querySelector('[role="dialog"]') === null;
      perf.frames.push([time, valid ? 1 : 0]);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const mark = (name: string, ready: () => boolean) => {
    if (perf.marks[name] !== undefined) return;
    if (ready()) perf.marks[name] = performance.now();
  };
  new MutationObserver(() => {
    mark('menuReady', () =>
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Play'),
    );
    // The ranking answered (a list, or an empty one): its view replaced "Loading…".
    mark('rankingReady', () => document.querySelector('.records') !== null);
  }).observe(document, { childList: true, subtree: true, characterData: true });
  if (perf.longFramesSupported) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const frame = entry as PerformanceEntry & {
          blockingDuration?: number;
          scripts?: { invoker: string; sourceURL: string; duration: number }[];
        };
        perf.longFrames.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: frame.blockingDuration ?? 0,
          scripts: (frame.scripts ?? [])
            .map((script) => ({
              invoker: script.invoker,
              source: script.sourceURL.split('/').pop() ?? '',
              duration: Math.round(script.duration),
            }))
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 3),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  }
}

export async function startRecording(page: Page) {
  await page.evaluate(() => {
    window.__perf!.frames = [];
    window.__perf!.longFrames = [];
    window.__perf!.recording = true;
  });
}

export async function stopRecording(page: Page) {
  return page.evaluate(() => {
    const perf = window.__perf!;
    perf.recording = false;
    return { frames: perf.frames, longFrames: perf.longFrames };
  });
}

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const round = (value: number | null, digits = 2) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

export type FrameStats = ReturnType<typeof frameStats>;

/**
 * Statistics of the intervals between consecutive valid frames (an interval touching an
 * invalid frame is dropped). `refreshMs` is the display's frame time measured on the idle
 * menu: frames longer than 1.5× it missed at least one refresh.
 */
export function frameStats(frames: [number, 0 | 1][], refreshMs: number) {
  const intervals: number[] = [];
  let invalidFrames = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const [time, valid] = frames[index]!;
    const [previous, previousValid] = frames[index - 1]!;
    if (!valid) invalidFrames += 1;
    if (valid && previousValid) intervals.push(time - previous);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((sum, value) => sum + value, 0);
  return {
    validIntervals: intervals.length,
    invalidFrames,
    validSeconds: round(total / 1000, 1),
    fpsAverage: round(total > 0 ? (intervals.length * 1000) / total : null, 1),
    frameMs: {
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? null),
    },
    /** Frames that missed at least one display refresh (longer than 1.5 refresh periods). */
    missedRefreshes: intervals.filter((value) => value > refreshMs * 1.5).length,
    /** Visible hitches: frames of 50 ms or more, and of 100 ms or more. */
    over50ms: intervals.filter((value) => value >= 50).length,
    over100ms: intervals.filter((value) => value >= 100).length,
  };
}

/** Median frame time of the idle menu: the display's refresh period. */
export async function measureRefreshMs(page: Page): Promise<number> {
  await startRecording(page);
  await page.waitForTimeout(2000);
  const { frames } = await stopRecording(page);
  const intervals = frames.slice(1).map(([time], index) => time - frames[index]![0]);
  intervals.sort((a, b) => a - b);
  return percentile(intervals, 0.5) ?? 16.67;
}

/** Memory and DOM counters from the DevTools Protocol, after an explicit garbage collection. */
export async function memoryAfterGc(cdp: CDPSession) {
  // Diagnostic only: HeapProfiler.collectGarbage forces a full collection through the
  // DevTools Protocol, so that figures compare at equivalent points.
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? null;
  const mb = (bytes: number | null) => (bytes === null ? null : round(bytes / 2 ** 20, 2));
  return {
    jsHeapUsedMB: mb(value('JSHeapUsedSize')),
    jsHeapTotalMB: mb(value('JSHeapTotalSize')),
    domNodes: value('Nodes'),
    jsEventListeners: value('JSEventListeners'),
    documents: value('Documents'),
  };
}

export async function openCdp(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  return cdp;
}

/** The machine, browser and build the figures were measured on. */
export async function environment(page: Page, browser: Browser, headless: boolean) {
  const gpu = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { vendor: null, renderer: null };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  const screen = await page.evaluate(() => ({
    viewport: `${innerWidth}x${innerHeight}`,
    devicePixelRatio,
    screen: `${window.screen.width}x${window.screen.height}`,
  }));
  const git = (command: string) => {
    try {
      return execSync(command, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  return {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: os.cpus()[0]?.model.trim() ?? null,
    logicalCores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    browser: `${browser.browserType().name()} ${browser.version()}`,
    headless,
    gpu,
    ...screen,
    build: 'vite build --mode e2e (minified production build with test hooks)',
    commit: git('git rev-parse --short HEAD'),
    uncommittedChanges: (git('git status --porcelain') ?? '').length > 0,
  };
}
