import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLanDiscoverySetting, writeLanDiscoverySetting } from './lanDiscoverySetting';

describe('LAN discovery setting', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-lan-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('reads as unset when nothing has been saved', () => {
    expect(readLanDiscoverySetting(configDir)).toBeUndefined();
  });

  it('reads back what was written', () => {
    writeLanDiscoverySetting(configDir, true);
    expect(readLanDiscoverySetting(configDir)).toBe(true);
    writeLanDiscoverySetting(configDir, false);
    expect(readLanDiscoverySetting(configDir)).toBe(false);
  });

  it('creates the config directory if it does not exist yet', () => {
    const nested = path.join(configDir, 'profile', 'config');
    writeLanDiscoverySetting(nested, true);
    expect(readLanDiscoverySetting(nested)).toBe(true);
  });

  it('reads a corrupt or mistyped file as unset rather than failing startup', () => {
    const file = path.join(configDir, 'lan-discovery.json');
    fs.writeFileSync(file, '{not json', 'utf-8');
    expect(readLanDiscoverySetting(configDir)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ enabled: 'yes' }), 'utf-8');
    expect(readLanDiscoverySetting(configDir)).toBeUndefined();
  });
});
