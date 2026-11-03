import { assert, expect, test } from 'vitest';

import { dhtSync, PlayerApp, Scenario, runScenario } from '@holochain-open-dev/tryorama';
import {
  ActionHash,
  AgentPubKey,
  AppBundleSource,
  DnaHash,
  encodeHashToBase64,
  fakeDnaHash,
  hashFrom32AndType,
  HoloHashType,
  Record as HolochainRecord,
} from '@holochain/client';
import {
  GroupDnaProperties,
  GroupMembraneProof,
  InviteDelegation,
  JoinGate,
  JoinSignature,
  StewardCredential,
  StewardPermission,
} from '@theweave/group-client';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';
import {
  delegationPayloadBytes,
  installGroup,
  joinPayloadBytes,
  localJoinSignature,
  localKeypair,
  LocalKeypair,
  prospectiveMember,
  redeemInvite,
} from './common.js';

const appBundleSource: AppBundleSource = { type: 'path', value: GROUP_HAPP_PATH };

type JoinStatus = 'Valid' | 'Invalid' | 'Pending';

type Group = {
  alice: PlayerApp;
  aliceKey: AgentPubKey;
  properties: GroupDnaProperties;
  dnaHash: DnaHash;
};

/** Alice creates a group with `join_policy` and becomes its progenitor. */
async function groupWithPolicy(
  scenario: Scenario,
  joinPolicy: JoinGate | undefined,
  allowDelegatedInvites = false,
): Promise<Group> {
  const [conductor, aliceKey] = await prospectiveMember(scenario);
  const properties: GroupDnaProperties = { progenitor: encodeHashToBase64(aliceKey) };
  if (joinPolicy) properties.join_policy = joinPolicy;
  if (allowDelegatedInvites) properties.allow_delegated_invites = true;
  const [alice] = await installGroup(scenario, appBundleSource, properties, {
    conductor,
    agentPubKey: aliceKey,
  });
  return { alice, aliceKey, properties, dnaHash: groupCell(alice).cell_id[0] };
}

function groupCell(player: PlayerApp) {
  return getCellByRoleName(player, 'group');
}

async function signJoin(signer: PlayerApp, joiningAgent: AgentPubKey): Promise<JoinSignature> {
  return groupCell(signer).callZome({
    zome_name: 'group',
    fn_name: 'sign_join_invitation',
    payload: joiningAgent,
  });
}

async function delegateInvite(signer: PlayerApp, inviteKey: AgentPubKey): Promise<InviteDelegation> {
  return groupCell(signer).callZome({
    zome_name: 'group',
    fn_name: 'sign_invite_delegation',
    payload: inviteKey,
  });
}

async function joinStatus(viewer: PlayerApp, agent: AgentPubKey): Promise<JoinStatus> {
  return groupCell(viewer).callZome({
    zome_name: 'group',
    fn_name: 'get_agent_join_status',
    payload: agent,
  });
}

