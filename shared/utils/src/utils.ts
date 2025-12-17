import {
  PartialModifiers,
  DistributionInfo,
  TDistributionInfo,
  ToolCompatibilityId,
  ToolInfoAndVersions,
  ToolVersionInfo,
} from '@theweave/moss-types';
import {
  AgentPubKey, AppInfo, CellId, CellInfo, CellType,
  decodeHashFromBase64, DnaHash, DnaHashB64,
  encodeHashToBase64,
  HoloHashB64,
  ListAppsResponse
} from '@holochain/client';
import { AppletId, AppletHash, IframeKind } from '@theweave/api';
import { Value } from '@sinclair/typebox/value';
import { Md5 } from 'ts-md5';
import { compareVersions, validate as validateSemver } from 'compare-versions';

export function invitePropsToPartialModifiers(props: string): PartialModifiers {
  const [networkSeed, progenitorString] = props.split('&progenitor=');
  if (!progenitorString) throw new Error('Invite string does not contain progenitor.');
  let progenitor;
  if (progenitorString === 'null') {
    progenitor = null;
  } else {
    try {
      const rawKey = decodeHashFromBase64(progenitorString);
      if (rawKey.length !== 39) {
        throw new Error(`Progenitor key is not a valid agent key. Got ${progenitorString}`);
      }
    } catch (e) {
      throw new Error(`Progenitor key is not a valid agent key. Got ${progenitorString}`);
    }
    if (!progenitorString.startsWith('uhCAk')) {
      throw new Error(`Progenitor key is not a valid agent key. Got ${progenitorString}`);
    }
    progenitor = progenitorString;
  }
  return {
    networkSeed,
    progenitor,
  };
}

export function partialModifiersFromInviteLink(inviteLink: string): PartialModifiers {
  try {
    const split = inviteLink.trim().split('://');
    const split2 = inviteLink.startsWith('https')
      ? split[2].split('/') // link contains the web prefix, i.e. https://theweave.social/wal/weave-0.15://invite/aljsfkajsf
      : split[1].split('/'); // link does not contain the web prefix, i.e. weave-0.15://invite/aljsfkajsf
    if (split2[0] === 'invite') {
      return invitePropsToPartialModifiers(split2[1]);
    } else {
      throw new Error('Invalid invite link: Invite link is of the wrong format');
    }
  } catch (e) {
    throw new Error('Invalid invite link: Failed to parse invite link.');
  }
}

export function appIdFromAppletHash(appletHash: AppletHash): string {
  return `applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

export function appIdFromAppletId(appletId: AppletId): string {
  return `applet#${toLowerCaseB64(appletId)}`;
}

export function appletHashFromAppId(installedAppId: string): AppletHash {
  return decodeHashFromBase64(toOriginalCaseB64(installedAppId.slice(7)));
}

export function appletIdFromAppId(installedAppId: string): AppletId {
  return toOriginalCaseB64(installedAppId.slice(7));
}

export function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

export function toOriginalCaseB64(input: string): HoloHashB64 {
  return input.replace(/[a-z]\$/g, (match) => match[0].toUpperCase());
}

export function deriveToolCompatibilityId(input: {
  toolListUrl: string;
  toolId: string;
  versionBranch: string;
}): ToolCompatibilityId {
  return Md5.hashStr(`${input.toolListUrl}#${input.toolId}#${input.versionBranch}`);
}

export function toolCompatibilityIdFromDistInfoString(distInfoString: string): string {
  const distributionInfo: DistributionInfo = JSON.parse(distInfoString);
  // Verify format
  Value.Assert(TDistributionInfo, distributionInfo);
  return toolCompatibilityIdFromDistInfo(distributionInfo);
}

export function toolCompatibilityIdFromDistInfo(distributionInfo: DistributionInfo): string {
  if (distributionInfo.type === 'tools-library') {
    return distributionInfo.info.originalToolActionHash;
  } else if (distributionInfo.type === 'web2-tool-list') {
    return deriveToolCompatibilityId({
      toolListUrl: distributionInfo.info.toolListUrl,
      toolId: distributionInfo.info.toolId,
      versionBranch: distributionInfo.info.versionBranch,
    });
  } else {
    throw new Error(
      `Cannot derive Tool compatibility id from distribution info type '${distributionInfo.type}'`,
    );
  }
}

export function globalPubKeyFromListAppsResponse(apps: ListAppsResponse): AgentPubKey | undefined {
  const anyGroupApp = apps.find((app) => app.installed_app_id.startsWith('group#'));
  return anyGroupApp?.agent_pub_key;
}

export function getLatestVersionFromToolInfo(
  toolInfo: ToolInfoAndVersions,
  happSha256: string,
): ToolVersionInfo | undefined {
  return toolInfo.versions
    .filter(
      (version) => validateSemver(version.version) && happSha256 === version.hashes.happSha256,
    )
    .sort((version_a, version_b) => compareVersions(version_b.version, version_a.version))[0];
}


export function getAppStatus(app: AppInfo): string {
  if (isAppRunning(app)) {
    return 'ENABLED';
  } else if (isAppDisabled(app)) {
    return 'DISABLED';
  } else if (isAppAwaitingMemProofs(app)) {
    return 'AWAITING_MEMPROOFS';
  } else {
    return 'UNKNOWN';
  }
}

export function isAppRunning(app: AppInfo): boolean {
  return app.status.type === 'enabled';
}
export function isAppDisabled(app: AppInfo): boolean {
  return app.status.type === 'disabled';
}
export function isAppAwaitingMemProofs(app: AppInfo): boolean {
  return app.status.type === 'awaiting_memproofs';
}

export function getCellId(cellInfo: CellInfo): CellId | undefined {
  if (cellInfo.type === CellType.Provisioned) {
    return cellInfo.value.cell_id;
  }
  if (cellInfo.type === CellType.Cloned) {
    return cellInfo.value.cell_id;
  }
  return undefined;
}

export function intoOrigin(iframeKind: IframeKind): string {
  switch (iframeKind.type) {
    case 'applet':
      return `applet://${toLowerCaseB64(encodeHashToBase64(iframeKind.appletHash))}`;
    case 'cross-group':
      return `cross-group://${toLowerCaseB64(iframeKind.toolCompatibilityId)}`;
  }
}

export function intoAppletOrigin(appletId: AppletId, groupId: DnaHashB64): string {
  return `applet://${toLowerCaseB64(appletId)}.${toLowerCaseB64(groupId)}`;
}

/** Assuming `origin` is `applet://<appletId>.<groupId>` */
export function getIdsFromAppletOrigin(origin: string): [AppletId, DnaHashB64] {
  const host = origin.split('://')[1].split('?')[0].split('/')[0];
  const dollarHost = host.replace(/%24/g, '$');
  const parts = dollarHost.split('.');
  return [toOriginalCaseB64(parts[0]), toOriginalCaseB64(parts[1])];
}

/** Assuming `origin` is `cross-group://<toolId>` */
export function getToolIdFromCrossGroupOrigin(origin: string): ToolCompatibilityId {
  const host = origin.split('://')[1].split('?')[0].split('/')[0];
  const dollarHost = host.replace(/%24/g, '$');
  return toOriginalCaseB64(dollarHost);
}