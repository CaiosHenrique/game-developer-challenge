/**
 * Development build of the e2e app, for the `chromium-strict` Playwright project:
 * `import.meta.env.MODE` is `e2e` (test hooks), but React is its development build, where
 * <StrictMode> really mounts, unmounts and remounts every effect. Vite builds React for
 * development when NODE_ENV is `development` before it resolves its configuration; npm
 * scripts cannot set it the same way on every platform, hence this script.
 * Output: dist-e2e-dev/ (served by `vite preview --outDir dist-e2e-dev`).
 */
import { build } from 'vite';

process.env.NODE_ENV = 'development';

await build({
  mode: 'e2e',
  logLevel: 'warn',
  build: { outDir: 'dist-e2e-dev', emptyOutDir: true },
});
