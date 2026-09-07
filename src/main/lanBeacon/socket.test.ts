import { describe, it, expect, afterEach } from 'vitest';
import {
  broadcastPlan,
  LAN_INVITE_MULTICAST_ADDRESS,
  LAN_INVITE_PORT,
  openBeaconSocket,
  type BeaconSocket,
} from './socket.js';

const opened: BeaconSocket[] = [];

async function open(onDatagram: Parameters<typeof openBeaconSocket>[0]): Promise<BeaconSocket> {
  const socket = await openBeaconSocket(onDatagram);
  opened.push(socket);
  return socket;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

/** Resolves with the first payload the socket receives, or rejects after 2s. */
function firstDatagram(): { promise: Promise<Uint8Array>; handler: (p: Uint8Array) => void } {
  let settle: (payload: Uint8Array) => void;
  let fail: (error: Error) => void;
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error('no datagram within 2s')), 2000);
  return {
    promise,
    handler: (payload) => {
      clearTimeout(timer);
      settle(payload);
    },
  };
}

describe('openBeaconSocket', () => {
  it('reports the interfaces it joined the group on', async () => {
    const socket = await open(() => {});
    expect(Array.isArray(socket.joinedInterfaces())).toBe(true);
  });

  it('delivers a broadcast payload to a listener on this machine', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const inbox = firstDatagram();
    await open(inbox.handler);
    const sender = await open(() => {});
    sender.broadcast(payload);
    expect(await inbox.promise).toEqual(payload);
  });

  it('delivers a unicast payload to a given address and port', async () => {
    // One socket, sending to itself: with two sockets sharing the port, which
    // one the kernel hands a unicast datagram to is not defined.
    const payload = new Uint8Array([9, 9, 9]);
    const inbox = firstDatagram();
    const socket = await open(inbox.handler);
    socket.unicast(payload, '127.0.0.1', LAN_INVITE_PORT);
    expect(await inbox.promise).toEqual(payload);
  });

  it('closes cleanly, and closing twice is not an error', async () => {
    const socket = await open(() => {});
    await socket.close();
    await expect(socket.close()).resolves.toBeUndefined();
  });
});

describe('broadcastPlan', () => {
  const wifi = { name: 'wlp1s0', address: '192.168.1.20', broadcast: '192.168.1.255' };
  const vpn = { name: 'tailscale0', address: '100.64.0.2', broadcast: '100.127.255.255' };

  it('sends the multicast copy once per interface, pinned to that interface', () => {
    const plan = broadcastPlan([wifi, vpn]);
    const multicast = plan.filter((hop) => hop.address === LAN_INVITE_MULTICAST_ADDRESS);
    expect(multicast.map((hop) => hop.via)).toEqual([wifi.address, vpn.address]);
  });

  it('sends a directed broadcast for every interface too', () => {
    const plan = broadcastPlan([wifi, vpn]);
    const broadcasts = plan.filter((hop) => hop.address !== LAN_INVITE_MULTICAST_ADDRESS);
    expect(broadcasts).toEqual([
      { via: wifi.address, address: wifi.broadcast },
      { via: vpn.address, address: vpn.broadcast },
    ]);
  });

  it('leaves nothing on the wire when there is no interface to send from', () => {
    expect(broadcastPlan([])).toEqual([]);
  });
});
