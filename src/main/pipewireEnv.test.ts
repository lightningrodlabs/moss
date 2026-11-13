import { describe, expect, it } from 'vitest';
import { pipewireClientConfigEnv } from './pipewireEnv';

describe('pipewireClientConfigEnv', () => {
  it('on Linux, points every in-process PipeWire client at the plain client configuration', () => {
    expect(pipewireClientConfigEnv({}, 'linux')).toEqual({ PIPEWIRE_CONFIG_NAME: 'client.conf' });
  });

  it('keeps a configuration name the user already set', () => {
    expect(pipewireClientConfigEnv({ PIPEWIRE_CONFIG_NAME: 'mine.conf' }, 'linux')).toEqual({});
  });

  it('sets nothing off Linux', () => {
    expect(pipewireClientConfigEnv({}, 'darwin')).toEqual({});
    expect(pipewireClientConfigEnv({}, 'win32')).toEqual({});
  });
});
