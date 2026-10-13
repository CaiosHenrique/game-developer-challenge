# Pirate Battle

A top-down naval shooter: sail between islands, sink enemy ships with your front gun and
broadsides, and score as much as you can before the timer runs out or your ship sinks.

**Play it:** https://game-developer-challenge-azure.vercel.app — the production deployment on
Vercel, built from `main` (see [Deployment](#deployment-vercel)).

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

| Action           | Keyboard                                                        | Touch (phone or tablet in landscape)       |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Sail forward     | `W` or `↑`                                                      | Bottom-left pad, raised middle button      |
| Turn left, right | `A`, `D` or `←`, `→`                                            | Bottom-left pad, lower left / right button |
| Front gun        | `Space`                                                         | Bottom-right pad, raised middle button     |
| Left broadside   | `Q`                                                             | Bottom-right pad, lower left button        |
| Right broadside  | `E`                                                             | Bottom-right pad, lower right button       |
| Pause            | `P` or `Esc`                                                    | Pause button (top right)                   |
| Resume           | `P`, `Esc` or Resume                                            | Resume                                     |
| Mute sounds      | In the pause dialog: "Mute sound effects" (`Tab`, then `Enter`) | Pause, then tap "Mute sound effects"       |

The pause button at the top right also works with the mouse; the touch buttons only appear on
devices whose main pointer is touch.

Keys work by position (`KeyboardEvent.code`), so they stay in place on other keyboard layouts.
Hold several keys or buttons at once to sail, turn and fire together. The ship only sails
forward; releasing forward lets it slow down.

The match also pauses by itself when the window loses focus, the page is hidden, or a touch
device is turned to portrait. It only resumes when you choose to (Resume, `P` or `Esc`).
Leaving the match (Main Menu, Back, reload) ends it without recording anything.

### Sound effects

Shots, broadsides, hits on ships, rams, sunk ships, splashes, points, low health, the 30 s and
10 s warnings, pause and resume, and the start and end of a match have sound effects. Sound is
on by default and starts only after you press Play (browsers allow audio only after a user
action). The **Mute sound effects** switch in the pause dialog silences them at once and is
saved on this device. If the browser has no Web Audio or a sound file fails to load, the game
plays silently. There are no ambient loops.

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
and includes visual regression, accessibility scans (axe) and keyboard focus checks.

The four visual regression tests compare against baselines made on Windows with Microsoft Edge,
and run only there. On Linux, macOS or another browser channel they are reported as skipped,
with the reason, and the rest of the suite runs as usual. A missing baseline fails its test
and is never written by a normal run: baselines change only with
`npx playwright test visual --update-snapshots`, after reviewing the differences
([docs/TESTING.md](docs/TESTING.md#visual-regression-baselines)). What each suite covers and does not cover:
[docs/TESTING.md](docs/TESTING.md). Measured performance: [docs/perf/README.md](docs/perf/README.md).

## Assets and attribution

**Source.** Everything in `assets/` was supplied with the challenge, in the Jungle Gaming
repository [junglegaming/game-developer-challenge](https://github.com/junglegaming/game-developer-challenge)
(commit `3158914`), and is kept unmodified. That repository states no license, author or
credits for these files.

**Processing.** `scripts/prepare-assets.ts` generates the runtime files in `public/game/` (not
versioned). It converts the Starling XML ship atlas to a PixiJS spritesheet, defines named
regions of the tile sheet (islands, water) and copies the UI atlas. Images are copied byte for
byte: no pixel is changed. The menu and HUD art is imported from `assets/` as it is.

**What is known about the art, and what is not:**

| Files                                                       | Origin                                                                                                                                                                                                                                                                                                                                                                                      | License                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ships, ship parts, effects, tiles, their sheets and vectors | Appear to derive from [Pirate Pack by Kenney](https://kenney.nl/assets/pirate-pack): same set of sprites and layout, a preview image of the same size and composition, and metadata in some tiles dated 10 February 2017, two days before the pack was posted on OpenGameArt. The challenge's files look repainted (a painted style, unlike the flat original); who made them is not known. | The original Pirate Pack is CC0 1.0 ([Kenney](https://kenney.nl/assets/pirate-pack), [OpenGameArt](https://opengameart.org/content/pirate-pack-190)). **The license of the repainted files is not confirmed.** |
| UI (HUD, controls, menu, `ui_sheet*`) and backgrounds       | Supplied by the challenge; author not identified                                                                                                                                                                                                                                                                                                                                            | Not identified                                                                                                                                                                                                 |
| Sounds (`assets/sounds/`)                                   | Supplied by the challenge; author not identified                                                                                                                                                                                                                                                                                                                                            | Not identified. The game plays 19 of the 27 files (copied unchanged to `public/game/sounds/`); the two ambient loops, `ship_sinking` and the `ui_*` sounds are not used.                                       |
| Fonts                                                       | None shipped: the interface uses the system font stack                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                              |

The CC0 license covers Kenney's original pack. It is not evidence about the repainted files or
the UI art, so this project does not claim any license for them. They are used because the
challenge provides them and asks for them to be used.

**Open question:** whether the public deployment may redistribute these files is not stated
anywhere in the challenge repository. Confirmation (and the license of the repainted art and
the UI) should be requested from Jungle Gaming.

**Sounds:** the project owner confirmed directly with Jungle Gaming that the audio files
supplied with the challenge may be used. That confirmation was verbal: no written license or
statement is in this repository, and the author and license of the WAV files are still not
identified. It covers the sounds only, not the art or the UI above.

## Deployment (Vercel)

`vercel.json` configures the build (`npm ci`, `npm run build`, output `dist/`), a single-page
rewrite and cache headers. The rewrite excludes `/api/*` (so an API request never receives
`index.html` when the mock worker is not active), `/game/*`, `/assets/*` and
`mockServiceWorker.js`.

1. Import the GitHub repository in Vercel (framework preset Vite, no environment variables).
2. Every push to the production branch deploys.
3. After deploying, open the URL, reload it, and check that the ranking and history load.

### Production

| Platform | Production branch | Public URL                                        |
| -------- | ----------------- | ------------------------------------------------- |
| Vercel   | `main`            | https://game-developer-challenge-azure.vercel.app |

This is the only public URL. The per-deployment URLs Vercel creates (`…-caio-team1.vercel.app`)
are protected by Vercel's login and are not meant to be shared. Every push to `main` deploys
again, so the production URL may serve a commit newer than the one verified below.

**Last verified on 13 October 2026, commit `742262c`:**

- **Same files as the commit:** the 88 files served by the production URL (`index.html`, the
  mock service worker, everything under `/assets/` and `/game/`, including the 19 sound files)
  were byte-identical to a `npm run build` of `742262c` made from a clean clone. The page loads
  the bundle `index-BBtEZnmO.js`, built from the M5 code (sound effects, hit tint, splinters),
  which no earlier commit contains.
- **Deployment record:** GitHub lists Vercel's latest Production deployment for `742262c` as
  successful. Which deployment the production domain points to was not checked in the Vercel
  dashboard.
- **Browser smoke test** on the production URL (Microsoft Edge, fresh isolated contexts; the
  scripts are not part of this repository), all passed:
  - the menu opens, the mock service worker registers and controls the page, `/api/health`
    answers through it (`mocked: true`) and the ranking loads (page 1 of 4);
  - `/options` and `/result` load and reload directly, also as the first page visited, and
    `/play` without a match returns to the menu;
  - a real 60 s match ends (ship sunk), the Result screen shows it saved on the device and
    submitted, and it is still shown after a reload, as is its Match History entry;
  - sound: no audio context before Play and one, running, after it; the 19 sound files load
    (HTTP 200); real shots produce a non-silent output signal, and the mute switch in the pause
    dialog silences it and is saved (measured, not listened to);
  - no console error or warning, page error or failed request;
  - caching: `/` and the sound files `max-age=0, must-revalidate`, `/mockServiceWorker.js`
    `no-cache`, `/assets/*` immutable; `/api/*` without the worker answers 404, not the page.
