import { DnaHashB64 } from '@holochain/client';
import { GroupClient } from '@theweave/group-client';
import { appIdFromAppletHash } from '@theweave/utils';
import {
  getAdminWsAndAppPort,
  getAppWs,
  getGroupAppInfo,
  getPassword,
  getWeRustHandler,
} from '../../helpers/helpers.js';
import { WDockerFilesystem } from '../../filesystem.js';

export async function disableGroup(
  conductorId: string,
  groupDnaHashB64: DnaHashB64,
): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(conductorId)) {
    console.log(`A conductor with name '${conductorId}' does not exist.`);
    return Promise.resolve();
  }
  wDockerFs.setConductorId(conductorId);
  const password = await getPassword();

  const { adminWs, appPort } = await getAdminWsAndAppPort(conductorId, password);

  const groupAppInfo = await getGroupAppInfo(adminWs, groupDnaHashB64);
  if (!groupAppInfo) {
    console.log(`No installed group found with dna hash '${groupDnaHashB64}'.`);
    return Promise.resolve();
  }

  // Get the group client
  const weRustHandler = await getWeRustHandler(wDockerFs, password);
  const groupAppWs = await getAppWs(adminWs, appPort, groupAppInfo.installed_app_id, weRustHandler);
  const groupClient = new GroupClient(groupAppWs, [], 'group');

  // Get all joined applets and disable them
  const joinedAppletHashes = await groupClient.getMyJoinedAppletsHashes();
  const appIdsOfJoinedApplets = joinedAppletHashes.map((appletHash) =>
    appIdFromAppletHash(appletHash),
  );
  const installedApps = await adminWs.listApps({});
  const appsToDisable = installedApps.filter((appInfo) =>
    appIdsOfJoinedApplets.includes(appInfo.installed_app_id),
  );
  for (const appInfo of appsToDisable) {
    await adminWs.disableApp({ installed_app_id: appInfo.installed_app_id });
  }

  // Disable group app as well
  await adminWs.disableApp({ installed_app_id: groupAppInfo.installed_app_id });
}
