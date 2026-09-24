import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface BuildConfig {
  appId: string;
  productName: string;
  mac: { executableName?: string; extendInfo?: unknown };
  nsis: { shortcutName?: string; uninstallDisplayName?: string };
  linux: { desktop?: { Name?: string } };
}

const buildConfig = yaml.load(
  fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf-8'),
) as BuildConfig;
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const breakingVersion = (packageJson.name as string).match(/-(\d+\.\d+)$/)?.[1];
const versionedName = `moss-${breakingVersion}`;
const versionedLabel = `Moss ${breakingVersion}`;

/**
 * Moss versions with incompatible group DNAs are meant to be installed side by side, which
 * is why the package name and appId carry the breaking version. electron-builder derives
 * the deb's `/opt/<productName>` directory and the macOS `<executableName>.app` bundle
 * name from the build config, so those have to carry the version too or the installs
 * collide.
 */
describe('install location versioning', () => {
  it('package.json name ends with the breaking version', () => {
    expect(breakingVersion).toBeDefined();
  });

  it('productName carries the breaking version', () => {
    expect(buildConfig.productName).toBe(versionedName);
  });

  it('appId matches the package name', () => {
    expect(buildConfig.appId).toBe(packageJson.name);
  });

  it('the mac bundle name carries the breaking version independently of productName', () => {
    expect(buildConfig.mac.executableName).toBe(versionedName);
  });

  /**
   * productName doubles as a path segment, so it is a plain lowercase slug. The labels
   * people see in launchers and uninstall lists are set separately and keep the version
   * so that side-by-side installs can be told apart.
   */
  it('launcher and uninstall labels are readable and versioned', () => {
    expect(buildConfig.linux.desktop?.Name).toBe(versionedLabel);
    expect(buildConfig.nsis.shortcutName).toBe(versionedLabel);
    expect(buildConfig.nsis.uninstallDisplayName).toBe(versionedLabel);
  });

  /**
   * electron-builder copies extendInfo into Info.plist with Object.assign, so a YAML list
   * of single-key maps lands under the keys "0", "1", ... and the usage descriptions that
   * macOS requires for camera and microphone access never reach the plist.
   */
  it('mac Info.plist additions are a map of plist keys', () => {
    const extendInfo = buildConfig.mac.extendInfo;
    expect(Array.isArray(extendInfo)).toBe(false);
    expect(Object.keys(extendInfo as Record<string, unknown>)).toEqual(
      expect.arrayContaining([
        'NSCameraUsageDescription',
        'NSMicrophoneUsageDescription',
        'NSAudioCaptureUsageDescription',
      ]),
    );
  });

  /**
   * macOS shows productName in the menu bar and Electron locates its helper bundles by
   * it, so the version cannot be hidden there through Info.plist alone. The mac build
   * scripts override productName on the command line; the deb build must not.
   */
  describe('per-platform build scripts', () => {
    const scripts = packageJson.scripts as Record<string, string>;
    const buildScripts = Object.entries(scripts).filter(([, cmd]) =>
      cmd.includes('electron-builder --'),
    );

    it('mac builds present the app as plain Moss', () => {
      const macScripts = buildScripts.filter(([, cmd]) => cmd.includes('--mac'));
      expect(macScripts.length).toBeGreaterThan(0);
      for (const [, cmd] of macScripts) {
        expect(cmd).toContain('-c.productName=Moss');
      }
    });

    it('linux builds keep the versioned productName', () => {
      const linuxScripts = buildScripts.filter(([, cmd]) => cmd.includes('--linux'));
      expect(linuxScripts.length).toBeGreaterThan(0);
      for (const [, cmd] of linuxScripts) {
        expect(cmd).not.toContain('productName');
      }
    });
  });
});
