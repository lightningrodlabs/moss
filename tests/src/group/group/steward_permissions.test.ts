import { assert, test } from 'vitest';

import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import {
  AppBundleSource,
  encodeHashToBase64,
  fakeAgentPubKey,
  Record as HolochainRecord,
} from '@holochain/client';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';
import {
  threeAgentsOneProgenitorOneStewardOneMember,
  twoAgentsOneProgenitorAndOneSteward,
} from './common.js';
import { Accountability, StewardPermission } from '@theweave/group-client';
import { fail } from 'assert';

// Helper: pull the Steward variant out of a `Vec<Accountability>` response and
// fail loudly if there isn't exactly one.
function expectStewardAccountability(accs: Accountability[]): Extract<
  Accountability,
  { type: 'Steward' }
> {
  const steward = accs.find((a): a is Extract<Accountability, { type: 'Steward' }> => a.type === 'Steward');
  if (!steward) {
    fail(`Expected a Steward accountability, got: ${JSON.stringify(accs)}`);
  }
  return steward;
}

test('Create unlimited steward permission and retrieve it in different ways', async () => {
  await runScenario(async (scenario) => {
    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: GROUP_HAPP_PATH,
    };

    const [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(scenario, appBundleSource, ['group']);

    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellAlice = getCellByRoleName(alice, 'group');

    // Alice (progenitor): get_my_accountabilities should include Progenitor.
    const aliceMyAccs: Accountability[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: Date.now() * 1000, local: true },
    });
    assert(aliceMyAccs.some((a) => a.type === 'Progenitor'));

    // Alice queries her own pubkey: same.
    const aliceAgentAccs: Accountability[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [alicePubKey, Date.now() * 1000], local: true },
    });
    assert(aliceAgentAccs.some((a) => a.type === 'Progenitor'));

    // Alice asks about Bob → Bob should be a Steward with the expected claim shape.
    const bobAccsViaAlice: Accountability[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [bobPubKey, Date.now() * 1000], local: true },
    });
    const bobStewardViaAlice = expectStewardAccountability(bobAccsViaAlice);
    assert(
      encodeHashToBase64(bobStewardViaAlice.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert(!bobStewardViaAlice.content.permission.expiry);
    // permission_hash on the inner StewardPermission is null for permissions issued by
    // the progenitor (they aren't derived from a parent permission).
    assert(!bobStewardViaAlice.content.permission.permission_hash);
    assert(
      encodeHashToBase64(bobStewardViaAlice.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Bob asks about himself → same Steward claim.
    const bobMyAccs: Accountability[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: Date.now() * 1000, local: false },
    });
    const bobMySteward = expectStewardAccountability(bobMyAccs);
    assert(
      encodeHashToBase64(bobMySteward.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert(!bobMySteward.content.permission.expiry);
    assert(!bobMySteward.content.permission.permission_hash);
    assert(
      encodeHashToBase64(bobMySteward.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Alice queries Bob a second time (now that Bob's claim has been seen at least once on
    // the network) — should still report Steward.
    const bobAccsViaAliceAgain: Accountability[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [bobPubKey, Date.now() * 1000], local: true },
    });
    const bobStewardViaAliceAgain = expectStewardAccountability(bobAccsViaAliceAgain);
    assert(
      encodeHashToBase64(bobStewardViaAliceAgain.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );
  });
});


test('Create expiring steward permission and retrieve it in different ways', async () => {
  await runScenario(async (scenario) => {
    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: GROUP_HAPP_PATH,
    };

    const now = Date.now() * 1_000;
    const now_1 = now + 1_000 * 1_000;
    const now_100 = now + 100_000 * 1_000;
    const now_101 = now + 101_000 * 1_000;
    const expiry = now_100;

    const [[alice, _alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(scenario, appBundleSource, ['group'], expiry);

    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellAlice = getCellByRoleName(alice, 'group');

    // Alice queries Bob: Steward with the expected expiry.
    const bobAccsBefore: Accountability[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [bobPubKey, now_1], local: true },
    });
    const bobStewardBefore = expectStewardAccountability(bobAccsBefore);
    assert(
      encodeHashToBase64(bobStewardBefore.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert.equal(bobStewardBefore.content.permission.expiry, expiry);
    assert(!bobStewardBefore.content.permission.permission_hash);
    assert(
      encodeHashToBase64(bobStewardBefore.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Bob queries himself: same Steward claim.
    const bobMyAccsBefore: Accountability[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: now, local: false },
    });
    const bobMyStewardBefore = expectStewardAccountability(bobMyAccsBefore);
    assert.equal(bobMyStewardBefore.content.permission.expiry, expiry);
    assert(
      encodeHashToBase64(bobMyStewardBefore.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // At expiry: Bob should still be Steward
    let bobAccsAfter: Accountability[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [bobPubKey, expiry], local: true },
    });
    assert(bobAccsAfter.some((a) => a.type === 'Steward'));
    assert(!bobAccsAfter.some((a) => a.type === 'Progenitor'));

    // At expiry + 1: Bob should no longer be Steward (empty array since Member is implicit).
    bobAccsAfter = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [bobPubKey, now_101], local: true },
    });
    assert(bobAccsAfter.length == 0);
    assert.equal(
      bobAccsAfter.length,
      0,
      `Bob should have no accountabilities, got: ${JSON.stringify(bobAccsAfter)}`,
    );

    // Bob's query of himself: also no longer Steward.
    const bobMyAccsAfter: Accountability[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: now_101, local: false },
    });
    assert.equal(
      bobMyAccsAfter.length,
      0,
      `Bob should have no accountabilities, got: ${JSON.stringify(bobMyAccsAfter)}`,
    );
  });
});


