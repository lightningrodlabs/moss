import { describe, expect, it } from 'vitest';

import {
  binaryReleaseTag,
  exeSuffix,
  holochainBinaryName,
  type BinaryNameConfig,
} from './binary-names.mjs';

/** No binarySources at all: every binary comes from the stock release. */
const STOCK: BinaryNameConfig = { holochain: '0.7.0' };

/** holochain and hc repointed at a fork release, the rest left stock. */
const FORK: BinaryNameConfig = {
  holochain: '0.7.0',
  binarySources: {
    holochain: {
      binariesRepo: 'lightningrodlabs/holochain',
      binariesTag: 'holochain-0.7.0-mdns.0',
    },
    hc: { binariesRepo: 'lightningrodlabs/holochain', binariesTag: 'holochain-0.7.0-mdns.0' },
  },
};

/** kitsune2-bootstrap-srv is released on its own cadence. */
const BOOTSTRAP_SRV_OVERRIDE: BinaryNameConfig = {
  holochain: '0.7.0',
  kitsune2BootstrapSrv: '0.7.1',
};

describe('holochainBinaryName', () => {
  it('uses the holochain version when the binary has no fork source', () => {
    expect(holochainBinaryName('holochain', STOCK, 'linux')).toBe('holochain-v0.7.0');
    expect(holochainBinaryName('hc', STOCK, 'linux')).toBe('hc-v0.7.0');
    expect(holochainBinaryName('lair-keystore', STOCK, 'linux')).toBe('lair-keystore-v0.7.0');
    expect(holochainBinaryName('kitsune2-bootstrap-srv', STOCK, 'linux')).toBe(
      'kitsune2-bootstrap-srv-v0.7.0',
    );
  });

  it('uses the fork release tag for the binaries that have one', () => {
    expect(holochainBinaryName('holochain', FORK, 'linux')).toBe('holochain-v0.7.0-mdns.0');
    expect(holochainBinaryName('hc', FORK, 'linux')).toBe('hc-v0.7.0-mdns.0');
  });

  it('keeps the stock holochain version for binaries with no fork source', () => {
    expect(holochainBinaryName('lair-keystore', FORK, 'linux')).toBe('lair-keystore-v0.7.0');
    expect(holochainBinaryName('kitsune2-bootstrap-srv', FORK, 'linux')).toBe(
      'kitsune2-bootstrap-srv-v0.7.0',
    );
  });

  it('applies the kitsune2-bootstrap-srv version override to that binary alone', () => {
    expect(holochainBinaryName('kitsune2-bootstrap-srv', BOOTSTRAP_SRV_OVERRIDE, 'linux')).toBe(
      'kitsune2-bootstrap-srv-v0.7.1',
    );
    expect(holochainBinaryName('holochain', BOOTSTRAP_SRV_OVERRIDE, 'linux')).toBe(
      'holochain-v0.7.0',
    );
  });

  it('appends .exe on win32', () => {
    expect(holochainBinaryName('holochain', FORK, 'win32')).toBe('holochain-v0.7.0-mdns.0.exe');
    expect(holochainBinaryName('holochain', STOCK, 'win32')).toBe('holochain-v0.7.0.exe');
    expect(holochainBinaryName('lair-keystore', FORK, 'win32')).toBe('lair-keystore-v0.7.0.exe');
  });
});

describe('binaryReleaseTag', () => {
  it('is the stock release tag for a binary with no fork source', () => {
    expect(binaryReleaseTag('holochain', STOCK)).toBe('holochain-0.7.0');
    expect(binaryReleaseTag('lair-keystore', FORK)).toBe('holochain-0.7.0');
  });

  it('is the configured fork tag where there is one', () => {
    expect(binaryReleaseTag('holochain', FORK)).toBe('holochain-0.7.0-mdns.0');
    expect(binaryReleaseTag('hc', FORK)).toBe('holochain-0.7.0-mdns.0');
  });

  it('follows the kitsune2-bootstrap-srv version override', () => {
    expect(binaryReleaseTag('kitsune2-bootstrap-srv', BOOTSTRAP_SRV_OVERRIDE)).toBe(
      'holochain-0.7.1',
    );
  });
});

describe('exeSuffix', () => {
  it('is .exe on win32 and empty everywhere else', () => {
    expect(exeSuffix('win32')).toBe('.exe');
    expect(exeSuffix('linux')).toBe('');
    expect(exeSuffix('darwin')).toBe('');
  });
});
