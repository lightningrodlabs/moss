import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SUPERSEDED_URL_SCHEMES,
  WEAVE_PROTOCOL_VERSION,
  WEAVE_URL_PREFIX,
  WEAVE_URL_SCHEME,
} from '@theweave/moss-types';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The scheme the OS registers comes from electron-builder.yml, which cannot import the
 * constant the rest of the code derives its links from. If they drift, deep links are
 * handed to an app that does not listen for them.
 */
describe('deep link scheme registration', () => {
  /**
   * Every weave scheme mentioned anywhere in the file, so that a scheme cannot hide
   * behind a blank line or a restructured protocols block.
   */
  const schemesInBuildConfig = (): string[] => {
    const yml = fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf-8');
    const withoutComments = yml.replace(/#.*$/gm, '');
    return Array.from(new Set(withoutComments.match(/weave-\d+\.\d+/g) ?? []));
  };

  it('electron-builder.yml declares exactly this version scheme', () => {
    expect(schemesInBuildConfig()).toEqual([WEAVE_URL_SCHEME]);
  });

  it('does not declare a scheme that belongs to another Moss version', () => {
    for (const superseded of SUPERSEDED_URL_SCHEMES) {
      expect(schemesInBuildConfig()).not.toContain(superseded);
    }
  });

  it('never lists the current scheme as superseded, which would release it on startup', () => {
    expect(SUPERSEDED_URL_SCHEMES).not.toContain(WEAVE_URL_SCHEME);
  });

  it('derives scheme and prefix from the protocol version', () => {
    expect(WEAVE_URL_SCHEME).toBe(`weave-${WEAVE_PROTOCOL_VERSION}`);
    expect(WEAVE_URL_PREFIX).toBe(`weave-${WEAVE_PROTOCOL_VERSION}://`);
  });
});
