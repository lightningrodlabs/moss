import { DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import {
  getAdminWsAndAppPort,
  getAppWs,
  getPassword,
  getWeRustHandler,
} from '../../helpers/helpers.js';
import { WDockerFilesystem } from '../../filesystem.js';
import { GroupClient } from '@theweave/group-client';
import { getCellId } from '@theweave/utils';

export async function groupInfo(
  conductorId: string,
  dnaHash: DnaHashB64,
  verbose = false,
): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(conductorId)) {
    console.log(`A conductor with name '${conductorId}' does not exist.`);
    return;
  }
  wDockerFs.setConductorId(conductorId);
  const password = await getPassword();
  const { adminWs, appPort } = await getAdminWsAndAppPort(conductorId, password);
  const weRustHandler = await getWeRustHandler(wDockerFs, password);

  const allApps = await adminWs.listApps({});
  const groupAppInfo = allApps.find((appInfo) => {
    if ('group' in appInfo.cell_info && appInfo.installed_app_id.startsWith('group#')) {
      const groupCellInfo = appInfo.cell_info['group'][0];
      const cellId = getCellId(groupCellInfo);
      return encodeHashToBase64(cellId![0]) === dnaHash;
    }
    return false;
  });
  if (!groupAppInfo) {
    console.log('No group found with this dna hash.');
    /*await*/ adminWs.client.close();
    return;
  }

  const groupAppWs = await getAppWs(adminWs, appPort, groupAppInfo.installed_app_id, weRustHandler);
  const groupClient = new GroupClient(groupAppWs, [], 'group');

  const myJoinedApplets = await groupClient.getMyJoinedApplets();
  console.log('Joined Tools:');
  myJoinedApplets.forEach((applet) => {
    if (verbose) {
      console.log(applet.applet);
    } else {
      console.log('- ', applet.applet.custom_name);
    }
  });
  const unjoinedTools = await groupClient.getUnjoinedApplets();
  console.log(`\n${unjoinedTools.length} Unactivated Tools.`);
  /*await*/ adminWs.client.close();
  /*await*/ groupAppWs.client.close();
}
