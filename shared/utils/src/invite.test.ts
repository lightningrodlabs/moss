import { describe, it, expect } from 'vitest';
import { WEAVE_PROTOCOL_VERSION } from '@theweave/moss-types';
import { encode } from '@msgpack/msgpack';
import { Base64 } from 'js-base64';
import {
  InviteParseError,
  isWeaveUrl,
  isInviteLink,
  inviteCodeFromPartialModifiers,
  invitePropsToPartialModifiers,
  looksLikeInviteCode,
  partialModifiersFromInviteCode,
  partialModifiersFromInviteLink,
  partialModifiersFromInviteString,
  weaveLinkVersion,
} from './invite.js';

const SEED = '0e1b4e0f-4e1e-4a4d-8c1e-0e6a3f2b7c11';
const PROGENITOR = 'uhCAkReDO1vypDyq42CVJoQmZiE3bF1uGIrIVpWgBVZw2HJ6YJ1y8';

const link = (version: string, seed = SEED, progenitor: string = PROGENITOR) =>
  `weave-${version}://invite/${seed}&progenitor=${progenitor}`;

const webLink = (version: string, seed = SEED, progenitor: string = PROGENITOR) =>
  `https://theweave.social/wal?${link(version, seed, progenitor)}`;

/**
 * The group DNA changed between 0.15 and 0.16, so joining with a 0.15 seed would
 * produce a group that looks joined but can never find its peers. Every entry point
 * must refuse it with a reason the UI can explain.
 */
describe('invite links from an incompatible Moss version', () => {
  const expectVersionMismatch = (fn: () => unknown, foundVersion: string) => {
    let thrown: unknown;
    try {
      fn();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InviteParseError);
    expect((thrown as InviteParseError).reason).toBe('version-mismatch');
    expect((thrown as InviteParseError).foundVersion).toBe(foundVersion);
  };

  it('rejects a bare 0.15 deep link', () => {
    expectVersionMismatch(() => partialModifiersFromInviteLink(link('0.15')), '0.15');
  });

  it('rejects a 0.15 web forwarding link', () => {
    expectVersionMismatch(() => partialModifiersFromInviteLink(webLink('0.15')), '0.15');
  });

  it('rejects a 0.15 link pasted into the combined link-or-code field', () => {
    expectVersionMismatch(() => partialModifiersFromInviteString(webLink('0.15')), '0.15');
  });

  it('rejects links from older and newer versions alike', () => {
    expectVersionMismatch(() => partialModifiersFromInviteString(link('0.12')), '0.12');
    expectVersionMismatch(() => partialModifiersFromInviteString(link('0.17')), '0.17');
  });

  it('rejects a 0.15 invite for an unstewarded group', () => {
    expectVersionMismatch(
      () => partialModifiersFromInviteString(link('0.15', SEED, 'null')),
      '0.15',
    );
  });

  it('rejects an invite code from another version', () => {
    const foreignCode = inviteCodeFromPartialModifiers({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    }).replace(`moss-${WEAVE_PROTOCOL_VERSION}-`, 'moss-0.15-');
    expectVersionMismatch(() => partialModifiersFromInviteString(foreignCode), '0.15');
  });

  it('reports the found version in the error message', () => {
    expect(() => partialModifiersFromInviteLink(link('0.15'))).toThrowError(/0\.15/);
  });
});

/**
 * Link handlers route on this rather than on the current version's prefix. If it only
 * matched the current version, a foreign-version link clicked inside an applet would
 * match no branch at all and fail as a navigation, with nothing shown to the user.
 */
describe('isWeaveUrl', () => {
  it('matches weave URLs of any protocol version', () => {
    expect(isWeaveUrl(link('0.15'))).toBe(true);
    expect(isWeaveUrl(link(WEAVE_PROTOCOL_VERSION))).toBe(true);
    expect(isWeaveUrl('weave-0.12://hrl/uhC0kabc/uhCkkdef')).toBe(true);
    expect(isWeaveUrl('weave-1.0://applet/uhCkkdef')).toBe(true);
  });

  it('does not match other schemes or a weave URL embedded in a web link', () => {
    expect(isWeaveUrl('https://example.com')).toBe(false);
    expect(isWeaveUrl('mailto:someone@example.com')).toBe(false);
    expect(isWeaveUrl(webLink(WEAVE_PROTOCOL_VERSION))).toBe(false);
    expect(isWeaveUrl('')).toBe(false);
  });
});

