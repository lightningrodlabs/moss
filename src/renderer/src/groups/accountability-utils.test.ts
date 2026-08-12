import { describe, expect, it } from 'vitest';
import type { Accountability } from '@theweave/group-client';
import {
  amIPrivileged,
  canArchive,
  canDelegateSteward,
  myStewardPermissionHash,
} from './accountability-utils';

const hash = (fill: number) => new Uint8Array(39).fill(fill);
const progenitor: Accountability = { type: 'Progenitor' };
const member: Accountability = { type: 'Member' };
const steward = (permissionHash: Uint8Array, expiry?: number): Accountability => ({
  type: 'Steward',
  content: { permission_hash: permissionHash, permission: { for_agent: hash(9), expiry } },
});

describe('amIPrivileged', () => {
  it('is false for no accountabilities', () => expect(amIPrivileged([])).toBe(false));
  it('is false for member only', () => expect(amIPrivileged([member])).toBe(false));
  it('is true for a steward', () => expect(amIPrivileged([member, steward(hash(1))])).toBe(true));
  it('is true for the progenitor', () => expect(amIPrivileged([progenitor])).toBe(true));
});

describe('myStewardPermissionHash', () => {
  it('returns the first steward claim hash', () =>
    expect(myStewardPermissionHash([member, steward(hash(1)), steward(hash(2))])).toEqual(hash(1)));
  it('is undefined for the progenitor (progenitors hold no claim)', () =>
    expect(myStewardPermissionHash([progenitor])).toBeUndefined());
  it('is undefined for members', () => expect(myStewardPermissionHash([member])).toBeUndefined());
});

describe('canArchive', () => {
  it('allows the agent who added the tool', () =>
    expect(canArchive([member], hash(5), hash(5))).toBe(true));
  it('allows the progenitor', () => expect(canArchive([progenitor], hash(5), hash(6))).toBe(true));
  it('denies stewards who did not add the tool', () =>
    expect(canArchive([steward(hash(1))], hash(5), hash(6))).toBe(false));
  it('denies when addedBy is unknown and not privileged', () =>
    expect(canArchive([member], undefined, hash(6))).toBe(false));
});

describe('canDelegateSteward', () => {
  it('allows the progenitor', () => expect(canDelegateSteward([progenitor])).toBe(true));
  it('allows a permanent steward', () => expect(canDelegateSteward([steward(hash(1))])).toBe(true));
  it('denies an expiring steward', () =>
    expect(canDelegateSteward([steward(hash(1), 1754000000000000)])).toBe(false));
  it('denies members', () => expect(canDelegateSteward([member])).toBe(false));
});
