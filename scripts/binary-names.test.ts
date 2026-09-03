import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import url from 'node:url';

import {
  binaryVersionFor,
  holochainBinaryName,
  versionedBinaryName,
  type BinaryNameConfig,
} from './binary-names.mjs';

const STOCK: BinaryNameConfig = { holochain: '0.7.0' };
const FORK: BinaryNameConfig = { holochain: '0.7.0', holochainBinaryTag: '0.7.0-mdns.0' };

describe('holochainBinaryName', () => {
  it('uses the plain holochain version when no fork tag is configured', () => {
    expect(holochainBinaryName('holochain', STOCK, 'linux')).toBe('holochain-v0.7.0');
    expect(holochainBinaryName('hc', STOCK, 'linux')).toBe('hc-v0.7.0');
  });

  it('uses the fork tag for holochain and hc when one is configured', () => {
    expect(holochainBinaryName('holochain', FORK, 'linux')).toBe('holochain-v0.7.0-mdns.0');
    expect(holochainBinaryName('hc', FORK, 'linux')).toBe('hc-v0.7.0-mdns.0');
  });

  it('keeps the stock holochain version for the unpatched binaries', () => {
    expect(holochainBinaryName('lair-keystore', FORK, 'linux')).toBe('lair-keystore-v0.7.0');
    expect(holochainBinaryName('kitsune2-bootstrap-srv', FORK, 'linux')).toBe(
      'kitsune2-bootstrap-srv-v0.7.0',
    );
  });

  it('appends .exe on win32', () => {
    expect(holochainBinaryName('holochain', FORK, 'win32')).toBe('holochain-v0.7.0-mdns.0.exe');
    expect(holochainBinaryName('holochain', STOCK, 'win32')).toBe('holochain-v0.7.0.exe');
    expect(holochainBinaryName('lair-keystore', FORK, 'win32')).toBe('lair-keystore-v0.7.0.exe');
  });
});

describe('binaryVersionFor', () => {
  it('exposes the version separately so callers can apply their own override', () => {
    expect(binaryVersionFor('holochain', FORK)).toBe('0.7.0-mdns.0');
    expect(binaryVersionFor('hc', FORK)).toBe('0.7.0-mdns.0');
    expect(binaryVersionFor('lair-keystore', FORK)).toBe('0.7.0');
    expect(binaryVersionFor('holochain', STOCK)).toBe('0.7.0');
  });

  it('composes with versionedBinaryName the way callers with an override do', () => {
    expect(versionedBinaryName('kitsune2-bootstrap-srv', '0.7.1', 'linux')).toBe(
      'kitsune2-bootstrap-srv-v0.7.1',
    );
  });
});

describe('the checked-in moss.config.json', () => {
  const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const mossConfig: BinaryNameConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'moss.config.json'), 'utf-8'),
  );

  it('names the unpatched binaries after the holochain version', () => {
    expect(holochainBinaryName('lair-keystore', mossConfig, 'linux')).toBe(
      `lair-keystore-v${mossConfig.holochain}`,
    );
  });

  it('names holochain after the configured binary tag, if there is one', () => {
    const expected = mossConfig.holochainBinaryTag ?? mossConfig.holochain;
    expect(holochainBinaryName('holochain', mossConfig, 'linux')).toBe(`holochain-v${expected}`);
    expect(holochainBinaryName('hc', mossConfig, 'linux')).toBe(`hc-v${expected}`);
  });
});
