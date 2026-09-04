import { LocalToolInfo, ToolCompatibilityId } from '@theweave/moss-types';
import { ToolAndCurationInfo } from '../types.js';

/**
 * Presenting Tools this computer already holds as library entries.
 *
 * A Tool obtained once leaves behind everything a listing needs, so it can be
 * offered again for a new group even with no curation list in reach. Such an
 * entry is deliberately shaped like any other so that the grouping, filtering,
 * sorting and install paths need no special case; only the marker distinguishes
 * it, and only so the UI can explain where it came from.
 */

/** Turns one locally held Tool into the entry shape a curation list produces. */
export function toolAndCurationInfoFromLocal(
  local: LocalToolInfo,
): ToolAndCurationInfo | undefined {
  if (local.distributionInfo.type !== 'web2-tool-list') return undefined;
  const info = local.distributionInfo.info;
  const version = {
    version: info.toolVersion,
    hashes: {
      webhappSha256: local.webhappSha256 ?? '',
      happSha256: local.happSha256,
      uiSha256: local.uiSha256,
    },
    // There is nothing to download: the bytes this names are already on disk.
    url: '',
    changelog: '',
    releasedAt: local.installedAt,
  };
  return {
    toolCompatibilityId: local.toolCompatibilityId,
    toolInfoAndVersions: {
      id: info.toolId,
      versionBranch: info.versionBranch,
      title: info.toolName,
      // Neither is recorded at install time; both are cosmetic.
      subtitle: '',
      description: '',
      icon: local.icon,
      tags: [],
      versions: [version],
    },
    curationInfos: [],
    latestVersion: version,
    toolListUrl: info.toolListUrl,
    developerCollectiveId: info.developerCollectiveId,
    availableLocally: true,
  };
}

/**
 * Adds locally held Tools to what the curation lists offered, but only where
 * the lists say nothing: a Tool a reachable list describes is always described
 * by that list, since it has the real subtitle, tags and curation.
 */
export function mergeLocalTools(
  libraryTools: Record<ToolCompatibilityId, ToolAndCurationInfo>,
  localTools: LocalToolInfo[],
): Record<ToolCompatibilityId, ToolAndCurationInfo> {
  const merged = { ...libraryTools };
  for (const local of localTools) {
    if (merged[local.toolCompatibilityId]) continue;
    const entry = toolAndCurationInfoFromLocal(local);
    if (entry) merged[local.toolCompatibilityId] = entry;
  }
  return merged;
}
