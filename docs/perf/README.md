# Performance and memory audit

Measured results of the game's performance and memory behaviour, with the method used to get
them. The JSON files next to this one are the raw results of the last run:

- `edge-headed.json` — main measurement, in a visible Microsoft Edge window.
- `edge-headless.json` — secondary reference, headless Edge.

They describe one machine at one moment. Use them to compare future runs **on the same
machine and mode**, not as universal targets.

## Running

```bash
npm run perf                                   # both projects (about 20 minutes)
npx playwright test --config playwright.perf.config.ts --project=edge-headed
PERF_RUNS=1 PERF_MATCH_SECONDS=60 npm run perf # shorter, for a quick check (bash)
```

In PowerShell, set the variables first: `$env:PERF_RUNS=1; $env:PERF_MATCH_SECONDS=60; npm run perf`
(they stay set for that terminal). A shorter run is only a smoke check: its figures are not
comparable with the three-minute results below.

`npm run perf` is separate from `npm run test:e2e`: its own config
(`playwright.perf.config.ts`), one test at a time, no retries, and a fresh build served on
port 4174. The headed project opens a visible Edge window: leave it in the foreground
until the run ends (see "Validity").

| Setting              | Default              | Meaning                                          |
| -------------------- | -------------------- | ------------------------------------------------ |
| `PERF_RUNS`          | 3 headed, 1 headless | Cold starts and three-minute matches per project |
| `PERF_MATCH_SECONDS` | 180                  | Match length (60 to 180, the Options limits)     |

## Build and conditions

- **Build:** `vite build --mode e2e`: the same minified production build (no source maps)
  plus the test hooks, about 1.3 kB more (752.8 kB against 751.5 kB). The hooks are needed
  to read entity counts and to finish matches quickly in the memory cycles; they are only
  read once per second during measured frames. Production builds do not contain them.
- **Game:** the real clock, real keyboard input (sail, alternate turns, fire every gun),
  real rendering. Scenario `endless-spawns` (the player cannot sink, so the match lasts
  its full time; enemies spawn every 5 s as usual, at most 6 alive), options 180 s / 5 s.
- **Environment:** recorded in each JSON file (`environment`): OS, CPU, RAM, browser
  version, headless or not, WebGL vendor and renderer, viewport, device pixel ratio, commit.

## Metrics

