import { describe, it, expect } from 'vitest';
import { createLanBeaconProbe, type LanBeaconProbeApi } from './lan-beacon-probe.js';

async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

function fakeApi() {
  const calls = {
    setListening: [] as boolean[],
    stopAdvertising: 0,
    diagnostics: 0,
  };
  const api: LanBeaconProbeApi & { lanBeaconStopAdvertising: () => Promise<void> } = {
    lanBeaconSetListening: async (listening) => {
      calls.setListening.push(listening);
    },
    lanBeaconDiagnostics: async () => {
      calls.diagnostics++;
      return {
        bound: true,
        interfaces: ['eth0'],
        advertising: false,
        advertisementId: undefined,
        sent: 0,
        received: 3,
        dropped: 0,
      };
    },
    // Present on the real bridge; the probe must never reach for it.
    lanBeaconStopAdvertising: async () => {
      calls.stopAdvertising++;
    },
  };
  return { api, calls };
}

describe('the debugging panel’s LAN beacon probe', () => {
  it('holds a listen claim while it runs, so bound is not false merely because no dialog is open', async () => {
    const { api, calls } = fakeApi();
    const probe = createLanBeaconProbe({ api, onReading: () => {}, intervalMs: 5 });
    await probe.start();
    expect(calls.setListening).toEqual([true]);
    probe.stop();
    expect(calls.setListening).toEqual([true, false]);
  });

  it('never stops an advertisement, because the slot it would stop belongs to someone else', async () => {
    const { api, calls } = fakeApi();
    const probe = createLanBeaconProbe({ api, onReading: () => {}, intervalMs: 5 });
    await probe.start();
    await waitFor(() => expect(calls.diagnostics).toBeGreaterThan(0));
    probe.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.stopAdvertising, 'the panel silenced whichever owner was broadcasting').toBe(0);
  });

  it('reports each reading and stops reporting once stopped', async () => {
    const { api } = fakeApi();
    const readings: number[] = [];
    const probe = createLanBeaconProbe({
      api,
      onReading: (reading) => readings.push(reading.received),
      intervalMs: 5,
    });
    await probe.start();
    await waitFor(() => expect(readings.length).toBeGreaterThan(0));
    probe.stop();
    const seen = readings.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(readings.length).toBe(seen);
  });
});
