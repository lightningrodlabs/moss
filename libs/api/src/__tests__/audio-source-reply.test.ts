import { describe, expect, it } from 'vitest';

import {
  AudioSourceUnavailableError,
  deliveryFromAudioSourceReply,
  isAudioSourceUnavailableError,
} from '../audio-source-capture';

const port = {} as MessagePort;

describe('deliveryFromAudioSourceReply', () => {
  it('a grant with its port becomes a delivery', () => {
    const delivery = deliveryFromAudioSourceReply(
      { status: 'granted', label: 'System audio', canExcludeSelf: true },
      [port],
    );
    expect(delivery).toEqual({ label: 'System audio', canExcludeSelf: true, port });
  });

  it('a grant without a transferred port is a host error', () => {
    expect(() =>
      deliveryFromAudioSourceReply(
        { status: 'granted', label: 'System audio', canExcludeSelf: true },
        [],
      ),
    ).toThrow(/transferred no port/);
  });

  it('a cancel is null, so the Tool keeps its control', () => {
    expect(deliveryFromAudioSourceReply({ status: 'cancelled' }, [])).toBeNull();
  });

  it('a refusal throws a typed error carrying the host reason', () => {
    for (const reason of ['unsupported', 'disabled'] as const) {
      let caught: unknown;
      try {
        deliveryFromAudioSourceReply({ status: 'refused', reason }, []);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AudioSourceUnavailableError);
      expect((caught as AudioSourceUnavailableError).reason).toBe(reason);
      expect((caught as Error).message).toContain(reason);
    }
  });
});

describe('isAudioSourceUnavailableError', () => {
  it('recognises the error by shape, so a Tool bundling its own copy of this package still matches', () => {
    const foreign = Object.assign(new Error('The host cannot capture audio sources: disabled'), {
      name: 'AudioSourceUnavailableError',
      reason: 'disabled',
    });
    expect(isAudioSourceUnavailableError(foreign)).toBe(true);
    expect(isAudioSourceUnavailableError(new AudioSourceUnavailableError('unsupported'))).toBe(
      true,
    );
  });

  it('rejects other errors and non-errors', () => {
    expect(isAudioSourceUnavailableError(new Error('x'))).toBe(false);
    expect(isAudioSourceUnavailableError(null)).toBe(false);
    expect(
      isAudioSourceUnavailableError({ name: 'AudioSourceUnavailableError', reason: 'other' }),
    ).toBe(false);
  });
});
