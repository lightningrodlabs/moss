import { describe, expect, it, vi } from 'vitest';
import { encodeHashToBase64 } from '@holochain/client';
import type {
  AppWebsocket,
  CallZomeRequest,
  RoleNameCallZomeRequest,
} from '@holochain/client';

import {
  CellCallGate,
  cellKeyOf,
  WARMING_CALL_TIMEOUT_MS,
  instrumentZomeCallGate,
  isInitTimeoutError,
  retryInitTimeout,
  zomeCallGateOf,
} from './zome-call-gate.js';

const INIT_TEXT =
  'Another zome function has triggered the `init()` callback, which has been blocking this zome call for longer than 30 seconds. Giving up.';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('isInitTimeoutError', () => {
  it('recognises the conductor init timeout text', () => {
    expect(isInitTimeoutError(new Error(INIT_TEXT))).toBe(true);
  });
  it('rejects other errors', () => {
    expect(isInitTimeoutError(new Error('CellNotRunning'))).toBe(false);
    expect(isInitTimeoutError(undefined)).toBe(false);
  });
});

describe('cellKeyOf', () => {
  it('uses the role name when present', () => {
    expect(
      cellKeyOf({
        role_name: 'group',
        zome_name: 'z',
        fn_name: 'f',
        payload: null,
      } as RoleNameCallZomeRequest),
    ).toBe('group');
  });
  it('uses dna and agent for a cell id request', () => {
    const dna = new Uint8Array(39).fill(1);
    const agent = new Uint8Array(39).fill(2);
    const key = cellKeyOf({
      cell_id: [dna, agent],
      zome_name: 'z',
      fn_name: 'f',
      payload: null,
    } as CallZomeRequest);
    expect(key).toBe(`${encodeHashToBase64(dna)}:${encodeHashToBase64(agent)}`);
  });
});

