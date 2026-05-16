import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import {
  createGroupFromMainDashboard,
  enterSpaceIfPrompted,
  getCurrentGroupInviteLink,
  joinGroupByInviteLink,
} from '../helpers/groups';

/**
 * Smoke #3 — Join a group via an invite link.
 *
 * why: isolates the join flow from peer discovery. Joining a group installs
 * the group DNA locally with the network seed encoded in the invite link — it
 * is a conductor-local operation that does NOT require the inviting agent to
 * be online or any gossip to converge. Keeping this separate from the
 * multi-agent discovery test (#9) means a failure here points squarely at the
 * invite-link parse / join-group-dialog / group-install path, while a failure
 * only in #9 points at gossip.
 *
 * Two agents are used purely as a deterministic source of a real invite link:
 * agent 1 creates a group and emits one; agent 2 consumes it. No shared
 * network state is asserted.
 */
test('agent 2 joins a group from agent 1\'s invite link', async ({ moss, secondAgent }) => {
  // ---- Agent 1: create a group and emit an invite link ----
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);
  await createGroupFromMainDashboard(moss.mainWindow, { name: 'Joinable Group' });
  // why: getCurrentGroupInviteLink needs the "Invite People" button, which is
  // gated on the agent being a privileged steward with a set profile. Entering
  // the space sets that profile.
  await enterSpaceIfPrompted(moss.mainWindow, 'inviter');

  const inviteLink = await getCurrentGroupInviteLink(moss.mainWindow);
  expect(inviteLink).toMatch(/invite/i);

  // ---- Agent 2: launch a separate instance and join via the link ----
  const agent2 = await secondAgent({ profileName: 'joiner' });
  await waitForBoot(agent2.mainWindow, 120_000);
  await startFreshIfLegacyImport(agent2.mainWindow);
  await joinGroupByInviteLink(agent2.mainWindow, inviteLink);

  // Success signal: the joined group appears in agent 2's groups sidebar.
  // why: joinGroupByInviteLink returns when the join dialog closes, but the
  // group cell install and the groups-sidebar store update continue after
  // that. On a contended CI runner that tail can run well past 30s, so give
  // the sidebar button a generous window.
  await expect(agent2.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(1, {
    timeout: 120_000,
  });
});
