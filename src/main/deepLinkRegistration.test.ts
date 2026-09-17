import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { registerDeepLinkSchemes, UrlSchemeRegistry } from './deepLinkRegistration';

const fakeRegistry = (): UrlSchemeRegistry & {
  setAsDefaultProtocolClient: ReturnType<typeof vi.fn>;
  removeAsDefaultProtocolClient: ReturnType<typeof vi.fn>;
} => ({
  setAsDefaultProtocolClient: vi.fn(() => true),
  removeAsDefaultProtocolClient: vi.fn(() => true),
});

const packaged = (platform: NodeJS.Platform) => ({
  platform,
  scheme: 'weave-0.16',
  supersededSchemes: ['weave-0.15'],
  defaultApp: false,
  execPath: '/opt/Moss (0.16)/moss',
  argv: ['/opt/Moss (0.16)/moss'],
});

describe('registerDeepLinkSchemes', () => {
  it('claims the current scheme on macOS and Windows', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const registry = fakeRegistry();
      registerDeepLinkSchemes(registry, packaged(platform));
      expect(registry.setAsDefaultProtocolClient).toHaveBeenCalledWith('weave-0.16');
    }
  });

  it('releases superseded schemes on macOS and Windows', () => {
    const registry = fakeRegistry();
    registerDeepLinkSchemes(registry, packaged('darwin'));
    expect(registry.removeAsDefaultProtocolClient).toHaveBeenCalledWith('weave-0.15');
  });

  it('never calls into the OS registry on Linux, where the claim would take over text/html', () => {
    const registry = fakeRegistry();
    registerDeepLinkSchemes(registry, packaged('linux'));
    expect(registry.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(registry.removeAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it('points an unpackaged run at the script it was started with', () => {
    const registry = fakeRegistry();
    registerDeepLinkSchemes(registry, {
      ...packaged('darwin'),
      defaultApp: true,
      execPath: '/usr/bin/electron',
      argv: ['/usr/bin/electron', 'out/main/index.js'],
    });
    expect(registry.setAsDefaultProtocolClient).toHaveBeenCalledWith(
      'weave-0.16',
      '/usr/bin/electron',
      [path.resolve('out/main/index.js')],
    );
  });

  it('keeps going when releasing a superseded scheme throws', () => {
    const registry = fakeRegistry();
    registry.removeAsDefaultProtocolClient.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => registerDeepLinkSchemes(registry, packaged('darwin'))).not.toThrow();
  });
});
