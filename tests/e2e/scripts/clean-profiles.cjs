#!/usr/bin/env node
/**
 * Wipes accumulated E2E test profile data.
 *
 * Cleans two locations:
 *   1. `<repo>/test-results-e2e/profiles/` — the isolated tree where current
 *      tests write (everything goes).
 *   2. `~/.config/org.lightningrodlabs.moss-0.15/0.15.x/pw-*` — orphaned dirs
 *      from old test runs that wrote into the user's config tree before we
 *      switched to --user-data-dir isolation. Only `pw-*` prefixed entries are
 *      removed — the user's real profiles (`default`, custom `--profile X`
 *      runs, etc.) are left alone.
 *
 * why: the test fixture intentionally keeps profile dirs around after each
 * test so logs are inspectable on failure (see tests/e2e/fixtures/moss.ts).
 * That accumulates, so we want an explicit cleanup the developer can run.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const profilesRoot = path.join(repoRoot, 'test-results-e2e', 'profiles');
const userConfigRoot = path.join(
  os.homedir(),
  '.config',
  'org.lightningrodlabs.moss-0.15',
  '0.15.x',
);

let cleanedAny = false;

// 1. Clean the isolated tree wholesale.
if (fs.existsSync(profilesRoot)) {
  const entries = fs.readdirSync(profilesRoot);
  if (entries.length > 0) {
    console.log(`Removing ${entries.length} dir(s) under ${profilesRoot}:`);
    for (const entry of entries) console.log(`  - ${entry}`);
    fs.rmSync(profilesRoot, { recursive: true, force: true });
    fs.mkdirSync(profilesRoot, { recursive: true });
    cleanedAny = true;
  }
}

// 2. Clean orphan pw-* entries from the user config (one-time migration cleanup).
if (fs.existsSync(userConfigRoot)) {
  const orphans = fs
    .readdirSync(userConfigRoot)
    .filter((name) => name.startsWith('pw-'));
  if (orphans.length > 0) {
    console.log(`Removing ${orphans.length} orphan test dir(s) under ${userConfigRoot}:`);
    for (const entry of orphans) {
      console.log(`  - ${entry}`);
      fs.rmSync(path.join(userConfigRoot, entry), { recursive: true, force: true });
    }
    cleanedAny = true;
  }
}

if (!cleanedAny) {
  console.log('Nothing to clean.');
}
