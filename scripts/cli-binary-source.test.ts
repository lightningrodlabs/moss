import { describe, expect, it } from 'vitest';
// @ts-ignore -- plain ESM module shipped in the cli package, no type declarations
import { binaryFilenameFor, binarySourceFor, binaryUrlFor } from '../cli/binary-source.mjs';
import { holochainBinaryName } from './binary-names.mjs';

const STOCK_CHECKSUMS = {
  holochain: {},
  'lair-keystore': {},
};

const FORK_CHECKSUMS = {
  binarySources: {
    holochain: {
      binariesRepo: 'lightningrodlabs/holochain',
      binariesTag: 'holochain-0.7.0-hello.2',
    },
    hc: {
      binariesRepo: 'lightningrodlabs/holochain',
      binariesTag: 'holochain-0.7.0-hello.2',
    },
  },
};

describe('binarySourceFor (cli)', () => {
  it('defaults to the stock holochain release for the version', () => {
    expect(binarySourceFor(STOCK_CHECKSUMS, 'holochain', '0.7.0')).toEqual({
      repo: 'holochain/holochain',
      tag: 'holochain-0.7.0',
    });
  });

  it('takes the repo and tag from a binarySources entry', () => {
    expect(binarySourceFor(FORK_CHECKSUMS, 'holochain', '0.7.0')).toEqual({
      repo: 'lightningrodlabs/holochain',
      tag: 'holochain-0.7.0-hello.2',
    });
  });

  it('keeps binaries without an entry on the stock release', () => {
    expect(binarySourceFor(FORK_CHECKSUMS, 'lair-keystore', '0.7.0')).toEqual({
      repo: 'holochain/holochain',
      tag: 'holochain-0.7.0',
    });
  });
});

describe('binaryUrlFor (cli)', () => {
  it('builds the release asset URL from the resolved source', () => {
    expect(binaryUrlFor(FORK_CHECKSUMS, 'holochain', '0.7.0', 'x86_64-unknown-linux-gnu')).toBe(
      'https://github.com/lightningrodlabs/holochain/releases/download/holochain-0.7.0-hello.2/holochain-x86_64-unknown-linux-gnu',
    );
    expect(
      binaryUrlFor(FORK_CHECKSUMS, 'kitsune2-bootstrap-srv', '0.7.0', 'x86_64-unknown-linux-gnu'),
    ).toBe(
      'https://github.com/holochain/holochain/releases/download/holochain-0.7.0/kitsune2-bootstrap-srv-x86_64-unknown-linux-gnu',
    );
  });
});

describe('binaryFilenameFor (cli)', () => {
  const MOSS_CONFIG = { holochain: '0.7.0' };
  const BINARIES = ['holochain', 'lair-keystore', 'kitsune2-bootstrap-srv'];

  it('names a fork binary after its release tag', () => {
    expect(binaryFilenameFor(FORK_CHECKSUMS, MOSS_CONFIG, 'holochain', 'linux')).toBe(
      'holochain-v0.7.0-hello.2',
    );
  });

  it('names a stock binary after the holochain version', () => {
    expect(binaryFilenameFor(FORK_CHECKSUMS, MOSS_CONFIG, 'lair-keystore', 'linux')).toBe(
      'lair-keystore-v0.7.0',
    );
  });

  it('names a separately pinned bootstrap server after its own version', () => {
    const config = { ...MOSS_CONFIG, kitsune2BootstrapSrv: '0.5.1' };
    expect(binaryFilenameFor(STOCK_CHECKSUMS, config, 'kitsune2-bootstrap-srv', 'win32')).toBe(
      'kitsune2-bootstrap-srv-v0.5.1.exe',
    );
  });

  // The app looks binaries up by the names scripts/binary-names.mjs gives them,
  // so the cli must save every binary under exactly that name.
  for (const checksums of [STOCK_CHECKSUMS, FORK_CHECKSUMS]) {
    for (const config of [MOSS_CONFIG, { ...MOSS_CONFIG, kitsune2BootstrapSrv: '0.5.1' }]) {
      for (const platform of ['linux', 'win32'] as const) {
        it(`matches the app's name for every binary (${platform}, ${checksums === FORK_CHECKSUMS ? 'fork' : 'stock'}, ${config.kitsune2BootstrapSrv ?? 'no k2 pin'})`, () => {
          const appConfig = { ...config, binarySources: (checksums as any).binarySources };
          for (const binary of BINARIES) {
            expect(binaryFilenameFor(checksums, config, binary, platform)).toBe(
              holochainBinaryName(binary, appConfig, platform),
            );
          }
        });
      }
    }
  }
});
