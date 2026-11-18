import { describe, expect, it } from 'vitest';

import type { AudioCapabilities } from '@theweave/moss-types';

import { audioAvailabilityState } from './audio-availability-state.js';

const SUPPORTED: AudioCapabilities = {
  supported: true,
  perApp: true,
  canExcludeSelf: true,
  backend: 'pipewire',
};

describe('audioAvailabilityState', () => {
  it('offers the check and nothing else before anyone asks', () => {
    expect(audioAvailabilityState({ checking: false, capabilities: undefined })).toEqual({
      kind: 'unchecked',
    });
  });

  it('reports a check in progress', () => {
    expect(audioAvailabilityState({ checking: true, capabilities: undefined })).toEqual({
      kind: 'checking',
    });
  });

  it('reports an unsupported host with the reason', () => {
    expect(
      audioAvailabilityState({
        checking: false,
        capabilities: {
          ...SUPPORTED,
          supported: false,
          perApp: false,
          reason: 'addon-unavailable',
        },
      }),
    ).toEqual({ kind: 'unavailable', reason: 'addon-unavailable' });
  });

  it('reports a supported host with its capabilities', () => {
    expect(audioAvailabilityState({ checking: false, capabilities: SUPPORTED })).toEqual({
      kind: 'available',
      backend: 'pipewire',
      perApp: true,
      perAppReason: undefined,
      canExcludeSelf: true,
    });
  });

  it('carries the per-app reason when only system capture works', () => {
    expect(
      audioAvailabilityState({
        checking: false,
        capabilities: { ...SUPPORTED, perApp: false, reason: 'timed out' },
      }),
    ).toMatchObject({ kind: 'available', perApp: false, perAppReason: 'timed out' });
  });
});
