import { test } from '../fixtures/moss';
import { waitForBoot } from '../helpers/bootToReady';
import { createGroupFromInitialSetup } from '../helpers/groups';

test.skip('create group from initial setup transitions to Running', async ({ moss }) => {
  // why: skipped until helper locators are tightened against a real build (Phase-2 work).
  // Drives: InitialSetup → CreateGroupStep1 → CreateGroupStep2 → CreatingGroup → Running.
  await waitForBoot(moss.mainWindow);
  await createGroupFromInitialSetup(moss.mainWindow, { name: 'Test Group' });
});
