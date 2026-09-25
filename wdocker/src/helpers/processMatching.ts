/**
 * Recognising wdocker's own processes in a `ps` listing.
 *
 * The daemon is started as `node <install path>/dist/daemon/daemon.js <id>`
 * whether wdocker runs from a global install or a source checkout, and the
 * `wdaemon` bin remains a valid entry point. Both `start` (deciding whether a
 * daemon is already up) and `stop` (deciding what to kill) have to agree on
 * what counts, so the rule lives here rather than in either of them.
 */

const DAEMON_SCRIPT_PATH = 'dist/daemon/daemon.js';

export interface ProcessDescription {
  cmd?: string;
}

/**
 * Whether a process is a wdaemon. The caller has already matched the recorded
 * pid; this confirms the pid was not recycled by an unrelated process before
 * anything is killed.
 */
export function isWdaemonProcess(proc: ProcessDescription): boolean {
  const cmd = proc.cmd;
  if (!cmd) return false;
  if (cmd.includes(DAEMON_SCRIPT_PATH)) return true;
  const executable = cmd.split(' ')[0];
  return !!executable && executable.endsWith('wdaemon');
}
