// Pure presentation logic for the on-demand audio availability check, kept
// out of the Lit element so it can be unit-tested without a DOM.

import type { AudioCapabilities } from '@theweave/moss-types';

export type AudioAvailabilityState =
  | { kind: 'unchecked' }
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: string | undefined }
  | {
      kind: 'available';
      backend: string;
      perApp: boolean;
      perAppReason: string | undefined;
      canExcludeSelf: boolean;
    };

export function audioAvailabilityState(input: {
  checking: boolean;
  capabilities: AudioCapabilities | undefined;
}): AudioAvailabilityState {
  if (input.checking) return { kind: 'checking' };
  const c = input.capabilities;
  if (!c) return { kind: 'unchecked' };
  if (!c.supported) return { kind: 'unavailable', reason: c.reason };
  return {
    kind: 'available',
    backend: c.backend,
    perApp: c.perApp,
    perAppReason: c.perApp ? undefined : c.reason,
    canExcludeSelf: c.canExcludeSelf,
  };
}
