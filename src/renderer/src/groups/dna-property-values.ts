import { decode } from '@msgpack/msgpack';
import yaml from 'js-yaml';
import type { AgentPubKeyB64 } from '@holochain/client';

/**
 * How a single DNA property value should be shown to a person: agent keys
 * become avatars, other holo hashes become copyable hashes, everything else is
 * plain text.
 */
export type PropertyDisplay =
  | { kind: 'agent'; key: AgentPubKeyB64 }
  | { kind: 'agentList'; keys: AgentPubKeyB64[] }
  | { kind: 'hash'; hash: string }
  | { kind: 'text'; text: string };

export type PropertyEntry = { key: string; value: PropertyDisplay };

export type RolePropertyRows = { role: string; entries: PropertyEntry[] };

const AGENT_KEY = /^uhCAk[A-Za-z0-9_-]{48}$/;
const HOLO_HASH = /^uhC[A-Za-z0-9_-]{50}$/;

export function isAgentKeyB64(value: unknown): value is AgentPubKeyB64 {
  return typeof value === 'string' && AGENT_KEY.test(value);
}

export function classifyPropertyValue(value: unknown): PropertyDisplay {
  if (isAgentKeyB64(value)) return { kind: 'agent', key: value };
  if (typeof value === 'string' && HOLO_HASH.test(value)) return { kind: 'hash', hash: value };
  if (Array.isArray(value) && value.length > 0 && value.every(isAgentKeyB64)) {
    return { kind: 'agentList', keys: value };
  }
  if (value === null || typeof value !== 'object') return { kind: 'text', text: String(value) };
  if (Array.isArray(value) && value.length === 0) return { kind: 'text', text: '[]' };
  return { kind: 'text', text: yaml.dump(value).trimEnd() };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeRoleProperties(roles: Record<string, Uint8Array>): RolePropertyRows[] {
  return Object.entries(roles).map(([role, bytes]) => {
    const decoded = decode(bytes);
    if (!isPlainObject(decoded)) {
      return { role, entries: [{ key: '', value: classifyPropertyValue(decoded) }] };
    }
    return {
      role,
      entries: Object.entries(decoded).map(([key, value]) => ({
        key,
        value: classifyPropertyValue(value),
      })),
    };
  });
}

/**
 * Whether there is anything worth showing: a role whose properties hold at
 * least one key, or a payload that is not an object at all.
 */
export function hasAnyProperties(roles: Record<string, Uint8Array>): boolean {
  return decodeRoleProperties(roles).some(({ entries }) => entries.length > 0);
}
