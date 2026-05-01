import { test as base, _electron as electron, Page, ElectronApplication } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

export type LaunchOptions = {
  /**
   * Logical name for this launch. Used as the directory name under
   * `<repo>/test-results-e2e/profiles/`. Does NOT become Moss's `--profile`
   * value — see `mossProfile` for that.
   *
   * why: isolation between tests/agents is provided by `userDataDir`, not
   * Moss's profile name. Keeping the logical test name separate from Moss's
   * profile name lets us relaunch against the same userDataDir without having
   * to thread Moss's profile string through the test.
   */
  profileName: string;
  /**
   * Absolute path to use as Electron's userData root, passed via --user-data-dir.
   * If omitted, a dir is created at `<repo>/test-results-e2e/profiles/<profileName>/`.
   *
   * why: tests must NOT share the user's real Moss data dir
   * (~/.config/org.lightningrodlabs.moss-0.15/) — that would risk corrupting
   * actual user profiles and would let `findLegacyProfiles()` pick up test
   * artifacts. Each test gets its own isolated tree.
   *
   * Pass an explicit `userDataDir` to relaunch against an existing dir
   * (smoke #8 relaunch persistence).
   */
  userDataDir?: string;
  /**
   * Moss CLI --profile value. Defaults to `'e2e'`. Constant by default so
   * relaunches against the same userDataDir find the same Moss profile subdir.
   * Override for niche scenarios; rarely needed.
   */
  mossProfile?: string;
  /** Extra CLI args appended after --profile. */
  extraArgs?: string[];
  /** Extra env vars merged into the child process. */
  env?: Record<string, string>;
  /** ms to wait for the admin window to appear after launch. */
  adminWindowTimeoutMs?: number;
};

export type LaunchedMoss = {
  app: ElectronApplication;
  /** The main "admin" window. Splashscreen is filtered out. */
  mainWindow: Page;
  /**
   * The userData root passed to Electron. Real on-disk profile data lives at
   * `<userDataDir>/<breakingAppVersion>/<profileName>/`. Kept after the test
   * runs so logs are inspectable on failure; clean en masse with
   * `yarn test:e2e:clean`.
   */
  userDataDir: string;
};

/** Repo-local root for all test profile dirs. Gitignored. */
export const E2E_PROFILES_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'test-results-e2e',
  'profiles',
);

/**
 * Resolve the repo root and verify the built artifact exists. We hand the
 * repo root (not the absolute main.js path) to Electron so that
 * `app.getAppPath()` resolves correctly — moss.config.json and
 * holochain-checksums.json are read relative to it.
 */
function resolveRepoRoot(): string {
  // tests/e2e/fixtures → repo root
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const main = path.join(repoRoot, 'out', 'main', 'index.js');
  if (!fs.existsSync(main)) {
    throw new Error(
      `Moss main entry not found at ${main}. Run \`yarn build\` before \`yarn test:e2e\`.`,
    );
  }
  return repoRoot;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export async function launchMoss(opts: LaunchOptions): Promise<LaunchedMoss> {
  const repoRoot = resolveRepoRoot();
  const userDataDir = opts.userDataDir ?? path.join(E2E_PROFILES_ROOT, opts.profileName);
  ensureDir(userDataDir);

  // why: pass the repo root (not the absolute main.js path) so app.getAppPath()
  // resolves to a directory containing moss.config.json + holochain-checksums.json,
  // matching what `yarn start` (electron-vite preview → `electron .`) does.
  // --user-data-dir is an Electron built-in flag that overrides app.getPath('userData')
  // before any user code runs, so Moss's filesystem.ts roots its profile tree
  // inside our isolated test dir instead of ~/.config/org.lightningrodlabs.moss-0.15/.
  const mossProfile = opts.mossProfile ?? 'e2e';
  const args = [
    repoRoot,
    `--user-data-dir=${userDataDir}`,
    '--profile',
    mossProfile,
    ...(opts.extraArgs ?? []),
  ];

  // why: if these are set in the user's shell (some devs set ELECTRON_RUN_AS_NODE=1
  // for ad-hoc scripting), Electron launches as plain Node and the main-process
  // API is unavailable, surfacing as `electron.app.isPackaged` undefined errors
  // far away from the root cause. Strip them unconditionally for a deterministic env.
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  Object.assign(env, opts.env ?? {});
  env.NODE_ENV = env.NODE_ENV ?? 'production';

  // why: pass the resolved electron binary explicitly. Yarn workspaces hoist
  // electron to the repo root; Playwright's auto-resolution sometimes picks
  // a stale path. Resolving against the repo root is deterministic.
  const electronPath = require(path.join(repoRoot, 'node_modules', 'electron')) as string;

  if (process.env.MOSS_E2E_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(
      `[moss-fixture] electronPath=${electronPath} repoRoot=${repoRoot} ` +
        `ELECTRON_RUN_AS_NODE=${env.ELECTRON_RUN_AS_NODE ?? '<unset>'} ` +
        `args=${JSON.stringify(args)}`,
    );
  }

  const app = await electron.launch({
    executablePath: electronPath,
    args,
    env,
    timeout: 90_000,
  });

  // why: surface main-process stdio when debugging. Otherwise a crash inside
  // Holochain init looks like "no windows ever opened" with no clue. Off by
  // default so green runs are quiet.
  if (process.env.MOSS_E2E_DEBUG) {
    const child = app.process();
    child.stdout?.on('data', (d) =>
      process.stdout.write(`[moss:${opts.profileName}:out] ${d}`),
    );
    child.stderr?.on('data', (d) =>
      process.stderr.write(`[moss:${opts.profileName}:err] ${d}`),
    );
  }

  const mainWindow = await waitForAdminWindow(app, opts.adminWindowTimeoutMs ?? 60_000);
  return { app, mainWindow, userDataDir };
}

/**
 * Moss opens a splashscreen window first; the admin window comes up later when
 * the renderer loads index.html. We pick the window whose URL ends in /index.html
 * (or contains 'admin.renderer'), ignoring splashscreen.html.
 */
async function waitForAdminWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const u = w.url();
      if (u.includes('admin.renderer') || /\/index\.html(?:\?|#|$)/.test(u)) {
        return w;
      }
    }
    await new Promise((r) => {
      const onWindow = () => {
        app.off('window', onWindow);
        r(undefined);
      };
      app.on('window', onWindow);
      // Don't block forever — re-check at least every 500ms in case of races.
      setTimeout(() => {
        app.off('window', onWindow);
        r(undefined);
      }, 500);
    });
  }
  throw new Error(
    `Admin window did not appear within ${timeoutMs}ms. Open windows: ${app
      .windows()
      .map((w) => w.url())
      .join(', ')}`,
  );
}

