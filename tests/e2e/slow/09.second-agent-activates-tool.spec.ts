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
 * Slow #9 — Multi-agent peer discovery via local bootstrap.
 *
 * why: this is the load-bearing peer-to-peer baseline. Without it the suite
 * proves only that a single-agent Moss boots; it doesn't prove that two Moss
 * instances actually talk to each other over gossip / Iroh. A regression that
 * breaks invite-link round-tripping, signaling, or peer discovery would slip
 * through every other test in the suite.
 *
 * why this lives in `slow/` and not `smoke/`: it launches two full Electron
 * apps + two conductors + two lair keystores + the relay, all contending for a
 * shared CI runner's handful of cores. Measured on a GitHub runner, individual
 * network ops run ~15-20x slower than on a dev machine (a remote zome call that
 * is sub-second locally took 17.9s in CI logs). Peer discovery that converges
 * in seconds locally therefore needs minutes in CI. That cost is too high to
 * gate every push on — the `slow` Playwright project runs this occasionally
 * (release branches / schedule / manual dispatch); the `smoke` project gates
 * pushes. See playwright.config.ts and the e2e workflow.
 *
 * Both agents share a single locally-spawned kitsune2-bootstrap-srv (the
 * `bootstrapSrv` fixture) — see fixtures/bootstrap.ts.
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
  // why: peer discovery is the slowest thing in the suite on a contended CI
  // runner — see the file header for the ~15-20x slowdown measurement. The
  // assertions below budget up to 480s for agent 1 to see agent 2; setup adds
  // ~120s. 15 minutes overall leaves headroom so a slow-but-successful
  // convergence is never cut off. This test runs occasionally, not per-push,
  // so a long ceiling costs little.
  test.setTimeout(900_000);

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
      // why: joinGroupByInviteLink returns when the join dialog closes, but the
      // group cell install and the groups-sidebar store update continue after
      // that — on a contended CI runner that tail runs well past 30s.
      await expect(agent2.mainWindow.locator('groups-sidebar group-sidebar-button')).toHaveCount(
        1,
        { timeout: 120_000 },
      );

      // ---- The actual peer-discovery assertion ----
      // why: the gossip-path proof. Locally the round trip is seconds; on a
      // contended CI runner it stretches into minutes (see file header). 480s
      // covers the observed worst case for agent 1 to see agent 2 without
      // masking a genuine hang. Agent 2's view converges right after agent 1's
      // — the transport connection is already up by then — so its window is
      // shorter.
      await expectPeerCount(agent1.mainWindow, 2, 480_000);
      await expectPeerCount(agent2.mainWindow, 2, 240_000);
    } finally {
      await closeMoss(agent2);
    }
  } finally {
    await closeMoss(agent1);
  }
});