/** Polls until `viewer` sees a settled join status for `agent`. */
async function settledJoinStatus(viewer: PlayerApp, agent: AgentPubKey): Promise<JoinStatus> {
  for (let i = 0; i < 60; i++) {
    const status = await joinStatus(viewer, agent);
    if (status !== 'Pending') return status;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 'Pending';
}

/** Generates a joiner key, lets `sign` build the proof for it, and installs. */
async function joinWith(
  scenario: Scenario,
  group: Group,
  sign: (joiningAgent: AgentPubKey) => Promise<JoinSignature[]>,
): Promise<[PlayerApp, AgentPubKey]> {
  const [conductor, key] = await prospectiveMember(scenario);
  const proof: GroupMembraneProof = { signatures: await sign(key) };
  return installGroup(scenario, appBundleSource, group.properties, {
    conductor,
    agentPubKey: key,
    membraneProof: proof,
  });
}

async function joinWithoutProof(scenario: Scenario, group: Group) {
  const [conductor, key] = await prospectiveMember(scenario);
  return installGroup(scenario, appBundleSource, group.properties, {
    conductor,
    agentPubKey: key,
  });
}

/** The ActionHash of a credential's action, as Holochain computes it. */
async function stewardCredential(viewer: PlayerApp, permissionHash: ActionHash): Promise<StewardCredential[]> {
  return groupCell(viewer).callZome({
    zome_name: 'group',
    fn_name: 'get_steward_credential',
    payload: permissionHash,
  });
}

/** Alice issues a steward permission for `forAgent` and returns its credential and hash. */
async function issueStewardPermission(
  group: Group,
  forAgent: AgentPubKey,
  expiry?: number,
): Promise<[StewardCredential[], ActionHash]> {
  const permission: StewardPermission = { for_agent: forAgent, expiry };
  const record: HolochainRecord = await groupCell(group.alice).callZome({
    zome_name: 'group',
    fn_name: 'create_steward_permission',
    payload: permission,
  });
  const hash = record.signed_action.hashed.hash;
  return [await stewardCredential(group.alice, hash), hash];
}

/**
 * Alice issues a steward permission for a fresh key, then that agent joins
 * citing its own credential (plus Alice's signature when the policy needs it).
 */
async function addSteward(
  scenario: Scenario,
  group: Group,
  opts: { expiry?: number; withProgenitorSignature?: boolean } = {},
): Promise<[PlayerApp, AgentPubKey, StewardCredential[], ActionHash]> {
  const [conductor, bobKey] = await prospectiveMember(scenario);
  const [credential, permissionHash] = await issueStewardPermission(group, bobKey, opts.expiry);
  const proof: GroupMembraneProof = {
    signatures: opts.withProgenitorSignature ? [await signJoin(group.alice, bobKey)] : [],
    own_steward_credential: credential,
  };
  const [bob] = await installGroup(scenario, appBundleSource, group.properties, {
    conductor,
    agentPubKey: bobKey,
    membraneProof: proof,
  });
  await scenario.shareAllAgents();
  return [bob, bobKey, credential, permissionHash];
}

test('joinPayloadBytes and delegationPayloadBytes match the Rust test vectors', () => {
  const dna = hashFrom32AndType(new Uint8Array(32).fill(1), HoloHashType.Dna);
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  expect(hex(joinPayloadBytes(dna, hashFrom32AndType(new Uint8Array(32).fill(2), HoloHashType.Agent)))).toBe(
    '6d6f73732d67726f75702d6a6f696e2d7631842d2401010101010101010101010101010101010101010101010101010101010101017ecfcebe842024020202020202020202020202020202020202020202020202020202020202020220493dfd',
  );
  expect(
    hex(delegationPayloadBytes(dna, hashFrom32AndType(new Uint8Array(32).fill(3), HoloHashType.Agent))),
  ).toBe(
    '6d6f73732d67726f75702d696e766974652d7631842d2401010101010101010101010101010101010101010101010101010101010101017ecfcebe84202403030303030303030303030303030303030303030303030303030303030303033f5da112',
  );
});

test('no join_policy: joins without proof', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, undefined);
    await joinWithoutProof(scenario, group);
  });
});

test('Progenitor policy: progenitor installs without proof', async () => {
  await runScenario(async (scenario) => {
    await groupWithPolicy(scenario, { type: 'Progenitor' });
  });
});

test('Progenitor policy: joiner with progenitor signature installs and is valid to the progenitor', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' });
    const [bob, bobKey] = await joinWith(scenario, group, async (k) => [await signJoin(group.alice, k)]);
    await scenario.shareAllAgents();
    await dhtSync([group.alice, bob], group.dnaHash);
    expect(await settledJoinStatus(group.alice, bobKey)).toBe('Valid');
  });
});

test('Progenitor policy: joiner without proof fails to install', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' });
    await expect(joinWithoutProof(scenario, group)).rejects.toThrow();
  });
});

test('Progenitor policy: proof signed for another agent fails', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' });
    const other = await localKeypair();
    await expect(
      joinWith(scenario, group, async () => [await signJoin(group.alice, other.pubKey)]),
    ).rejects.toThrow();
  });
});

test('Progenitor policy: proof signed over another DNA hash fails', async () => {
  await runScenario(async (scenario) => {
    // The progenitor key is held locally so the test can sign arbitrary bytes with it.
    const progenitorKeys = await localKeypair();
    const properties: GroupDnaProperties = {
      progenitor: encodeHashToBase64(progenitorKeys.pubKey),
      join_policy: { type: 'Progenitor' },
    };
    const wrongDna = await fakeDnaHash();
    const [joinerConductor, joinerKey] = await prospectiveMember(scenario);
    const proof: GroupMembraneProof = {
      signatures: [await localJoinSignature(progenitorKeys, wrongDna, joinerKey)],
    };
    await expect(
      installGroup(scenario, appBundleSource, properties, {
        conductor: joinerConductor,
        agentPubKey: joinerKey,
        membraneProof: proof,
      }),
    ).rejects.toThrow();
  });
});

