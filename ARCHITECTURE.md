# Architecture

How Pirate Battle is built, and why. Everything here describes the code as it is; file paths
are relative to the repository root. Setup and commands are in the [README](README.md),
tests in [docs/TESTING.md](docs/TESTING.md), performance measurements in
[docs/perf/README.md](docs/perf/README.md).

## Layers

```
React (src/App.tsx, src/app/)          screens, forms, HUD, dialogs, ranking and history
  │  owns one GameRuntime per match; reads the HUD through useSyncExternalStore
  ▼
GameRuntime (src/game/GameRuntime.ts)  PixiJS Application, fixed-step clock, input, pause
  │  steps the simulation, hands its state and events to the renderer
  ├─► Simulation (src/game/sim/)       pure, deterministic game rules (no Pixi, React, DOM)
  └─► GameRenderer (src/game/render/)  draws the simulation; visual effects only
TanStack Query + Axios (src/api/)      ranking, history, match submission
  ▼
MSW (src/mocks/)                       the API itself: handlers, data, network scenarios
localStorage (src/storage/)            options, last result, player, pending submissions
```

| Directory / file          | Responsibility                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main.tsx`            | Starts the mock API (lazy chunk), then renders `<App>` in `StrictMode` with the `QueryClient`.   |
| `src/App.tsx`             | Screens and the match lifecycle; options, player, submissions queue.                             |
| `src/app/`                | React screens and components (menu, Options, game screen, HUD, Result, records, touch controls). |
| `src/game/config.ts`      | Typed gameplay configuration (`DEFAULT_GAME_CONFIG`): every balance value.                       |
| `src/game/options.ts`     | Player options, their limits, validation, and the per-match config built from them.              |
| `src/game/arena.ts`       | World size, islands and their colliders, player start, enemy spawn points.                       |
| `src/game/sim/`           | Simulation: step order, ships, collisions, weapons, AI, spawner, seeded RNG.                     |
| `src/game/render/`        | `GameRenderer`: PixiJS scene, sprite pools, health bars, effects.                                |
| `src/game/GameRuntime.ts` | PixiJS `Application`, clock, keyboard/touch input, pause, HUD publishing, teardown.              |
| `src/game/assets.ts`      | Loads the generated spritesheets once and shares them between matches.                           |
| `src/game/scenarios.ts`   | e2e-only fixed match setups and URL parameters (`?scenario`, `?seed`, `?clock`, `?resultDelay`). |
| `src/api/`                | Contracts (zod), Axios client, typed errors, query hooks, submission protocol.                   |
| `src/mocks/`              | MSW worker, handlers, mock database and fixtures, network scenarios.                             |
| `src/storage/`            | Versioned `localStorage` access and the pending-submission queue.                                |
| `scripts/`                | `prepare-assets.ts` (runtime assets from `assets/`), `balance.ts` (headless balance report).     |
| `e2e/`                    | Playwright suite; `e2e/perf/` is the separate performance suite.                                 |

The simulation boundary is enforced by ESLint (`eslint.config.js`): files in `src/game/sim/`
cannot import `pixi.js`, React, the runtime, the asset loader, input or `src/app/`, and cannot
use `Math.random`, `Date`, `performance` or `crypto`.

## Application flow

Routing is a small `history`-based router (`src/app/router.ts`) with four paths: `/`, `/options`,
`/play`, `/result`. Any other path shows the menu.

1. **Menu (`/`)**: Play, Options, the controls, the Ranking and Match History tabs, and the
   network scenario panel.
2. **Play** creates a _match request_ (`navigate('/play', { match })`): a new `matchId`, the
   options in effect now and the `GameConfig` built from them (`configFromOptions`). Only this
   request mounts a game: reloading `/play`, deep-linking, Back or Forward reach `/play` without
   a request and redirect to the menu.
3. **Game (`/play`)**: `GameScreen` loads the assets (progress bar; on failure an error with
   Retry), then mounts `Match`, which creates the `GameRuntime`. The **Main Menu** button, the
   pause dialog's Main Menu, Back or a reload leave the match: it is destroyed and nothing is
   saved or sent (an abandoned match is not recorded).
4. **End**: when the simulation ends, the runtime publishes a result. `App` processes it once
   per `matchId`: it stores it as the last result, queues its online record and sends the
   queue. The ended arena stays on screen for 1 s (`RESULT_DELAY_MS`), then the app replaces
   `/play` with `/result` (so Back goes to the menu, never to the finished match).
5. **Result (`/result`)**: score, active time, end reason, whether it was saved on this
   device and its online submission state (with Submit or Retry when relevant). **Play Again**
   starts a new match request with the current options; **Main Menu** goes home. Reloading
   `/result` shows the stored last result.

## React and PixiJS

PixiJS is used imperatively; there is no React binding. React owns the lifetime, PixiJS owns
the frames.

- **One runtime per match.** `GameScreen` is keyed by `matchId`, so Play Again mounts a fresh
  `Match`, runtime, simulation, seed and configuration copy. The runtime clones the
  configuration it receives (`structuredClone`): Options changes apply to the next match only.
- **Strict Mode.** `main.tsx` renders in `StrictMode`, which mounts, unmounts and remounts
  effects in development. `GameRuntime.start()` awaits `app.init()`; `destroy()` may run before
  it resolves. In that case `destroy()` only marks the runtime as disposed, and `start()`
  destroys the application as soon as `init()` resolves, before adding a canvas or listeners.
- **Resize.** A `ResizeObserver` on the host resizes the renderer and letterboxes the fixed
  1600 × 900 world: the stage is scaled uniformly and centred. Game rules never depend on the
  screen size. The resolution is the device pixel ratio, capped at 2.
- **React never sees per-frame state.** The runtime offers a `HudState` (health, score, whole
  seconds left, phase, result, pause reason, announcement) every frame to a `HudStore`; the store
  notifies React (`useSyncExternalStore`) only when a value changed. The test hook counts these
  notifications: in `e2e/match.spec.ts`, 600 steps (10 simulated seconds, nothing but the clock
  changing) notify React exactly 10 times.
- **Keyboard capture** is attached only while a match is running and unpaused, and
  `preventDefault` is called only for the game keys (without Ctrl, Alt or Meta).

### Resource lifecycle

`GameRuntime.destroy()` releases everything the match created:

- the test hooks, the keyboard listeners and touch state, the `keydown` (pause), `blur` and
  `visibilitychange` listeners, the `ResizeObserver`;
- the cropped health-bar textures (`GameRenderer.destroy()`);
- the PixiJS application with its ticker, canvas and scene graph, including pooled sprites
  (`app.destroy(true, { children: true })`). PixiJS releases the WebGL context there
  (`loseContext` in its `GlContextSystem.destroy`).

Textures are **not** destroyed: `loadGameAssets()` loads the four runtime assets once
(`/game/ships.json`, `/game/tiles.json`, `/game/ui.json`, `/game/water@2x.png`) and every match
shares them. A failed load is not cached, so Retry loads again; a spritesheet missing a required
frame is unloaded and fails the load instead of drawing empty sprites.

`GameRuntime.liveInstances` counts initialized, not yet destroyed runtimes. The e2e suite
(`game-lifecycle`, `match`, `result`) checks that repeated navigation and Play Again leave one
canvas and one runtime, and no canvas once the match is left; the performance suite checks the
same over 26 matches in one page.

### Rendering

`GameRenderer` reads the simulation and the events of the last steps; it never writes back.

- Static layers: a tiling water sprite and the three island sprites.
- Dynamic layers (enemies, player, projectiles, effects) use **pools**: a sprite that is no
  longer needed is hidden and reused, so a match does not create display objects without bound.
- Ships show four damage stages from the art (intact, damaged, badly damaged, wreck), chosen
  from the health fraction (above 2/3, above 1/3, below), with a fire overlay on damaged ships.
- Every ship has a health bar above it that does not rotate with the hull. The fill is
  cropped from the UI atlas art; a new cropped texture is made only when the fraction changes,
  and the previous one is destroyed.
- Effects driven by events, in render time: muzzle flashes, hits on ships and islands, a ball
  sinking where it lands, a three-frame explosion and a sinking wreck for destroyed ships, the
  player's explosion on death.
- There is no interpolation between simulation steps: each frame draws the state of the last
  step (the simulation runs at 60 steps per second, whatever the display rate).
- `?debug=colliders` (in any build) draws the island boxes, hull circles and projectiles.

## Simulation

`Simulation` (`src/game/sim/simulation.ts`) holds the whole match state: player, enemies,
projectiles, score, tick, phase. It has no rendering or DOM dependency and is deterministic:
the same configuration, seed and input sequence give the same match. The runtime picks a new
seed per match (`crypto.getRandomValues`); the only randomness inside is the seeded mulberry32
generator (`src/game/sim/rng.ts`), used by the spawner.

### Clock

- Fixed step: `stepsPerSecond` = 60. The runtime accumulates real time from the PixiJS ticker
  and runs as many whole steps as fit.
- A frame longer than `maxFrameSeconds` (0.25 s) is clamped, so a stalled tab cannot cause a
  burst of steps.
- All game timing (match timer, cooldowns, spawns, projectile range, AI timers) is expressed in
  whole ticks (`secondsToTicks` rounds), so pausing freezes it without special cases.
- The e2e build can switch to a **manual clock** (`?clock=manual` or the test hook): the
  simulation then advances only through `step(count)` / `advance(ms)`.

### Order of one step

As implemented in `Simulation.step()`:

1. **Commands**: the player's input, then each living enemy's AI, all decided from
   start-of-step positions.
2. **Movement** of every ship (turn, accelerate or decelerate, move along the heading).
3. **Separation** of overlapping hulls: enemy/enemy and shooter/player. Chasers are not pushed
   away from the player: they ram.
4. **Islands and arena bounds** for every ship (islands win over separation); enemies' stuck
   state is updated.
5. **Ramming**: a chaser touching the player deals its impact damage once and is destroyed
   (cause `ramming`, no score).
6. **Projectiles**, in creation order: each moves along a swept segment and stops at its first
   contact. A hit applies damage once; an enemy reduced to 0 health is destroyed immediately,
   stops being a target for the next projectiles, and its projectiles in flight are removed.
7. **Firing**: the player's weapons, then living shooters (by id). New projectiles move from
   the next step.
8. **Cleanup**: destroyed enemies are removed.
9. **Spawning**: a pending spawn appears at a valid point; it acts from the next step.
10. **End of match**: the player's ship sank (`death`, checked first) or the timer reached the
    match duration (`time`). An ended match is frozen: further steps change nothing.

Each step produces events (`shot`, `projectileRemoved`, `shipHit`, `shipDestroyed`,
`matchEnded`) that the renderer turns into effects. Events never affect the simulation.

### Ships and collisions

- A ship sails forward only. Turning is a rate in radians per second; holding the throttle
  accelerates up to `maxSpeed`, releasing it decelerates to a stop.
- A **hull** is two circles along the heading (bow and stern: `radius` 24, `offset` 30 for every
  ship).
- **Islands** are axis-aligned boxes: each island art's size minus a 10-unit inset, to match the
  soft, transparent shore (`src/game/arena.ts`). The **arena** is the 1600 × 900 box.
- Ship against island or arena: each hull circle is pushed out (two passes per step, so a
  contact with two obstacles settles). Sailing into the contact caps the speed by the impact
  angle: head-on the ship stops, at a glancing angle it slides along the shore.
- Ship against ship: overlapping circles are pushed apart, half each.
- **Projectiles** are circles tested along their whole movement in the step (swept segment
  against island boxes expanded by the projectile radius, and against hull circles expanded by
  it), so a fast projectile cannot pass through a thin target. The earliest contact wins; on a
  tie, islands come first. Player projectiles only hit enemies; enemy projectiles only hit the
  player. A projectile is removed on contact, outside the arena, or after `range / speed`.

### Weapons

| Weapon (player) | Projectiles per shot                            | Damage | Speed | Range | Cooldown |
| --------------- | ----------------------------------------------- | -----: | ----: | ----: | -------: |
| Front gun       | 1, along the heading, from the bow              |     25 |   420 |   520 |    0.6 s |
| Left broadside  | 3 parallel balls, 28 apart, perpendicular left  |     20 |   380 |   380 |    1.5 s |
| Right broadside | 3 parallel balls, 28 apart, perpendicular right |     20 |   380 |   380 |    1.5 s |

Each weapon has its own cooldown, counted in ticks; holding the key fires again as soon as it
is ready. The shooter's gun is a front gun: 8 damage, speed 360, range 420, every 3 s.

### Enemies and AI

`enemyControls` (`src/game/sim/ai.ts`) decides each enemy's command per step:

- **Chaser** (40 health, top speed 110): always sails towards the player and rams it (15
  damage; the chaser is destroyed and the player gets no point).
- **Shooter** (60 health, top speed 110): sails towards the player until it is within 300
  (`preferredRange`), then stops and turns to aim. It fires when the player is within 380
  (`attackRange`) and within 15° of its bow (`fireCone`).
- **Island avoidance**: two rays (130 long, ±0.45 rad from the bow) are tested against the
  islands expanded by the hull radius; when one is blocked the enemy turns away, when both are,
  it turns to the side whose obstacle is farther. An enemy sailing but barely moving for 1 s is
  stuck: it turns to one fixed side (odd ids right, even ids left) for 0.8 s. There is no path
  finding.

### Spawner

`Spawner` (`src/game/sim/spawner.ts`):

- Spawns are scheduled at 2 s, then every `intervalSeconds` (the Options value), in whole ticks.
  Skipping a spawn never moves the following ones.
- A scheduled spawn is skipped while 6 enemies are alive (`maxAlive`). Otherwise it becomes
  pending; a pending spawn still waiting when the next one is scheduled is replaced.
- A pending spawn appears on the first tick with a valid point: one of 16 points near the arena
  edges, at least 450 from the player, not overlapping any ship. The point is picked with the
  seeded generator; the new enemy faces the player.
- Kinds: the first two spawns are a chaser, then a shooter (`openingKinds`), so every match meets
  both types; then each kind is drawn with equal weight.

### Score, damage and end

- One point per enemy destroyed by the player's fire, counted once (`destroyEnemy` ignores an
  enemy already destroyed). Rammed chasers give no point.
- Health never goes below 0. The player has 150 health.
- The match lasts the Options session time in active play (pauses excluded). The result's time
  is `endTick / 60`, exact.

## Input and pause

- **Keyboard** (`src/game/input.ts`), by physical key (`KeyboardEvent.code`): W or ↑ sail
  forward, A / D or ← / → turn, Space front gun, Q left broadside, E right broadside. Held keys
  are released when the window loses focus.
- **Touch** (`src/game/touchInput.ts`, `src/app/TouchControls.tsx`): shown on devices whose main
  pointer is coarse. Six on-screen buttons; each finger holds one action until it is lifted,
  cancelled or slides off, so several can be held at once. Keyboard and touch are combined: an
  action is held while any source holds it.
- **Pause**: P or Esc (toggle), the HUD pause button, and automatically when the window loses
  focus (`blur`), the page is hidden (`visibilitychange`) or a touch device is held in portrait.
  While paused no step runs (real or manual clock), effects stand still, and input is released.
  Only a player action resumes (Resume, P or Esc): held keys must be pressed again, the
  accumulator is reset and the first frame's delta is dropped, so no paused time is simulated.
  Turning a phone back to landscape does not resume by itself.

## Interface and accessibility

- Menus, forms, the HUD, the pause dialog and the Result screen are React DOM, styled with the
  asset pack's UI art (`src/app/uiArt.ts`). The arena, ships, projectiles, effects and the
  health bars above ships are PixiJS.
- The HUD is a `<dl>` (health, score, time left). A visually hidden polite live region announces
  discrete events only (`src/game/announcements.ts`): match end, pause and resume, low health
  (once, at 25 % or less), 30 s and 10 s left, and score changes, never the running clock.
- The pause dialog is modal (`role="dialog"`, `aria-modal`), focuses its first button and keeps
  Tab inside. Focus is moved deliberately: Options focuses its first field; leaving Options with
  its Main Menu button focuses Options again; closing the pause focuses the pause button; the
  Result screen focuses Play Again.
- The tabs follow the WAI-ARIA tabs pattern (arrows, Home, End). Lists are tables with headers
  and a page status.
- **The canvas has no accessible content.** A screen-reader user gets the HUD, the
  announcements and the dialogs, not the positions of ships or projectiles. The game is not
  playable without sight; no screen reader was tested (see
  [docs/TESTING.md](docs/TESTING.md#accessibility)).

## Local persistence

All keys are versioned (`.v1`): a change of shape gets a new key instead of misreading old data.
Every read is validated (zod or the options validator) and falls back safely; every write
reports failure instead of throwing. Storage may be unavailable (blocked, full): the app keeps
working and says what is not kept.

| Key                               | Written by                              | Content                                                                                                                                                                      |
| --------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pirate-battle.options.v1`        | Options → Save                          | `{ sessionSeconds, spawnIntervalSeconds }`. Invalid or missing fields fall back to the defaults.                                                                             |
| `pirate-battle.lastResult.v1`     | End of a match                          | `{ matchId, finishedAt, score, timePlayedSeconds, reason, options, submittedAt? }`. Written once per `matchId`; `submittedAt` is added when the online ranking confirmed it. |
| `pirate-battle.player.v1`         | First start                             | `{ playerId, playerName }`: a local, simulated identity (no authentication). The name is derived from the id, e.g. "Captain 4F2A".                                           |
| `pirate-battle.pendingMatches.v1` | End of a match; removed on confirmation | Array of match records (the API contract) waiting for the online ranking, in order.                                                                                          |
| `pirate-battle.mockdb.v1`         | Mock API                                | `{ records: [...] }`: the mock server's data (fixtures plus registered matches).                                                                                             |
| `pirate-battle.mockScenario.v1`   | Network scenario panel or `?api=`       | The selected network scenario id.                                                                                                                                            |

