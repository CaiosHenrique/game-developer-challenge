# Testing

Pirate Battle has three test suites:

- **Unit tests** (`npm run test:unit`, 108 tests): Node's test runner through `tsx`, for the
  pure simulation, the API contracts and client, TanStack Query behaviour, the mock API data
  and scenarios, and local storage. No browser.
- **End-to-end tests** (`npm run test:e2e`, 120 tests): Playwright, against a production build
  made with test hooks (`vite build --mode e2e`) and served by `vite preview` on port 4173,
  with the real MSW service worker. Playwright builds and starts that server itself
  (`webServer` in `playwright.config.ts`). It includes the visual regression, accessibility and
  keyboard focus tests.
- **Performance and memory** (`npm run perf`): a separate Playwright configuration
  (`playwright.perf.config.ts`, tests in `e2e/perf/`), never part of `test:e2e`. It measures
  instead of asserting; method and results are in [perf/README.md](perf/README.md).

Every end-to-end test starts from a fresh browser context (empty storage, no service worker
state, its own player). The tests fail if the console shows an error or a warning they did
not expect, except `asset-loading.spec.ts`, whose tests make asset loads fail on purpose and
check the error screen instead.

## Browser and projects

On Windows the tests run in the installed **Microsoft Edge** (`channel: 'msedge'`): Windows
Smart App Control blocks Playwright's own Chromium build there. Edge is Chromium, so this is
the Chromium engine the specification asks for. `PW_CHANNEL=chromium` (or `chrome`) selects
another Chromium build where it is allowed.

| Project            | Device                                                            | Runs                                                    |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `chromium-desktop` | Desktop Chrome profile, 1280 × 720                                | every `*.spec.ts` except `*.mobile.spec.ts` (103 tests) |
| `chromium-mobile`  | Pixel 7 in landscape: 863 × 360, touch, coarse pointer, DPR 2.625 | only `*.mobile.spec.ts` (17 tests)                      |

The mobile project covers what differs on a phone: touch controls (several fingers, cancel,
slide off, pause), orientation (portrait pauses, landscape never resumes), the main flow by
touch, ranking, history, match submission and the scenario panel by touch, and layout (no
sideways scrolling, controls inside the screen). The game rules themselves are the same
code on both, and are covered on desktop.

## Coverage of the specification (section 8)

| #   | Area                                                                                            | Desktop                                                                                                                                                                                    | Mobile                                                                                   |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | Options: navigation, validation, persistence                                                    | `options` (validation announced, reload, used by the next match, storage unavailable), `menu` (keyboard, focus)                                                                            | `flows.mobile` (Options by touch, used by the match)                                     |
| 2   | Asset loading, failure and retry                                                                | `asset-loading` (progress, failed load, Retry, invalid spritesheet)                                                                                                                        | —                                                                                        |
| 3   | Match start, movement, rotation, arena bounds, islands                                          | `movement`, `smoke`                                                                                                                                                                        | `touch.mobile` (sail and turn by touch)                                                  |
| 4   | Front and side guns, damage, cooldown, score without duplication                                | `weapons` (ball counts, exact cooldowns, range, islands, arena), `enemies` (exact damage per hit, one point per kill)                                                                      | `touch.mobile` (guns by touch, with sailing)                                             |
| 5   | Chaser and Shooter behaviour, spawn interval                                                    | `enemies`, `spawner` (cadence, distance from the player, same seed same match)                                                                                                             | —                                                                                        |
| 6   | End by time and by death, frozen simulation, clean restart                                      | `match`                                                                                                                                                                                    | `flows.mobile` (end and Play Again)                                                      |
| 7   | Pause, focus loss, resume without the clock moving                                              | `pause` (P/Esc, blur, hidden page, no catch-up, dialog focus, announcements)                                                                                                               | `orientation.mobile`, `touch.mobile` (held touch through a pause)                        |
| 8   | Result screen and persistence after refresh                                                     | `result` (stored once, reload, Back/Forward, storage unavailable)                                                                                                                          | `flows.mobile`                                                                           |
| 9   | Abandoning a match, repeated navigation, touch controls                                         | `result`, `game-lifecycle` (one canvas after repeated navigation)                                                                                                                          | `touch.mobile` (all touch controls), `flows.mobile`                                      |
| 10  | Ranking and Match History: pages, loading, empty, error                                         | `records` (stable order over every page, loading, empty, 4xx without retry, 5xx and network with retries, refresh on showing a tab, failed page never traps the player), `scenarios`       | `records.mobile` (tabs and pages by touch)                                               |
| 11  | Registration, both tabs updated, pending submission recovered after refresh                     | `submission` (one PUT, both tabs, queued through a reload and sent at start-up, `online` event, Retry, two tabs)                                                                           | `records.mobile` (submitted match in the history; failed one sent from the pending band) |
| 12  | Resend after a timeout without duplicates, late answers never overwriting newer data            | `scenarios` (stored but answered too late, out-of-order answers, switching scenario mid-load), `submission` (commit then failure, repeated Retry), `records` (late answer for a page left) | —                                                                                        |
| —   | Visual regression: menu, arena in a stable state, result                                        | `visual`                                                                                                                                                                                   | `visual.mobile` (arena with touch controls)                                              |
| —   | Accessibility: axe scans (WCAG A/AA, best practices), text contrast over images, keyboard focus | `a11y` (menu, Options with errors, match, pause, Result: submitted, failed, conflict), `focus`                                                                                             | `a11y.mobile` (match with touch controls)                                                |

