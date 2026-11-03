import { describe, it, expect } from 'vitest';
import { decode } from '@msgpack/msgpack';
import { encodeRoleOverrides } from './devProperties';

const defaults = { forum: { invalid: false }, other: { x: 1 } };

describe('encodeRoleOverrides', () => {
  it('merges an override over the manifest defaults for its role', () => {
    const encoded = encodeRoleOverrides(defaults, { forum: { stewarded: true } });
    expect(decode(encoded.forum)).toEqual({ invalid: false, stewarded: true });
  });

  it('yields nothing without overrides', () => {
    expect(encodeRoleOverrides(defaults, undefined)).toEqual({});
  });

  it('leaves out roles that have no override', () => {
    const encoded = encodeRoleOverrides(defaults, { forum: { invalid: true } });
    expect(Object.keys(encoded)).toEqual(['forum']);
  });
});
