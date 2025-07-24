import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    threads: false,
    testTimeout: 60 * 1_000 * 3, // 3  mins
  },
});
