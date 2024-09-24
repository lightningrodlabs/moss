import { getAdminWs, getPassword } from '../../helpers/helpers.js';
import { WDockerFilesystem } from '../../filesystem.js';
import { ListAppsResponse } from '@holochain/client';

export async function listApps(conductorId: string): Promise<ListAppsResponse | undefined> {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(conductorId)) {
    console.log(`A conductor with name '${conductorId}' does not exist.`);
    return;
  }
  wDockerFs.setConductorId(conductorId);
  const password = await getPassword();
  const adminWs = await getAdminWs(conductorId, password);
  const response = await adminWs.listApps({});
  adminWs.client.close();
  return response;
}
