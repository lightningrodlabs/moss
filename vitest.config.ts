import { defineConfig } from 'vitest/config';

// Top-level vitest config for Node-side unit tests of `src/main/**`.
// The `tests/` workspace already runs Holochain tryorama tests; this is
// the place for non-tryorama, non-Electron unit tests of main-process
// modules (ASR broker, etc.).
export default defineConfig({
  test: {
    threads: false,
    include: ['src/main/**/*.test.ts', 'libs/api/**/*.test.ts'],
    testTimeout: 60 * 1_000,
  },
});
