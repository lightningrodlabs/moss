import { describe, expect, it } from 'vitest';
import { InviteParseError, inviteCodeFromPartialModifiers } from '@theweave/utils';

import { describeJoinGroupError, shouldWarnAboutQuoting } from './inviteInput.js';

const SEED = '0e1b4e0f-4e1e-4a4d-8c1e-0e6a3f2b7c11';
const PROGENITOR = 'uhCAkReDO1vypDyq42CVJoQmZiE3bF1uGIrIVpWgBVZw2HJ6YJ1y8';

const inviteCode = () =>
  inviteCodeFromPartialModifiers({ networkSeed: SEED, progenitor: PROGENITOR });
const inviteLink = `weave-0.16://invite/${SEED}&progenitor=${PROGENITOR}`;

describe('shouldWarnAboutQuoting', () => {
  it('does not warn about an invite code, which never needs quoting', () => {
    expect(shouldWarnAboutQuoting(inviteCode())).toBe(false);
  });

  it('does not warn about a fully quoted invite link', () => {
    expect(shouldWarnAboutQuoting(inviteLink)).toBe(false);
  });

  it('warns about an invite link the shell truncated at the first &', () => {
    expect(shouldWarnAboutQuoting(inviteLink.split('&')[0])).toBe(true);
  });

  it('does not warn about input that is not a weave link at all', () => {
    expect(shouldWarnAboutQuoting('not-an-invite')).toBe(false);
  });
});

describe('describeJoinGroupError', () => {
  it('labels an invite parse failure with its machine-readable reason', () => {
    const error = new InviteParseError(
      'version-mismatch',
      'Invite code is for Moss 0.15 but this is Moss 0.16.',
      '0.15',
    );
    expect(describeJoinGroupError(error)).toBe(
      'invalid invite (version-mismatch): Invite code is for Moss 0.15 but this is Moss 0.16.',
    );
  });

  it('passes through the message of any other error', () => {
    expect(describeJoinGroupError(new Error('conductor not running'))).toBe(
      'conductor not running',
    );
  });

  it('stringifies a non-Error throw', () => {
    expect(describeJoinGroupError('boom')).toBe('boom');
  });
});
