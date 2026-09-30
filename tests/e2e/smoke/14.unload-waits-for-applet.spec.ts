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
 * Smoke #14 — Whether reloading the main window waits for an applet's unload callback.
 *
 * why: a Tool registers onBeforeUnload callbacks to save state. Moss should
 * let them finish before the page goes away. The example applet's callback
 * waits SLOW_UNLOAD_MS when asked to, then records when it finished in the
 * applet's local storage. A WAL window showing the same applet stays open
 * across the main window's reload, so the spec reads the record from there.
 *
 * Today the applet-view listener on the applet side replies to the unload
 * request at once, before the callbacks finish, so the host stops waiting too
 * early and the callback is cut off. This spec pins that behavior. The
 * applet-side fix (applet channel PR 2) flips the final assertion to expect a
 * finished callback that took at least SLOW_UNLOAD_MS.
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
    await moss.mainWindow.evaluate(() => window.location.reload()).catch(() => undefined);
    await waitForBoot(moss.mainWindow, 90_000);
    const reloadMs = Date.now() - reloadStartedAt;
    test.info().annotations.push({ type: 'reload-ms', description: String(reloadMs) });

    // Only the main window reloaded, so the WAL frame can report whether the
    // callback in the main-window frame ran to the end.
    const done = await readFromWal('weave-e2e-unload-done');
    test.info().annotations.push({ type: 'unload-done', description: String(done) });
    // PR 2 replaces this with: expect(done).not.toBeNull() and
    // expect(Number(done) - reloadStartedAt).toBeGreaterThanOrEqual(SLOW_UNLOAD_MS).
    expect(done, 'the unload callback is cut off by the reload').toBeNull();
  } finally {
    await closeMoss(moss);
  }
});
