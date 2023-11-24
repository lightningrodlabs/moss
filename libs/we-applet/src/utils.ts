import { HoloHashMap } from "@holochain-open-dev/utils";
import { EntryHash, decodeHashFromBase64 } from "@holochain/client";
import { DnaHash } from "@holochain/client";
import { AppletInfo, GroupProfile, Hrl } from "./types";
import { WeClient } from "./api";

export async function getAppletsInfosAndGroupsProfiles(
  weClient: WeClient,
  appletsHashes: EntryHash[]
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