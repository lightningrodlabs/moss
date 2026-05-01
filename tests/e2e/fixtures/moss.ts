import { test as base, _electron as electron, Page, ElectronApplication } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'os';

export type LaunchOptions = {
  /**
   * Profile name passed to Moss via --profile. Profile dir lives at
   * ~/.config/Moss/profiles/<profileName>/ (Linux) and is removed in teardown.
   */
  profileName: string;
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
  profileDir: string;
};

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

/**
 * Profile dirs Moss writes to on Linux. We delete the whole tree on teardown so
 * each test starts truly fresh (conductor DBs, lair, applet caches all gone).
 */
function profileDirFor(profileName: string): string {
  // why: filesystem.ts:connect() places profile data at
  //   $userData/<breakingAppVersion>/<profile>/
  // For Moss 0.15.x in production NODE_ENV, $userData is ~/.config/Moss/.
  // The breaking-version string for 0.15.x is the literal "0.15.x" (see
  // src/main/utils.ts:breakingAppVersion).
  return path.join(os.homedir(), '.config', 'Moss', '0.15.x', profileName);
}

function rmIfExists(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export async function launchMoss(opts: LaunchOptions): Promise<LaunchedMoss> {
  const repoRoot = resolveRepoRoot();
  const profileDir = profileDirFor(opts.profileName);
  // why: ensure no cross-test contamination if a prior run died mid-test.
  rmIfExists(profileDir);

  // why: pass the repo root (not the absolute main.js path) so app.getAppPath()
  // resolves to a directory containing moss.config.json + holochain-checksums.json,
  // matching what `yarn start` (electron-vite preview → `electron .`) does.
  const args = [repoRoot, '--profile', opts.profileName, ...(opts.extraArgs ?? [])];

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
    timeout: 60_000,
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
  return { app, mainWindow, profileDir };
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
 *   - `moss`: a launched Moss instance with a fresh profile, auto-cleaned up.
 *   - `secondAgent(opts?)`: launches an additional Moss instance (different profile),
 *     also tracked for cleanup. Use for multi-agent tests (smoke #9 etc.).
 *
 * Holochain ports are auto-allocated by Moss via `get-port`, so multiple agents
 * coexist on one machine without manual port offsets.
 */
export const test = base.extend<MossFixtures>({
  moss: async ({}, use, testInfo) => {
    const profileName = `pw-${sanitize(testInfo.title)}-${testInfo.workerIndex}-${Date.now()}`;
    const launched = await launchMoss({ profileName });
    try {
      await use(launched);
    } finally {
      await safeClose(launched);
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
        await safeClose(l);
      }
    }
  },
});

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'test';
}

async function safeClose(launched: LaunchedMoss): Promise<void> {
  try {
    await launched.app.close();
  } catch {
    // app may already be exiting
  }
  // why: lair / conductor children sometimes leak databases that contaminate the
  // next test. Removing the profile dir is the simplest correct teardown.
  rmIfExists(launched.profileDir);
}

export const expect = base.expect;