describe('CellCallGate', () => {
  it('runs the first call alone and holds the second until it settles', async () => {
    const gate = new CellCallGate();
    const a = deferred<string>();
    const fnA = vi.fn(() => a.promise);
    const fnB = vi.fn(async () => 'b');
    const pA = gate.run('group', fnA);
    const pB = gate.run('group', fnB);
    await flush();
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).not.toHaveBeenCalled();
    a.resolve('a');
    expect(await pA).toBe('a');
    expect(await pB).toBe('b');
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('lets calls run concurrently once the key is warm', async () => {
    const gate = new CellCallGate();
    await gate.run('group', async () => 'a');
    const c = deferred<string>();
    const d = deferred<string>();
    const fnC = vi.fn(() => c.promise);
    const fnD = vi.fn(() => d.promise);
    const pC = gate.run('group', fnC);
    const pD = gate.run('group', fnD);
    await flush();
    expect(fnC).toHaveBeenCalledTimes(1);
    expect(fnD).toHaveBeenCalledTimes(1);
    c.resolve('c');
    d.resolve('d');
    expect(await Promise.all([pC, pD])).toEqual(['c', 'd']);
  });

  it('waiters run after the first call rejects, and the next waiter runs alone', async () => {
    const gate = new CellCallGate();
    const a = deferred<string>();
    const b = deferred<string>();
    const fnB = vi.fn(() => b.promise);
    const fnC = vi.fn(async () => 'c');
    const pA = gate.run('group', () => a.promise);
    const pB = gate.run('group', fnB);
    const pC = gate.run('group', fnC);
    const caught = pA.catch((e: unknown) => e);
    await flush();
    a.reject(new Error('boom'));
    expect(((await caught) as Error).message).toBe('boom');
    await flush();
    // B became the warmer; C still waits.
    expect(fnB).toHaveBeenCalledTimes(1);
    expect(fnC).not.toHaveBeenCalled();
    b.resolve('b');
    expect(await pB).toBe('b');
    expect(await pC).toBe('c');
  });

  it('tells the callback whether it is the warming call', async () => {
    const gate = new CellCallGate();
    const a = deferred<string>();
    const seen: boolean[] = [];
    const pA = gate.run('group', (isWarmer) => {
      seen.push(isWarmer);
      return a.promise;
    });
    const pB = gate.run('group', async (isWarmer) => {
      seen.push(isWarmer);
      return 'b';
    });
    await flush();
    a.resolve('a');
    await Promise.all([pA, pB]);
    await gate.run('group', async (isWarmer) => {
      seen.push(isWarmer);
      return 'c';
    });
    expect(seen).toEqual([true, false, false]);
  });

  it('keys are independent', async () => {
    const gate = new CellCallGate();
    const a = deferred<string>();
    void gate.run('group', () => a.promise);
    const fnFoyer = vi.fn(async () => 'f');
    expect(await gate.run('foyer', fnFoyer)).toBe('f');
    expect(fnFoyer).toHaveBeenCalledTimes(1);
    a.resolve('a');
  });
});

describe('retryInitTimeout', () => {
  it('retries while the error is an init timeout and returns the eventual value', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error(INIT_TEXT))
      .mockRejectedValueOnce(new Error(INIT_TEXT))
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => {});
    expect(await retryInitTimeout(fn, { sleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('does not retry other errors', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('CellNotRunning'));
    const sleep = vi.fn(async () => {});
    await expect(retryInitTimeout(fn, { sleep })).rejects.toThrow('CellNotRunning');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the deadline with the last error', async () => {
    const err = new Error(INIT_TEXT);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await expect(
      retryInitTimeout(fn, { spacingMs: 10, deadlineMs: 25, sleep }),
    ).rejects.toBe(err);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('retryInitTimeout startedAt', () => {
  it('measures the deadline from startedAt, so a long wait leaves no time to retry', async () => {
    const err = new Error(INIT_TEXT);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);
    const sleep = vi.fn(async () => {});
    await expect(
      retryInitTimeout(fn, { startedAt: Date.now() - 200_000, sleep }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('instrumentZomeCallGate timeouts', () => {
  const req = { role_name: 'group', zome_name: 'z', fn_name: 'f', payload: null };

  it('gives the warming call the long timeout when none was given', async () => {
    const spy = vi.fn(async (_req: unknown, _timeout?: number) => 'ok');
    const appWs = { callZome: spy } as unknown as AppWebsocket;
    instrumentZomeCallGate(appWs, new CellCallGate(), { sleep: async () => {} });
    await appWs.callZome(req);
    expect(WARMING_CALL_TIMEOUT_MS).toBe(180_000);
    expect(spy).toHaveBeenLastCalledWith(req, 180_000);
  });

  it("passes the caller's timeout through for the warming call", async () => {
    const spy = vi.fn(async (_req: unknown, _timeout?: number) => 'ok');
    const appWs = { callZome: spy } as unknown as AppWebsocket;
    instrumentZomeCallGate(appWs, new CellCallGate(), { sleep: async () => {} });
    await appWs.callZome(req, 5000);
    expect(spy).toHaveBeenLastCalledWith(req, 5000);
  });

  it('leaves the timeout unset for calls on a warm cell', async () => {
    const spy = vi.fn(async (_req: unknown, _timeout?: number) => 'ok');
    const appWs = { callZome: spy } as unknown as AppWebsocket;
    instrumentZomeCallGate(appWs, new CellCallGate(), { sleep: async () => {} });
    await appWs.callZome(req);
    await appWs.callZome(req);
    expect(spy).toHaveBeenLastCalledWith(req, undefined);
  });
});

describe('instrumentZomeCallGate', () => {
  it('routes callZome through the gate and the retry', async () => {
    const first = deferred<string>();
    let calls = 0;
    const spy = vi.fn(async (_req: unknown, _timeout?: number) => {
      calls++;
      if (calls === 1) return first.promise;
      return 'second';
    });
    const appWs = { callZome: spy } as unknown as AppWebsocket;
    const gate = new CellCallGate();
    instrumentZomeCallGate(appWs, gate, { sleep: async () => {} });
    const req = { role_name: 'group', zome_name: 'z', fn_name: 'f', payload: null };
    const p1 = appWs.callZome(req, 5000);
    const p2 = appWs.callZome(req);
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(req, 5000);
    first.resolve('first');
    expect(await p1).toBe('first');
    expect(await p2).toBe('second');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('retries an init timeout through the wrapper', async () => {
    const spy = vi
      .fn<(r: unknown) => Promise<string>>()
      .mockRejectedValueOnce(new Error(INIT_TEXT))
      .mockResolvedValueOnce('ok');
    const appWs = { callZome: spy } as unknown as AppWebsocket;
    instrumentZomeCallGate(appWs, new CellCallGate(), { sleep: async () => {} });
    const res = await appWs.callZome({ role_name: 'g', zome_name: 'z', fn_name: 'f', payload: null });
    expect(res).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('zomeCallGateOf', () => {
  it('creates and reuses a gate for an unregistered websocket', () => {
    const appWs = { callZome: async () => null } as unknown as AppWebsocket;
    const gate = zomeCallGateOf(appWs);
    expect(gate).toBeInstanceOf(CellCallGate);
    expect(zomeCallGateOf(appWs)).toBe(gate);
  });
});
