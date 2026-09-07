import { describe, it, expect } from 'vitest';
import { BEACON_INTERVAL_MS, createBeaconPipe } from './pipe.js';

function harness() {
  const sent: Uint8Array[] = [];
  const unicast: { payload: Uint8Array; address: string; port: number }[] = [];
  const forwarded: { payload: Uint8Array; address: string }[] = [];
  let clock = 0;
  const timers: (() => void)[] = [];

  const pipe = createBeaconPipe({
    socket: {
      broadcast: (payload) => sent.push(payload),
      unicast: (payload, address, port) => unicast.push({ payload, address, port }),
      joinedInterfaces: () => ['eth0'],
      close: () => Promise.resolve(),
    },
    now: () => clock,
    setInterval: (fn: () => void) => {
      timers.push(fn);
      return timers.length as unknown as NodeJS.Timeout;
    },
    clearInterval: () => timers.splice(0),
    onDatagram: (payload, address) => forwarded.push({ payload, address }),
  });

  return {
    pipe,
    sent,
    unicast,
    forwarded,
    advance(ms: number) {
      clock += ms;
      for (const fire of [...timers]) fire();
    },
  };
}

const PAYLOAD = new Uint8Array([1, 2, 3]);

describe('createBeaconPipe', () => {
  it('sends the first beacon immediately rather than after one interval', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    expect(h.sent).toEqual([PAYLOAD]);
  });

  it('repeats the beacon on every interval while the window is open', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.advance(BEACON_INTERVAL_MS);
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(3);
  });

  it('stops on its own when the deadline passes', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 5_000);
    h.advance(6_000);
    const afterDeadline = h.sent.length;
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(afterDeadline);
    expect(h.pipe.diagnostics().advertising).toBe(false);
  });

  it('stops when asked', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.stopAdvertising();
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(1);
  });

  it('stops the advertisement named by the id it handed out', () => {
    const h = harness();
    const id = h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.stopAdvertising(id);
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(1);
    expect(h.pipe.diagnostics().advertising).toBe(false);
  });

  it('ignores a stop that names an advertisement somebody else has replaced', () => {
    const h = harness();
    const second = new Uint8Array([4, 5, 6]);
    // One owner's window, then a second owner taking the single slot: there is
    // only one socket, so the second beacon genuinely replaces the first.
    const displaced = h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.startAdvertising(second, 60_000);
    // The displaced owner closing its dialog must not take the live beacon
    // down with it.
    h.pipe.stopAdvertising(displaced);
    h.sent.length = 0;
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent).toEqual([second]);
    expect(h.pipe.diagnostics().advertising).toBe(true);
  });

  it('reports which advertisement is live, so a displaced owner can tell', () => {
    const h = harness();
    const first = h.pipe.startAdvertising(PAYLOAD, 60_000);
    expect(h.pipe.diagnostics().advertisementId).toBe(first);
    const second = h.pipe.startAdvertising(new Uint8Array([4, 5, 6]), 60_000);
    expect(second).not.toBe(first);
    expect(h.pipe.diagnostics().advertisementId).toBe(second);
    h.pipe.stopAdvertising(second);
    expect(h.pipe.diagnostics().advertisementId).toBeUndefined();
  });

  it('replaces an advertisement rather than running two at once', () => {
    const h = harness();
    const second = new Uint8Array([4, 5, 6]);
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.startAdvertising(second, 60_000);
    h.sent.length = 0;
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent).toEqual([second]);
  });

  it('forwards an inbound datagram', () => {
    const h = harness();
    h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.forwarded).toEqual([{ payload: PAYLOAD, address: '192.168.1.5' }]);
  });

  it('drops an oversize datagram instead of forwarding it', () => {
    const h = harness();
    h.pipe.deliver(new Uint8Array(4096), '192.168.1.5', 47654);
    expect(h.forwarded).toEqual([]);
    expect(h.pipe.diagnostics().dropped).toBe(1);
  });

  it('drops datagrams past the rate limit so a flood cannot swamp the renderer', () => {
    const h = harness();
    for (let i = 0; i < 200; i++) h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.forwarded.length).toBeLessThan(200);
    expect(h.pipe.diagnostics().dropped).toBeGreaterThan(0);
  });

  it('lets traffic through again once the rate-limit window has passed', () => {
    const h = harness();
    for (let i = 0; i < 200; i++) h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    const beforeWait = h.forwarded.length;
    h.advance(1_000);
    h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.forwarded.length).toBe(beforeWait + 1);
  });

  it('reports what the diagnostics pane needs', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.pipe.diagnostics()).toEqual({
      bound: true,
      interfaces: ['eth0'],
      advertising: true,
      advertisementId: 1,
      sent: 1,
      received: 1,
      dropped: 0,
    });
  });

  it('counts every beacon it puts on the wire, so a silent sender is visible', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    expect(h.pipe.diagnostics().sent).toBe(1);
    h.advance(BEACON_INTERVAL_MS);
    h.advance(BEACON_INTERVAL_MS);
    expect(h.pipe.diagnostics().sent).toBe(3);
    // Past the deadline nothing more goes out, and the count stops with it.
    h.advance(60_000);
    const afterDeadline = h.pipe.diagnostics().sent;
    h.advance(BEACON_INTERVAL_MS);
    expect(h.pipe.diagnostics().sent).toBe(afterDeadline);
  });
});
