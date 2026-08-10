import { describe, it, expect } from 'vitest';
import { WEAVE_PROTOCOL_VERSION } from '@theweave/moss-types';
import { partialModifiersFromInviteString } from '@theweave/utils';
import { foreignVersionLinkMessage, inviteErrorMessage } from './invite-error.js';

const SEED = '0e1b4e0f-4e1e-4a4d-8c1e-0e6a3f2b7c11';
const PROGENITOR = 'uhCAkReDO1vypDyq42CVJoQmZiE3bF1uGIrIVpWgBVZw2HJ6YJ1y8';

const messageFor = (input: string): string => {
  try {
    partialModifiersFromInviteString(input);
  } catch (e) {
    return inviteErrorMessage(e);
  }
  throw new Error(`Expected ${input} to be rejected`);
};

describe('pasting an invite from an incompatible Moss version', () => {
  const legacyWebLink = `https://theweave.social/wal?weave-0.15://invite/${SEED}&progenitor=${PROGENITOR}`;
  const legacyDeepLink = `weave-0.15://invite/${SEED}&progenitor=${PROGENITOR}`;
  const legacyUnstewardedLink = `weave-0.15://invite/${SEED}&progenitor=null`;

  for (const [label, input] of [
    ['web forwarding link', legacyWebLink],
    ['bare deep link', legacyDeepLink],
    ['unstewarded group link', legacyUnstewardedLink],
  ] as const) {
    it(`explains that a 0.15 ${label} is for another Moss version`, () => {
      const message = messageFor(input);
      expect(message).toContain('Moss 0.15');
      expect(message).toContain(`Moss ${WEAVE_PROTOCOL_VERSION}`);
      // Not a bare "invalid link" — the user needs to know why it cannot work.
      expect(message.toLowerCase()).not.toMatch(/^invalid/);
    });
  }

  it('does not silently produce modifiers for a 0.15 link', () => {
    expect(() => partialModifiersFromInviteString(legacyWebLink)).toThrow();
  });

  it('explains a 0.15 invite code the same way', () => {
    const message = messageFor('moss-0.15-gaFzoTGhcMA');
    expect(message).toContain('Moss 0.15');
  });
});

describe('other invite failures', () => {
  it('tells the user what to paste when the input is not an invite', () => {
    expect(messageFor('https://example.com/some-page')).toMatch(/invite link or invite code/);
  });

  it('flags a damaged progenitor separately from a version problem', () => {
    const message = messageFor(
      `weave-${WEAVE_PROTOCOL_VERSION}://invite/${SEED}&progenitor=not-a-key`,
    );
    expect(message).toMatch(/damaged/);
  });

  it('falls back to a usable message for unexpected errors', () => {
    expect(inviteErrorMessage(new Error('boom'))).toMatch(/invite link or invite code/);
  });
});

/**
 * An asset link and an invite link from another Moss version fail for the same reason
 * but call for different actions. Asset links are shared inside a group far more often
 * than invites, so telling their recipient to "ask for an invite" is the common case.
 */
describe('links from another Moss version that are not invites', () => {
  it('does not tell the user to ask for an invite', () => {
    const message = foreignVersionLinkMessage('weave-0.15://hrl/uhC0kabc/uhCkkdef', '0.15');
    expect(message).not.toMatch(/invite/i);
    expect(message).toContain('Moss 0.15');
    expect(message).toContain(`Moss ${WEAVE_PROTOCOL_VERSION}`);
  });

  it('covers applet and group links too', () => {
    for (const link of ['weave-0.15://applet/uhCkkdef', 'weave-0.15://group/uhC0kabc']) {
      expect(foreignVersionLinkMessage(link, '0.15')).not.toMatch(/invite/i);
    }
  });

  it('still uses the invite wording for invite links', () => {
    const message = foreignVersionLinkMessage(
      `weave-0.15://invite/${SEED}&progenitor=${PROGENITOR}`,
      '0.15',
    );
    expect(message).toMatch(/invite/i);
    expect(message).toContain('Moss 0.15');
  });
});
