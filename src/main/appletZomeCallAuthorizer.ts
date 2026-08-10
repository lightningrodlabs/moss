import { AppInfo, CallZomeRequest, CellId, CellInfo, encodeHashToBase64 } from '@holochain/client';
import { appletIdFromAppId, getCellId } from '@theweave/utils';
import { decideZomeCallSignable, type ZomeCallSigningDecision } from './zomeCallSigningPolicy';

/**
 * Resolves which cells each installed applet is allowed to have zome calls signed
 * for, and decides individual sign requests against that set (via the pure
 * decideZomeCallSignable policy).
 *
 * Resolving the allowed cells is a listApps round-trip and signing is on the hot
 * path, so the result is cached. The cache is rebuilt lazily: a request that the
 * cached view would refuse for an *unknown* cell triggers one refresh before the
 * refusal, so a just-installed applet or group is picked up with no false
 * rejection; concurrent refreshes coalesce into a single listApps. A known group
 * cell refused for a non-profiles zome is not re-checked (a rebuild cannot change
 * that verdict). Callers invalidate() on uninstall so the cache never keeps
 * granting for an app that is gone.
 */
export class AppletZomeCallAuthorizer {
  private cache: { ownByAppletId: Map<string, Set<string>>; groupCells: Set<string> } | undefined;
  private rebuildInFlight: Promise<void> | undefined;

  constructor(private listApps: () => Promise<AppInfo[]>) {}

  /** Drop the cached cell sets so the next authorize() re-resolves from live app info. */
  invalidate(): void {
    this.cache = undefined;
  }

  async authorize(
    callerAppletIds: string[],
    zomeCall: CallZomeRequest,
  ): Promise<ZomeCallSigningDecision> {
    if (!zomeCall.cell_id) return { sign: false, reason: 'unknown-cell' };
    const evaluate = (): ZomeCallSigningDecision =>
      decideZomeCallSignable({
        cellIdB64: cellIdKey(zomeCall.cell_id!),
        zomeName: zomeCall.zome_name,
        appletOwnCellIdsB64: this.ownCellsForCallers(callerAppletIds),
        groupCellIdsB64: this.cache?.groupCells ?? new Set(),
      });

    if (!this.cache) await this.rebuild();
    let decision = evaluate();
    if (!decision.sign && decision.reason === 'unknown-cell') {
      await this.rebuild();
      decision = evaluate();
    }
    return decision;
  }

  /**
   * The union of own-cells across the caller's applet ids. A plain applet caller
   * passes one id; a cross-group view passes every applet of its tool, so it may
   * legitimately sign for any of them (but still only their own cells).
   */
  private ownCellsForCallers(callerAppletIds: string[]): Set<string> {
    const union = new Set<string>();
    for (const id of callerAppletIds) {
      for (const key of this.cache?.ownByAppletId.get(id) ?? []) union.add(key);
    }
    return union;
  }

  private rebuild(): Promise<void> {
    if (this.rebuildInFlight) return this.rebuildInFlight;
    this.rebuildInFlight = (async () => {
      try {
        const apps = await this.listApps();
        const ownByAppletId = new Map<string, Set<string>>();
        const groupCells = new Set<string>();
        for (const app of apps) {
          const appId = app.installed_app_id;
          if (appId.startsWith('applet#')) {
            ownByAppletId.set(appletIdFromAppId(appId), new Set(cellIdsOfApp(app)));
          } else if (appId.startsWith('group#')) {
            // Only the `group` role cell hosts the profiles zome an applet may call.
            for (const key of cellIdsOfApp(app, 'group')) groupCells.add(key);
          }
        }
        this.cache = { ownByAppletId, groupCells };
      } finally {
        this.rebuildInFlight = undefined;
      }
    })();
    return this.rebuildInFlight;
  }
}

/** Stable string key for a CellId ([DnaHash, AgentPubKey]) so it can go in a Set. */
function cellIdKey(cellId: CellId): string {
  return `${encodeHashToBase64(cellId[0])}|${encodeHashToBase64(cellId[1])}`;
}

function cellIdsOfApp(appInfo: AppInfo, roleFilter?: string): string[] {
  const keys: string[] = [];
  for (const [roleName, cellInfos] of Object.entries(appInfo.cell_info)) {
    if (roleFilter && roleName !== roleFilter) continue;
    for (const cellInfo of cellInfos as CellInfo[]) {
      const cellId = getCellId(cellInfo);
      if (cellId) keys.push(cellIdKey(cellId));
    }
  }
  return keys;
}
