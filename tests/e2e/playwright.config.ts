import { defineConfig } from '@playwright/test';
import path from 'node:path';

// why: Holochain conductor + lair startup is slow and shares OS resources;
// run a single worker so tests don't fight over ports / profile dirs / OS notifications.
// See plans/ui-testing-and-cruft-cleanup.md for rationale.
export default defineConfig({
  testDir: path.resolve(__dirname, 'smoke'),
  // Phase-4 regression specs live under e2e/regression — point this at multiple dirs once that exists.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // why: launches are 5-30s including conductor boot, and tests like #6 do
  // multiple group-create flows (each ~15s). On the user's machine with legacy
  // profile data, the post-StartFresh continuation can push setup near 60s.
  // 240s leaves room without masking real hangs.
  timeout: 240_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: path.resolve(__dirname, '..', '..', 'test-results-e2e'),
});
