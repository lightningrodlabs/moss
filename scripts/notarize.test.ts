import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'notarize.js'),
  'utf-8',
);

/**
 * Notarization must be requested for the bundle identifier that electron-builder wrote
 * into Info.plist. A literal appId in this script silently goes stale on every breaking
 * version bump.
 */
describe('notarize hook', () => {
  it('takes the bundle identifier from the packager rather than a literal', () => {
    expect(source).not.toMatch(/org\.lightningrodlabs\.moss/);
    expect(source).toContain('params.packager.appInfo.macBundleIdentifier');
  });
});
