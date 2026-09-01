import { describe, expect, it, vi } from 'vitest';
import type { AppWebsocket } from '@holochain/client';

import { withAppWs } from './appWsLifecycle.js';

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

  it('does not mask the callback result when closing fails', async () => {
    const result = await withAppWs(
      async () =>
        fakeAppWs(() => {
          throw new Error('socket already gone');
        }),
      async () => 'value',
    );
    expect(result).toBe('value');
  });
});
