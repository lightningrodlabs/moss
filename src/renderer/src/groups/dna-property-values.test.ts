import { describe, it, expect } from 'vitest';
import { encode } from '@msgpack/msgpack';
import {
  classifyPropertyValue,
  decodeRoleProperties,
  hasAnyProperties,
} from './dna-property-values.js';

const AGENT_A = 'uhCAkQi3Vlzs6idIzWBmxcMU9zk12RsK3EqlPrLy_6eIHKJWK3dfe';
const AGENT_B = 'uhCAkxuzIMhvAMy1IUPwI6abbEdrPPXTtD4F_yOLSiqNDBcZv7hvA';
const DNA = 'uhC0komLr9MdDgaK9AbeeaJzNboew39xE-rbl8C-PUEW9qzhxR5-m';

describe('classifyPropertyValue', () => {
  it('recognises a base64 agent key', () => {
    expect(classifyPropertyValue(AGENT_A)).toEqual({ kind: 'agent', key: AGENT_A });
  });

  it('recognises a list made only of agent keys', () => {
    expect(classifyPropertyValue([AGENT_A, AGENT_B])).toEqual({
      kind: 'agentList',
      keys: [AGENT_A, AGENT_B],
    });
  });

  it('treats an empty list as text, not an agent list', () => {
    expect(classifyPropertyValue([])).toEqual({ kind: 'text', text: '[]' });
  });

  it('recognises other holo hashes as copyable hashes', () => {
    expect(classifyPropertyValue(DNA)).toEqual({ kind: 'hash', hash: DNA });
  });

  it('renders scalars and null as text', () => {
    expect(classifyPropertyValue(false)).toEqual({ kind: 'text', text: 'false' });
    expect(classifyPropertyValue(100)).toEqual({ kind: 'text', text: '100' });
    expect(classifyPropertyValue('dark')).toEqual({ kind: 'text', text: 'dark' });
    expect(classifyPropertyValue(null)).toEqual({ kind: 'text', text: 'null' });
  });

  it('renders nested values as yaml text', () => {
    expect(classifyPropertyValue({ a: 1, b: [AGENT_A] })).toEqual({
      kind: 'text',
      text: `a: 1\nb:\n  - ${AGENT_A}`,
    });
  });

  it('does not mistake a key-shaped string of the wrong length for an agent', () => {
    expect(classifyPropertyValue('uhCAkshort')).toEqual({ kind: 'text', text: 'uhCAkshort' });
  });
});

describe('decodeRoleProperties', () => {
  it('decodes msgpack properties per role into key/value rows', () => {
    const roles = {
      forum: encode({ invalid: false, moderators: [AGENT_A] }),
      other: encode({}),
    };
    expect(decodeRoleProperties(roles)).toEqual([
      {
        role: 'forum',
        entries: [
          { key: 'invalid', value: { kind: 'text', text: 'false' } },
          { key: 'moderators', value: { kind: 'agentList', keys: [AGENT_A] } },
        ],
      },
      { role: 'other', entries: [] },
    ]);
  });

  it('shows a non-object payload as a single text row', () => {
    expect(decodeRoleProperties({ r: encode(null) })).toEqual([
      { role: 'r', entries: [{ key: '', value: { kind: 'text', text: 'null' } }] },
    ]);
  });
});

describe('hasAnyProperties', () => {
  it('is false for an applet with no roles', () => {
    expect(hasAnyProperties({})).toBe(false);
  });

  it('is false when every role decodes to an empty object', () => {
    expect(hasAnyProperties({ a: encode({}), b: encode({}) })).toBe(false);
  });

  it('is true when any role holds a key', () => {
    expect(hasAnyProperties({ a: encode({}), b: encode({ invalid: false }) })).toBe(true);
  });

  it('is true for a non-object payload', () => {
    expect(hasAnyProperties({ a: encode(7) })).toBe(true);
  });
});