test("get_my_accountabilities returns the correct result after querying another agent's accountabilities", async () => {
  // Regression test for the privilege-escalation bug fixed in commit 48211967.
  //
  // Pre-fix, when a non-privileged agent (Charlie) called `is_agent_a_steward`
  // for some other agent (Bob), the zome would unconditionally write a private
  // `StewardPermissionClaim` entry to Charlie's source chain — even though that
  // claim was for Bob, not Charlie. Then `get_my_permission_type` would query
  // local source-chain claims without filtering by `for_agent == my_pub_key` and
  // wrongly answer "Steward" for Charlie.
  //
  // Both paths now have filters: `is_agent_a_steward` only writes the claim if
  // the queried agent is the caller, and `get_my_accountabilities` filters
  // claims by `for_agent`. This test verifies the user-visible invariant that a
  // cross-agent query does not pollute the caller's own accountabilities.
  await runScenario(async (scenario) => {
    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: GROUP_HAPP_PATH,
    };

    const [
      [_alice, _alicePubKey],
      [_bob, bobPubKey, _bobPermissionHash],
      [charlie, _charliePubKey],
    ] = await threeAgentsOneProgenitorOneStewardOneMember(scenario, appBundleSource, ['group']);

    const groupCellCharlie = getCellByRoleName(charlie, 'group');

    // Sanity: Charlie has no accountabilities to start with (not progenitor, not steward).
    const charlieAccsBefore: Accountability[] = await groupCellCharlie.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: Date.now() * 1000, local: false },
    });
    assert.equal(
      charlieAccsBefore.length,
      0,
      `Charlie should have no accountabilities before any cross-agent query, got: ${JSON.stringify(charlieAccsBefore)}`,
    );

    // Charlie asks about Bob (a real steward). This is the path that pre-fix would
    // have polluted Charlie's source chain.
    const bobAccsViaCharlie: Accountability[] = await groupCellCharlie.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_accountabilities',
      payload: { input: [bobPubKey, Date.now() * 1000], local: false },
    });
    assert(
      bobAccsViaCharlie.some((a) => a.type === 'Steward'),
      `Bob should still be reported as a Steward when queried by Charlie. Got: ${JSON.stringify(bobAccsViaCharlie)}`,
    );

    // Critical: after that cross-agent query, Charlie still has no accountabilities of
    // his own. If either filter regresses (write filter in is_agent_a_steward, or read
    // filter in get_my_accountabilities), Charlie's source chain ends up with Bob's
    // claim AND that claim leaks back as Charlie's accountability — both filters need
    // to be in place to prevent the false-positive.
    const charlieAccsAfter: Accountability[] = await groupCellCharlie.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: Date.now() * 1000, local: false },
    });
    assert.equal(
      charlieAccsAfter.length,
      0,
      `Charlie's accountabilities should remain empty after querying Bob's. Got: ${JSON.stringify(charlieAccsAfter)}`,
    );
  });
});

