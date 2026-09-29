import { describe, expect, it } from 'vitest';
import { composeAdvancedSettings, type AdvancedSettings } from './conductorNetworkConfig';

const PACKAGED_MDNS_ON = { isPackaged: true, mdnsEnabled: true };
const PACKAGED_MDNS_OFF = { isPackaged: true, mdnsEnabled: false };

describe('composeAdvancedSettings', () => {
  it('turns both halves of LAN discovery on when mDNS is enabled', () => {
    const advanced = composeAdvancedSettings(undefined, PACKAGED_MDNS_ON);
    expect(advanced.mdnsBootstrap).toEqual({ enabled: true });
    expect(advanced.irohTransport?.enableLanDiscovery).toBe(true);
  });

  it('writes both halves off explicitly when mDNS is disabled', () => {
    // Not merely absent: the config is read back on the next launch, so a node
    // that ran with mDNS on must be switched off by an explicit false.
    const advanced = composeAdvancedSettings(undefined, PACKAGED_MDNS_OFF);
    expect(advanced.mdnsBootstrap).toEqual({ enabled: false });
    expect(advanced.irohTransport?.enableLanDiscovery).toBe(false);
  });

  it('switches a previously enabled config back off', () => {
    const previous: AdvancedSettings = {
      mdnsBootstrap: { enabled: true },
      irohTransport: { enableLanDiscovery: true },
    };
    const advanced = composeAdvancedSettings(previous, PACKAGED_MDNS_OFF);
    expect(advanced.mdnsBootstrap?.enabled).toBe(false);
    expect(advanced.irohTransport?.enableLanDiscovery).toBe(false);
  });

  it('preserves iroh transport keys it does not own', () => {
    // The config comes back from YAML, so it can carry kitsune2 module keys Moss
    // has no type for. The cast is how a test states that.
    const previous = {
      irohTransport: { someOtherKitsuneKey: 'keep me', enableLanDiscovery: false },
    } as AdvancedSettings;
    const advanced = composeAdvancedSettings(previous, PACKAGED_MDNS_ON);
    expect(advanced.irohTransport).toEqual({
      someOtherKitsuneKey: 'keep me',
      enableLanDiscovery: true,
    });
  });

  it('preserves unrelated advanced settings', () => {
    const previous: AdvancedSettings = { someOtherModule: { tuning: 1 } };
    const advanced = composeAdvancedSettings(previous, PACKAGED_MDNS_ON);
    expect(advanced.someOtherModule).toEqual({ tuning: 1 });
  });

  it('does not mutate the settings it was given', () => {
    const previous: AdvancedSettings = { irohTransport: { enableLanDiscovery: false } };
    composeAdvancedSettings(previous, PACKAGED_MDNS_ON);
    expect(previous).toEqual({ irohTransport: { enableLanDiscovery: false } });
  });

  it('allows plain-text relays only in a dev build', () => {
    expect(
      composeAdvancedSettings(undefined, { isPackaged: false, mdnsEnabled: true }).irohTransport
        ?.relayAllowPlainText,
    ).toBe(true);
    expect(
      composeAdvancedSettings(undefined, PACKAGED_MDNS_ON).irohTransport?.relayAllowPlainText,
    ).toBeUndefined();
  });

  it('keeps the bootstrap and space tuning Moss relies on', () => {
    const advanced = composeAdvancedSettings(undefined, PACKAGED_MDNS_ON);
    expect(advanced.coreBootstrap).toEqual({ backoffMaxMs: 30000 });
    expect(advanced.coreSpace).toEqual({ reSignExpireTimeMs: 30000, reSignFreqMs: 30000 });
  });
});
