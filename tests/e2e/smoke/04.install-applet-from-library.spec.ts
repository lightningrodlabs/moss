import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';
import { installToolFromLibrary } from '../helpers/tools';
import { FIXTURE_TOOL_TITLE } from '../fixtures/toolCuration';

/**
 * Smoke #4 — Install the example applet from the in-app tool library.
 *
 * why: this is the load-bearing assertion the cleanup of pre-`_new_design`
 * "tools across the top of the main page" components depends on. We need to
 * lock in that installing a tool surfaces it inside the group pane (new
 * design) — so a future PR that accidentally re-introduces the old top-bar
 * surface, or breaks the new one, fails here.
 *
 * The test points Moss at a locally-served curation fixture (see
 * fixtures/toolCuration.ts) that publishes the repo's own
 * example-applet.webhapp. Zero internet dependency; deterministic hashes;
 * the install flow exercises the same renderer code path users hit in
 * production.
 */
const GROUP_NAME = 'Library Smoke';

test('install example applet from the in-app tool library', async ({
  toolCurationServer,
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);

  // why: launch directly so we can pass --tool-curation-url. The standard
  // `moss` fixture doesn't take launch options.
  // why bootstrap: pointing at the production bootstrap (bootstrap.moss.social)
  // can stall conductor startup by minutes when the host is slow or the public
  // server is congested. A local bootstrap brings boot-to-Running back to ~10s.
  const moss = await launchMoss({
    profileName: `pw-install-${Date.now()}`,
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

    // why: after install the user remains in the tool library view; navigate
    // back to the group to verify the new tool appears in the group pane.
    await moss.mainWindow.locator('groups-sidebar group-sidebar-button').first().click();

    // The installed tool must appear inside the group pane (new design).
    // group-area-sidebar renders <applet-sidebar-button> per installed applet.
    await expect(moss.mainWindow.locator('group-area-sidebar applet-sidebar-button')).toHaveCount(
      1,
      { timeout: 60_000 },
    );

    // why: negative assertion — old top-bar surface for tools must not be
    // present. After the Phase-3 cleanup deletes those components this is
    // automatic, but until then it ensures cleanup PRs that *also* hide the
    // old surface still pass without regressing the new one.
    await expect(moss.mainWindow.locator('topbar-button-old, sidebar-button-old')).toHaveCount(0);
  } finally {
    await closeMoss(moss);
  }
});
