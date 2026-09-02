import { describe, expect, it } from 'vitest';

import { isWdaemonProcess } from './processMatching.js';

describe('isWdaemonProcess', () => {
  it('recognises the daemon spawned from a global npm install', () => {
    expect(
      isWdaemonProcess({
        cmd: 'node /usr/lib/node_modules/@theweave/wdocker/dist/daemon/daemon.js my-node',
      }),
    ).toBe(true);
  });

  it('recognises the daemon spawned from a source checkout', () => {
    expect(
      isWdaemonProcess({
        cmd: '/usr/bin/node /home/eric/code/moss/wdocker/dist/daemon/daemon.js my-node',
      }),
    ).toBe(true);
  });

  it('recognises the daemon started through the wdaemon bin', () => {
    expect(isWdaemonProcess({ cmd: '/usr/local/bin/wdaemon my-node' })).toBe(true);
  });

  it('does not match an unrelated daemon.js', () => {
    expect(isWdaemonProcess({ cmd: 'node /home/eric/other-project/daemon.js' })).toBe(false);
  });

  it('does not match a process whose command mentions the daemon in passing', () => {
    expect(isWdaemonProcess({ cmd: 'tail -f /var/log/wdaemon-notes.txt' })).toBe(false);
  });

  it('does not match a process with no command line', () => {
    expect(isWdaemonProcess({})).toBe(false);
    expect(isWdaemonProcess({ cmd: '' })).toBe(false);
  });
});
