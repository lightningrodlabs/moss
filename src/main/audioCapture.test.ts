import { describe, it, expect, vi } from 'vitest';
import {
  AudioCaptureBackend,
  backendNameFor,
  loadAudioCapture,
  probeAudioCapabilities,
  probeAudioSupport,
} from './audioCapture';

const okBackend = (): AudioCaptureBackend => ({
  devices: () => [],
  processes: async () => [],
  openStream: () => {
    throw new Error('not opened in this test');
  },
});

describe('backendNameFor', () => {
  it.each([
    ['linux', 'pipewire'],
    ['darwin', 'coreaudio'],
    ['win32', 'wasapi'],
    ['freebsd', 'none'],
  ] as const)('%s → %s', (platform, expected) => {
    expect(backendNameFor(platform)).toBe(expected);
  });
});

describe('loadAudioCapture', () => {
  it('returns undefined when the addon cannot be required', () => {
    const failing = () => {
      throw new Error('libpipewire-0.3.so.0: cannot open shared object file');
    };
    expect(loadAudioCapture(failing)).toBeUndefined();
  });

  it('returns the module when require succeeds', () => {
    const mod = okBackend();
    expect(loadAudioCapture(() => mod)).toBe(mod);
  });
});

describe('probeAudioCapabilities', () => {
  it('no addon → unsupported with reason', async () => {
    expect(await probeAudioCapabilities(undefined, 'linux')).toEqual({
      supported: false,
      perApp: false,
      canExcludeSelf: false,
      backend: 'pipewire',
      reason: 'addon-unavailable',
    });
  });

  it('devices() throwing → unsupported with the error text', async () => {
    const backend = {
      ...okBackend(),
      devices: () => {
        throw new Error('no pipewire session');
      },
    };
    const caps = await probeAudioCapabilities(backend, 'linux');
    expect(caps.supported).toBe(false);
    expect(caps.reason).toBe('no pipewire session');
  });

  it('processes() rejecting → supported but not perApp', async () => {
    const backend = {
      ...okBackend(),
      processes: async () => {
        throw new Error('unsupported OS version');
      },
    };
    expect(await probeAudioCapabilities(backend, 'win32')).toEqual({
      supported: true,
      perApp: false,
      canExcludeSelf: true,
      backend: 'wasapi',
      reason: 'unsupported OS version',
    });
  });

  it('everything answering → fully capable, no reason', async () => {
    expect(await probeAudioCapabilities(okBackend(), 'darwin')).toEqual({
      supported: true,
      perApp: true,
      canExcludeSelf: true,
      backend: 'coreaudio',
    });
  });

  it('an empty processes() list is still perApp (nothing is playing, not unsupported)', async () => {
    const caps = await probeAudioCapabilities(okBackend(), 'linux');
    expect(caps.perApp).toBe(true);
  });
});

describe('probeAudioSupport', () => {
  it('returns the process list alongside the capabilities', async () => {
    const processList = [{ pid: 3, name: 'Firefox', isOutputActive: true }];
    const backend = { ...okBackend(), processes: async () => processList };
    const out = await probeAudioSupport(backend, 'linux');
    expect(out.processes).toEqual(processList);
    expect(out.capabilities).toEqual({
      supported: true,
      perApp: true,
      canExcludeSelf: true,
      backend: 'pipewire',
    });
  });

  it('processes() rejecting → no list and no perApp', async () => {
    const backend = {
      ...okBackend(),
      processes: async () => {
        throw new Error('unsupported OS version');
      },
    };
    const out = await probeAudioSupport(backend, 'win32');
    expect(out.processes).toEqual([]);
    expect(out.capabilities.perApp).toBe(false);
  });

  it('no addon → no list, unsupported', async () => {
    const out = await probeAudioSupport(undefined, 'linux');
    expect(out.processes).toEqual([]);
    expect(out.capabilities.supported).toBe(false);
  });

  it('devices() throwing → no list, and processes() is never asked', async () => {
    const processes = vi.fn(async () => []);
    const backend = {
      ...okBackend(),
      devices: () => {
        throw new Error('no pipewire session');
      },
      processes,
    };
    const out = await probeAudioSupport(backend, 'linux');
    expect(out.processes).toEqual([]);
    expect(processes).not.toHaveBeenCalled();
  });
});
