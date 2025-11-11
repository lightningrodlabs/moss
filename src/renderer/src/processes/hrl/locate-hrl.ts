import { AdminWebsocket, AppClient, AppInfo, EntryHash } from '@holochain/client';
import { Hrl } from '@theweave/api';
import { hrlLocatorZome } from './hrl_locator.js';

export interface EntryDefLocation {
  integrity_zome: string;
  entry_def: string;
}

export interface DnaLocation {
  appInfo: AppInfo;
  appletHash: EntryHash;
  roleName: string;
}

export type HrlLocation = {
  dnaLocation: DnaLocation;
  entryDefLocation?: EntryDefLocation;
};

export const HRL_LOCATOR_COORDINATOR_ZOME = '__hrl_locator';
export const HRL_LOCATOR_GET_FN_NAME = 'locate_hrl';

/**
 * 1. If it isn't already installed, install the hrl_locator coordinator zome
 * 2. Call the function to get the record from the hrl and return its integrity zome and entry def id
 * 3. Call "entry_defs" in the given integrity zome to retrieve the appropriate entry def id
 */
export async function locateHrl(
  adminWebsocket: AdminWebsocket,
  appClient: AppClient,
  dnaLocation: DnaLocation,
  hrl: Hrl,
): Promise<EntryDefLocation | undefined> {
  let location;
  try {
    location = await appClient.callZome({
      role_name: dnaLocation.roleName,
      zome_name: HRL_LOCATOR_COORDINATOR_ZOME,
      payload: hrl[1],
      fn_name: HRL_LOCATOR_GET_FN_NAME,
    });
  } catch (e) {
    console.warn('Call to locate_hrl() zome function failed. Attempting to install zome. Error:', e);
    await adminWebsocket.updateCoordinators({
      source: await hrlLocatorZome(),
      cell_id: [hrl[0], dnaLocation.appInfo.agent_pub_key],
    });

    location = await appClient.callZome({
      role_name: dnaLocation.roleName,
      zome_name: HRL_LOCATOR_COORDINATOR_ZOME,
      payload: hrl[1],
      fn_name: HRL_LOCATOR_GET_FN_NAME,
    });
  }

  const integrity_zome = location.integrity_zome;
  const entryDefIndex = location.entry_def_index;

  const entryDefs = await appClient.callZome({
    role_name: dnaLocation.roleName,
    zome_name: integrity_zome,
    payload: null,
    fn_name: 'entry_defs',
  });
  const entry_def = entryDefs.Defs[entryDefIndex].id.App;
  return {
    integrity_zome,
    entry_def,
  };
}
