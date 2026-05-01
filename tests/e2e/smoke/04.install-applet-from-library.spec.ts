import { test, expect } from '../fixtures/moss';
import { waitForBoot } from '../helpers/bootToReady';
import { createGroupFromInitialSetup } from '../helpers/groups';
import { installToolFromLibrary } from '../helpers/tools';

test.skip('install example applet via the in-app tool library', async ({ moss }) => {
  // why: skipped until tool-library locators + a curated example tool are wired in.
  // Asserts the tool appears inside the group pane (new design), not across the top.
  await waitForBoot(moss.mainWindow);
  await createGroupFromInitialSetup(moss.mainWindow, { name: 'Library Test Group' });
  await installToolFromLibrary(moss.mainWindow, { toolName: 'Example' });
  // Negative assertion: the old top-of-page tool bar must not be present.
  // We expect the cleanup phase to delete topbar-button-old.ts etc. so this
  // assertion stays accurate going forward.
  await expect(moss.mainWindow.locator('topbar-button-old, sidebar-button-old')).toHaveCount(0);
});
