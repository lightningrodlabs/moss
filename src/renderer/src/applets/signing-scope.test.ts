import { describe, it, expect } from 'vitest';
import { withSigningScopeRefresh } from './signing-scope';

describe('withSigningScopeRefresh', () => {
  it('refreshes the signing scope after the cell change and before returning', async () => {
    const order: string[] = [];
    const result = await withSigningScopeRefresh(
      async () => {
        order.push('op');
        return 'cloned';
      },
      async () => {
        order.push('refresh');
      },
    );
    expect(result).toBe('cloned');
    expect(order).toEqual(['op', 'refresh']);
  });

  it('waits for the refresh to finish before resolving', async () => {
    let refreshed = false;
    await withSigningScopeRefresh(
      async () => undefined,
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            refreshed = true;
            resolve();
          }, 10),
        ),
    );
    expect(refreshed).toBe(true);
  });

  it('does not refresh when the cell change fails, and passes the error on', async () => {
    let refreshed = false;
    await expect(
      withSigningScopeRefresh(
        async () => {
          throw new Error('clone failed');
        },
        async () => {
          refreshed = true;
        },
      ),
    ).rejects.toThrow('clone failed');
    expect(refreshed).toBe(false);
  });
});
