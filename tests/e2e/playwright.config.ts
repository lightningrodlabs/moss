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
  timeout: 90_000,
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
