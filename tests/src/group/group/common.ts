import {
  ActionHash,
  AgentPubKey,
  AppBundleSource,
  DnaHash,
  encodeHashToBase64,
  hashFrom32AndType,
  HoloHashType,
  RoleName,
  RoleSettingsMap,
} from '@holochain/client';
import {
  AgentApp,
  Conductor,
  dhtSync,
  enableAndGetAgentApp,
  PlayerApp,
  Scenario,
} from '@holochain-open-dev/tryorama';
import { encode } from '@msgpack/msgpack';
import sodium from 'libsodium-wrappers';
import {
  Accountability,
  GroupDnaProperties,
  GroupMembraneProof,
  InviteDelegation,
  JoinSignature,
  StewardPermission,
} from '@theweave/group-client';
import { getCellByRoleName } from '../../shared.js';

/**
 * Spin up `nAgents` players sharing a single group, with the first agent as the
 * progenitor. The progenitor's pubkey is used as the `progenitor` DNA property
 * for everyone, so all agents land in the same group.
 */
export async function nAgentsOneProgenitor(
  scenario: Scenario,
  appBundleSource: AppBundleSource,
  roleNames: RoleName[],
  nAgents: number,
): Promise<[PlayerApp, AgentPubKey][]> {
  const [alice, alicePubKey] = await installAppWithProgenitor(
    scenario,
    appBundleSource,
    roleNames,
    true,
  );

  const allAgents: [PlayerApp, AgentPubKey][] = [[alice, alicePubKey]];

  for (let i = 0; i < nAgents - 1; i++) {
    const [player, playerPubKey] = await installAppWithProgenitor(
      scenario,
      appBundleSource,
      roleNames,
      true,
      alicePubKey,
    );
    allAgents.push([player, playerPubKey]);
  }

  return allAgents;
}

/**
 * Set up a group with Alice as progenitor and Bob as steward. Alice issues Bob a
 * `StewardPermission` (optionally expiring at `expiry`, microseconds since epoch),
 * then waits for DHT sync so Bob can see his permission.
 *
 * Returns [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]].
 */
export async function twoAgentsOneProgenitorAndOneSteward(
  scenario: Scenario,
  appBundleSource: AppBundleSource,
  roleNames: RoleName[],
  expiry?: number,
): Promise<[[PlayerApp, AgentPubKey], [PlayerApp, AgentPubKey, ActionHash]]> {
  const [[alice, alicePubKey], [bob, bobPubKey]] = await nAgentsOneProgenitor(
    scenario,
    appBundleSource,
    roleNames,
    2,
  );
  const groupCellAlice = getCellByRoleName(alice, 'group');

  const input: StewardPermission = {
    for_agent: bobPubKey,
    expiry,
  };
  await groupCellAlice.callZome({
    zome_name: 'group',
    fn_name: 'create_steward_permission',
    payload: input,
  });

  const accs: Accountability[] = await groupCellAlice.callZome({
    zome_name: 'group',
    fn_name: 'get_agent_accountabilities',
    payload: { input: [bobPubKey, Date.now() * 1000], local: true },
  });

  const stewardAcc = accs.find((a) => a.type === 'Steward');
  if (!stewardAcc || stewardAcc.type !== 'Steward') {
    const now = Date.now() * 1000;
    throw new Error(
      `Bob should have a Steward accountability immediately after issuance. Got: ${JSON.stringify(accs)}.\nExpiry (us): ${expiry}\nTime now (us): ${now}\nTime left until expiry: ${expiry === undefined ? 'never' : expiry - now}`,
    );
  }

  // Wait for dht sync so Bob can see his own permission via the DHT.
  await dhtSync([alice, bob], groupCellAlice.cell_id[0]);

  return [
    [alice, alicePubKey],
    [bob, bobPubKey, stewardAcc.content.permission_hash],
  ];
}

