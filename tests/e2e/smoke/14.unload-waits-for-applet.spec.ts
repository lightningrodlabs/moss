import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';
import {
  createExamplePost,
  installToolFromLibrary,
  openFirstPostInWalWindow,
  openToolInGroup,
  waitForAppletHandshake,
} from '../helpers/tools';
import { FIXTURE_TOOL_TITLE } from '../fixtures/toolCuration';

/**
 * Smoke #14 — What happens to an applet's unload callback when the main
 * window reloads.
 *
 * why: a Tool registers onBeforeUnload callbacks to save state, and Moss asks
 * the applet frames to run them when a window unloads. The example applet's
 * callback waits SLOW_UNLOAD_MS when asked to, then records when it finished
 * in the applet's local storage. A WAL window showing the same applet stays
 * open across the main window's reload, so the spec reads the record from
 * there.
 *
 * Moss does not hold the reload for the callbacks, so the reload cuts a slow
 * callback off. The spec pins that outcome.
 */
const GROUP_NAME = 'Unload Wait';
const SLOW_UNLOAD_MS = 2000;

test('reloading the main window does not yet wait for the applet unload callback', async ({
  toolCurationServer,
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);
  const moss = await launchMoss({
    profileName: `pw-unload-${Date.now()}`,
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
    await createExamplePost(frame, `pw-unload-${Date.now()}`);
    const { walFrame } = await openFirstPostInWalWindow(moss.app, frame);

    await frame.locator('[data-weave-ready]').evaluate((_el, delayMs) => {
      window.localStorage.removeItem('weave-e2e-unload-done');
      window.localStorage.setItem('weave-e2e-slow-unload', String(delayMs));
    }, SLOW_UNLOAD_MS);
    const readFromWal = (key: string) =>
      walFrame
        .locator('[data-weave-ready]')
        .evaluate((_el, k) => window.localStorage.getItem(k), key);
    expect(
      await readFromWal('weave-e2e-slow-unload'),
      'the main-window and WAL-window frames of one applet must share its local storage',
    ).toBe(String(SLOW_UNLOAD_MS));

    const reloadStartedAt = Date.now();
    const reloaded = moss.mainWindow.waitForEvent('load', { timeout: 30_000 });
    // why: the menu reload and window close start in the browser process, the
    // path on which each applet frame also unregisters from its own
    // beforeunload; the request must reach the frames before that.
    await moss.app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/index.html'),
      );
      main?.webContents.reload();
    });
    await reloaded;
    await waitForBoot(moss.mainWindow, 90_000);
    const reloadMs = Date.now() - reloadStartedAt;
    test.info().annotations.push({ type: 'reload-ms', description: String(reloadMs) });

    // Only the main window reloaded, so the WAL frame can report whether the
    // callback in the main-window frame ran to the end.
    const done = await readFromWal('weave-e2e-unload-done');
    test.info().annotations.push({ type: 'unload-done', description: String(done) });
    expect(done, 'the reload cuts the unload callback off').toBeNull();
  } finally {
    await closeMoss(moss);
  }
});