test('Progenitor policy: valid proof plus one junk signature fails', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' });
    const junk = await localKeypair();
    await expect(
      joinWith(scenario, group, async (k) => {
        const real = await signJoin(group.alice, k);
        const forged: JoinSignature = { ...(await localJoinSignature(junk, group.dnaHash, k)) };
        forged.signature = new Uint8Array(64);
        return [real, forged];
      }),
    ).rejects.toThrow();
  });
});

test('Progenitor policy: proof with 65 signatures fails', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' });
    await expect(
      joinWith(scenario, group, async (k) => {
        const real = await signJoin(group.alice, k);
        const extra: JoinSignature[] = [];
        for (let i = 0; i < 64; i++) {
          extra.push(await localJoinSignature(await localKeypair(), group.dnaHash, k));
        }
        return [real, ...extra];
      }),
    ).rejects.toThrow();
  });
});

test('Steward policy: first steward joins with its own permission, then admits others', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' });
    const [bob, bobKey] = await addSteward(scenario, group);
    expect(await settledJoinStatus(group.alice, bobKey)).toBe('Valid');
    const [, charlieKey] = await joinWith(scenario, group, async (k) => [await signJoin(bob, k)]);
    await scenario.shareAllAgents();
    expect(await settledJoinStatus(group.alice, charlieKey)).toBe('Valid');
  });
});

test('Steward policy: steward appointed by a steward joins with a two-link credential', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' });
    const [bob, , , bobPermissionHash] = await addSteward(scenario, group);
    const [conductor, daveKey] = await prospectiveMember(scenario);
    const permission: StewardPermission = {
      for_agent: daveKey,
      permission_hash: bobPermissionHash,
    };
    const record: HolochainRecord = await groupCell(bob).callZome({
      zome_name: 'group',
      fn_name: 'create_steward_permission',
      payload: permission,
    });
    const daveCredential = await stewardCredential(bob, record.signed_action.hashed.hash);
    expect(daveCredential.length).toBe(2);
    await installGroup(scenario, appBundleSource, group.properties, {
      conductor,
      agentPubKey: daveKey,
      membraneProof: { signatures: [], own_steward_credential: daveCredential },
    });
  });
});

test('Steward policy: progenitor signature alone fails', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' });
    await expect(
      joinWith(scenario, group, async (k) => [await signJoin(group.alice, k)]),
    ).rejects.toThrow();
  });
});

test('Steward policy: expiring steward permission fails to install', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' });
    const farFuture = (Date.now() + 1000 * 60 * 60 * 24 * 365) * 1000;
    const [conductor, bobKey] = await prospectiveMember(scenario);
    const [credential] = await issueStewardPermission(group, bobKey, farFuture);
    await expect(
      installGroup(scenario, appBundleSource, group.properties, {
        conductor,
        agentPubKey: bobKey,
        membraneProof: { signatures: [], own_steward_credential: credential },
      }),
    ).rejects.toThrow();
  });
});

test('Steward policy: member citing another steward\'s credential fails to install', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' });
    const [bob, , bobCredential] = await addSteward(scenario, group);
    const [carol] = await joinWith(scenario, group, async (k) => [await signJoin(bob, k)]);
    await scenario.shareAllAgents();
    await expect(
      joinWith(scenario, group, async (k) => [
        { ...(await signJoin(carol, k)), steward_credential: bobCredential },
      ]),
    ).rejects.toThrow();
  });
});

test('Steward policy: tampered steward credential fails to install', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' });
    const [conductor, bobKey] = await prospectiveMember(scenario);
    const [credential] = await issueStewardPermission(group, bobKey);
    const tampered = credential.map((c) => ({ ...c, signature: new Uint8Array(64) }));
    await expect(
      installGroup(scenario, appBundleSource, group.properties, {
        conductor,
        agentPubKey: bobKey,
        membraneProof: { signatures: [], own_steward_credential: tampered },
      }),
    ).rejects.toThrow();
  });
});

test('Both policy: progenitor alone fails, progenitor + steward succeeds', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, {
      type: 'AllOf',
      content: [{ type: 'Progenitor' }, { type: 'Steward' }],
    });
    const [bob, bobKey] = await addSteward(scenario, group, { withProgenitorSignature: true });
    expect(await settledJoinStatus(group.alice, bobKey)).toBe('Valid');
    const [, charlieKey] = await joinWith(scenario, group, async (k) => [
      await signJoin(group.alice, k),
      await signJoin(bob, k),
    ]);
    await scenario.shareAllAgents();
    expect(await settledJoinStatus(group.alice, charlieKey)).toBe('Valid');
    // Last, because a failed install leaves a conductor that shareAllAgents cannot query.
    await expect(
      joinWith(scenario, group, async (k) => [await signJoin(group.alice, k)]),
    ).rejects.toThrow();
  });
});

