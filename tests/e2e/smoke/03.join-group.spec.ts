import { test } from '../fixtures/moss';
import { waitForBoot } from '../helpers/bootToReady';
import { joinGroupByInviteLink } from '../helpers/groups';

test.skip('join a group via invite link', async ({ moss }) => {
  // why: skipped until we have a deterministic source of invite links — a fixture
  // group with a known seed will need to exist before this can run. See the multi-agent
  // smoke (#9) for the realistic version where agent 1 emits the invite for agent 2.
  await waitForBoot(moss.mainWindow);
  await joinGroupByInviteLink(moss.mainWindow, 'TODO-fixture-invite-link');
});
