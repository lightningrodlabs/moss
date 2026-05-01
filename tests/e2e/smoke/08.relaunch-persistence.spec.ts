import { test, expect, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard } from '../helpers/groups';

/**
 * Smoke #8 — Quit and relaunch with the same profile dir retains the group.
 *
 * why: catches regressions in conductor DB persistence, lair keystore reuse,
 * and Moss's startup path that re-attaches to existing app interfaces. Without
 * this, a refactor that accidentally re-initializes lair on every launch would
 * silently look fine in the create-group smoke (#2) but break for users.
 *
 * Approach: run the standard `moss` fixture to create a group; capture its
 * userDataDir; quit; launch a second time against the same userDataDir; verify
 * the group is still there. The `secondAgent` fixture is the cleanest way to
 * track the relaunch for teardown.
 */
test('relaunch against same userDataDir retains the previously-created group', async ({
  moss,
  secondAgent,
}) => {
  // First launch: create a group.
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);
  await createGroupFromMainDashboard(moss.mainWindow, { name: 'Persisted Group' });
  await expect(moss.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(1);

  const dirToReuse = moss.userDataDir;

  // Quit cleanly and wait for lair/holochain children to actually exit.
  // why: the relaunch needs the conductor DB and lair socket free; bare
  // app.close() returns before reparented children release their locks.
  // closeMoss captures the descendant pid set BEFORE close and waits for
  // them all to leave /proc — see fixtures/moss.ts.
  await closeMoss(moss);

  // Relaunch against the same userDataDir. The fixture's secondAgent() is the
  // public path to another Moss instance; it tracks the new app for teardown.
  const relaunched = await secondAgent({
    profileName: 'relaunch',
    userDataDir: dirToReuse,
  });

  // The same group must reappear. Note: on relaunch we may briefly see
  // LegacyKeystoreImport again because findLegacyProfiles() rescans disk —
  // startFreshIfLegacyImport handles that idempotently.
  await waitForBoot(relaunched.mainWindow, 120_000);
  await startFreshIfLegacyImport(relaunched.mainWindow);
  await expect(
    relaunched.mainWindow.locator('groups-sidebar group-sidebar-button'),
  ).toHaveCount(1, { timeout: 60_000 });

  // Sentinel: a brand-new launch with a different userDataDir should NOT have
  // the group. Skipping that here — it would just duplicate smoke #1's signal.
  // The relaunched.app is closed/cleaned by the secondAgent fixture teardown.
});
