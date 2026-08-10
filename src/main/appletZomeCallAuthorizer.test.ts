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

// Two applets and one group app. The group app has group/foyer/assets role cells;
// only the group-role cell may be signed for (profiles zome only).
const APPLET_A = encodeHashToBase64(new Uint8Array([10, 10, 10]));
const APPLET_B = encodeHashToBase64(new Uint8Array([20, 20, 20]));
const A_CELL = cellId([100]);
const B_CELL = cellId([200]);
const GROUP_CELL = cellId([1]);
const FOYER_CELL = cellId([2]);
const ASSETS_CELL = cellId([3]);
const FOREIGN_CELL = cellId([255]);

function apps(): AppInfo[] {
  return [
    { installed_app_id: appIdFromAppletId(APPLET_A), cell_info: { forum: [provisioned(A_CELL)] } },
    { installed_app_id: appIdFromAppletId(APPLET_B), cell_info: { forum: [provisioned(B_CELL)] } },
    {
      installed_app_id: 'group#seed#prog',
      cell_info: {
        group: [provisioned(GROUP_CELL)],
        foyer: [provisioned(FOYER_CELL)],
        assets: [provisioned(ASSETS_CELL)],
      },
    },
  ] as unknown as AppInfo[];
}

function req(id: CellId, zome_name: string): CallZomeRequest {
  return { cell_id: id, zome_name } as unknown as CallZomeRequest;
}

function makeAuthorizer() {
  let listAppsCalls = 0;
  const authorizer = new AppletZomeCallAuthorizer(async () => {
    listAppsCalls += 1;
    return apps();
  });
  return { authorizer, calls: () => listAppsCalls };
}

describe('AppletZomeCallAuthorizer', () => {
  it('signs an applet call to its own cell (any zome)', async () => {
    const { authorizer } = makeAuthorizer();
    expect(await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'))).toEqual({
      sign: true,
      reason: 'own-cell',
    });
  });

  it('signs a group-cell profiles call', async () => {
    const { authorizer } = makeAuthorizer();
    expect(await authorizer.authorize([APPLET_A], req(GROUP_CELL, 'profiles'))).toEqual({
      sign: true,
      reason: 'group-profiles',
    });
  });

  it('refuses a group-cell non-profiles zome (the core vulnerability)', async () => {
    const { authorizer } = makeAuthorizer();
    expect(await authorizer.authorize([APPLET_A], req(GROUP_CELL, 'group'))).toEqual({
      sign: false,
      reason: 'group-zome-not-allowed',
    });
  });

  it('refuses the group app foyer/assets cells (not the group role)', async () => {
    const { authorizer } = makeAuthorizer();
    expect((await authorizer.authorize([APPLET_A], req(FOYER_CELL, 'foyer'))).sign).toBe(false);
    expect((await authorizer.authorize([APPLET_A], req(ASSETS_CELL, 'assets'))).sign).toBe(false);
  });

  it('refuses another applet’s own cell', async () => {
    const { authorizer } = makeAuthorizer();
    expect(await authorizer.authorize([APPLET_A], req(B_CELL, 'posts'))).toEqual({
      sign: false,
      reason: 'unknown-cell',
    });
  });

  it('a cross-group caller may sign for any of its tool’s applets', async () => {
    const { authorizer } = makeAuthorizer();
    expect((await authorizer.authorize([APPLET_A, APPLET_B], req(B_CELL, 'posts'))).sign).toBe(true);
  });

  it('refuses a missing cell_id', async () => {
    const { authorizer } = makeAuthorizer();
    expect(await authorizer.authorize([APPLET_A], { zome_name: 'x' } as CallZomeRequest)).toEqual({
      sign: false,
      reason: 'unknown-cell',
    });
  });

  it('refreshes once on an unknown cell, but not on a known-cell refusal', async () => {
    const { authorizer, calls } = makeAuthorizer();
    // First call builds the cache (1) then, being unknown, refreshes once (2).
    await authorizer.authorize([APPLET_A], req(FOREIGN_CELL, 'x'));
    expect(calls()).toBe(2);
    // A group-zome refusal is not re-checked — a rebuild cannot flip it.
    await authorizer.authorize([APPLET_A], req(GROUP_CELL, 'group'));
    expect(calls()).toBe(2);
  });

  it('caches: an allowed call after the cache is warm does not re-list', async () => {
    const { authorizer, calls } = makeAuthorizer();
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(calls()).toBe(1);
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(calls()).toBe(1);
  });

  it('invalidate() forces a re-list on the next authorize', async () => {
    const { authorizer, calls } = makeAuthorizer();
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(calls()).toBe(1);
    authorizer.invalidate();
    await authorizer.authorize([APPLET_A], req(A_CELL, 'posts'));
    expect(calls()).toBe(2);
  });
});
