import { AdminWebsocket } from '@holochain/client';
import { TOOLS_LIBRARY_APP_ID } from '@theweave/moss-types';
import { downloadToolLibraryHappIfNecessary } from '../helpers/helpers.js';
import { WDockerFilesystem } from '../filesystem.js';

export async function installDefaultAppsIfNecessary(adminWs: AdminWebsocket): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  const allApps = await adminWs.listApps({});
  const allInstalledAppIds = allApps.map((appInfo) => appInfo.installed_app_id);

  // Install tool library
  if (!allInstalledAppIds.includes(TOOLS_LIBRARY_APP_ID)) {
    console.log('Installing tool library happ.');
    await downloadToolLibraryHappIfNecessary();

    const toolLibraryNetworkSeed = 'dummy-seed';

    const pubkey = await adminWs.generateAgentPubKey();

    await adminWs.installApp({
      path: wDockerFs.toolsLibraryHappPath,
      installed_app_id: TOOLS_LIBRARY_APP_ID,
      agent_key: pubkey,
      network_seed: toolLibraryNetworkSeed,
      membrane_proofs: {},
    });

    await adminWs.enableApp({ installed_app_id: TOOLS_LIBRARY_APP_ID });

    console.log('Tool library happ installed.');
  }
}
