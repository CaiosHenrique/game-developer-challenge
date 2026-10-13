# Pirate Battle

A top-down naval shooter: sail between islands, sink enemy ships with your front gun and
broadsides, and score as much as you can before the timer runs out or your ship sinks.

Built with React 19, strict TypeScript, PixiJS 8, TanStack Query 5, Axios, MSW 2 and
Playwright. The original challenge specification is in [docs/CHALLENGE.md](docs/CHALLENGE.md).

| Document                                   | Contents                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | Modules, React/PixiJS integration, simulation, collisions, persistence, API, balance |
| [docs/TESTING.md](docs/TESTING.md)         | Test suites, coverage of the specification, visual baselines, accessibility          |
| [docs/perf/README.md](docs/perf/README.md) | Performance and memory measurements, method and limits                               |
| [docs/BACKLOG.md](docs/BACKLOG.md)         | Known issues and open follow-ups                                                     |

## Requirements

- Node.js 22.12 or later (`engines` in `package.json`; developed on Node 24) and npm.
- End-to-end and performance tests: a Chromium-based browser. On Windows the tests use the
  installed Microsoft Edge; elsewhere, Playwright's Chromium (`npx playwright install chromium`).
  See [docs/TESTING.md](docs/TESTING.md#browser-and-projects).

## Setup

```bash
npm ci
npm run dev
```

Open http://localhost:5173. `npm run dev` and `npm run build` first generate the runtime
assets in `public/game/` (`npm run assets`, below).

**Environment variables:** the game needs none (no `.env` file, no keys, no external service).
The tests read a few optional ones:

| Variable             | Used by            | Effect                                                                          |
| -------------------- | ------------------ | ------------------------------------------------------------------------------- |
| `PW_CHANNEL`         | `test:e2e`, `perf` | Browser: `msedge` (Windows default), `chrome`, or `chromium` (Playwright's own) |
| `CI`                 | `test:e2e`         | Forbids `test.only`, one retry, never reuses a running server                   |
| `PERF_RUNS`          | `perf`             | Runs per project (default 3 headed, 1 headless)                                 |
| `PERF_MATCH_SECONDS` | `perf`             | Length of the measured match, 60 to 180 (default 180)                           |

## Commands

| Command                   | What it does                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`             | Development server, http://localhost:5173                                                     |
| `npm run build`           | Type-check and production build in `dist/`                                                    |
| `npm run preview`         | Serve `dist/`, http://localhost:4173                                                          |
| `npm run typecheck`       | TypeScript, no output                                                                         |
| `npm run lint`            | ESLint                                                                                        |
| `npm run format`          | Prettier, rewrites files                                                                      |
| `npm run format:check`    | Prettier, check only                                                                          |
| `npm run assets`          | Generate `public/game/` from `assets/` (runs before `dev`, `build` and `build:e2e`)           |
| `npm run build:e2e`       | Production build with the test hooks (`vite build --mode e2e`), used by the browser tests     |
| `npm run test:unit`       | Unit tests (Node test runner through `tsx`; no browser)                                       |
| `npm run test:e2e`        | Build with test hooks, serve it on port 4173 and run Playwright (desktop and mobile projects) |
| `npm run test:e2e:report` | Open the last Playwright HTML report                                                          |
| `npm run perf`            | Performance and memory suite (separate config, port 4174, about 20 minutes)                   |
| `npm run balance`         | Headless balance report over seeded matches (`npm run balance -- 200` for 200 seeds)          |

Ports are fixed (`strictPort`): if 5173, 4173 or 4174 is taken, the command fails instead of
picking another port. `npm run test:e2e` reuses a server already listening on 4173 (outside CI):
stop any `npm run preview` first, or the tests run against that older build.

## How to play

Each match lasts the session time chosen in Options (active play; pauses do not count).
Enemies keep arriving: **chasers** (red) sail straight at you and ram, sinking themselves;
**shooters** (black) keep their distance and fire their front gun. Every enemy you sink with
your guns is worth one point; a chaser that rams you gives none. The match ends when the time
is up or your ship sinks, and the Result screen shows the score, the time played and why it
ended.

### Controls

| Action           | Keyboard             | Touch (phone or tablet in landscape)       |
| ---------------- | -------------------- | ------------------------------------------ |
| Sail forward     | `W` or `↑`           | Bottom-left pad, raised middle button      |
| Turn left, right | `A`, `D` or `←`, `→` | Bottom-left pad, lower left / right button |
| Front gun        | `Space`              | Bottom-right pad, raised middle button     |
| Left broadside   | `Q`                  | Bottom-right pad, lower left button        |
| Right broadside  | `E`                  | Bottom-right pad, lower right button       |
| Pause            | `P` or `Esc`         | Pause button (top right)                   |
| Resume           | `P`, `Esc` or Resume | Resume                                     |

The pause button at the top right also works with the mouse; the touch buttons only appear on
devices whose main pointer is touch.

Keys work by position (`KeyboardEvent.code`), so they stay in place on other keyboard layouts.
Hold several keys or buttons at once to sail, turn and fire together. The ship only sails
forward; releasing forward lets it slow down.

The match also pauses by itself when the window loses focus, the page is hidden, or a touch
device is turned to portrait. It only resumes when you choose to (Resume, `P` or `Esc`).
Leaving the match (Main Menu, Back, reload) ends it without recording anything.

### Gameplay configuration

The **Options** screen sets the two values the next matches use, saved on this device:

| Option                      | Limits                          | Default |
| --------------------------- | ------------------------------- | ------: |
| Game session time           | 60 to 180 seconds, whole        |   120 s |
| Enemy spawn time (interval) | 1 to 10 seconds, in 0.5 s steps |     5 s |

A match keeps the options in effect when it started. Every other gameplay value (health,
speeds, turn rates, weapons, cooldowns, ranges, AI, spawn rules) is in `DEFAULT_GAME_CONFIG`
in [src/game/config.ts](src/game/config.ts); the values and the reasons behind them are in
[ARCHITECTURE.md](ARCHITECTURE.md#balance).

## Ranking, history and the mock API

The menu has two tabs:

- **Ranking**: matches played with the same options as yours now (only equal settings are
  compared), by score.
- **Match History**: the matches of this device's player, most recent first, plus the ones
  still waiting to be submitted.

There is no real server. Both lists and match submission are served by
[MSW](https://mswjs.io/) in the browser, **in every build, including production**: its
service worker (`public/mockServiceWorker.js`) starts before the app renders. Its data is a
fixed set of fictional matches plus the matches played in this browser, kept in
`localStorage`. The player is a local identity generated on first start (no account, no
login).

A finished match is queued on the device before it is sent, and stays queued until the
server confirms it. If sending fails (a server error, a connection failure), it is sent again when the app
opens, when the browser comes back online, after the next match, or with Retry (Result screen,
or the pending list in Match History). Details: [ARCHITECTURE.md](ARCHITECTURE.md#submission-and-recovery-of-pending-matches).

### Network scenarios

How the mock API answers can be changed, to see how the game behaves with a slow or failing
server.

- **In the app:** open **Network scenarios (mock API)** at the bottom of the menu and pick a
  scenario. The lists are asked again at once. A scenario other than Normal shows in the panel's
  title.
- **By URL:** add `?api=<id>`, e.g. `http://localhost:5173/?api=slow`. A valid id wins and is
  saved for the next loads; an unknown id is ignored.
- **Reset:** **Reset mock data** in the same panel restores the initial matches and the Normal
  scenario. It does not change your options, last result, player or pending submissions.

The choice is saved in the browser and shared by its tabs.

| `?api=` id                    | Panel label               | Behaviour                                                                            |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `normal`                      | Normal                    | Every request succeeds after 150 ms (default)                                        |
| `empty`                       | Empty lists               | Ranking and history answer with no matches (stored data untouched)                   |
| `many-pages`                  | Many pages                | Lists include extra generated matches, read-only                                     |
| `slow`                        | Slow                      | Every request answers after 2.5 s                                                    |
| `variable-latency`            | Variable latency          | Each request answers after 0.1 to 2 s (seeded by `?apiSeed=<n>`, default 1)          |
| `out-of-order`                | Out of order              | Requests alternate 1.8 s and 0.1 s, so newer answers arrive first                    |
| `timeout`                     | Timeout                   | No answer in time: the client times out (5 s) and retries twice, about 18 s in all   |
| `network-error`               | Connection failure        | Every request fails to connect                                                       |
| `http-4xx`                    | HTTP 400                  | Every request is rejected (not retried)                                              |
| `http-5xx`                    | HTTP 503                  | Every request fails with a server error (retried twice)                              |
| `ranking-fail`                | Ranking fails             | Only the ranking fails (503)                                                         |
| `history-fail`                | History fails             | Only the history fails (503)                                                         |
| `submit-timeout-after-commit` | Timeout after registering | The first send of each match is stored but answered too late; the retry gets it back |
| `submit-unavailable`          | Registration unavailable  | Match submission fails (503) until another scenario is chosen                        |

### Reproducing failures

| To see                                      | Do                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading, then an error with Try again       | Scenario `timeout`, `network-error` or `http-5xx`; open the menu and wait (`timeout` takes about 18 s)                                                              |
| An error that is not retried                | Scenario `http-4xx`                                                                                                                                                 |
| Previous page kept while the next one loads | Scenario `slow`, default options (4 ranking pages with the initial data), then Next in Ranking                                                                      |
| Late answers not overwriting newer ones     | Scenario `out-of-order` or `variable-latency`, change pages quickly                                                                                                 |
| A submission that fails, then Retry         | Scenario `submit-unavailable`, finish a match (Result: failed, Retry); switch back to Normal and press Retry                                                        |
| A submission queued across a reload         | Scenario `submit-unavailable`, finish a match, reload: the match is listed as waiting in Match History; choose Normal and it is sent (Retry, or the next trigger)   |
| A resend that must not duplicate the match  | Scenario `submit-timeout-after-commit`, finish a match: the first send times out after being stored, the retry gets the same record back, the ranking lists it once |
| A connection failure                        | Scenario `network-error`                                                                                                                                            |

The browser tests reproduce all of these deterministically, and also cases that are not set
from the menu: failed asset loading (error and Retry on the game screen), unavailable
`localStorage`, the `online` event and two tabs at once; see [docs/TESTING.md](docs/TESTING.md).

## Tests

```bash
npm run test:unit      # pure simulation, API contracts and client, mock API, storage
npm run test:e2e       # Playwright: desktop (1280 × 720) and mobile (Pixel 7 landscape)
npm run perf           # performance and memory (separate, long)
```

The end-to-end suite runs against a production build with test hooks and the real MSW worker,
and includes visual regression (Windows + Edge baselines), accessibility scans (axe) and
keyboard focus checks. What each suite covers and does not cover:
[docs/TESTING.md](docs/TESTING.md). Measured performance: [docs/perf/README.md](docs/perf/README.md).

## Assets

The original challenge assets in `assets/` are never modified. `scripts/prepare-assets.ts`
generates the runtime files in `public/game/` (not versioned): it converts the Starling XML ship
atlas to a PixiJS spritesheet, defines named regions of the tile sheet (islands, water) and
copies the UI atlas.

## Deployment (Vercel)

`vercel.json` configures the build (`npm ci`, `npm run build`, output `dist/`), a single-page
rewrite and cache headers. The rewrite excludes `/api/*` (so an API request never receives
`index.html` when the mock worker is not active), `/game/*`, `/assets/*` and
`mockServiceWorker.js`.

1. Import the GitHub repository in Vercel (framework preset Vite, no environment variables).
2. Every push to the production branch deploys.
3. After deploying, open the URL, reload it, and check that the ranking and history load.

No public deployment is documented here yet.