Asset loading (2), enemy behaviour (5) and the timeout/late-answer rules (12) run on desktop
only: they do not depend on the device, and the mobile project already runs the same build.

## Running the tests

```bash
npm run test:unit                     # unit tests
npm run test:e2e                      # every end-to-end test, both projects
npx playwright test --project=chromium-desktop
npx playwright test --project=chromium-mobile
npx playwright test visual            # only the visual regression tests (both projects)
npx playwright test records           # any file name filter
npx playwright test -g "out of order" # by test title
npx playwright test --repeat-each=3   # run each test 3 times (looks for flaky tests)
npx playwright test --workers=1       # one test at a time (looks for order dependencies)
npx playwright test a11y focus        # accessibility scans and keyboard focus
npm run perf                          # performance suite (separate, see perf/README.md)
```

`reuseExistingServer` is on outside CI: if something already listens on port 4173 (for example
a forgotten `vite preview`), Playwright tests that server instead of building a new one. Stop
it first, or the tests may run against an old build.

## Reports, traces and screenshots

- `npm run test:e2e:report` opens the HTML report of the last run (`playwright-report/`).
- A failed test keeps its **trace** and a **screenshot** (`trace: 'retain-on-failure'`,
  `screenshot: 'only-on-failure'`). They are attached to the test in the HTML report, and
  stored in `test-results/<test>/`. A trace opens with
  `npx playwright show-trace test-results/<test>/trace.zip` (or from the report).
- A failed visual comparison attaches the expected image, the actual one and their diff.

`playwright-report/` and `test-results/` are not versioned.

## Recorded run

The last full run kept as evidence, recorded here as it happened (not repeated since):

| Item             | Recorded                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Date             | 13 October 2026, end-to-end suite started at 14:39 UTC                                                      |
| Commit           | `041e795`, in a clean clone from GitHub                                                                     |
| Environment      | Windows 11, Node 24.21.0, npm 11.19.0, Playwright 1.64.0, Microsoft Edge 155.0.4283.45                      |
| Setup and checks | `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`: passed              |
| Unit tests       | 108 of 108 passed                                                                                           |
| End-to-end tests | 120 of 120 passed (103 desktop, 17 mobile), none flaky or skipped, 87.9 s with 6 workers                    |
| HTML report      | [reports/e2e-041e795.html](reports/e2e-041e795.html), the report Playwright produced in that run, unchanged |

Traces and screenshots of failures are configured (see above) but none exist for this run:
no test failed. The other files a run leaves in `playwright-report/` and `test-results/` are
not versioned.

## Test parameters

The end-to-end tests drive the real game and the real mock API through these URL
parameters. Unless noted, they only exist in the e2e build (`--mode e2e`): the production
build ignores them, and the test hooks below are not in it.