/**
 * Set up a group with Alice as progenitor, Bob as steward, and Charlie as a plain
 * member. Same flow as `twoAgentsOneProgenitorAndOneSteward` but with a third
 * non-privileged agent in the same group, useful for testing how queries by a
 * non-privileged agent affect that agent's own accountabilities.
 */
export async function threeAgentsOneProgenitorOneStewardOneMember(
  scenario: Scenario,
  appBundleSource: AppBundleSource,
  roleNames: RoleName[],
  expiry?: number,
): Promise<
  [[PlayerApp, AgentPubKey], [PlayerApp, AgentPubKey, ActionHash], [PlayerApp, AgentPubKey]]
> {
  const [[alice, alicePubKey], [bob, bobPubKey], [charlie, charliePubKey]] =
    await nAgentsOneProgenitor(scenario, appBundleSource, roleNames, 3);

  const groupCellAlice = getCellByRoleName(alice, 'group');

  const input: StewardPermission = {
    for_agent: bobPubKey,
    expiry,
  };
  await groupCellAlice.callZome({
    zome_name: 'group',
    fn_name: 'create_steward_permission',
    payload: input,
  });

  const accs: Accountability[] = await groupCellAlice.callZome({
    zome_name: 'group',
    fn_name: 'get_agent_accountabilities',
    payload: { input: [bobPubKey, Date.now() * 1000], local: true },
  });
  const stewardAcc = accs.find((a) => a.type === 'Steward');
  if (!stewardAcc || stewardAcc.type !== 'Steward') {
    const now = Date.now() * 1000;
    throw new Error(
      `Bob should have a Steward accountability immediately after issuance. Got: ${JSON.stringify(accs)}.\nExpiry (us): ${expiry}\nTime now (us): ${now}\nTime left until expiry: ${expiry === undefined ? 'never' : expiry - now}`,
    );
  }

  // Generous timeout: three-way DHT sync over a tryorama localnet is occasionally slow.
  await dhtSync([alice, bob, charlie], groupCellAlice.cell_id[0], undefined, 30_000);

  return [
    [alice, alicePubKey],
    [bob, bobPubKey, stewardAcc.content.permission_hash],
    [charlie, charliePubKey],
  ];
}

/**
 *
 * @param scenario
 * @param appBundleSource
 * @param roleNames Rolenames to add the properties to in the dna properties
 * @param progenitor If not provided it is assumed that the app is installed with a newly
 * generated agent key as the progenitor and the app is installed with this progenitor key
 */
export async function installAppWithProgenitor(
  scenario: Scenario,
  appBundleSource: AppBundleSource,
  roleNames: RoleName[],
  progenitorPattern: boolean,
  progenitor?: AgentPubKey,
): Promise<[PlayerApp, AgentPubKey]> {
  let generatedKey: AgentPubKey | undefined;
  const conductor = await scenario.addConductor();
  if (progenitorPattern && !progenitor) {
    generatedKey = await conductor.adminWs().generateAgentPubKey();
    progenitor = generatedKey;
  }

  const properties = progenitorPattern
    ? { progenitor: encodeHashToBase64(progenitor) }
    : { progenitor: null };

  const rolesSettings: RoleSettingsMap = {};
  roleNames.forEach((roleName) => {
    rolesSettings[roleName] = {
      type: 'provisioned',
      value: {
        modifiers: {
          properties,
        },
      },
    };
  });

  const appInfo = await conductor.installApp({
    appBundleSource,
    options: {
      rolesSettings,
      agentPubKey: generatedKey,
    },
  });
  const adminWs = conductor.adminWs();
  const port = await conductor.attachAppInterface();
  const issued = await adminWs.issueAppAuthenticationToken({
    installed_app_id: appInfo.installed_app_id,
  });
  const appWs = await conductor.connectAppWs(issued.token, port);
  const agentApp: AgentApp = await enableAndGetAgentApp(adminWs, appWs, appInfo);
  return [{ conductor, appWs, ...agentApp }, appInfo.agent_pub_key];
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const JOIN_DOMAIN = new TextEncoder().encode('moss-group-join-v1');
const JOIN_DELEGATE_DOMAIN = new TextEncoder().encode('moss-group-invite-v1');

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** The bytes a signer signs to admit `joiningAgent`. Mirrors `join_payload_bytes`. */
export function joinPayloadBytes(dnaHash: DnaHash, joiningAgent: AgentPubKey): Uint8Array {
  return concatBytes(JOIN_DOMAIN, dnaHash, joiningAgent);
}

/** The bytes a signer signs to approve `inviteKey`. Mirrors `delegation_payload_bytes`. */
export function delegationPayloadBytes(dnaHash: DnaHash, inviteKey: AgentPubKey): Uint8Array {
  return concatBytes(JOIN_DELEGATE_DOMAIN, dnaHash, inviteKey);
}

/** An ed25519 keypair held outside any conductor, e.g. an external signer or an invite key. */
export type LocalKeypair = { pubKey: AgentPubKey; privateKey: Uint8Array };

export async function localKeypair(): Promise<LocalKeypair> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    pubKey: hashFrom32AndType(kp.publicKey, HoloHashType.Agent),
    privateKey: kp.privateKey,
  };
}

