import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    threads: false,
    testTimeout: 60 * 1_000 * 3, // 3  mins
    // why: the Playwright e2e specs under e2e/ are *.spec.ts and would be
    // collected by Vitest's default glob, but they use Playwright's test()
    // runner, not Vitest's. Exclude them so `yarn test` (tryorama) ignores
    // them — they run separately via `yarn test:e2e` / `test:e2e:slow`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
