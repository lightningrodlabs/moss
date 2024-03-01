import { HoloHashMap } from '@holochain-open-dev/utils';
import { EntryHash, HoloHashB64, encodeHashToBase64 } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletHash, AppletInfo, GroupProfile } from '@lightningrodlabs/we-applet';
import { WeClient } from '@lightningrodlabs/we-applet';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

export async function getAppletsInfosAndGroupsProfiles(
  weClient: WeClient,
  appletsHashes: EntryHash[],
): Promise<{
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
}> {
  const groupsProfiles = new HoloHashMap<DnaHash, GroupProfile>();
  const appletsInfos = new HoloHashMap<EntryHash, AppletInfo>();

  for (const appletHash of appletsHashes) {
    const appletInfo = await weClient.appletInfo(appletHash);
    if (appletInfo) {
      appletsInfos.set(appletHash, appletInfo);

      for (const groupId of appletInfo.groupsIds) {
        if (!groupsProfiles.has(groupId)) {
          const groupProfile = await weClient.groupProfile(groupId);

          if (groupProfile) {
            groupsProfiles.set(groupId, groupProfile);
          }
        }
      }
    }
  }

  return {
    groupsProfiles,
    appletsInfos,
  };
}

export function encodeContext(context: any) {
  return fromUint8Array(encode(context), true);
}

export function decodeContext(contextStringified: string): any {
  return decode(toUint8Array(contextStringified));
}

export function appletOrigin(appletHash: AppletHash): string {
  return `applet://${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

export function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

export function urlFromAppletHash(appletHash: AppletHash): string {
  const appletHashB64 = encodeHashToBase64(appletHash);
  const lowerCaseAppletId = toLowerCaseB64(appletHashB64);
  return lowerCaseAppletId.replaceAll('$', '%24');
}