When storage cannot be written: options apply for the session only (the Options screen says
so); the result is kept for the session and the Result screen says it was not saved; the
player identity lasts for the page load; the pending queue lives in memory (the Result screen
and the history warn that a reload loses it); the mock data lives in memory (the menu says it
resets on reload).

## Ranking and history

### Contracts

`src/api/contracts.ts` defines zod schemas used by **both** the client (responses) and the MSW
handlers (requests and responses):

- `MatchRecord`: `matchId`, `playerId`, `playerName`, `finishedAt` (ISO date-time),
  `score`, `durationSeconds` (active time), `endReason` (`time` | `death`), `config`
  (`sessionSeconds`, `spawnIntervalSeconds`, within the Options limits) and `configKey`
  (e.g. `120s-5s`), which must match `config`.
- `RankingEntry`: a `MatchRecord` plus its `rank`.
- `Page<T>`: `items`, `page` (from 1), `pageSize` (1 to 50, default 10), `totalItems`,
  `totalPages`. The schema checks that the metadata agrees with itself (page size, total pages,
  number of items on this page; a page past the end is valid and empty).
- Errors: `{ error: { code, message } }`.

| Endpoint                                   | Answer                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ranking?configKey&page&pageSize` | Matches with that configuration only, ordered by score (desc), then `finishedAt` (earlier first), then `matchId`.               |
| `GET /api/players/:playerId/matches`       | The player's matches, most recent first, then `matchId`.                                                                        |
| `PUT /api/matches/:matchId`                | Idempotent registration: 201 created, 200 for the same record again, 409 for a different record under the same id, 400 invalid. |

Both orders are total, so pages are stable. The ranking only compares matches played with the
same options, and the Ranking tab shows the configuration of the current options.

### Client and cache

- **Axios** (`src/api/http.ts`): one instance, base URL `/api`, 5 s timeout. Failures are
  normalized to `ApiError` (`timeout`, `network`, `http` with status and code,
  `invalid-response`); cancellations are left to TanStack Query. A response that does not match
  the contract, or a page other than the one asked for, is rejected.
- **TanStack Query** (`src/api/queries.ts`): keys `['ranking', configKey, page]` and
  `['history', playerId, page]`. `staleTime` 10 s, refetch on window focus, and
  `refetchOnMount: 'always'`, so showing a tab refreshes it. While another page loads the
  previous one stays visible (`keepPreviousData`) and is marked as loading. Retries: at most 2,
  only for transient errors (timeout, network, 5xx, 408, 429), after 1 s then 2 s; a 4xx or an
  invalid response is not retried.
- **Late answers**: each page is its own cache entry and the request carries the query's
  `AbortSignal`; an answer can only be stored under the key it was requested for, so a late
  answer never replaces a newer page. When the scenario or the mock data changes,
  `refreshRecordQueries` cancels requests in flight before invalidating, so a first load
  cannot keep an answer given under the old conditions.
- Every list shows its states: loading, error with Try again, empty, the rows, the previous page
  while the next loads, "Updating…" during a background refresh, and a refresh error that keeps
  the last results.

### Submission and recovery of pending matches

`MatchSubmitter` (`src/api/submissions.ts`) with the queue `PendingSubmissions`
(`src/storage/pendingSubmissions.ts`):

1. When a match ends, its record is built from the stored result (same `matchId`, end time,
   active time, reason and options) and **queued before it is sent**.
2. Sending is a TanStack Query mutation per match (key `['submitMatch', matchId]`), retried like
   the queries (transient errors only, at most 2 retries). Offline is reported as a failure, not
   paused. A match never has two sends in flight at once.
3. A record leaves the queue only after the server confirmed it **and** `submittedAt` was
   written on the stored last result (when it is that match). If that local write fails, the
   record stays queued and the next trigger sends it again; the server answers idempotently.
4. After a confirmation, both lists are refreshed.

Triggers: app start, the `online` event, the end of every match (the whole queue is sent), and
the Retry buttons (Result screen, pending band in Match History). A 409 conflict is not retried
automatically; it keeps the record queued and shows Retry. The Match History's first page shows
the queued matches not yet confirmed (never one already listed by the server).

Several tabs share the stored queue and mock data: each change re-reads storage first, and a
`storage` event refreshes the other tabs. Storage has no atomic read-modify-write, so two tabs
changing the queue at the same instant can still race; a duplicate send is harmless because
registration is idempotent.

## Mock API (MSW)

The ranking and history API exists only as MSW handlers (`src/mocks/handlers.ts`), and the
worker runs in **every build, including production**. `main.tsx` loads it as a separate chunk
and waits for it before rendering; if it cannot start, the game still works and the tabs say
ranking and history are offline. Unhandled requests (assets, the page) bypass MSW; any other
`/api/*` path answers 404.

- **Data** (`src/mocks/db.ts`): seeded fixtures (52 matches by 12 fictional captains, in three
  configurations: 34 with 120 s / 5 s, 12 with 60 s / 3 s, 6 with 180 s / 2.5 s) plus the matches
  registered from this browser, stored under `pirate-battle.mockdb.v1`. It is per browser
  profile: there is no shared server, so other devices' matches never appear.
- **Network scenarios** (`src/mocks/scenarios.ts`): how requests are answered (latency,
  failures, empty or extra data). Scenarios never change the stored data. They are listed in
  the [README](README.md#network-scenarios).
- **Selection**: a valid `?api=<id>` wins and is saved; otherwise the saved scenario; otherwise
  `normal`. The menu's "Network scenarios (mock API)" panel changes it at run time and refreshes
  the lists. **Reset mock data** restores the fixtures and the `normal` scenario; it does not
  touch the options, the last result, the player or the pending queue.
- **Storage unavailable**: MSW reads `localStorage` while its module loads; when storage access
  throws, `src/mocks/storageFallback.ts` gives it an in-memory storage during that load only.

**A real backend** would replace `src/mocks/` and keep `src/api/`: the client already validates
every response against the contracts, normalizes errors and relies on an idempotent `PUT`. A
real backend would also need authentication (the player id is a local, simulated identity)
and server-side validation of results (the client is trusted here).

## Builds and test instrumentation

| Build                                         | Used by                            | Differences                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build` (`vite build`)                | Production, `npm run preview`      | Minified, no test hooks. MSW runs.                                                                                                                                      |
| `npm run build:e2e` (`vite build --mode e2e`) | `npm run test:e2e`, `npm run perf` | Same minified build plus `window.__pirateTest`, `window.__pirateMocks` and the e2e-only URL parameters (`?scenario`, `?seed`, `?clock`, `?resultDelay`, `?apiTimeout`). |
| `npm run dev` (Vite dev server)               | Development                        | Unminified, React development mode (Strict Mode double effects). No test hooks.                                                                                         |

The test code is gated by `import.meta.env.MODE === 'e2e'` and removed from other builds by
the bundler. The production bundle contains no test hooks, no performance instrumentation
(`e2e/perf/` is injected by the tests) and no axe.

## Balance

All values live in `DEFAULT_GAME_CONFIG` (`src/game/config.ts`); systems read them from there,
so rebalancing never changes simulation code. The Options screen exposes the two values the
specification asks for: session time (60 to 180 s, whole seconds, default 120) and spawn
interval (1 to 10 s in 0.5 s steps, default 5).

`npm run balance` plays seeded matches headlessly (no browser) with the default configuration
and two player policies: `idle` (never touches the controls) and `bot` (a simple heuristic that
sails at the nearest enemy and fires when lined up; not a strong player). With the current
values and 50 seeds, it prints:

| Policy | Died | Survival median / min | Score mean / max | Rams taken (mean) |
| ------ | ---: | --------------------- | ---------------- | ----------------: |
| idle   | 100% | 37.3 s / 28.8 s       | 0 / 0            |               3.5 |
| bot    |  40% | 120.0 s / 80.1 s      | 17.0 / 24        |               4.5 |

Decisions recorded with the balance pass (commit `f8f0ab1`): the earlier tuning was unwinnable
for the bot (it died in every match), so player health went to 150, the shooter to 8 damage
every 3 s, ramming to 15, the chaser's top speed to 110, with a spawn every 5 s and at most 6
enemies alive. A player who does nothing sinks in well under a minute; an engaged player can
survive the whole match and score. This was tuned against the bot only, not with players.

## Known limitations

- One fixed arena layout (three islands); islands collide as boxes inset from their art, not
  as their exact shore outline.
- Enemies have no path finding: they steer around islands with two rays and a fixed-side escape
  when stuck, which can still look clumsy around island corners.
- No audio; no interpolation between simulation steps (60 steps per second on any display).
- Touch play is landscape only; portrait pauses the match.
- The canvas is not accessible to screen readers (see above).
- Ranking and history are local to one browser profile (mock API, simulated identity); results
  are not validated by a server.
- Two tabs changing the pending queue or the mock data at the very same instant can race
  (harmless for submissions, which are idempotent).
- Performance was measured on one machine only ([docs/perf/README.md](docs/perf/README.md)).