describe('isInviteLink', () => {
  it('separates invites from links to other things', () => {
    expect(isInviteLink(link('0.15'))).toBe(true);
    expect(isInviteLink(webLink(WEAVE_PROTOCOL_VERSION))).toBe(true);
    expect(isInviteLink(`weave-0.15://hrl/uhC0kabc/uhCkkdef`)).toBe(false);
    expect(isInviteLink(`weave-0.15://applet/uhCkkdef`)).toBe(false);
    expect(isInviteLink(`weave-0.15://group/uhC0kabc`)).toBe(false);
    expect(isInviteLink('https://example.com')).toBe(false);
  });
});

describe('weaveLinkVersion', () => {
  it('reads the version off both link forms', () => {
    expect(weaveLinkVersion(link('0.15'))).toBe('0.15');
    expect(weaveLinkVersion(webLink('0.16'))).toBe('0.16');
    expect(weaveLinkVersion(`weave-0.15://hrl/uhC0kabc/uhCkkdef`)).toBe('0.15');
  });

  it('attributes even a payload-less weave URL to its version', () => {
    expect(weaveLinkVersion('weave-0.15://')).toBe('0.15');
  });

  it('is undefined for non-weave input', () => {
    expect(weaveLinkVersion('https://example.com')).toBe(undefined);
    expect(weaveLinkVersion('')).toBe(undefined);
  });
});

