# Pirate Battle

Top-down naval shooter built with React, TypeScript, PixiJS, TanStack Query, Axios, MSW and Playwright.

> Work in progress. Full setup, controls, configuration and network-scenario docs will be added here.
> The original challenge specification lives in [docs/CHALLENGE.md](docs/CHALLENGE.md).

## Requirements

- Node.js >= 22.12 (developed on 24.x), npm
- For end-to-end tests: a Chromium-based browser (see [End-to-end tests](#end-to-end-tests))

## Commands

| Command                   | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `npm install`             | Install dependencies                                                   |
| `npm run dev`             | Start the dev server (http://localhost:5173)                           |
| `npm run build`           | Type-check and build for production (`dist/`)                          |
| `npm run preview`         | Serve the production build (http://localhost:4173)                     |
| `npm run typecheck`       | Run the TypeScript compiler without emitting                           |
| `npm run lint`            | Run ESLint                                                             |
| `npm run format`          | Format with Prettier                                                   |
| `npm run assets`          | Rebuild runtime assets in `public/game/` (runs before dev/build)       |
| `npm run test:e2e`        | Build, serve and run the Playwright suite against the production build |
| `npm run test:e2e:report` | Open the last Playwright HTML report                                   |

## Assets

The original challenge assets in `assets/` are never modified. `scripts/prepare-assets.ts` generates
the runtime files in `public/game/` (git-ignored): it converts the Starling XML ship atlas to a
PixiJS spritesheet, defines named regions of the tile sheet and copies the UI atlas.

## Mock API

Ranking and match history are served by [MSW](https://mswjs.io/) in every build, including
production. The service worker (`public/mockServiceWorker.js`) is started before the app renders.

## End-to-end tests

Tests run against the production build (`vite build` + `vite preview`) with the real MSW worker.

- **Windows:** Playwright's bundled Chromium is unsigned and can be blocked by Smart App Control,
  so on Windows the tests use the installed Microsoft Edge (same Chromium engine) by default.
- **Other platforms / CI:** the bundled Chromium is used (`npx playwright install chromium`).
- Override with `PW_CHANNEL`: `chromium` (bundled), `chrome` or `msedge`.

## Deployment (Vercel)

`vercel.json` configures the build (`npm ci`, `npm run build`, output `dist/`), an SPA rewrite and
cache headers. The rewrite deliberately excludes `/api/*` (so requests never receive `index.html`
when the mock worker is not active), `/game/*`, `/assets/*` and `mockServiceWorker.js`.

1. Import the GitHub repository in Vercel (framework preset: Vite, no environment variables needed).
2. Every push to the production branch triggers a deploy.
3. After deploying, open the URL, reload it, and check that the mock API responds (ranking/history load).
