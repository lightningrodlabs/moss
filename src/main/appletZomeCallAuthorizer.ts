import { AppInfo, CallZomeRequest, CellId, CellInfo, encodeHashToBase64 } from '@holochain/client';
import { appletIdFromAppId, getCellId } from '@theweave/utils';
import type { AppletId } from '@theweave/api';
import { decideZomeCallSignable, type ZomeCallSigningDecision } from './zomeCallSigningPolicy';

/**
 * How long a resolved cell set may be trusted before it is rebuilt from live app
 * info. This is the self-heal window for an uninstall that never called
 * invalidate() — notably the renderer's leaveGroup, which uninstalls apps
 * through its own admin websocket and so bypasses the main-process invalidate
 * sites. Within this window a torn-down applet's cells can still be granted, but
 * there is no iframe left to request signing for them.
 */
const CACHE_MAX_AGE_MS = 60_000;

/**
 * Minimum time between rebuilds triggered by an unknown-cell refusal. A rebuild
 * picks up an applet or group installed since the last build (so a legitimate
 * just-installed cell is not falsely refused), but only once per interval, so a
 * flood of calls to a genuinely-unknown cell cannot drive an unthrottled
 * listApps per call. The interval is well below the time it takes a
 * newly-installed applet's iframe to mount and make its first call.
 */
const MIN_UNKNOWN_REBUILD_INTERVAL_MS = 1_000;

/**
 * Resolves which cells each installed applet is allowed to have zome calls signed
 * for, and decides individual sign requests against that set (via the pure
 * decideZomeCallSignable policy).
 *
 * Resolving the allowed cells is a listApps round-trip and signing is on the hot
 * path, so the result is cached. Freshness is maintained three ways: invalidate()
 * drops it immediately (called on the IPC uninstall paths); a request that the
 * cached view refuses for an *unknown* cell rebuilds once (throttled) so a
 * just-installed cell is picked up; and a cache older than CACHE_MAX_AGE_MS is
 * rebuilt before use so a missed invalidate self-heals. A generation counter
 * ensures an invalidate() during an in-flight rebuild discards that rebuild's
 * (now stale) snapshot instead of silently restoring it.
 */
export class AppletZomeCallAuthorizer {
  private cache: { ownByAppletId: Map<string, Set<string>>; groupCells: Set<string> } | undefined;
  private builtAt = 0;
  private generation = 0;
  private rebuildInFlight: Promise<void> | undefined;

  constructor(
    private listApps: () => Promise<AppInfo[]>,
    private clock: () => number = () => Date.now(),
  ) {}

  /** Drop the cached cell sets and abandon any in-flight rebuild's result. */
  invalidate(): void {
    this.cache = undefined;
    this.generation += 1;
    this.rebuildInFlight = undefined;
  }

  async authorize(
    callerAppletIds: AppletId[],
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

    if (!this.cache || this.clock() - this.builtAt > CACHE_MAX_AGE_MS) await this.rebuild();
    let decision = evaluate();
    if (
      !decision.sign &&
      decision.reason === 'unknown-cell' &&
      this.clock() - this.builtAt > MIN_UNKNOWN_REBUILD_INTERVAL_MS
    ) {
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
  private ownCellsForCallers(callerAppletIds: AppletId[]): Set<string> {
    const union = new Set<string>();
    for (const id of callerAppletIds) {
      for (const key of this.cache?.ownByAppletId.get(id) ?? []) union.add(key);
    }
    return union;
  }

  private rebuild(): Promise<void> {
    if (this.rebuildInFlight) return this.rebuildInFlight;
    const generationAtStart = this.generation;
    const p = (async () => {
      const apps = await this.listApps();
      // An invalidate() during the listApps round-trip means this snapshot may
      // already be stale (e.g. the app it would grant was just uninstalled), so
      // discard it rather than restore it.
      if (generationAtStart !== this.generation) return;
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
      this.builtAt = this.clock();
    })();
    this.rebuildInFlight = p;
    void p.finally(() => {
      if (this.rebuildInFlight === p) this.rebuildInFlight = undefined;
    });
    return p;
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