| Parameter           | Build           | What it does                                                                                                                                                                                                                                            |
| ------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?scenario=<name>`  | e2e only        | Starts every match from a fixed situation (`open-sea`, `chaser-ahead`, `chaser-flank`, `chaser-behind-island`, `shooter-far`, `endless-spawns`, `last-stand`, `skirmish`), see `src/game/scenarios.ts`. Unknown names are ignored.                      |
| `?seed=<uint32>`    | e2e only        | Seed of the match (enemy spawns).                                                                                                                                                                                                                       |
| `?clock=manual`     | e2e only        | Matches start on a manual clock: the simulation only advances through the test hook (`step`, `advance`). Rendering still runs on real time, so shots, hits and fire are animated with real time.                                                        |
| `?resultDelay=<ms>` | e2e only        | Time the ended match stays on screen before the Result screen.                                                                                                                                                                                          |
| `?api=<scenario>`   | **every build** | Network scenario of the mock API (see `src/mocks/scenarios.ts`). A valid value wins and is saved for the next loads; an unknown value is ignored (the saved scenario, then `normal`, applies). Also selectable in the menu's "Network scenarios" panel. |
| `?apiSeed=<uint32>` | **every build** | Seed of the scenario latencies (`variable-latency`): the same seed and the same sequence of requests give the same delays. Default 1.                                                                                                                   |
| `?apiTimeout=<ms>`  | e2e only        | Shortens the HTTP client timeout (5 s otherwise), so timeout tests do not wait for real timeouts.                                                                                                                                                       |

Test hooks (e2e build only): `window.__pirateTest` reads the simulation state and drives the
manual clock; `window.__pirateMocks` gives the running MSW worker (to add a handler for one
test), the mock database and MSW's `http`, `HttpResponse` and `delay`.

## Visual regression baselines

`e2e/visual.spec.ts` (desktop) and `e2e/visual.mobile.spec.ts` (mobile) compare screenshots
with `toHaveScreenshot`. The baselines are versioned next to the specs:

- `e2e/visual.spec.ts-snapshots/menu-chromium-desktop-win32.png`
- `e2e/visual.spec.ts-snapshots/arena-chromium-desktop-win32.png`
- `e2e/visual.spec.ts-snapshots/result-chromium-desktop-win32.png`
- `e2e/visual.mobile.spec.ts-snapshots/arena-touch-chromium-mobile-win32.png`

Each capture waits for a final, deterministic screen: fixture data only, the manual clock,
a fixed scenario and number of ticks, no shot, hit or fire in the arena (they are animated
with real time), the submission confirmed on the Result screen, no pending request, fonts
ready and every image decoded. CSS animations and the text caret are disabled.

**Tolerance: at most 100 different pixels.** Measured on the reference environment, repeated
runs differ by 0 pixels, while small real changes differ by 900 to 2,400 pixels (a label
colour, one word, a button moved by 24 px). A ratio of 1% of the pixels (about 9,200 on
desktop) let all of those changes pass, so it is not used.

**The baselines are only valid in the environment that produced them: Windows with
Microsoft Edge.** Screenshots depend on the operating system, the browser version, the
installed fonts, font rendering and the graphics stack (WebGL renders the arena), so another
system will report differences that are not regressions. Playwright adds the project and the
platform to each file name (`-chromium-desktop-win32`), so baselines for another platform
would be separate files.

To change a baseline on purpose:

1. Run the visual tests and open the report to review every difference
   (`npx playwright test visual`, then `npm run test:e2e:report`).
2. Only if every difference is the intended change, regenerate:
   `npx playwright test visual --update-snapshots`.
3. Look at the new images before versioning them.

Never use `--update-snapshots` to make a failing comparison pass without understanding the
difference.

## Accessibility

**Automated (`e2e/a11y.spec.ts`, `e2e/a11y.mobile.spec.ts`).** `@axe-core/playwright` runs axe
with its default rules (WCAG 2.x A and AA, plus best practices) on each state below. Any
violation fails the test; the full axe results are attached to the test in the HTML report.

| State                                                      | Project |
| ---------------------------------------------------------- | ------- |
| Menu: Ranking tab, then Match History, scenario panel open | desktop |
| Options, then Options with both validation errors          | desktop |
| Match: HUD and game controls                               | desktop |
| Pause dialog                                               | desktop |
| Result: submitted; submission failed; conflict             | desktop |
| Match with the touch controls                              | mobile  |

axe cannot measure text drawn over images, which is how the HUD shows its values. A separate
test measures their contrast against the pixels behind the glyphs (`textContrastOverImage` in
`e2e/a11y.ts`): at least 4.5:1 for the health label, 3:1 for the large bold score and time.

**Keyboard focus (`e2e/focus.spec.ts`).** Options focuses its first field and leaving it with
Main Menu focuses Options again; the pause dialog focuses Resume, and closing it (Enter, `P`,
`Esc`) focuses the pause button; the ranking pager, the scenario panel (summary, select, Reset)
and the Result screen's Retry work by keyboard and show the 3 px focus ring. Other tests cover
the pause dialog's focus trap and live region (`pause`), the tabs' arrow keys and the Options
errors being announced (`menu`, `options`).

**Not covered by the tests (manual review only, or not done):**

- No screen reader was used (NVDA, JAWS, Narrator, VoiceOver, TalkBack): what a screen reader
  actually announces is not verified. The live regions and roles were checked by reading the
  code and by the axe scans only.
- The arena is a canvas with no accessible content: ship and projectile positions are not
  available to assistive technology, so the game cannot be played without sight. The HUD, the
  announcements (score, time warnings, low health, pause, match end) and every screen outside
  the match are accessible.
- The match screen has no heading; its only heading is the pause dialog's, while it is open.
- In the ranking and history, the pager's status (`role="status"`) changes twice when a page is
  changed (`Loading page N…`, then `Page N of M`), so both may be announced.
- No check of zoom and reflow at 200 % or 400 %, of Windows high-contrast mode, or of
  `prefers-reduced-motion` (the game does not read it).
- Colour is not the only cue for health (the HUD also shows the number), but the health bars
  above ships are only visual.

## No continuous integration

There is no CI workflow in this repository yet. The visual baselines are Windows + Edge
screenshots: compared on a Linux runner (other fonts, font rendering and graphics), they
would fail without any regression. A future CI job could run the rest of the suite, with
Linux baselines generated and reviewed separately.
