import { describe, it, expect } from 'vitest';
import { createLanBeaconService } from './index.js';
import type { BeaconSocket, DatagramHandler } from './socket.js';

/** A fake socket opener that counts opens/closes and lets a test drive datagram delivery. */
function fakeOpener() {
  let opens = 0;
  let closes = 0;
  const sockets: { onDatagram: DatagramHandler; closed: boolean }[] = [];

  async function openSocket(onDatagram: DatagramHandler): Promise<BeaconSocket> {
    opens++;
    const entry = { onDatagram, closed: false };
    sockets.push(entry);
    return {
      broadcast: () => {},
      unicast: () => {},
      joinedInterfaces: () => ['eth0'],
      close: async () => {
        entry.closed = true;
        closes++;
      },
    };
  }

  return {
    openSocket,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
    /** Deliver a datagram on the most recently opened (and still open) socket. */
    deliver(payload: Uint8Array) {
      const live = [...sockets].reverse().find((s) => !s.closed);
      if (!live) throw new Error('no live socket to deliver on');
      live.onDatagram(payload, '192.168.1.9', 47654);
    },
  };
}

describe('createLanBeaconService refcounting', () => {
  it('opens exactly one socket when two owners are listening', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    await service.setListening(true, () => {});
    await service.setListening(true, () => {});
    expect(fake.opens).toBe(1);
  });

  it('leaves the socket open and delivering when only one of two owners stops', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    const received: number[] = [];
    await service.setListening(true, () => received.push(1));
    await service.setListening(true, () => {});
    await service.setListening(false, () => {});
    expect(fake.closes).toBe(0);
    fake.deliver(new Uint8Array([1]));
    expect(received.length).toBe(1);
  });

  it('closes the socket once the second (last) owner stops', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    await service.setListening(true, () => {});
    await service.setListening(true, () => {});
    await service.setListening(false, () => {});
    await service.setListening(false, () => {});
    expect(fake.closes).toBe(1);
  });

  it('opens a fresh socket cleanly on a listen after a full close', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    await service.setListening(true, () => {});
    await service.setListening(false, () => {});
    expect(fake.opens).toBe(1);
    expect(fake.closes).toBe(1);
    await service.setListening(true, () => {});
    expect(fake.opens).toBe(2);
    expect(fake.closes).toBe(1);
  });

  it('does not let a redundant stop after full release corrupt a later owner’s open', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    await service.setListening(true, () => {}); // owner A opens
    await service.setListening(false, () => {}); // owner A stops -> closed
    await service.setListening(false, () => {}); // owner A's redundant extra stop
    expect(fake.closes).toBe(1); // did not attempt a second real close, and did not go negative
    await service.setListening(true, () => {}); // owner B, later, opens fresh
    expect(fake.opens).toBe(2);
  });

  // Known limitation, not a target of this fix: a bare aggregate count has no
  // notion of *whose* claim a stop releases, so it cannot tell "the same
  // owner stopped twice" apart from "a second, distinct owner stopped once".
  // With two owners open, a double-stop from one of them closes the socket
  // out from under the other anyway. Fixing this for real needs the stopper
  // to identify itself (e.g. a token handed back from the open call) and
  // that widens the IPC contract, preload API, and every caller — out of
  // scope here. `LanInviteSession.close()` is now idempotent (guarded the
  // same way `open()` already was), which closes off the only path a real
  // caller in this codebase had to a same-owner double-release; the
  // remaining exposure here is only a caller that talks to the IPC surface
  // directly, bypassing the session. This is `it.fails` so the test breaks
  // loudly (telling whoever lands that fix to delete it) instead of
  // silently going stale.
  it.fails(
    'does not close the socket out from under a second owner on a double-stop from the first (known limitation)',
    async () => {
      const fake = fakeOpener();
      const service = createLanBeaconService({ openSocket: fake.openSocket });
      await service.setListening(true, () => {}); // owner A opens
      await service.setListening(true, () => {}); // owner B opens
      await service.setListening(false, () => {}); // owner A stops (count 1, B remains)
      await service.setListening(false, () => {}); // owner A's second, erroneous stop
      expect(fake.closes).toBe(0);
    },
  );

  it('shares one open between concurrent first-openers instead of racing two sockets', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    await Promise.all([service.setListening(true, () => {}), service.setListening(true, () => {})]);
    expect(fake.opens).toBe(1);
  });

  it('does not double-forward one datagram to two owners listening concurrently', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    let callsA = 0;
    let callsB = 0;
    await service.setListening(true, () => {
      callsA++;
    });
    await service.setListening(true, () => {
      callsB++;
    });
    fake.deliver(new Uint8Array([9]));
    // Only the forwarder wired at actual socket-open time (the first
    // opener's) is ever invoked; re-registering one per owner would have
    // made this 1/1 instead of 1/0.
    expect(callsA).toBe(1);
    expect(callsB).toBe(0);
  });

  it('shuts down regardless of outstanding owners, and a late stop after that does not re-close', async () => {
    const fake = fakeOpener();
    const service = createLanBeaconService({ openSocket: fake.openSocket });
    await service.setListening(true, () => {});
    await service.setListening(true, () => {});
    await service.shutdown();
    expect(fake.closes).toBe(1);
    await service.setListening(false, () => {});
    expect(fake.closes).toBe(1);
  });
});
