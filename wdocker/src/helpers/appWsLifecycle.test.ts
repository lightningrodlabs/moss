import { describe, expect, it, vi } from 'vitest';
import type { AppWebsocket } from '@holochain/client';

import {
  LONG_LIVED_APP_AUTH_TOKEN_PARAMS,
  PER_CYCLE_APP_AUTH_TOKEN_PARAMS,
  withAppWs,
} from './appWsLifecycle.js';

function fakeAppWs(close: () => unknown): AppWebsocket {
  return { client: { close } } as unknown as AppWebsocket;
}

describe('withAppWs', () => {
  it('returns the value produced by the callback', async () => {
    const result = await withAppWs(
      async () => fakeAppWs(() => undefined),
      async () => 'value',
    );
    expect(result).toBe('value');
  });

  it('closes the websocket after a successful callback', async () => {
    const close = vi.fn();
    await withAppWs(
      async () => fakeAppWs(close),
      async () => undefined,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the websocket and rethrows when the callback throws', async () => {
    const close = vi.fn();
    await expect(
      withAppWs(
        async () => fakeAppWs(close),
        async () => {
          throw new Error('zome call failed');
        },
      ),
    ).rejects.toThrow('zome call failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('warns instead of throwing when closing fails, and keeps the callback result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await withAppWs(
        async () =>
          fakeAppWs(() => {
            throw new Error('socket already gone');
          }),
        async () => 'value',
      );
      expect(result).toBe('value');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('propagates a connect failure without running the callback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const use = vi.fn(async () => 'value');
    try {
      await expect(
        withAppWs(async () => {
          throw new Error('connect failed');
        }, use),
      ).rejects.toThrow('connect failed');
      expect(use).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('settles when close never resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await withAppWs(
        async () => fakeAppWs(() => new Promise(() => undefined)),
        async () => 'value',
        5,
      );
      expect(result).toBe('value');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('surfaces the callback error rather than a close error when both fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        withAppWs(
          async () =>
            fakeAppWs(() => {
              throw new Error('socket already gone');
            }),
          async () => {
            throw new Error('zome call failed');
          },
        ),
      ).rejects.toThrow('zome call failed');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('app auth token params', () => {
  it('keeps long-lived sockets on a non-expiring, reusable token', () => {
    expect(LONG_LIVED_APP_AUTH_TOKEN_PARAMS).toEqual({ single_use: false, expiry_seconds: 0 });
  });

  it('keeps per-cycle sockets on a short-lived single-use token', () => {
    expect(PER_CYCLE_APP_AUTH_TOKEN_PARAMS.single_use).toBe(true);
    expect(PER_CYCLE_APP_AUTH_TOKEN_PARAMS.expiry_seconds).toBeGreaterThan(0);
    expect(PER_CYCLE_APP_AUTH_TOKEN_PARAMS.expiry_seconds).toBeLessThanOrEqual(60);
  });
});
