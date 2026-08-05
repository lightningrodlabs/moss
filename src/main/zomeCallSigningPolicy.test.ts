import { describe, it, expect } from 'vitest';
import { decideZomeCallSignable, type ZomeCallSigningInput } from './zomeCallSigningPolicy';

const OWN_A = 'own-cell-a';
const OWN_B = 'own-cell-b';
const GROUP_1 = 'group-cell-1';
const GROUP_2 = 'group-cell-2';
const FOREIGN = 'some-other-cell';

function input(overrides: Partial<ZomeCallSigningInput>): ZomeCallSigningInput {
  return {
    cellIdB64: OWN_A,
    zomeName: 'posts',
    appletOwnCellIdsB64: new Set([OWN_A, OWN_B]),
    groupCellIdsB64: new Set([GROUP_1, GROUP_2]),
    ...overrides,
  };
}

describe('decideZomeCallSignable', () => {
  const rows: Array<{
    name: string;
    cellIdB64: string;
    zomeName: string;
    expected: ReturnType<typeof decideZomeCallSignable>;
  }> = [
    {
      name: 'own cell, any zome → sign',
      cellIdB64: OWN_A,
      zomeName: 'posts',
      expected: { sign: true, reason: 'own-cell' },
    },
    {
      name: 'second own cell, any zome → sign',
      cellIdB64: OWN_B,
      zomeName: 'whatever',
      expected: { sign: true, reason: 'own-cell' },
    },
    {
      name: 'own cell wins even for a zome named "profiles"',
      cellIdB64: OWN_A,
      zomeName: 'profiles',
      expected: { sign: true, reason: 'own-cell' },
    },
    {
      name: 'group cell + profiles zome → sign',
      cellIdB64: GROUP_1,
      zomeName: 'profiles',
      expected: { sign: true, reason: 'group-profiles' },
    },
    {
      name: 'any installed group cell + profiles → sign',
      cellIdB64: GROUP_2,
      zomeName: 'profiles',
      expected: { sign: true, reason: 'group-profiles' },
    },
    {
      name: 'group cell + group zome → REJECT (the core vulnerability)',
      cellIdB64: GROUP_1,
      zomeName: 'group',
      expected: { sign: false, reason: 'group-zome-not-allowed' },
    },
    {
      name: 'group cell + custom_views → REJECT',
      cellIdB64: GROUP_1,
      zomeName: 'custom_views',
      expected: { sign: false, reason: 'group-zome-not-allowed' },
    },
    {
      name: 'group cell + peer_status → REJECT (delivered via host events, not direct calls)',
      cellIdB64: GROUP_1,
      zomeName: 'peer_status',
      expected: { sign: false, reason: 'group-zome-not-allowed' },
    },
    {
      name: 'unknown cell + profiles → REJECT (only known group cells get the profiles allowance)',
      cellIdB64: FOREIGN,
      zomeName: 'profiles',
      expected: { sign: false, reason: 'unknown-cell' },
    },
    {
      name: 'unknown cell + arbitrary zome → REJECT',
      cellIdB64: FOREIGN,
      zomeName: 'group',
      expected: { sign: false, reason: 'unknown-cell' },
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      expect(
        decideZomeCallSignable(input({ cellIdB64: row.cellIdB64, zomeName: row.zomeName })),
      ).toEqual(row.expected);
    });
  }

  it('an applet with no resolved cells signs nothing', () => {
    expect(
      decideZomeCallSignable({
        cellIdB64: OWN_A,
        zomeName: 'posts',
        appletOwnCellIdsB64: new Set(),
        groupCellIdsB64: new Set(),
      }),
    ).toEqual({ sign: false, reason: 'unknown-cell' });
  });
});
