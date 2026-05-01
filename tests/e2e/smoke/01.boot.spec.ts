import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';

/**
 * Smoke #1 — Boot to Ready (Phase-0 spike).
 *
 * why: this is the load-bearing baseline. If this passes, Playwright can drive
 * Moss at all. If it fails, every other spec is moot — investigate before
 * touching downstream tests.
 *
 * A fresh profile lands on either:
 *   - InitialSetup, in packaged production builds; or
 *   - Running (with no groups), in unpackaged builds — which is what we
 *     always have under test, because !app.isPackaged makes the renderer's
 *     isDevModeEnabled() return true and skip the InitialSetup branch
 *     (see src/renderer/src/moss-app.ts:270).
 *
 * If the user's machine has legacy Moss data on disk, the LegacyKeystoreImport
 * screen appears first; we always click Start Fresh. Testing the import-from-
 * previous flow is deliberately deferred (Phase 4).
 */
test('boots and reaches a ready state with a fresh profile', async ({ moss }) => {
  await waitForBoot(moss.mainWindow, 90_000);
  const state = await startFreshIfLegacyImport(moss.mainWindow);
  expect(['InitialSetup', 'Running']).toContain(state);
  await expect(moss.mainWindow.locator('moss-app')).toBeVisible();
});
