import { defineConfig } from '@playwright/test';
import path from 'node:path';

// why: Holochain conductor + lair startup is slow and shares OS resources;
// run a single worker so tests don't fight over ports / profile dirs / OS notifications.
// See plans/ui-testing-and-cruft-cleanup.md for rationale.
export default defineConfig({
  // why: two projects split the suite by cost. `smoke` is the fast suite that
  // gates every push/PR. `slow` holds multi-agent tests whose peer-discovery
  // depends on real gossip convergence — on a shared CI runner that runs
  // ~15-20x slower than a dev machine, so those tests take minutes and only
  // run occasionally (release branches / schedule / manual). Select with
  // `--project=smoke` or `--project=slow`; see tests/package.json scripts.
  projects: [
    { name: 'smoke', testDir: path.resolve(__dirname, 'smoke') },
    { name: 'slow', testDir: path.resolve(__dirname, 'slow') },
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // why: retries are off everywhere. They were originally on in CI to mask
  // first-attempt slowness, but the retry-passes-fast pattern was hiding the
  // root cause (CDP picking up the wrong window when devtools auto-opened on
  // unpackaged builds). With MOSS_DISABLE_DEVTOOLS=1 set by the fixture, the
  // first attempt should reliably succeed. If a real flake surfaces, fix the
  // root cause rather than re-enabling retries.
  retries: 0,
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
