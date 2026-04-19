import { describe, expect, it } from 'vitest';

import {
  WHISPER_SERVER_ENV_VAR,
  WhisperCommandResolveError,
  resolveWhisperServerCommand,
  whisperServerBinaryName,
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
    expect(out.command).toEqual([
      'nix',
      'shell',
      'nixpkgs#whisper-cpp',
      '-c',
      'whisper-server',
    ]);
    expect(out.resolvedPath).toBeUndefined();
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
