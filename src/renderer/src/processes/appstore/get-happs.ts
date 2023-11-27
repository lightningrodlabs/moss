import { AppAgentClient } from '@holochain/client';
import { AppEntry, DevHubResponse, Entity } from './types.js';

export async function getAllApps(appstoreClient: AppAgentClient): Promise<Array<Entity<AppEntry>>> {
  const allApps: DevHubResponse<Array<Entity<AppEntry>>> = await appstoreClient.callZome({
    fn_name: 'get_all_apps',
    zome_name: 'appstore_api',
    role_name: 'appstore',
    payload: null,
  });

  console.log('Asked appstore for all apps: ', allApps.payload);

  return allApps.payload;
}
