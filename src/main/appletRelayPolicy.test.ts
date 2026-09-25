import { describe, expect, it } from 'vitest';

import { relayTimeoutMs } from './appletRelayPolicy';

describe('relayTimeoutMs', () => {
  it('bounds ordinary cross-window requests', () => {
    expect(relayTimeoutMs('get-record-info')).toBe(60_000);
    expect(relayTimeoutMs('open-view')).toBe(60_000);
  });

  it('never times out a request that waits on the user in a native dialog', () => {
    // The consent dialog is modal and always resolves, so a deadline would
    // only create a session that no caller owns.
    expect(relayTimeoutMs('asr-open-session')).toBeNull();
  });
});
