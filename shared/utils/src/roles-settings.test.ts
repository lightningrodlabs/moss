import { describe, it, expect } from 'vitest';
import { encode } from '@msgpack/msgpack';
import { rolesSettingsFor } from './utils.js';

describe('rolesSettingsFor', () => {
  it('turns each role\'s encoded properties into provisioned role settings', () => {
    const properties = { stewarded: true, stewards: ['uhCAk1'] };
    const settings = rolesSettingsFor({ rVines: encode(properties) });
    expect(settings).toEqual({
      rVines: { type: 'provisioned', value: { modifiers: { properties } } },
    });
  });

  it('yields no settings for no properties', () => {
    expect(rolesSettingsFor({})).toEqual({});
  });
});
