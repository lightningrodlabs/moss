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
//import { Accountability, StewardPermission } from '@theweave/group-client';
//import { getCellByRoleName } from '../../shared';
//
// export async function threeAgentsOneProgenitorOneStewardOneMember(
//   scenario: Scenario,
//   appBundleSource: AppBundleSource,
//   roleNames: RoleName[],
//   expiry?: number,
// ): Promise<
//   [[PlayerApp, AgentPubKey], [PlayerApp, AgentPubKey, ActionHash], [PlayerApp, AgentPubKey]]
// > {
//   console.log('@threeAgentsOneProgenitorOneStewardOneMember: calling nAgentsOneProgenitor...');
//
//   const [[alice, alicePubKey], [bob, bobPubKey], [neitherBobNorAlice, neitherBobNorAlicePubKey]] =
//     await nAgentsOneProgenitor(scenario, appBundleSource, roleNames, 3);
//
//   const groupCellAlice = getCellByRoleName(alice, 'group');
//
//   const input: StewardPermission = {
//     for_agent: bobPubKey,
//     expiry,
//   };
//   await groupCellAlice.callZome({
//     zome_name: 'group',
//     fn_name: 'create_steward_permission',
//     payload: input,
//   });
//
//   const permissionType: Accountability = await groupCellAlice.callZome({
//     zome_name: 'group',
//     fn_name: 'get_agent_permission_type',
//     payload: { input: bobPubKey },
//   });
//
//   if (permissionType.type !== 'Steward') {
//     const now = Date.now() * 1000;
//     throw new Error(
//       `Bob should have steward permission at this point but got permission: ${JSON.stringify(permissionType)}.\nExpiry (us): ${expiry}\nTime now (us): ${now}\nTime left until expiry: ${expiry - now}`,
//     );
//   }
//
//   console.log('@threeAgentsOneProgenitorOneStewardOneMember: awaiting dht sync...');
//
//   // Wait for dht sync to make sure that Bob has access to his permission
//   await dhtSync([alice, bob, neitherBobNorAlice], groupCellAlice.cell_id[0], undefined, 10_000);
//
//   return [
//     [alice, alicePubKey],
//     [bob, bobPubKey, permissionType.content.permission_hash],
//     [neitherBobNorAlice, neitherBobNorAlicePubKey],
//   ];
// }
//
// export async function twoAgentsOneProgenitorAndOneSteward(
//   scenario: Scenario,
//   appBundleSource: AppBundleSource,
//   roleNames: RoleName[],
//   expiry?: number,
// ): Promise<[[PlayerApp, AgentPubKey], [PlayerApp, AgentPubKey, ActionHash]]> {
//   const [[alice, alicePubKey], [bob, bobPubKey]] = await nAgentsOneProgenitor(
//     scenario,
//     appBundleSource,
//     roleNames,
//     2,
//   );
//   const groupCellAlice = getCellByRoleName(alice, 'group');
//
//   const input: StewardPermission = {
//     for_agent: bobPubKey,
//     expiry,
//   };
//   await groupCellAlice.callZome({
//     zome_name: 'group',
//     fn_name: 'create_steward_permission',
//     payload: input,
//   });
//
//   const permissionType: PermissionType = await groupCellAlice.callZome({
//     zome_name: 'group',
//     fn_name: 'get_agent_permission_type',
//     payload: { input: bobPubKey },
//   });
//
//   if (permissionType.type !== 'Steward') {
//     const now = Date.now() * 1000;
//     throw new Error(
//       `Bob should have steward permission at this point but got permission: ${JSON.stringify(permissionType)}.\nExpiry (us): ${expiry}\nTime now (us): ${now}\nTime left until expiry: ${expiry - now}`,
//     );
//   }
//
//   // Wait for dht sync to make sure that Bob has access to his permission
//   await dhtSync([alice, bob], groupCellAlice.cell_id[0]);
//
//   return [
//     [alice, alicePubKey],
//     [bob, bobPubKey, permissionType.content.permission_hash],
//   ];
// }
//
// export async function nAgentsOneProgenitor(
//   scenario: Scenario,
//   appBundleSource: AppBundleSource,
//   roleNames: RoleName[],
//   nAgents: number,
// ): Promise<[PlayerApp, AgentPubKey][]> {
//   const [alice, alicePubKey] = await installAppWithProgenitor(
//     scenario,
//     appBundleSource,
//     roleNames,
//     true,
//   );
//
//   const allAgents: [PlayerApp, AgentPubKey][] = [[alice, alicePubKey]];
//
//   for (let i = 0; i < nAgents; i++) {
//     const [player, playerPubKey] = await installAppWithProgenitor(
//       scenario,
//       appBundleSource,
//       roleNames,
//       true,
//       alicePubKey,
//     );
//     allAgents.push([player, playerPubKey]);
//   }
//
//   return allAgents;
// }

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
