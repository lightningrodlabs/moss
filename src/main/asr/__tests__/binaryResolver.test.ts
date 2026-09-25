import { describe, expect, it } from 'vitest';

import {
  WHISPER_SERVER_ENV_VAR,
  WhisperCommandResolveError,
  resolveWhisperServerCommand,
  whisperServerBinaryName,
  NIX_SHELL_START_TIMEOUT_MS,
  NIX_WHISPER_FLAKE_REF,
} from '../binaryResolver';

describe('whisperServerBinaryName', () => {
  it('produces a plain name on linux and mac', () => {
    expect(whisperServerBinaryName('1.8.4', 'linux')).toBe('whisper-server-v1.8.4');
    expect(whisperServerBinaryName('1.8.4', 'darwin')).toBe('whisper-server-v1.8.4');
  });
  it('adds .exe on windows', () => {
    expect(whisperServerBinaryName('1.8.4', 'win32')).toBe('whisper-server-v1.8.4.exe');
  });
});

describe('resolveWhisperServerCommand', () => {
  it('prefers the env var when set', () => {
    const out = resolveWhisperServerCommand({
      binariesDir: '/opt/moss/resources/bins',
      whisperServerVersion: '1.8.4',
      isPackaged: true,
      env: { [WHISPER_SERVER_ENV_VAR]: '/custom/whisper-server --foo bar' },
      fileExists: () => false,
      platform: 'linux',
    });
    expect(out.source).toBe('env');
    expect(out.command).toEqual(['/custom/whisper-server', '--foo', 'bar']);
  });

  it('ignores an empty env var and falls through to the next step', () => {
    const out = resolveWhisperServerCommand({
      binariesDir: '/opt/moss/resources/bins',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      env: { [WHISPER_SERVER_ENV_VAR]: '   ' },
      fileExists: () => false,
      platform: 'linux',
    });
    expect(out.source).toBe('nixShell');
  });

  it('resolves to the bundled binary when it exists on disk', () => {
    const out = resolveWhisperServerCommand({
      binariesDir: '/opt/moss/resources/bins',
      whisperServerVersion: '1.8.4',
      isPackaged: true,
      env: {},
      fileExists: (p) => p === '/opt/moss/resources/bins/whisper-server-v1.8.4',
      platform: 'linux',
    });
    expect(out.source).toBe('bundled');
    expect(out.command).toEqual(['/opt/moss/resources/bins/whisper-server-v1.8.4']);
    expect(out.resolvedPath).toBe('/opt/moss/resources/bins/whisper-server-v1.8.4');
  });

  it('uses the .exe filename on windows', () => {
    const out = resolveWhisperServerCommand({
      binariesDir: 'C:\\moss\\resources\\bins',
      whisperServerVersion: '1.8.4',
      isPackaged: true,
      env: {},
      fileExists: (p) => p.endsWith('whisper-server-v1.8.4.exe'),
      platform: 'win32',
    });
    expect(out.source).toBe('bundled');
    expect(out.command[0]).toMatch(/whisper-server-v1\.8\.4\.exe$/);
  });

  it('falls back to the nix shell invocation in dev when no bundled binary exists', () => {
    const out = resolveWhisperServerCommand({
      binariesDir: '/dev/moss/resources/bins',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      env: {},
      fileExists: () => false,
      platform: 'linux',
    });
    expect(out.source).toBe('nixShell');
    expect(out.command).toEqual(['nix', 'shell', NIX_WHISPER_FLAKE_REF, '-c', 'whisper-server']);
    // A floating channel reference would re-download nixpkgs on every
    // channel bump; the pin must name an exact revision.
    expect(NIX_WHISPER_FLAKE_REF).toMatch(/^github:NixOS\/nixpkgs\/[0-9a-f]{40}#whisper-cpp$/);
    // First use may fetch the whole closure, which the default 60 s
    // readiness budget does not cover.
    expect(out.startTimeoutMs).toBe(NIX_SHELL_START_TIMEOUT_MS);
    expect(NIX_SHELL_START_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(out.resolvedPath).toBeUndefined();
  });

  it('gives bundled and env binaries no extra start budget', () => {
    const out = resolveWhisperServerCommand({
      binariesDir: '/bins',
      whisperServerVersion: '1.8.4',
      isPackaged: true,
      env: {},
      fileExists: () => true,
      platform: 'linux',
    });
    expect(out.source).toBe('bundled');
    expect(out.startTimeoutMs).toBeUndefined();
  });

  it('throws with an informative message when packaged and nothing resolves', () => {
    expect(() =>
      resolveWhisperServerCommand({
        binariesDir: '/opt/moss/resources/bins',
        whisperServerVersion: '1.8.4',
        isPackaged: true,
        env: {},
        fileExists: () => false,
        platform: 'linux',
      }),
    ).toThrow(WhisperCommandResolveError);
  });
});
