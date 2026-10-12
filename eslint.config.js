import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'public', 'playwright-report', 'test-results', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The simulation is pure game logic: no rendering, UI, DOM input or asset loading.
    files: ['src/game/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['pixi.js', 'react', 'react-dom'],
          patterns: ['**/GameRuntime*', '**/assets*', '**/input*', '**/app/**'],
        },
      ],
    },
  },
);
