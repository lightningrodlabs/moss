import { defineConfig } from 'vitest/config';

// Fast, dependency-free unit tests for main/renderer helper modules. The
// tryorama/Holochain integration tests live in the `tests` workspace and run
// via `yarn test`; these run via `yarn test:unit`.
export default defineConfig({
  test: {
    threads: false,
    include: ['src/**/*.test.ts', 'libs/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60 * 1_000,
  },
});