describe('partialModifiersFromInviteLink', () => {
  it('parses a current-version bare link', () => {
    expect(partialModifiersFromInviteLink(link(WEAVE_PROTOCOL_VERSION))).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });

  it('parses a current-version web forwarding link', () => {
    expect(partialModifiersFromInviteLink(webLink(WEAVE_PROTOCOL_VERSION))).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });

  it('parses an unstewarded group invite', () => {
    expect(partialModifiersFromInviteLink(link(WEAVE_PROTOCOL_VERSION, SEED, 'null'))).toEqual({
      networkSeed: SEED,
      progenitor: null,
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(partialModifiersFromInviteLink(`  ${webLink(WEAVE_PROTOCOL_VERSION)}\n`)).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });

  it('rejects a non-invite weave link', () => {
    expect(() =>
      partialModifiersFromInviteLink(`weave-${WEAVE_PROTOCOL_VERSION}://hrl/uhC0kabc/uhCkkdef`),
    ).toThrowError(InviteParseError);
  });

  it('rejects input that is not a weave link at all', () => {
    expect(() => partialModifiersFromInviteLink('https://example.com/hello')).toThrowError(
      InviteParseError,
    );
  });

  it('ignores text appended after the link', () => {
    expect(
      partialModifiersFromInviteLink(`${webLink(WEAVE_PROTOCOL_VERSION)} — see you there!`),
    ).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });

  it.each([
    ['wrapped in parentheses', '(', ')'],
    ['wrapped in angle brackets', '<', '>'],
    ['followed by a comma', '', ','],
    ['ending a sentence', '', '.'],
  ])('parses a link copied out of prose, %s', (_label, prefix, suffix) => {
    for (const progenitor of [PROGENITOR, 'null']) {
      const pasted = `${prefix}${link(WEAVE_PROTOCOL_VERSION, SEED, progenitor)}${suffix}`;
      expect(partialModifiersFromInviteLink(pasted)).toEqual({
        networkSeed: SEED,
        progenitor: progenitor === 'null' ? null : progenitor,
      });
    }
  });

  /**
   * A key that happens to begin with "null" must not be truncated to the unstewarded
   * literal: that would join the wrong variant of the seed, which looks joined and
   * never finds peers -- the exact failure this version gating exists to prevent.
   */
  it.each(['nullXYZ', 'nullish', 'nulluhCAkReDO1vypDyq42CVJoQmZiE3bF1uGIrIVpWgBVZw2HJ6YJ1y'])(
    'rejects a corrupt progenitor beginning with null (%s) instead of reading it as unstewarded',
    (progenitor) => {
      let thrown: unknown;
      try {
        partialModifiersFromInviteLink(link(WEAVE_PROTOCOL_VERSION, SEED, progenitor));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(InviteParseError);
      expect((thrown as InviteParseError).reason).toBe('invalid-progenitor');
    },
  );

  it('still reads a bare null as unstewarded, with or without trailing punctuation', () => {
    for (const suffix of ['', ')', '.', ',', '>']) {
      expect(
        partialModifiersFromInviteLink(`${link(WEAVE_PROTOCOL_VERSION, SEED, 'null')}${suffix}`)
          .progenitor,
      ).toBe(null);
    }
  });

  it('rejects a bad progenitor key', () => {
    let thrown: unknown;
    try {
      partialModifiersFromInviteLink(link(WEAVE_PROTOCOL_VERSION, SEED, 'not-an-agent-key'));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as InviteParseError).reason).toBe('invalid-progenitor');
  });
});

describe('invite codes', () => {
  it('round-trips a stewarded group', () => {
    const modifiers = { networkSeed: SEED, progenitor: PROGENITOR };
    expect(partialModifiersFromInviteCode(inviteCodeFromPartialModifiers(modifiers))).toEqual(
      modifiers,
    );
  });

  it('round-trips an unstewarded group', () => {
    const modifiers = { networkSeed: SEED, progenitor: null };
    expect(partialModifiersFromInviteCode(inviteCodeFromPartialModifiers(modifiers))).toEqual(
      modifiers,
    );
  });

  it('round-trips through the combined link-or-code entry point', () => {
    const modifiers = { networkSeed: SEED, progenitor: null };
    expect(partialModifiersFromInviteString(inviteCodeFromPartialModifiers(modifiers))).toEqual(
      modifiers,
    );
  });

  it('is not a URL and carries the protocol version up front', () => {
    const code = inviteCodeFromPartialModifiers({ networkSeed: SEED, progenitor: PROGENITOR });
    expect(code.startsWith(`moss-${WEAVE_PROTOCOL_VERSION}-`)).toBe(true);
    expect(code).not.toContain('://');
    expect(code).not.toContain(' ');
  });

  it('survives whitespace introduced by chat clients', () => {
    const code = inviteCodeFromPartialModifiers({ networkSeed: SEED, progenitor: PROGENITOR });
    const wrapped = ` ${code.slice(0, 20)}\n${code.slice(20)} `;
    expect(partialModifiersFromInviteCode(wrapped)).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });

  it('rejects a truncated code instead of producing partial modifiers', () => {
    const code = inviteCodeFromPartialModifiers({ networkSeed: SEED, progenitor: PROGENITOR });
    expect(() => partialModifiersFromInviteCode(code.slice(0, code.length - 12))).toThrowError(
      InviteParseError,
    );
  });

  it('refuses to make a code from an invalid progenitor, rather than deferring the failure', () => {
    let thrown: unknown;
    try {
      inviteCodeFromPartialModifiers({ networkSeed: SEED, progenitor: 'not-an-agent-key' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InviteParseError);
    expect((thrown as InviteParseError).reason).toBe('invalid-progenitor');
  });

  it('only ever throws InviteParseError, whatever the payload decodes to', () => {
    // A well-formed code whose payload carries a progenitor of the wrong type.
    const bogus = `moss-${WEAVE_PROTOCOL_VERSION}-${Base64.fromUint8Array(
      encode({ s: SEED, p: 'not-bytes' }),
      true,
    )}`;
    let thrown: unknown;
    try {
      partialModifiersFromInviteCode(bogus);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InviteParseError);
  });

  it('recognizes invite codes by shape, including foreign versions', () => {
    expect(
      looksLikeInviteCode(inviteCodeFromPartialModifiers({ networkSeed: SEED, progenitor: null })),
    ).toBe(true);
    expect(looksLikeInviteCode('moss-0.15-AAAA')).toBe(true);
    expect(looksLikeInviteCode(webLink(WEAVE_PROTOCOL_VERSION))).toBe(false);
    expect(looksLikeInviteCode('')).toBe(false);
  });
});

describe('invitePropsToPartialModifiers', () => {
  it('parses the props of a deep link', () => {
    expect(invitePropsToPartialModifiers(`${SEED}&progenitor=${PROGENITOR}`)).toEqual({
      networkSeed: SEED,
      progenitor: PROGENITOR,
    });
  });

  it('parses null progenitor', () => {
    expect(invitePropsToPartialModifiers(`${SEED}&progenitor=null`)).toEqual({
      networkSeed: SEED,
      progenitor: null,
    });
  });

  it('rejects props without a progenitor segment', () => {
    let thrown: unknown;
    try {
      invitePropsToPartialModifiers(SEED);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as InviteParseError).reason).toBe('invalid-progenitor');
  });
});