export async function localSign(keypair: LocalKeypair, bytes: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_sign_detached(bytes, keypair.privateKey);
}

/** A direct join signature from a key held outside the conductor. */
export async function localJoinSignature(
  keypair: LocalKeypair,
  dnaHash: DnaHash,
  joiningAgent: AgentPubKey,
): Promise<JoinSignature> {
  return {
    signer: keypair.pubKey,
    steward_credential: [],
    signature: await localSign(keypair, joinPayloadBytes(dnaHash, joiningAgent)),
    delegation: null,
  };
}

/** Completes a signer's invite delegation for `joiningAgent`, as the joiner's client does. */
export async function redeemInvite(
  invite: InviteDelegation,
  inviteKey: LocalKeypair,
  dnaHash: DnaHash,
  joiningAgent: AgentPubKey,
): Promise<JoinSignature> {
  return {
    signer: invite.signer,
    steward_credential: invite.steward_credential,
    signature: await localSign(inviteKey, joinPayloadBytes(dnaHash, joiningAgent)),
    delegation: invite.delegation,
  };
}

/** A conductor with a fresh agent key, ready to request a membrane proof for that key. */
export async function prospectiveMember(scenario: Scenario): Promise<[Conductor, AgentPubKey]> {
  const conductor = await scenario.addConductor();
  const agentPubKey = await conductor.adminWs().generateAgentPubKey();
  return [conductor, agentPubKey];
}

/**
 * Install the group happ with explicit DNA properties and, optionally, a
 * membrane proof for an agent key generated beforehand.
 */
export async function installGroup(
  scenario: Scenario,
  appBundleSource: AppBundleSource,
  properties: GroupDnaProperties,
  opts: { conductor?: Conductor; agentPubKey?: AgentPubKey; membraneProof?: GroupMembraneProof } = {},
): Promise<[PlayerApp, AgentPubKey]> {
  const conductor = opts.conductor ?? (await scenario.addConductor());
  const rolesSettings: RoleSettingsMap = {
    group: {
      type: 'provisioned',
      value: {
        modifiers: { properties },
        membrane_proof: opts.membraneProof ? encode(opts.membraneProof) : undefined,
      },
    },
  };
  const appInfo = await conductor.installApp({
    appBundleSource,
    options: { rolesSettings, agentPubKey: opts.agentPubKey },
  });
  const adminWs = conductor.adminWs();
  const port = await conductor.attachAppInterface();
  const issued = await adminWs.issueAppAuthenticationToken({
    installed_app_id: appInfo.installed_app_id,
  });
  const appWs = await conductor.connectAppWs(issued.token, port);
  const agentApp: AgentApp = await enableAndGetAgentApp(adminWs, appWs, appInfo);
  return [{ conductor, appWs, ...agentApp }, appInfo.agent_pub_key];
}
