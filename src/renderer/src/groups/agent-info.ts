/** The part of a kitsune2 agent info that peer discovery needs. */
interface AgentInfoData {
  agent?: string;
  isTombstone?: boolean;
}

/**
 * Extracts the kitsune agent ids of reachable agents from an agentInfo
 * response. Each item is a signed agent info, either as a JSON string or
 * already parsed, whose `agentInfo` field is itself a JSON string. Agents
 * that left the network publish a tombstone, and those are not peers anyone
 * can sync with, so they are skipped. Malformed items are skipped too.
 */
export function liveAgentIdsFromAgentInfo(items: unknown[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    try {
      const signed = (typeof item === 'string' ? JSON.parse(item) : item) as {
        agentInfo?: unknown;
      };
      const info = (
        typeof signed.agentInfo === 'string' ? JSON.parse(signed.agentInfo) : signed.agentInfo
      ) as AgentInfoData | undefined;
      if (!info?.agent || info.isTombstone) continue;
      ids.push(info.agent);
    } catch (e) {
      console.warn('[AgentInfo] Failed to parse agent info item:', item, e);
    }
  }
  return ids;
}
