import { describe, expect, it, vi } from 'vitest';
import {
  CRASH_REPORTER_OPTIONS,
  describeChildProcessGone,
  installCrashReporting,
} from './crashReporting';

describe('crash reporting', () => {
  it('keeps minidumps local: nothing is uploaded anywhere', () => {
    expect(CRASH_REPORTER_OPTIONS.uploadToServer).toBe(false);
    expect(CRASH_REPORTER_OPTIONS.submitURL).toBeUndefined();
  });

  it('starts the reporter and logs where dumps land', () => {
    const start = vi.fn();
    const lines: string[] = [];
    installCrashReporting({
      start,
      crashDumpsDir: '/profile/chromium/Crashpad',
      onChildProcessGone: () => undefined,
      log: (line) => lines.push(line),
    });
    expect(start).toHaveBeenCalledWith(CRASH_REPORTER_OPTIONS);
    expect(lines.join('\n')).toContain('/profile/chromium/Crashpad');
  });

  it('logs a child process that is gone, with what Electron knows about it', () => {
    let listener: ((details: Parameters<typeof describeChildProcessGone>[0]) => void) | undefined;
    const lines: string[] = [];
    installCrashReporting({
      start: () => undefined,
      crashDumpsDir: '/d',
      onChildProcessGone: (l) => (listener = l),
      log: (line) => lines.push(line),
    });
    listener!({
      type: 'Utility',
      reason: 'crashed',
      exitCode: 139,
      serviceName: 'audio.mojom.AudioService',
      name: 'Audio Service',
    });
    expect(lines.at(-1)).toBe(
      describeChildProcessGone({
        type: 'Utility',
        reason: 'crashed',
        exitCode: 139,
        serviceName: 'audio.mojom.AudioService',
        name: 'Audio Service',
      }),
    );
    expect(lines.at(-1)).toContain('Utility');
    expect(lines.at(-1)).toContain('crashed');
    expect(lines.at(-1)).toContain('139');
    expect(lines.at(-1)).toContain('Audio Service');
  });

  it('describes a child without a name or service', () => {
    expect(describeChildProcessGone({ type: 'GPU', reason: 'oom', exitCode: 1 })).toBe(
      '[child-process-gone] GPU: oom (exit code 1)',
    );
  });
});
