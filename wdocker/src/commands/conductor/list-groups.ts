import { cleanTable, getAdminWs, getCellId, getPassword } from '../../helpers/helpers.js';
import { WDockerFilesystem } from '../../filesystem.js';
import { encodeHashToBase64 } from '@holochain/client';

export async function listGroups(conductorId: string): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(conductorId)) {
    console.log(`A conductor with name '${conductorId}' does not exist.`);
    return;
  }
  wDockerFs.setConductorId(conductorId);
  const password = await getPassword();
  const adminWs = await getAdminWs(conductorId, password);
  const response = await adminWs.listApps({});
  const groups = response.filter((appInfo) => appInfo.installed_app_id.startsWith('group#'));
  const table = cleanTable();
  table.push(['GROUP DNA HASH']);
  groups.forEach((appInfo) => {
    const groupCellInfo = appInfo.cell_info['group'][0];
    const cellId = getCellId(groupCellInfo);
    table.push([encodeHashToBase64(cellId![0])]);
  });
  console.log(table.toString());
  adminWs.client.close();
}
