import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Playwright global setup: ensure the example-applet webhapp the tool-curation
 * fixture serves is current before any test runs.
 *
 * why: smoke #4/#5 install `example/workdir/example-applet.webhapp` and assert
 * against the applet's DOM (e.g. the `[data-weave-ready]` handshake marker).
 * The fixture only checks the file *exists* — so a webhapp built before a
 * change to `example/ui` silently serves stale UI, and #5 fails as an
 * inscrutable handshake timeout rather than a clear "rebuild me" error.
 *
 * CI rebuilds the webhapp in a dedicated step, so there this is a no-op. The
 * case this guards is a local `yarn test:e2e` against a stale checkout.
 *
 * Staleness is an mtime comparison against the example applet's own sources
 * (UI + forum DNA). It does not track the `@theweave/*` libs the UI bundles —
 * if those change, rebuild manually with `yarn build:example-applet`.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEBHAPP = path.join(REPO_ROOT, 'example', 'workdir', 'example-applet.webhapp');
const SOURCE_PATHS = [
  path.join(REPO_ROOT, 'example', 'ui', 'src'),
  path.join(REPO_ROOT, 'example', 'ui', 'index.html'),
  path.join(REPO_ROOT, 'example', 'ui', 'package.json'),
  path.join(REPO_ROOT, 'example', 'dnas'),
];

/** Newest mtime (ms) found at `target`, recursing into directories. 0 if absent. */
function newestMtime(target: string): number {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(target)
    .reduce((newest, entry) => Math.max(newest, newestMtime(path.join(target, entry))), 0);
}

export default function globalSetup(): void {
  const webhappMtime = fs.existsSync(WEBHAPP) ? fs.statSync(WEBHAPP).mtimeMs : 0;
  const newestSource = SOURCE_PATHS.reduce((newest, p) => Math.max(newest, newestMtime(p)), 0);

  if (webhappMtime > newestSource) {
    // eslint-disable-next-line no-console
    console.log('[e2e:global-setup] example-applet.webhapp is up to date.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[e2e:global-setup] example-applet.webhapp is ${
      webhappMtime === 0 ? 'missing' : 'stale'
    } — running \`yarn build:example-applet\` (this is slow the first time)...`,
  );
  execSync('yarn build:example-applet', { cwd: REPO_ROOT, stdio: 'inherit' });
}
