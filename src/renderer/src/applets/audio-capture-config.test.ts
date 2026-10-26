import { describe, it, expect } from 'vitest';
import { audioCaptureAvailable } from './audio-capture-config';
import type { AudioCapabilities } from '@theweave/moss-types';

const caps = (supported: boolean): AudioCapabilities => ({
  supported,
  perApp: supported,
  canExcludeSelf: supported,
  backend: 'pipewire',
  reason: supported ? undefined : 'addon-unavailable',
});

describe('audioCaptureAvailable', () => {
  it('switch on: reports the probe’s supported flag', async () => {
    expect(await audioCaptureAvailable(() => true, async () => caps(true))).toBe(true);
    expect(await audioCaptureAvailable(() => true, async () => caps(false))).toBe(false);
  });

  it('switch off: unavailable without probing, even on a supported host', async () => {
    let probed = 0;
    const result = await audioCaptureAvailable(
      () => false,
      async () => {
        probed += 1;
        return caps(true);
      },
    );
    expect(result).toBe(false);
    expect(probed).toBe(0);
  });

  it('a probe that throws reads as unavailable and is warned about, never thrown', async () => {
    const warnings: string[] = [];
    const result = await audioCaptureAvailable(
      () => true,
      async () => {
        throw new Error('ipc gone');
      },
      (m) => warnings.push(m),
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ipc gone');
  });
});
