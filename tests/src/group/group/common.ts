import {
  ActionHash,
  AgentPubKey,
  AppBundleSource,
  encodeHashToBase64,
  RoleName,
  RoleSettingsMap,
} from '@holochain/client';
import {
  AgentApp,
  dhtSync,
  enableAndGetAgentApp,
  PlayerApp,
  Scenario,
} from '@holochain/tryorama';
import { Accountability, StewardPermission } from '@theweave/group-client';
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