test('Steward can nominate additional stewards if their steward permission is not expiring', async () => {
  await runScenario(async (scenario) => {
    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: GROUP_HAPP_PATH,
    };

    const [[alice, _alicePubKey], [bob, _bobPubKey, bobPermissionHash], [charlie, charliePubKey]] =
      await threeAgentsOneProgenitorOneStewardOneMember(scenario, appBundleSource, ['group']);

    const groupCellAlice = getCellByRoleName(alice, 'group');
    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellCharlie = getCellByRoleName(charlie, 'group');

    // Bob (steward, unlimited permission) issues Charlie a steward permission.
    const input: StewardPermission = {
      for_agent: charliePubKey,
      permission_hash: bobPermissionHash,
    };

    const permissionRecord: HolochainRecord = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'create_steward_permission',
      payload: input,
    });

    await dhtSync([alice, bob, charlie], groupCellAlice.cell_id[0]);

    // Charlie queries his own accountabilities → should now include Steward.
    const charlieAccs: Accountability[] = await groupCellCharlie.callZome({
      zome_name: 'group',
      fn_name: 'get_my_accountabilities',
      payload: { input: Date.now() * 1000, local: false },
    });
    const charlieSteward = expectStewardAccountability(charlieAccs);

    assert(
      encodeHashToBase64(charlieSteward.content.permission.for_agent) ===
        encodeHashToBase64(charliePubKey),
    );
    assert(!charlieSteward.content.permission.expiry);
    // Charlie's permission was created by Bob, so its inner permission_hash points at
    // Bob's permission (i.e. derivation chain is recorded).
    assert(!!charlieSteward.content.permission.permission_hash);
    assert(
      encodeHashToBase64(charlieSteward.content.permission.permission_hash!) ===
        encodeHashToBase64(bobPermissionHash),
    );
    assert(
      encodeHashToBase64(permissionRecord.signed_action.hashed.hash) ===
        encodeHashToBase64(charlieSteward.content.permission_hash),
    );
  });
});

test('Steward can NOT nominate additional stewards if their steward permission is expiring', async () => {
  await runScenario(async (scenario) => {
    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: GROUP_HAPP_PATH,
    };

    // Expiry is far in the future, but it's still expiring.
    const expiry = (Date.now() + 600_000) * 1_000;

    const [[_alice, _alicePubKey], [bob, _bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(scenario, appBundleSource, ['group'], expiry);

    const groupCellBob = getCellByRoleName(bob, 'group');

    const input: StewardPermission = {
      for_agent: await fakeAgentPubKey(),
      permission_hash: bobPermissionHash,
    };

    try {
      await groupCellBob.callZome({
        zome_name: 'group',
        fn_name: 'create_steward_permission',
        payload: input,
      });
      fail(
        'Bob should not be able to create a steward permission while only holding an expiring one himself',
      );
    } catch (e) {
      if (
        !e
          .toString()
          .includes('Only non-expiring StewardPermissions are allowed to take this action')
      ) {
        fail(
          `Expected validation rejection about expiring StewardPermissions, got: ${e}`,
        );
      }
    }
  });
});

test('Steward can NOT nominate additional stewards without providing a valid permission hash', async () => {
  await runScenario(async (scenario) => {
    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: GROUP_HAPP_PATH,
    };

    // Expiry is far in the future.
    const expiry = (Date.now() + 600_000) * 1_000;

    const [[_alice, _alicePubKey], [bob, _bobPubKey, _bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(scenario, appBundleSource, ['group'], expiry);

    const groupCellBob = getCellByRoleName(bob, 'group');

    const input: StewardPermission = {
      for_agent: await fakeAgentPubKey(),
      permission_hash: null,
    };

    try {
      await groupCellBob.callZome({
        zome_name: 'group',
        fn_name: 'create_steward_permission',
        payload: input,
      });
      fail(
        'Bob should not be able to create a steward permission without providing a valid permission hash',
      );
    } catch (e) {
      if (
        !e.toString().includes('No valid permission hash provided and agent is not the progenitor')
      ) {
        fail(
          `Expected validation rejection about missing permission hash, got: ${e}`,
        );
      }
    }
  });
});

// TODO
// - test that no steward permission returns an empty Accountability list
// - test that StewardPermission entries cannot be created for oneself
// - test retrieval of all agents' accountabilities (get_all_agents_accountabilities)
