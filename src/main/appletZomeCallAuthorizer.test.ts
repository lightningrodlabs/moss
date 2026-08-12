import { describe, it, expect } from 'vitest';
import {
  AppInfo,
  CallZomeRequest,
  CellId,
  CellInfo,
  CellType,
  encodeHashToBase64,
} from '@holochain/client';
import { appIdFromAppletId } from '@theweave/utils';
import { AppletZomeCallAuthorizer } from './appletZomeCallAuthorizer';

const AGENT = new Uint8Array([0, 1, 2]);
const cellId = (dna: number[]): CellId => [new Uint8Array(dna), AGENT];

function provisioned(id: CellId): CellInfo {
  return { type: CellType.Provisioned, value: { cell_id: id, name: 'c' } } as unknown as CellInfo;
}

const APPLET_A = encodeHashToBase64(new Uint8Array([10, 10, 10]));
const APPLET_B = encodeHashToBase64(new Uint8Array([20, 20, 20]));
const APPLET_C = encodeHashToBase64(new Uint8Array([30, 30, 30]));
const A_CELL = cellId([100]);
const B_CELL = cellId([200]);
const C_CELL = cellId([210]);
const GROUP_CELL = cellId([1]);
const FOYER_CELL = cellId([2]);
const ASSETS_CELL = cellId([3]);
const FOREIGN_CELL = cellId([255]);

const appletApp = (id: string, cell: CellId): AppInfo =>
  ({
    installed_app_id: appIdFromAppletId(id),
    cell_info: { forum: [provisioned(cell)] },
  }) as unknown as AppInfo;

const groupApp = (): AppInfo =>
  ({
    installed_app_id: 'group#seed#prog',
    cell_info: {
      group: [provisioned(GROUP_CELL)],
      foyer: [provisioned(FOYER_CELL)],
      assets: [provisioned(ASSETS_CELL)],
    },
  }) as unknown as AppInfo;

function req(id: CellId, zome_name: string): CallZomeRequest {
  return { cell_id: id, zome_name } as unknown as CallZomeRequest;
}

/** Harness with a controllable clock and mutable installed-app list. */
function harness(
  initial: AppInfo[] = [appletApp(APPLET_A, A_CELL), appletApp(APPLET_B, B_CELL), groupApp()],
) {
  let now = 0;
  let apps = initial;
  let calls = 0;
  const authorizer = new AppletZomeCallAuthorizer(
    async () => {
      calls += 1;
      return apps;
    },
    () => now,
  );
  return {
    authorizer,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
    setApps: (a: AppInfo[]) => {
      apps = a;
    },
  };
}

