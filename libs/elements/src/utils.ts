import { HoloHashMap } from '@holochain-open-dev/utils';
import { EntryHash, HoloHashB64, encodeHashToBase64 } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletHash, AppletInfo, GroupProfile, IframeKind } from '@theweave/api';
import { WeaveClient } from '@theweave/api';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

export async function getAppletsInfosAndGroupsProfiles(
  weaveClient: WeaveClient,
  appletsHashes: AppletHash[],
): Promise<{
  appletsInfos: ReadonlyMap<AppletHash, AppletInfo>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
}> {
  const appletsInfos = new HoloHashMap<AppletHash, AppletInfo>();
  const groupsProfiles = new HoloHashMap<DnaHash, GroupProfile>();

  for (const appletHash of appletsHashes) {
    const appletInfo = await weaveClient.appletInfo(appletHash);
    if (!appletInfo) {
      console.warn(`Could not find applet info for ` + encodeHashToBase64(appletHash));
      continue;
    }
    appletsInfos.set(appletHash, appletInfo);
    for (const groupHash of appletInfo.groupsHashes) {
      if (groupsProfiles.has(groupHash)) {
        continue;
      }
      const groupProfile = await weaveClient.groupProfile(groupHash);
      if (groupProfile) {
        groupsProfiles.set(groupHash, groupProfile);
      }
    }
  }

  return {
    groupsProfiles,
    appletsInfos,
  };
}

export async function getAppletInfoAndGroupsProfiles(
  weaveClient: WeaveClient,
  appletHash: AppletHash,
): Promise<{
  appletInfo: AppletInfo | undefined;
  groupProfiles: ReadonlyMap<DnaHash, GroupProfile>;
}> {
  const res = await getAppletsInfosAndGroupsProfiles(weaveClient, [appletHash]);
  return {
    appletInfo: res.appletsInfos.get(appletHash),
    groupProfiles: res.groupsProfiles,
  };
}

export function encodeContext(context: any) {
  return fromUint8Array(encode(context), true);
}

export function decodeContext(contextStringified: string): any {
  return decode(toUint8Array(contextStringified));
}

export function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

export function urlFromAppletHash(appletHash: AppletHash): string {
  const appletHashB64 = encodeHashToBase64(appletHash);
  const lowerCaseAppletId = toLowerCaseB64(appletHashB64);
  return lowerCaseAppletId.replaceAll('$', '%24');
}
