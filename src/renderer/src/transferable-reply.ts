import type { AudioSourceRequestReply } from '@theweave/api';
import type { AudioSourceGrantOutcome } from './audio-sources/grants-client.js';

/**
 * A handler result that must be posted with a transfer list. Only
 * `request-audio-sources` produces one; every other reply stays a plain value.
 */
export class TransferableReply<T = unknown> {
  constructor(
    public readonly result: T,
    public readonly transfer: Transferable[],
  ) {}
}

/**
 * The reply a Tool's `request-audio-sources` gets. A grant travels with its
 * port in the transfer list; a cancel or refusal is a plain value.
 */
export function audioSourceReply(
  outcome: AudioSourceGrantOutcome,
): AudioSourceRequestReply | TransferableReply<AudioSourceRequestReply> {
  if (outcome.status !== 'granted') return outcome;
  return new TransferableReply<AudioSourceRequestReply>(
    {
      status: 'granted',
      label: outcome.result.label,
      canExcludeSelf: outcome.result.canExcludeSelf,
    },
    [outcome.port],
  );
}
