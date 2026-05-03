import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import {
  createGroupFromMainDashboard,
  enterSpaceIfPrompted,
  getCurrentGroupInviteLink,
  joinGroupByInviteLink,
} from '../helpers/groups';
import { expectPeerCount } from '../helpers/tools';

/**
 * Smoke #9 (reduced) — Multi-agent group join via invite link.
 *
 * why: this is the load-bearing multi-agent baseline. Without it the smoke
 * suite proves only that a single-agent Moss boots; it doesn't prove that the
 * invite-link round-trip works or that two Moss instances run independently
 * with their own conductor + lair against the same network.
 *
 * Verified here:
 *   - Agent 1 creates a group and emits a real invite link.
 *   - Agent 2 launches with its own profile + userDataDir, parses the invite
 *     link, joins the group, ends up with that group in its sidebar.
 *   - Each agent sees themselves in their own group peer-list (proves both
 *     agents successfully published their per-group profile to their group cell).
 *
 * NOT verified here (deferred to Phase 4):
 *   - Cross-agent gossip discovery — i.e., agent 1 sees agent 2 in the peer
 *     list and vice versa. That depends on the bootstrap / signaling / relay
 *     path completing, which is too slow and too flaky against the public
 *     server (bootstrap.moss.social) to be a reliable smoke signal — empirically
 *     does not converge within 4+ minutes on a typical dev box. Lock that down
 *     once the harness can spin up a local kitsune2-bootstrap-srv as a test
 *     fixture and pass --bootstrap-url to both agents.
 */
test('second agent joins same group as agent 1 via an invite link', async ({
  moss,
  secondAgent,
}) => {
  test.setTimeout(360_000);

  // ---- Agent 1: create group, set per-group profile, copy invite link ----
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);
  await createGroupFromMainDashboard(moss.mainWindow, { name: 'Multiagent Smoke' });

  // why: getCurrentGroupInviteLink and the peer-list both live inside the group
  // pane (group-area-sidebar). That pane only finishes mounting after the
  // moss-create-profile screen is dismissed.
  await enterSpaceIfPrompted(moss.mainWindow, 'agent-one');

  const inviteLink = await getCurrentGroupInviteLink(moss.mainWindow);
  expect(inviteLink).toMatch(/invite/i);

  // Agent 1's local peer list should show just self (1).
  await expectPeerCount(moss.mainWindow, 1, 60_000);

  // ---- Agent 2: launch separate instance, join via link ----
  const agent2 = await secondAgent();
  await waitForBoot(agent2.mainWindow, 120_000);
  await startFreshIfLegacyImport(agent2.mainWindow);
  await joinGroupByInviteLink(agent2.mainWindow, inviteLink);
  await enterSpaceIfPrompted(agent2.mainWindow, 'agent-two');

  // Agent 2 has the group in their sidebar (invite-link parse + join succeeded).
  await expect(agent2.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(
    1,
    { timeout: 30_000 },
  );

  // Agent 2's local peer list shows self (proves agent 2's profile zome call
  // landed in agent 2's own conductor).
  await expectPeerCount(agent2.mainWindow, 1, 60_000);

  // Agent 1's view should still have its group, unchanged by agent 2's actions.
  await expect(moss.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(1);
});
