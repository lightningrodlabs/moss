import { describe, expect, it } from 'vitest';
// @ts-ignore -- plain ESM module shipped in the cli package, no type declarations
import { binarySourceFor, binaryUrlFor } from '../cli/binary-source.mjs';

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
