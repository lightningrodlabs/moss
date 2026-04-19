// Resolves the command that launches whisper-server in this Moss
// install. Pure function of env + filesystem + config; takes its
// Electron-derived inputs (binariesDir, isPackaged) from the caller so
// this file has no Electron dependency and stays cheap to unit-test.
//
// Resolution order:
//   1. MOSS_WHISPER_SERVER_CMD env var (space-separated command).
//      Overrides everything. For CI and tightly-controlled dev setups.
//   2. Bundled binary at `<binariesDir>/whisper-server-v<version><exe>`.
//      Matches the moss pattern for holochain / lair / kitsune2-
//      bootstrap-srv. Will be populated by fetch-binaries.mjs once the
//      whisper binary fetch pipeline lands; absent today.
//   3. `nix shell nixpkgs#whisper-cpp -c whisper-server` dev fallback.
//      Only active when isPackaged === false. Production installs must
//      never shell out to nix.
//
// On failure we throw a resolver-specific error with a clear message
// so callers can surface it to the user via Moss's logs / settings UI.

import { existsSync } from 'node:fs';
import path from 'node:path';

export type WhisperBinarySource = 'env' | 'bundled' | 'nixShell';

export interface ResolvedWhisperCommand {
  /** argv to pass to WhisperServerConfig.command. */
  command: readonly string[];
  /** Where the command came from. For diagnostics / telemetry only. */
  source: WhisperBinarySource;
  /** Absolute path to the resolved binary, when applicable. */
  resolvedPath?: string;
}

export interface ResolveWhisperCommandOptions {
  /** Absolute path to the resources/bins directory. */
  binariesDir: string;
  /** Version string used to construct the bundled binary filename. */
  whisperServerVersion: string;
  /** True when running inside a packaged app.asar; disables nix fallback. */
  isPackaged: boolean;
  /** Platform override; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Env override; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Filesystem override; defaults to fs.existsSync. */
  fileExists?: (p: string) => boolean;
}

export const WHISPER_SERVER_ENV_VAR = 'MOSS_WHISPER_SERVER_CMD';

/**
 * Binary name for the requested version. Windows gets `.exe`. Linux/mac
 * are plain. Mirrors the naming used by `fetch-binaries.mjs` for
 * holochain / lair / kitsune2-bootstrap-srv.
 */
export function whisperServerBinaryName(
  version: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const exe = platform === 'win32' ? '.exe' : '';
  return `whisper-server-v${version}${exe}`;
}

export class WhisperCommandResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperCommandResolveError';
  }
}

export function resolveWhisperServerCommand(
  opts: ResolveWhisperCommandOptions,
): ResolvedWhisperCommand {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const fileExists = opts.fileExists ?? existsSync;

  // 1. Env override — always wins.
  const fromEnv = env[WHISPER_SERVER_ENV_VAR];
  if (fromEnv && fromEnv.trim().length > 0) {
    const command = fromEnv.trim().split(/\s+/);
    return { command, source: 'env' };
  }

  // 2. Bundled binary.
  const binaryName = whisperServerBinaryName(opts.whisperServerVersion, platform);
  const binaryPath = path.join(opts.binariesDir, binaryName);
  if (fileExists(binaryPath)) {
    return {
      command: [binaryPath],
      source: 'bundled',
      resolvedPath: binaryPath,
    };
  }

  // 3. Nix-shell dev fallback.
  if (!opts.isPackaged) {
    return {
      command: ['nix', 'shell', 'nixpkgs#whisper-cpp', '-c', 'whisper-server'],
      source: 'nixShell',
    };
  }

  throw new WhisperCommandResolveError(
    `Cannot locate whisper-server. Tried:\n` +
      `  - $${WHISPER_SERVER_ENV_VAR}: not set\n` +
      `  - bundled binary: ${binaryPath} (missing)\n` +
      `  - nix dev fallback: disabled in packaged build\n` +
      `Run \`yarn fetch:binaries\` to download the bundled binary, or ` +
      `set $${WHISPER_SERVER_ENV_VAR} to a working whisper-server invocation.`,
  );
}
