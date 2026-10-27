import { describe, expect, it } from 'vitest';
import { holochainBinaryName, holochainBinaryUrl } from './binarySource.js';

const mossConfig = { holochain: '0.7.1', binariesAppendix: 'moss-0.16' };
const stock = { version: '0.7.1' };
const fork = {
  version: '0.7.1',
  binarySources: {
    holochain: { binariesRepo: 'lightningrodlabs/holochain', binariesTag: 'holochain-0.7.1-mdns.7' },
  },
};

describe('holochainBinaryUrl', () => {
  it('downloads the stock release when no binary source is configured', () => {
    expect(holochainBinaryUrl(stock, mossConfig, 'x86_64-unknown-linux-gnu')).toBe(
      'https://github.com/holochain/holochain/releases/download/holochain-0.7.1/holochain-x86_64-unknown-linux-gnu',
    );
  });

  it('downloads the fork release the app runs when a binary source is configured', () => {
    expect(holochainBinaryUrl(fork, mossConfig, 'aarch64-apple-darwin')).toBe(
      'https://github.com/lightningrodlabs/holochain/releases/download/holochain-0.7.1-mdns.7/holochain-aarch64-apple-darwin',
    );
  });
});

describe('holochainBinaryName', () => {
  it('names the stock binary after the stock version', () => {
    expect(holochainBinaryName(stock, mossConfig, 'linux')).toBe(
      'holochain-v0.7.1-moss-0.16-wdocker',
    );
  });

  it('names a fork binary after its release, so a cached stock binary is not reused', () => {
    expect(holochainBinaryName(fork, mossConfig, 'linux')).toBe(
      'holochain-v0.7.1-mdns.7-moss-0.16-wdocker',
    );
  });

  it('adds the Windows suffix', () => {
    expect(holochainBinaryName(fork, mossConfig, 'win32')).toBe(
      'holochain-v0.7.1-mdns.7-moss-0.16-wdocker.exe',
    );
  });
});