describe('AppletZomeCallAuthorizer', () => {
  it('signs an applet call to its own cell (any zome)', async () => {
    const { authorizer } = harness();
    expect(await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).toEqual({
      sign: true,
      reason: 'own-cell',
    });
  });

  it('signs a group-cell profiles call', async () => {
    const { authorizer } = harness();
    expect(await authorizer.authorize([APPLET_A], req(GROUP_CELL, 'profiles'))).toEqual({
      sign: true,
      reason: 'group-profiles',
    });
  });

  it('refuses a group-cell non-profiles zome (the core vulnerability)', async () => {
    const { authorizer } = harness();
    expect(await authorizer.authorize([APPLET_A], req(GROUP_CELL, 'group'))).toEqual({
      sign: false,
      reason: 'group-zome-not-allowed',
    });
  });

  it('refuses the group app foyer/assets cells (not the group role)', async () => {
    const { authorizer } = harness();
    expect((await authorizer.authorize([APPLET_A], req(FOYER_CELL, 'foyer'))).sign).toBe(false);
    expect((await authorizer.authorize([APPLET_A], req(ASSETS_CELL, 'assets'))).sign).toBe(false);
  });

  it('refuses another applet’s own cell', async () => {
    const { authorizer } = harness();
    expect(await authorizer.authorize([APPLET_A], req(B_CELL, 'posts'))).toEqual({
      sign: false,
      reason: 'unknown-cell',
    });
  });

  it('a cross-group caller may sign for any of its tool’s applets', async () => {
    const { authorizer } = harness();
    expect((await authorizer.authorize([APPLET_A, APPLET_B], req(B_CELL, 'posts'))).sign).toBe(
      true,
    );
  });

  it('refuses a missing cell_id', async () => {
    const { authorizer } = harness();
    expect(await authorizer.authorize([APPLET_A], { zome_name: 'x' } as CallZomeRequest)).toEqual({
      sign: false,
      reason: 'unknown-cell',
    });
  });

  it('does not re-list on a fresh build even when the cell is unknown', async () => {
    const { authorizer, calls } = harness();
    // The build itself is one listApps; re-listing immediately would not find a
    // cell that was absent moments ago, so it is throttled.
    await authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'));
    expect(calls()).toBe(1);
  });

  it('caches: an allowed call after the cache is warm does not re-list', async () => {
    const { authorizer, calls } = harness();
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(calls()).toBe(1);
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(calls()).toBe(1);
  });

  it('picks up a just-installed applet after the throttle interval (no false refusal)', async () => {
    const h = harness();
    // Warm the cache before APPLET_C exists.
    await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(h.calls()).toBe(1);
    // APPLET_C is installed, and its iframe calls after mounting (> throttle).
    h.setApps([appletApp(APPLET_A, A_CELL), appletApp(APPLET_C, C_CELL), groupApp()]);
    h.advance(1_500);
    expect((await h.authorizer.authorize([APPLET_C], req(C_CELL, 'posts'))).sign).toBe(true);
    expect(h.calls()).toBe(2); // one refresh, which found it
  });

  it('throttles rebuilds under a flood of unknown-cell calls', async () => {
    const h = harness();
    await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts')); // build (1)
    h.advance(1_500);
    await h.authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x')); // refresh (2)
    expect(h.calls()).toBe(2);
    // Further unknown-cell calls within the throttle window do not re-list.
    await h.authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'));
    await h.authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'));
    expect(h.calls()).toBe(2);
  });

  it('invalidate() forces a re-list on the next authorize', async () => {
    const h = harness();
    await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(h.calls()).toBe(1);
    h.authorizer.invalidate();
    await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(h.calls()).toBe(2);
  });

  it('self-heals a missed uninstall via a background refresh once past the max age', async () => {
    const h = harness();
    // A is granted while installed (cache built at t=0).
    expect((await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(true);
    // A is uninstalled via a path that does NOT call invalidate() (leaveGroup).
    h.setApps([appletApp(APPLET_B, B_CELL), groupApp()]);
    // Within the max age the stale grant persists (no live iframe uses it).
    h.advance(30_000);
    expect((await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(true);
    // Past the max age, the first call still serves the stale set (does not block)
    // but kicks a background refresh.
    h.advance(31_000);
    expect((await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(true);
    // Once the refresh settles, the grant is gone.
    await flush();
    expect((await h.authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(false);
  });

  it('keeps signing when a stale-age background refresh rejects', async () => {
    let now = 0;
    let fail = false;
    const authorizer = new AppletZomeCallAuthorizer(
      async () => {
        if (fail) throw new Error('admin socket reconnecting');
        return [appletApp(APPLET_A, A_CELL), groupApp()];
      },
      () => now,
    );
    expect((await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(true);
    now += 61_000; // stale; the background refresh will now reject
    fail = true;
    // Signing keeps working against the warm cache; the rejected refresh does not
    // propagate (and must not surface as an unhandled rejection).
    expect((await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(true);
    await flush();
  });

  it('rate-limits doomed background refreshes during an outage (one per interval)', async () => {
    let now = 0;
    let calls = 0;
    let fail = false;
    const authorizer = new AppletZomeCallAuthorizer(
      async () => {
        calls += 1;
        if (fail) throw new Error('admin socket down');
        return [appletApp(APPLET_A, A_CELL), groupApp()];
      },
      () => now,
    );
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts')); // build (1)
    expect(calls).toBe(1);
    now += 61_000; // stale
    fail = true; // outage
    // Three signs during the outage fire only one background refresh attempt.
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    await flush();
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    await flush();
    expect(calls).toBe(2);
    now += 2_000; // past the interval → one more attempt allowed
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    await flush();
    expect(calls).toBe(3);
  });

  it('an unknown-cell call during an outage refuses without throwing or flooding listApps', async () => {
    let now = 0;
    let calls = 0;
    let fail = false;
    const authorizer = new AppletZomeCallAuthorizer(
      async () => {
        calls += 1;
        if (fail) throw new Error('admin socket down');
        return [appletApp(APPLET_A, A_CELL), groupApp()];
      },
      () => now,
    );
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts')); // build (1)
    now += 61_000;
    fail = true;
    // Unknown cell during the outage: refuses cleanly (no raw socket error) ...
    expect(await authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'))).toEqual({
      sign: false,
      reason: 'unknown-cell',
    });
    await flush();
    const attemptsSoFar = calls;
    // ... and further unknown-cell calls within the interval fire no new round-trips.
    await authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'));
    await authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'));
    await flush();
    expect(calls).toBe(attemptsSoFar);
  });

  it('an invalidate during an in-flight rebuild discards that stale snapshot (generation)', async () => {
    const { authorizer, releaseListApps, setApps } = gatedHarness([appletApp(APPLET_A, A_CELL)]);
    const first = authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    setApps([]); // uninstalled while listApps is in flight
    authorizer.invalidate();
    releaseListApps();
    await first;
    // The stale snapshot must not have been committed: A is no longer granted.
    expect((await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(false);
  });

  it('a legit call after an in-flight invalidate rebuilds fresh (no strand)', async () => {
    // The discarded rebuild must not leave the authorizer refusing a cell that is
    // still installed: the next call re-lists and grants it.
    const { authorizer, releaseListApps } = gatedHarness([appletApp(APPLET_A, A_CELL), groupApp()]);
    const first = authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    authorizer.invalidate();
    releaseListApps();
    await first;
    expect((await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).sign).toBe(true);
  });
});

/** Resolve after pending microtasks + one macrotask so background rebuilds settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Harness whose listApps blocks until releaseListApps() is called, for in-flight races. */
function gatedHarness(initial: AppInfo[]) {
  let apps = initial;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const authorizer = new AppletZomeCallAuthorizer(
    async () => {
      await gate;
      return apps;
    },
    () => 0,
  );
  return {
    authorizer,
    releaseListApps: () => release(),
    setApps: (a: AppInfo[]) => {
      apps = a;
    },
  };
}
