import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';
import { installToolFromLibrary, openToolInGroup, waitForAppletHandshake } from '../helpers/tools';
import { FIXTURE_TOOL_TITLE } from '../fixtures/toolCuration';

/**
 * Smoke #5 — Applet iframe loads and the WeaveClient handshake completes.
 *
 * why: the renderer ↔ applet-iframe handshake is the seam where Moss's
 * actual value lives. A regression in the postMessage protocol or in
 * applet-host iframe wiring breaks every applet without breaking any
 * existing test. This is the smallest assertion that catches it: install
 * the example applet, open it, and wait for the [data-weave-ready] marker
 * the example applet sets when renderInfo arrives.
 */
const GROUP_NAME = 'Handshake Smoke';

test('applet iframe loads and WeaveClient handshake completes', async ({
  toolCurationServer,
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);

  // why bootstrap: see smoke #4 — production bootstrap can stall conductor
  // startup; local bootstrap keeps the test deterministic.
  const moss = await launchMoss({
    profileName: `pw-handshake-${Date.now()}`,
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

    const frame = await openToolInGroup(moss.mainWindow, FIXTURE_TOOL_TITLE);
    await waitForAppletHandshake(frame, 60_000);

    // why: a second light-touch assertion. The example applet renders
    // <example-applet-main> when renderInfo.view.type === 'main' — so this
    // pins down "we got the right view branch" beyond just the host marker.
    await expect(frame.locator('example-applet-main')).toBeVisible({ timeout: 30_000 });
  } finally {
    await closeMoss(moss);
  }
});
