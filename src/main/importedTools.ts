/**
 * Maps the Tools in a groups export to the versions this Moss can run.
 *
 * An export records the tool list and version branch that the exporting Moss
 * used. A Tool built for an earlier Moss version targets an earlier Holochain
 * and cannot be installed here, so an import from an earlier version installs
 * the Tool's currently curated version instead.
 */

export interface CuratedTool {
  toolId: string;
  toolListUrl: string;
  versionBranch: string;
}

export interface ToolSource {
  toolListUrl: string;
  versionBranch: string;
}

/** Collects the tools of the given lists from a curation file. */
export function curatedToolsFromCuration(curation: unknown, useLists: string[]): CuratedTool[] {
  const lists = (curation as { curationLists?: Record<string, { tools?: unknown }> } | null)
    ?.curationLists;
  if (!lists) return [];
  const tools: CuratedTool[] = [];
  for (const listName of useLists) {
    const entries = lists[listName]?.tools;
    if (!Array.isArray(entries)) continue;
    for (const t of entries) {
      if (
        typeof t?.toolId === 'string' &&
        typeof t?.toolListUrl === 'string' &&
        typeof t?.versionBranch === 'string'
      ) {
        tools.push({
          toolId: t.toolId,
          toolListUrl: t.toolListUrl,
          versionBranch: t.versionBranch,
        });
      }
    }
  }
  return tools;
}

/**
 * Where to install an exported Tool from. A curated Tool with the same id wins.
 * Without one, the exported source is used only when it is known to target this
 * Moss version (`requireCurated` false); otherwise the Tool is unavailable.
 */
export function resolveImportedTool(
  tool: { toolId: string; toolListUrl: string; versionBranch: string },
  curated: CuratedTool[],
  requireCurated: boolean,
): ToolSource | undefined {
  const match = curated.find((c) => c.toolId === tool.toolId);
  if (match) return { toolListUrl: match.toolListUrl, versionBranch: match.versionBranch };
  if (requireCurated) return undefined;
  return { toolListUrl: tool.toolListUrl, versionBranch: tool.versionBranch };
}
