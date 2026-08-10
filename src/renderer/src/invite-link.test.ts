import { describe, it, expect } from 'vitest';
import { DnaModifiers } from '@holochain/client';
import { encode } from '@msgpack/msgpack';
import { partialModifiersFromInviteString } from '@theweave/utils';
import {
  modifiersToInviteCode,
  modifiersToInviteUrl,
  partialModifiersFromDnaModifiers,
} from './invite-link.js';

const SEED = '0e1b4e0f-4e1e-4a4d-8c1e-0e6a3f2b7c11';
const PROGENITOR = 'uhCAkReDO1vypDyq42CVJoQmZiE3bF1uGIrIVpWgBVZw2HJ6YJ1y8';

const dnaModifiers = (progenitor: string | null): DnaModifiers =>
  ({
    network_seed: SEED,
    properties: encode({ progenitor }),
  }) as unknown as DnaModifiers;

/**
 * The link and the code are the only things a user ever pastes, so what this produces
 * has to survive what the parser accepts. Testing them against hand-built strings only
 * would leave the two halves free to drift apart.
 */
describe.each([
  ['a stewarded group', PROGENITOR],
  ['an unstewarded group', null],
])('invites for %s', (_label, progenitor) => {
  const modifiers = dnaModifiers(progenitor);

  it('reads the join-relevant modifiers off the DNA modifiers', () => {
    expect(partialModifiersFromDnaModifiers(modifiers)).toEqual({
      networkSeed: SEED,
      progenitor,
    });
  });

  it('produces a link that parses back to the same group', () => {
    expect(partialModifiersFromInviteString(modifiersToInviteUrl(modifiers))).toEqual({
      networkSeed: SEED,
      progenitor,
    });
  });

  it('produces a code that parses back to the same group', () => {
    expect(partialModifiersFromInviteString(modifiersToInviteCode(modifiers))).toEqual({
      networkSeed: SEED,
      progenitor,
    });
  });

  it('produces a link and a code that describe the same group', () => {
    expect(partialModifiersFromInviteString(modifiersToInviteUrl(modifiers))).toEqual(
      partialModifiersFromInviteString(modifiersToInviteCode(modifiers)),
    );
  });
});

describe('invite link shape', () => {
  it('routes through the web page so recipients without Moss land somewhere useful', () => {
    expect(modifiersToInviteUrl(dnaModifiers(PROGENITOR))).toMatch(
      /^https:\/\/[^?]+\?weave-\d+\.\d+:\/\/invite\//,
    );
  });

  it('spells an absent progenitor as the literal the parser special-cases', () => {
    expect(modifiersToInviteUrl(dnaModifiers(null))).toContain('&progenitor=null');
  });

  it('survives a trailing comment appended by whoever pasted it', () => {
    const url = `${modifiersToInviteUrl(dnaModifiers(PROGENITOR))} — see you there!`;
    expect(partialModifiersFromInviteString(url)).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });
});

describe('invite code shape', () => {
  it('is not a URL, so link-hostile channels cannot mangle it', () => {
    const code = modifiersToInviteCode(dnaModifiers(PROGENITOR));
    expect(code).not.toContain('://');
    expect(code).not.toMatch(/\s/);
  });
});