export type SecondAgentFactory = (
  overrides?: Partial<LaunchOptions>,
) => Promise<LaunchedMoss>;

type MossFixtures = {
  moss: LaunchedMoss;
  secondAgent: SecondAgentFactory;
};

/**
 * Use this `test` instead of the bare Playwright one. It gives you:
 *   - `moss`: a launched Moss instance with an isolated userDataDir under
 *     `<repo>/test-results-e2e/profiles/`. Closed (gracefully) at end of test;
 *     the profile dir is intentionally NOT deleted so logs are inspectable.
 *   - `secondAgent(opts?)`: launches an additional Moss instance (different
 *     profile + dir), tracked for close at end of test. For multi-agent tests
 *     (smoke #9 etc.).
 *
 * Holochain ports are auto-allocated by Moss via `get-port`, so multiple agents
 * coexist on one machine without manual port offsets.
 *
 * To wipe accumulated test profile data: `yarn test:e2e:clean`.
 */
export const test = base.extend<MossFixtures>({
  moss: async ({}, use, testInfo) => {
    const profileName = `pw-${sanitize(testInfo.title)}-${testInfo.workerIndex}-${Date.now()}`;
    const launched = await launchMoss({ profileName });
    try {
      await use(launched);
    } finally {
      await closeMoss(launched);
    }
  },
  secondAgent: async ({}, use, testInfo) => {
    const launched: LaunchedMoss[] = [];
    const factory: SecondAgentFactory = async (overrides) => {
      const profileName =
        overrides?.profileName ??
        `pw-${sanitize(testInfo.title)}-2-${testInfo.workerIndex}-${Date.now()}`;
      const second = await launchMoss({ ...(overrides ?? {}), profileName });
      launched.push(second);
      return second;
    };
    try {
      await use(factory);
    } finally {
      for (const l of launched) {
        await closeMoss(l);
      }
    }
  },
});

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'test';
}

/**
 * Close a launched Moss instance and wait for all of its child processes
 * (lair-keystore, holochain) to actually exit.
 *
 * why: it isn't enough to call `app.close()` and move on. lair and conductor
 * are spawned as children of the Electron main process; when Electron dies,
 * they get reparented to init, so `descendants(electronPid)` afterwards finds
 * nothing. The reparented processes can keep holding lair sockets / conductor
 * DB locks for a few seconds, which makes a quick relaunch (smoke #8) fail.
 *
 * Capture the descendant pid set BEFORE close, then poll `/proc` until each
 * pid is gone. Bounded wait so a stuck child doesn't deadlock the suite.
 */
export async function closeMoss(launched: LaunchedMoss): Promise<void> {
  let descendants: number[] = [];
  try {
    const electronPid = launched.app.process().pid;
    if (electronPid) descendants = collectDescendants(electronPid);
  } catch {
    // pid may already be gone
  }

  try {
    await launched.app.evaluate(({ app }) => app.quit());
  } catch {
    // app may already be detached / dead — fall through to force close
  }
  try {
    await launched.app.close();
  } catch {
    // already exiting
  }

  // Force-kill any of the captured descendants that didn't exit on quit.
  for (const pid of descendants) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }

  // Poll until everything is actually gone or 5s elapses.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const stillAlive = descendants.filter((p) => fs.existsSync(`/proc/${p}`));
    if (stillAlive.length === 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  // why: deliberately keep userDataDir on disk after the test. Logs in
  // `<userDataDir>/<version>/<profile>/logs/` are useful for debugging real
  // failures; tests run against an isolated repo-local tree, not the user's
  // real Moss data. Run `yarn test:e2e:clean` to wipe accumulated test data.
}

/**
 * Walk /proc and return all transitive descendants of `rootPid`. Linux-only
 * by plan.
 */
function collectDescendants(rootPid: number): number[] {
  try {
    const all = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
    const parentMap = new Map<number, number>();
    for (const p of all) {
      try {
        const stat = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
        // Format: pid (comm) state ppid ...
        const m = stat.match(/\)\s+\S+\s+(\d+)/);
        if (m) parentMap.set(p, Number(m[1]));
      } catch {
        // process gone or perms — skip
      }
    }
    const descendants: number[] = [];
    const queue = [rootPid];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [child, parent] of parentMap.entries()) {
        if (parent === cur) {
          descendants.push(child);
          queue.push(child);
        }
      }
    }
    return descendants;
  } catch {
    return [];
  }
}

export const expect = base.expect;
