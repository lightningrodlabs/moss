import type { CrashReporterStartOptions, Details } from 'electron';

/**
 * Minidumps stay on the user's machine. A native fault in the main process
 * (an audio addon, a conductor binding) otherwise leaves no record at all on
 * Linux, where the system crash handler ignores unpackaged binaries.
 */
export const CRASH_REPORTER_OPTIONS: CrashReporterStartOptions = {
  uploadToServer: false,
  compress: false,
};

export interface CrashReportingDeps {
  start: (options: CrashReporterStartOptions) => void;
  crashDumpsDir: string;
  onChildProcessGone: (listener: (details: Details) => void) => void;
  log: (line: string) => void;
}

export function describeChildProcessGone(details: Details): string {
  const who = details.name ?? details.serviceName;
  const subject = who ? `${details.type} (${who})` : details.type;
  return `[child-process-gone] ${subject}: ${details.reason} (exit code ${details.exitCode})`;
}

export function installCrashReporting(deps: CrashReportingDeps): void {
  deps.start(CRASH_REPORTER_OPTIONS);
  deps.log(`Crash minidumps are written to ${deps.crashDumpsDir}`);
  deps.onChildProcessGone((details) => deps.log(describeChildProcessGone(details)));
}
