import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard } from '../helpers/groups';

/**
 * Smoke #2 — Create a group from the running main dashboard.
 *
 * why: the foundational flow that #4-#9 depend on. Locks down the
 * groups-sidebar "+" → add-group-dialog → create-group-dialog path that
 * replaced the old top-of-page tools listing.
 */
test('creates a group via the groups-sidebar add button', async ({ moss }) => {
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);

  await createGroupFromMainDashboard(moss.mainWindow, { name: 'Smoke Group' });

  // Success signal: the new group appears as a button in the groups sidebar.
  // group-sidebar-button renders the group name as its accessible label (or
  // tooltip + icon). We verify presence by checking the groups-sidebar contains
  // *some* group-sidebar-button element after creation.
  await expect(moss.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(1, {
    timeout: 30_000,
  });
});