| Metric                                        | How                                                                                                                                                                                                                                 | Limits                                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame times (p50, p95, p99, max), average FPS | Timestamps of every `requestAnimationFrame` callback, recorded in the page. Only intervals between two **valid** frames count: page visible, window focused, no dialog (pause) on screen.                                           | `requestAnimationFrame` is capped by the display refresh rate, so FPS cannot exceed it. It measures the main-thread frame cadence, not GPU presentation. |
| Missed refreshes                              | Intervals longer than 1.5 × the display refresh period (median rAF interval of the idle menu).                                                                                                                                      | An estimate of dropped frames.                                                                                                                           |
| Hitches                                       | Intervals of 50 ms or more, and of 100 ms or more.                                                                                                                                                                                  |                                                                                                                                                          |
| Long animation frames                         | `long-animation-frame` entries (≥ 50 ms of work), if the browser supports them (checked first).                                                                                                                                     | Chromium only.                                                                                                                                           |
| Startup                                       | Navigation Timing (response end, DOMContentLoaded, load) and two marks: menu ready (Play button in the DOM) and ranking ready (the list answered).                                                                                  | Measured from navigation start of a cold load (new browser context: no cache, no service worker).                                                        |
| Match entry                                   | From the click on Play to a canvas on screen and a running match.                                                                                                                                                                   |                                                                                                                                                          |
| Navigation                                    | Result → menu, menu → Options, Options → menu, Match History tab (includes the mock API's 150 ms latency).                                                                                                                          |                                                                                                                                                          |
| Entities                                      | Enemies, projectiles, effects and display objects, sampled once per second through the test hook (the cost of each sample is recorded).                                                                                             |                                                                                                                                                          |
| Memory                                        | DevTools Protocol `Performance.getMetrics` (JS heap used, DOM nodes, JS event listeners) after an explicit full garbage collection (`HeapProfiler.collectGarbage`, twice), at equivalent points: back on the menu after each match. | Chromium only. JS memory only: no reliable web API exposes GPU memory, so it is not reported.                                                            |

The pause scenario is checked too: the simulation tick does not move while the pause dialog
is shown, and those frames are excluded.

## Validity

A run is **invalid** if the match pauses without the test asking (the window lost focus or
was hidden): it is kept in the JSON with `valid: false` and the reason, and left out of the
summaries. Frames while the pause dialog is shown, or without focus, are invalid frames and
never enter the frame statistics. Headed and headless figures are never mixed.

## Results (last run, 13 Oct 2026)

**Environment** (both projects): Windows 11 (10.0.26200), AMD Ryzen 5 5600 (12 threads),
16 GB, Microsoft Edge 155.0.4283.45, GPU AMD Radeon RX 6600 through ANGLE / Direct3D 11
(hardware: headless also used the GPU on this machine, not software rendering), viewport
1280 × 720, device pixel ratio 1. The display refresh period measured on the idle menu was
**6.1 ms (about 165 Hz)**, which caps the frame rate. Commit `7058470` plus uncommitted
work (M6a, M6b). The application source measured is that of commit `041e795`, except for
one comment in `src/App.tsx`.

### Startup (cold load: new context, no cache, no service worker)

Headed, 3 runs, median (min–max):

| Mark                                                            | Median (min–max) |
| --------------------------------------------------------------- | ---------------- |
| Response end                                                    | 4 ms (4–8)       |
| DOMContentLoaded / load                                         | 108 ms (103–215) |
| Menu ready (Play in the DOM; the mock API starts first)         | 188 ms (185–306) |
| Ranking ready (first answer, 150 ms simulated latency included) | 384 ms (379–500) |

Headless, 1 run: 213 / 281 / 482 ms (not compared with headed).

### Three-minute match

Headed: **3 valid runs out of 3**, about 178 s of valid frames each (29,392 to 29,451
intervals). The first 3 s after entering are reported separately (stabilization). About 497
frames per run were invalid: the scripted 3 s pause, excluded as intended.

| Metric (steady part)                   | Median (min–max) over 3 runs                 |
| -------------------------------------- | -------------------------------------------- |
| Average FPS                            | 165 (165–165)                                |
| Frame time p50 / p95 / p99             | 6.1 / 6.2 / 6.3 ms (identical in the 3 runs) |
| Worst frame                            | 6.6 ms                                       |
| Missed refreshes (> 1.5 × 6.1 ms)      | 0                                            |
| Frames ≥ 50 ms / ≥ 100 ms              | 0 / 0                                        |
| Long animation frames                  | 0                                            |
| Stabilization (first 3 s): worst frame | 6.3–12.1 ms, none ≥ 50 ms                    |
| Entering the match (click → running)   | 149 ms (140–157)                             |

Entities sampled once per second (179 samples per run): at most 6 enemies (5.3 on
average), 3 projectiles, 5 effects and 19 display objects in the dynamic layers. A sample
costs at most 0.2 ms. Pause check: the simulation tick did not move during the 3 s pause in
any run. Navigation after the match: Result → menu 35–38 ms, menu → Options 30–33 ms,
Options → menu 30–32 ms, Match History tab 225–230 ms (150 ms of it is the mock API's
latency). No console error or warning, no failed request (2 aborted per run: see below).

Headless, 1 valid run: 165 FPS, p50 / p95 / p99 6.1 / 6.2 / 6.3 ms, worst 12.2 ms, 2 missed
refreshes, nothing ≥ 50 ms.

**Reading:** on this machine, with this load, the frame rate followed the 165 Hz display with
p99 at 6.3 ms, below the 16.7 ms frame time of the specification's 60 FPS target. These are
observations, not guarantees:

- One machine with a fast desktop GPU, one browser, a 1280 × 720 viewport at device pixel ratio
  1, and one display rate (165 Hz). Nothing was measured on slower or integrated GPUs, on
  phones, at higher resolutions or pixel ratios, or with a 60 Hz or 144 Hz display.
- The load was the game's own limit: at most 6 enemies alive, a few projectiles and effects.
  How the game behaves with more entities was not measured.
- `requestAnimationFrame` timing shows the main thread's frame cadence; it does not show GPU
  presentation or input latency.

**An isolated stall, cause unknown.** In the first full run of the audit (its results are not
in the JSON, which holds the last run), one of the three headed matches had 15 frames of about
1 s (worst 1,006 ms, 15 long animation frames). That match also took about 12 s more wall time,
because the game clamps a frame to 250 ms of simulated time. The other two matches of that run,
its headless run and 5 later headed matches had none (two in diagnostic runs with script
attribution of long animation frames turned on, then the three of the run in the JSON).
**The cause was not determined:** that
run did not record attribution yet, and the stall did not happen again. Nothing measured points
to the game, the browser or anything else on the machine, and none of them is ruled out.

### Repeated matches without a reload (memory)

Six matches in the same page (20 s of real play each, then the rest of the 3 minutes
simulated through the test hook), back to the menu after each, then 20 quick enter / leave
cycles. Figures after an explicit garbage collection, back on the menu (headed; headless
gave the same within 0.03 MB):

| Point                 | JS heap used                    | DOM nodes | JS event listeners | Canvases |
| --------------------- | ------------------------------- | --------- | ------------------ | -------- |
| Before any match      | 5.59 MB                         | 241       | 178                | 0        |
| After match 1         | 8.38 MB                         | 245       | 200                | 0        |
| After matches 2 … 6   | 8.65, 8.89, 9.09, 9.32, 9.39 MB | 245       | 200                | 0        |
| After 20 quick cycles | 10.21 MB                        | 245       | 200                | 0        |

- During every match exactly one game runtime was alive; entering took 160 ms the first
  time (assets) and 58–66 ms afterwards; frames stayed at p99 6.3 ms in every cycle.
- No "too many active WebGL contexts" warning after 26 games created and destroyed: PixiJS
  releases each WebGL context when the game is destroyed (`loseContext` in
  `GlContextSystem.destroy`). DOM nodes, listeners and canvases do not grow.
- **Observation:** the JS heap grows slowly (+0.74 MB over matches 2–6, +0.82 MB over 20 quick
  cycles), with growth slowing down.
- **Investigation (instrumented, diagnostic runs not kept in the JSON):** heap snapshots before
  and after 50 extra cycles show no game object growing (no PixiJS, React or game class among
  the growing objects). The growth (about 15 kB per cycle) is native strings, compiled code,
  browser performance buffers (resource timing, bounded at 250 entries), DevTools network
  buffers (`NetworkResourcesData`, `XHRReplayData`, present because Playwright attaches the
  DevTools protocol), and one `MessagePort` with a cross-realm `ReadableStream` per request
  that goes through the MSW service worker (the ranking refresh, and the favicon, which
  Chromium fetches again on each history navigation). Retainers show each port kept alive by
  its own stream listener. Requests made from the menu alone, with no match, leave exactly
  one of each per request, and aborting a request or not makes no difference.
- **Conclusion:** in these runs, no leak was found in the game's own resources (runtimes,
  canvases, WebGL contexts, DOM nodes, listeners, PixiJS or React objects).
