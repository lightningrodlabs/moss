import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import {
  createGroupFromMainDashboard,
  enterSpaceIfPrompted,
  getCurrentGroupInviteLink,
  joinGroupByInviteLink,
} from '../helpers/groups';
import { expectPeerCount } from '../helpers/tools';

/**
 * Smoke #9 — Multi-agent peer discovery via local bootstrap.
 *
 * why: this is the load-bearing peer-to-peer baseline. Without it the smoke
 * suite proves only that a single-agent Moss boots; it doesn't prove that two
 * Moss instances actually talk to each other over gossip / Iroh. A regression
 * that breaks invite-link round-tripping, signaling, or peer discovery would
 * slip through every other test in the suite.
 *
 * Both agents share a single locally-spawned kitsune2-bootstrap-srv (the
 * `bootstrapSrv` fixture). This brings cross-agent peer discovery down from
 * "minutes against bootstrap.moss.social, often flaky" to "seconds, deterministic,
 * offline-capable" — see fixtures/bootstrap.ts.
 *
 * Verified end-to-end:
 *   - Agent 1 creates a group and emits a real invite link.
 *   - Agent 2 launches with its own profile + dir against the same bootstrap,
 *     parses the invite link, joins the group.
 *   - Each agent sees the other in its group peer-list — proves gossip /
 *     bootstrap / signaling / relay all completed end-to-end.
 *
 * Tool sharing (the original (a)+(b) parts of the plan) is still deferred to
 * the in-library install test (#4) once a local toolCurations fixture lands.
 */
test('two agents on a local bootstrap discover each other in the same group', async ({
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);

  // why: launch directly (rather than using the standard `moss` / `secondAgent`
  // fixtures) so we can pass `bootstrap:` to BOTH agents — the fixture's
  // `moss` field doesn't accept opts.
  const agent1 = await launchMoss({
    profileName: `pw-multi-1-${Date.now()}`,
    bootstrap: bootstrapSrv,
  });

  try {
    // ---- Agent 1: create group, set per-group profile, copy invite link ----
    await waitForBoot(agent1.mainWindow, 90_000);
    await startFreshIfLegacyImport(agent1.mainWindow);
    await createGroupFromMainDashboard(agent1.mainWindow, { name: 'Multiagent Smoke' });
    await enterSpaceIfPrompted(agent1.mainWindow, 'agent-one');

    const inviteLink = await getCurrentGroupInviteLink(agent1.mainWindow);
    expect(inviteLink).toMatch(/invite/i);

    // Sanity: agent 1's local peer list shows just self.
    await expectPeerCount(agent1.mainWindow, 1, 60_000);

    // why: dev mode (yarn applet-dev-example) sleeps 10s between launching
    // agents 1 and 2. Without this, agent 2 starts joining before agent 1's
    // group cell has registered with the bootstrap, and the gossip rendezvous
    // never converges. Mirror the dev-mode pattern.
    await new Promise((r) => setTimeout(r, 10_000));

    // ---- Agent 2: launch separate instance against the same bootstrap ----
    const agent2 = await launchMoss({
      profileName: `pw-multi-2-${Date.now()}`,
      bootstrap: bootstrapSrv,
    });

    try {
      await waitForBoot(agent2.mainWindow, 120_000);
      await startFreshIfLegacyImport(agent2.mainWindow);
      await joinGroupByInviteLink(agent2.mainWindow, inviteLink);
      await enterSpaceIfPrompted(agent2.mainWindow, 'agent-two');

      // Agent 2 has the group in their sidebar.
      await expect(agent2.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(
        1,
        { timeout: 30_000 },
      );

      // ---- The actual peer-discovery assertion ----
      // why: the gossip-path proof. With a local bootstrap the round trip
      // should be on the order of seconds; allow up to 120s to absorb
      // first-time conductor warm-up and the initial gossip exchange.
      await expectPeerCount(agent1.mainWindow, 2, 120_000);
      await expectPeerCount(agent2.mainWindow, 2, 120_000);
    } finally {
      await closeMoss(agent2);
    }
  } finally {
    await closeMoss(agent1);
  }
});
