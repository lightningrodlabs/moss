import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';
import { installToolFromLibrary } from '../helpers/tools';
import { FIXTURE_TOOL_TITLE } from '../fixtures/toolCuration';

/**
 * Smoke #10 — Right-click an installed tool in the group sidebar opens the
 * informational tool-info dialog (no install controls, no navigation).
 *
 * why: validates the seam between the @contextmenu handler in
 * group-area-sidebar, the bubbling `open-tool-info` event, the
 * tool-info-dialog host mounted on main-dashboard, and library-tool-details
 * rendered in `informational` mode.
 */
const GROUP_NAME = 'Tool Info Group';

test('right-click on group sidebar tool opens info dialog without install controls', async ({
  toolCurationServer,
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);

  const moss = await launchMoss({
    profileName: `pw-tool-info-${Date.now()}`,
    toolCurationUrl: toolCurationServer.curationUrl,
    bootstrap: bootstrapSrv,
  });

  try {
    await waitForBoot(moss.mainWindow, 90_000);
    await startFreshIfLegacyImport(moss.mainWindow);
    await createGroupFromMainDashboard(moss.mainWindow, { name: GROUP_NAME });
    await enterSpaceIfPrompted(moss.mainWindow, 'agent-one');

    await installToolFromLibrary(moss.mainWindow, {
      toolName: FIXTURE_TOOL_TITLE,
      groupName: GROUP_NAME,
    });

    // why: post-install the user is left on the tool-library page. Navigate
    // back into the group so the group-area-sidebar (with the contextmenu
    // handler) is rendered before we right-click.
    await moss.mainWindow.locator('groups-sidebar group-sidebar-button').first().click();

    const sidebarButton = moss.mainWindow
      .locator('group-area-sidebar applet-sidebar-button')
      .first();
    await expect(sidebarButton).toBeVisible({ timeout: 60_000 });

    const urlBefore = moss.mainWindow.url();

    await sidebarButton.click({ button: 'right' });

    // The dialog body renders <library-tool-details> with `informational=true`
    // once the unified tool is resolved (or a fallback panel if not). The
    // tool-info-dialog host is always mounted on main-dashboard, so observe
    // visibility on the inner sl-dialog (which toggles on open/close).
    const dialog = moss.mainWindow.locator('tool-info-dialog');
    await expect(dialog.locator('sl-dialog')).toBeVisible({ timeout: 30_000 });

    // why: install controls live inside <select-group> in library-tool-details.
    // In informational mode, none of them render. Assert absence under the
    // dialog scope so the (unrelated) tool-library page's select-group cannot
    // produce a false negative.
    await expect(dialog.locator('select-group')).toHaveCount(0);

    // No navigation occurred.
    expect(moss.mainWindow.url()).toBe(urlBefore);

    // Close via ESC and assert the dialog goes away. sl-dialog stays mounted
    // when hidden, so check the inner sl-dialog visibility, not just presence.
    await moss.mainWindow.keyboard.press('Escape');
    await expect(dialog.locator('sl-dialog')).toBeHidden({ timeout: 10_000 });
  } finally {
    await closeMoss(moss);
  }
});
