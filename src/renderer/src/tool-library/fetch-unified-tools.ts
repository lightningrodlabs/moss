import { validate as validateSemver } from 'compare-versions';
import {
  DeveloperCollective,
  DeveloperCollectiveToolList,
  ToolCompatibilityId,
  ToolCurationConfig,
  ToolCurationList,
  ToolCurations,
  ToolCurator,
} from '@theweave/moss-types';
import { deriveToolCompatibilityId, toolCompatibilityIdFromDistInfoString } from '@theweave/utils';
import { ToolAndCurationInfo, ToolListUrl, UnifiedToolEntry } from '../types.js';
import { groupToolsByBaseId, sortVersionsDescending } from '../utils.js';
import { DevModeToolLibrary, MossStore } from '../moss-store.js';
import { toolLibraryFetch } from './library-fetch.js';

export const DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS: ToolCurationConfig[] = [
  {
    url: 'https://lightningrodlabs.org/weave-tool-curation/0.16/curations-0.16.json',
    useLists: ['default'],
  },
];

export function activeToolCurationConfigs(mossStore: MossStore): ToolCurationConfig[] {
  if (mossStore.appletDevConfig) {
    return mossStore.appletDevConfig.toolCurations;
  }
  const json: string | null = window.localStorage.getItem('mossCurationConfig');
  if (json) {
    try {
      const urls = JSON.parse(json) as string[];
      return urls.map((url) => ({ url, useLists: ['default'] }));
    } catch {
      return DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS;
    }
  }
  return DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS;
}

export type FetchedUnifiedTools = {
  unifiedTools: Map<string, UnifiedToolEntry>;
  availableTools: Record<ToolCompatibilityId, ToolAndCurationInfo>;
  developerCollectives: Record<ToolListUrl, DeveloperCollective>;
  curationLists: { curator: ToolCurator; list: ToolCurationList }[];
};

export async function fetchUnifiedTools(
  toolCurationConfigs: ToolCurationConfig[],
  devModeToolLibrary: DevModeToolLibrary | undefined,
): Promise<FetchedUnifiedTools> {
  const allTools: Record<ToolCompatibilityId, ToolAndCurationInfo> = {};
  const developerCollectives: Record<ToolListUrl, DeveloperCollective> = {};

  if (devModeToolLibrary) {
    const { tools, devCollective } = devModeToolLibrary;
    tools.forEach((tool) => {
      allTools[tool.toolCompatibilityId] = tool;
      developerCollectives[tool.toolListUrl] = devCollective;
    });
  }

  const curationLists: { curator: ToolCurator; list: ToolCurationList }[] = [];
  await Promise.allSettled(
    toolCurationConfigs.map(async (config) => {
      try {
        const resp = await toolLibraryFetch.fetch(config.url, { cache: 'no-cache' });
        const toolCurations: ToolCurations = await resp.json();
        config.useLists.forEach((listName) => {
          const relevantList = toolCurations.curationLists[listName];
          if (relevantList) {
            curationLists.push({
              curator: toolCurations.curator,
              list: relevantList,
            });
          }
        });
      } catch (e) {
        console.warn(
          "Failed to fetch, parse or validate curator's list from url ",
          config.url,
          ':',
          e,
        );
      }
    }),
  );

  const toolLists: Record<ToolListUrl, DeveloperCollectiveToolList> = {};
  const distinctToolListUrls = Array.from(
    new Set(curationLists.map((list) => list.list.tools.map((tool) => tool.toolListUrl)).flat()),
  );

  await Promise.allSettled(
    distinctToolListUrls.map(async (url) => {
      try {
        const resp = await toolLibraryFetch.fetch(url, { cache: 'no-cache' });
        const toolList: DeveloperCollectiveToolList = await resp.json();
        toolLists[url] = toolList;
        developerCollectives[url] = toolList.developerCollective;
      } catch (e) {
        console.warn('Failed to fetch, parse or validate Tool list from url ', url, ':', e);
      }
    }),
  );

  curationLists.forEach(({ curator, list }) => {
    list.tools.forEach((curatedTool) => {
      const toolList = toolLists[curatedTool.toolListUrl];
      if (!toolList) return;
      const relevantTool = toolList.tools.find(
        (tool) =>
          tool.id === curatedTool.toolId && tool.versionBranch === curatedTool.versionBranch,
      );
      if (!relevantTool) return;
      relevantTool.versions = sortVersionsDescending(relevantTool.versions);
      const latestVersion = relevantTool.versions.filter((version) =>
        validateSemver(version.version),
      )[0];
      if (!latestVersion) return;
      const toolCompatibilityId = deriveToolCompatibilityId({
        toolListUrl: curatedTool.toolListUrl,
        toolId: relevantTool.id,
        versionBranch: relevantTool.versionBranch,
      });
      let toolAndCurationInfo = allTools[toolCompatibilityId];
      if (toolAndCurationInfo) {
        toolAndCurationInfo.curationInfos.push({
          info: curatedTool,
          curator,
        });
      } else {
        toolAndCurationInfo = {
          toolCompatibilityId,
          toolInfoAndVersions: relevantTool,
          toolListUrl: curatedTool.toolListUrl,
          latestVersion,
          developerCollectiveId: toolList.developerCollective.id,
          curationInfos: [
            {
              info: curatedTool,
              curator,
            },
          ],
        };
      }
      allTools[toolCompatibilityId] = toolAndCurationInfo;
    });
  });

  return {
    unifiedTools: groupToolsByBaseId(allTools),
    availableTools: allTools,
    developerCollectives,
    curationLists,
  };
}

/**
 * Find the UnifiedToolEntry whose version branches include the given compatibility id.
 *
 * TODO(test): unit test deferred — see plans/tool-info-popup.md "TDD plan" #2.
 *   Cover hit and miss cases. Re-enable when renderer-side Vitest infra lands.
 */
export function findUnifiedToolByCompatibilityId(
  unifiedTools: Map<string, UnifiedToolEntry>,
  toolCompatibilityId: string,
): UnifiedToolEntry | undefined {
  for (const tool of unifiedTools.values()) {
    for (const branch of tool.versionBranches.values()) {
      if (branch.toolCompatibilityId === toolCompatibilityId) {
        return tool;
      }
    }
  }
  return undefined;
}

/**
 * Given an Applet entry's distribution_info JSON and a unified-tools map, find the matching UnifiedToolEntry.
 * Returns undefined when the JSON is malformed or the applet's source isn't in the map (offline / curation removed / dev applet).
 *
 * TODO(test): unit test deferred — see plans/tool-info-popup.md "TDD plan" #2.
 *   Cases to cover: well-formed distribution_info hits/misses, malformed JSON,
 *   wrong shape. Re-enable when renderer-side Vitest infra lands.
 */
export function resolveUnifiedToolForApplet(
  distributionInfo: string,
  unifiedTools: Map<string, UnifiedToolEntry>,
): UnifiedToolEntry | undefined {
  let compatId: string;
  try {
    compatId = toolCompatibilityIdFromDistInfoString(distributionInfo);
  } catch {
    return undefined;
  }
  return findUnifiedToolByCompatibilityId(unifiedTools, compatId);
}
