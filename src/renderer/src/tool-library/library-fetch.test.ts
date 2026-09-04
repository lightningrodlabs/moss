import { describe, it, expect } from 'vitest';
import { ToolLibraryGate, ToolLibraryUnreachableError, FetchLike } from './library-fetch';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const ok = (): Response => new Response('{}', { status: 200 });

/** A fetch that never resolves unless aborted, like a hanging DNS lookup. */
const hanging: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('ToolLibraryGate', () => {
  it('passes a successful response through and stays online', async () => {
    let calls = 0;
    const gate = new ToolLibraryGate({
      fetchImpl: async () => {
        calls++;
        return ok();
      },
      onLine: () => true,
    });
    const resp = await gate.fetch('https://lib.example/list.json');
    expect(resp.status).toBe(200);
    expect(calls).toBe(1);
    expect(gate.isOffline()).toBe(false);
  });

  it('aborts a hanging request at the timeout and then refuses without touching the network', async () => {
    const c = clock();
    let calls = 0;
    const gate = new ToolLibraryGate({
      fetchImpl: (url, init) => {
        calls++;
        return hanging(url, init);
      },
      now: c.now,
      onLine: () => true,
      timeoutMs: 20,
      offlineHoldMs: 30_000,
    });
    await expect(gate.fetch('https://lib.example/a')).rejects.toBeInstanceOf(
      ToolLibraryUnreachableError,
    );
    expect(gate.isOffline()).toBe(true);
    await expect(gate.fetch('https://lib.example/b')).rejects.toThrow(/unreachable/);
    expect(calls).toBe(1);
  });

  it('probes again once the hold has elapsed and recovers on success', async () => {
    const c = clock();
    let fail = true;
    const gate = new ToolLibraryGate({
      fetchImpl: async () => {
        if (fail) throw new TypeError('Failed to fetch');
        return ok();
      },
      now: c.now,
      onLine: () => true,
      offlineHoldMs: 1_000,
    });
    await expect(gate.fetch('https://lib.example/a')).rejects.toThrow();
    c.advance(999);
    await expect(gate.fetch('https://lib.example/a')).rejects.toThrow(/unreachable/);
    c.advance(2);
    fail = false;
    expect((await gate.fetch('https://lib.example/a')).status).toBe(200);
    expect(gate.isOffline()).toBe(false);
  });

  it('treats an HTTP error as reachable', async () => {
    const gate = new ToolLibraryGate({
      fetchImpl: async () => new Response('nope', { status: 503 }),
      onLine: () => true,
    });
    const resp = await gate.fetch('https://lib.example/a');
    expect(resp.status).toBe(503);
    expect(gate.isOffline()).toBe(false);
  });

  it('honours the browser offline hint without probing', async () => {
    let calls = 0;
    const gate = new ToolLibraryGate({
      fetchImpl: async () => {
        calls++;
        return ok();
      },
      onLine: () => false,
    });
    expect(gate.isOffline()).toBe(true);
    await expect(gate.fetch('https://lib.example/a')).rejects.toThrow(/unreachable/);
    expect(calls).toBe(0);
  });

  it('reset clears a recorded failure', async () => {
    const gate = new ToolLibraryGate({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
      onLine: () => true,
    });
    await expect(gate.fetch('https://lib.example/a')).rejects.toThrow();
    expect(gate.isOffline()).toBe(true);
    gate.reset();
    expect(gate.isOffline()).toBe(false);
  });
});
