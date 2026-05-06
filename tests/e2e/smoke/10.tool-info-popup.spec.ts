import { test, expect } from '../fixtures/moss';
import { waitForBoot } from '../helpers/bootToReady';
import { createGroupFromInitialSetup } from '../helpers/groups';
import { installToolFromLibrary } from '../helpers/tools';

/**
 * Smoke #10 — Right-click an installed tool in the group sidebar opens the
 * informational tool-info dialog (no install button, no navigation).
 *
 * why: validates the seam between the contextmenu in group-applets-row,
 * the bubbling `open-tool-info` event, the tool-info-dialog host mounted on
 * main-dashboard, and library-tool-details rendered in `readonly` mode.
 *
 * Skipped until smoke #4 (install-applet-from-library) is enabled — without
 * a real installed applet there is nothing to right-click. Same gating as #4.
 */
test.skip('right-click on group sidebar tool opens info dialog without install controls', async ({
  moss,
}) => {
  await waitForBoot(moss.mainWindow);
  await createGroupFromInitialSetup(moss.mainWindow, { name: 'Tool Info Group' });
  await installToolFromLibrary(moss.mainWindow, { toolName: 'Example' });

  const urlBefore = moss.mainWindow.url();

  // The new-design group sidebar (group-area-sidebar) renders each tool as
  // <applet-sidebar-button>. The @contextmenu handler is on that element.
  await moss.mainWindow
    .locator('group-area-sidebar applet-sidebar-button')
    .first()
    .click({ button: 'right' });

  // Dialog mounted at app root via main-dashboard.
  const dialog = moss.mainWindow.locator('tool-info-dialog moss-dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Install controls must be absent in readonly mode.
  await expect(dialog.locator('select-group')).toHaveCount(0);

  // No navigation occurred.
  expect(moss.mainWindow.url()).toBe(urlBefore);

  // Close via ESC.
  await moss.mainWindow.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});
