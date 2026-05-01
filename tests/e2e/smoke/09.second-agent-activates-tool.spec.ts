import { test } from '../fixtures/moss';

test.skip('second agent joins same group, activates installed tool, appears in peer list', async ({
  moss: _moss,
  secondAgent: _secondAgent,
}) => {
  // why: the peer-to-peer baseline. Without this, smoke is testing a single-agent
  // app, not Moss. Three assertions:
  //   (a) tool listed in the second agent's group pane
  //   (b) applet iframe loads and WeaveClient handshake completes for agent 2
  //   (c) agent 2 appears in agent 1's group peer-list (poll — gossip is async)
  //
  // Depends on: smoke #4 (install via library), helpers/groups.getCurrentGroupInviteLink,
  // and helpers/tools.expectPeerCount being implemented.
});