- **Hypothesis, not confirmed:** the remaining growth seems to come from the mock layer (MSW's
  service-worker messaging) and from the measuring tools, a few kB per request. Every figure
  above was taken with the DevTools protocol attached, which keeps buffers of its own, so the
  runs cannot tell how much of it a normal browser session would keep. Not fixed: no change to
  the game or to MSW is justified without that confirmation.

### Pending: memory in a normal Edge session

The check that would confirm or reject the hypothesis was **not done**: it has to run in an
Edge window that no automation or DevTools session is attached to, and every browser this
audit could drive was instrumented. Procedure for a manual check:

1. Build and serve the production build (the mock API runs in it; no test hooks):
   `npm run build`, then `npm run preview`, and open http://localhost:4173 in a normal Edge
   window (a new InPrivate window gives empty storage; extensions off).
2. Open Edge's **Browser task manager** (Shift+Esc), right-click its header and show the
   **JavaScript memory** column (if Edge does not offer it, use **Memory footprint**, which
   counts more than JavaScript). It needs no DevTools; it cannot force a garbage collection,
   so read it after the menu has been idle for 30 s.
3. Baseline: the menu after loading, idle 30 s. Note the tab's JavaScript memory ("live"
   figure).
4. Play N = 10 matches with Options at 60 s each, back to the menu after each, idle 30 s, note
   the figure. Keep the window in the foreground.
5. Control without matches: reload, wait for the baseline again, then switch between the
   Ranking and Match History tabs 50 times (each switch asks the mock API again), idle 30 s,
   note the figure. Growth here comes from requests alone, not from matches.
6. Optional, at the end only: open DevTools → Memory, press **Collect garbage**, take a heap
   snapshot and look for growing `MessagePort` / `ReadableStream` or game classes. Opening
   DevTools changes what the page retains, so do it once, after the readings.

Reading the result: figures from the task manager and from the DevTools protocol are not the
same measurement (no forced collection, different accounting) and must not be compared with
the table above, only with each other. If the matches grow the figure in step 4 clearly more
than the requests do in step 5, investigate the game again; if both grow similarly, the
growth follows requests, consistent with the hypothesis.

## Aborted requests

Each run lists `abortedRequests` apart from failures: TanStack Query cancels the list
requests it replaces (for example, after a confirmed submission the ranking is asked again),
so the browser reports them as `net::ERR_ABORTED`. They are expected, and not counted as
problems; any other failed request is.

## Changes made in this audit

No change to the game: the measurements showed no problem in its code. Added:
`playwright.perf.config.ts`, `e2e/perf/` (measurement helpers and scenarios), the
`npm run perf` script, this folder.
