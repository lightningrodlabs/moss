import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const readBuildConfigValue = (key: string): string => {
  const yml = fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf-8');
  const match = yml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) throw new Error(`electron-builder.yml has no top-level "${key}"`);
  return match[1];
};

/**
 * Moss versions with incompatible group DNAs are meant to be installed side by side, which
 * is why the package name and appId carry the breaking version. electron-builder derives
 * the deb's `/opt/<productName>` directory and the macOS `<productName>.app` bundle from
 * productName alone, so it has to carry the version too or the installs collide.
 */
describe('install location versioning', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  const breakingVersion = (packageJson.name as string).match(/-(\d+\.\d+)$/)?.[1];

  it('package.json name ends with the breaking version', () => {
    expect(breakingVersion).toBeDefined();
  });

  it('productName carries the breaking version', () => {
    expect(readBuildConfigValue('productName')).toBe(`Moss (${breakingVersion})`);
  });

  it('appId matches the package name', () => {
    expect(readBuildConfigValue('appId')).toBe(packageJson.name);
  });
});