test('External 2-of-3: one signature fails, two distinct succeed', async () => {
  await runScenario(async (scenario) => {
    const keys: LocalKeypair[] = [await localKeypair(), await localKeypair(), await localKeypair()];
    const group = await groupWithPolicy(scenario, {
      type: 'External',
      content: { keys: keys.map((k) => encodeHashToBase64(k.pubKey)), threshold: 2 },
    });
    await expect(
      joinWith(scenario, group, async (k) => [await localJoinSignature(keys[0], group.dnaHash, k)]),
    ).rejects.toThrow();
    await joinWith(scenario, group, async (k) => [
      await localJoinSignature(keys[0], group.dnaHash, k),
      await localJoinSignature(keys[2], group.dnaHash, k),
    ]);
  });
});

test('AllowList: listed agent joins without proof, unlisted fails', async () => {
  await runScenario(async (scenario) => {
    const [listedConductor, listedKey] = await prospectiveMember(scenario);
    const group = await groupWithPolicy(scenario, {
      type: 'AllowList',
      content: { agents: [encodeHashToBase64(listedKey)] },
    });
    await installGroup(scenario, appBundleSource, group.properties, {
      conductor: listedConductor,
      agentPubKey: listedKey,
    });
    await expect(joinWithoutProof(scenario, group)).rejects.toThrow();
  });
});

test('malformed policy (threshold 0) fails genesis', async () => {
  await runScenario(async (scenario) => {
    const key = await localKeypair();
    await expect(
      groupWithPolicy(scenario, {
        type: 'External',
        content: { keys: [encodeHashToBase64(key.pubKey)], threshold: 0 },
      }),
    ).rejects.toThrow();
  });
});

test('Delegated: invite signed by progenitor, joiner signs with invite key, join succeeds', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' }, true);
    const inviteKey = await localKeypair();
    const invite = await delegateInvite(group.alice, inviteKey.pubKey);
    const [bob, bobKey] = await joinWith(scenario, group, async (k) => [
      await redeemInvite(invite, inviteKey, group.dnaHash, k),
    ]);
    await scenario.shareAllAgents();
    await dhtSync([group.alice, bob], group.dnaHash);
    expect(await settledJoinStatus(group.alice, bobKey)).toBe('Valid');
  });
});

test('Delegated: same invite used by two different agents, both succeed', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' }, true);
    const inviteKey = await localKeypair();
    const invite = await delegateInvite(group.alice, inviteKey.pubKey);
    const redeem = async (k: AgentPubKey) => [await redeemInvite(invite, inviteKey, group.dnaHash, k)];
    const [, bobKey] = await joinWith(scenario, group, redeem);
    const [, carolKey] = await joinWith(scenario, group, redeem);
    assert(encodeHashToBase64(bobKey) !== encodeHashToBase64(carolKey));
  });
});

test('Delegated: rejected when allow_delegated_invites is false', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' }, false);
    const inviteKey = await localKeypair();
    const invite = await delegateInvite(group.alice, inviteKey.pubKey);
    await expect(
      joinWith(scenario, group, async (k) => [await redeemInvite(invite, inviteKey, group.dnaHash, k)]),
    ).rejects.toThrow();
  });
});

test('Delegated: invite key signature over a different agent fails', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Progenitor' }, true);
    const inviteKey = await localKeypair();
    const invite = await delegateInvite(group.alice, inviteKey.pubKey);
    const someoneElse = await localKeypair();
    await expect(
      joinWith(scenario, group, async () => [
        await redeemInvite(invite, inviteKey, group.dnaHash, someoneElse.pubKey),
      ]),
    ).rejects.toThrow();
  });
});

test('Delegated: delegation from a member citing another steward\'s credential fails to install', async () => {
  await runScenario(async (scenario) => {
    const group = await groupWithPolicy(scenario, { type: 'Steward' }, true);
    const [bob, , bobCredential] = await addSteward(scenario, group);
    const [carol] = await joinWith(scenario, group, async (k) => [await signJoin(bob, k)]);
    await scenario.shareAllAgents();
    const inviteKey = await localKeypair();
    const invite = await delegateInvite(carol, inviteKey.pubKey);
    await expect(
      joinWith(scenario, group, async (k) => [
        {
          ...(await redeemInvite(invite, inviteKey, group.dnaHash, k)),
          steward_credential: bobCredential,
        },
      ]),
    ).rejects.toThrow();
  });
});
