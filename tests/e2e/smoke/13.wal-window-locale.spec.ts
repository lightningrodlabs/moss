import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';
import { openLanguageTab, openSettings, selectLocale } from '../helpers/settings';
import {
  createExamplePost,
  installToolFromLibrary,
  openFirstPostInWalWindow,
  openToolInGroup,
  waitForAppletHandshake,
} from '../helpers/tools';
import { FIXTURE_TOOL_TITLE } from '../fixtures/toolCuration';

/**
 * Smoke #13 — A language change reaches applet views in WAL windows.
 *
 * why: Moss sends a locale change to the applet frames of the main window
 * directly and to WAL windows over IPC, naming the applets whose frames should
 * receive it. The WAL-window leg once named no applets, so frames in WAL
 * windows kept the old locale. The example applet shows the locale a view
 * holds on its host element (data-weave-locale).
 */
const GROUP_NAME = 'WAL Locale';

test('a language change reaches the applet view in a WAL window', async ({
  toolCurationServer,
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);
  const moss = await launchMoss({
    profileName: `pw-wal-locale-${Date.now()}`,
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
    await createExamplePost(frame, `pw-wal-locale-${Date.now()}`);

    const { walFrame } = await openFirstPostInWalWindow(moss.app, frame);
    await expect(walFrame.locator('[data-weave-locale="en"]')).toBeAttached();

    await moss.mainWindow.bringToFront();
    await openSettings(moss.mainWindow);
    await openLanguageTab(moss.mainWindow);
    await selectLocale(moss.mainWindow, 'de');

    // The main-window view is the control: it has always received the change.
    await expect(frame.locator('[data-weave-locale="de"]')).toBeAttached({ timeout: 15_000 });
    await expect(walFrame.locator('[data-weave-locale="de"]')).toBeAttached({ timeout: 15_000 });
  } finally {
    await closeMoss(moss);
  }
});
