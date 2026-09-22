import { describe, it, expect, vi } from 'vitest';
import { AudioSourceGrantsClient, AudioSourceGrantsClientBindings } from './grants-client';

function rig(overrides: Partial<AudioSourceGrantsClientBindings> = {}) {
  const port = { close: vi.fn() } as unknown as MessagePort;
  const requestAudioSources = vi.fn(async () => ({ grantId: 'g1', label: 'System audio', canExcludeSelf: true }));
  const stopAudioSources = vi.fn(async () => {});
  const expectPort = vi.fn(async (_requestId: string) => port);
  const b: AudioSourceGrantsClientBindings = {
    isEnabled: () => true,
    newRequestId: () => 'r1',
    requestAudioSources,
    stopAudioSources,
    expectPort,
    ...overrides,
  };
  // Return the bindings' own (possibly overridden) functions, not the
  // pre-override locals: an override passed to rig() must be the thing
  // assertions observe. The cast back to the concrete mock type is truthful
  // because every override supplied by a test below is itself a vi.fn().
  return {
    client: new AudioSourceGrantsClient(b),
    port,
    requestAudioSources: b.requestAudioSources as unknown as typeof requestAudioSources,
    stopAudioSources: b.stopAudioSources as unknown as typeof stopAudioSources,
    expectPort: b.expectPort as unknown as typeof expectPort,
  };
}

describe('AudioSourceGrantsClient.request', () => {
  it('switch off → null without touching main', async () => {
    const r = rig({ isEnabled: () => false });
    expect(await r.client.request({ iframeKey: 'i1', toolName: 'Presence' })).toBeNull();
    expect(r.requestAudioSources).not.toHaveBeenCalled();
    expect(r.expectPort).not.toHaveBeenCalled();
  });

  it('arms the port expectation BEFORE invoking main, then returns result + port', async () => {
    const order: string[] = [];
    const r = rig({
      expectPort: vi.fn(async () => {
        order.push('expect');
        return { close: vi.fn() } as unknown as MessagePort;
      }),
      requestAudioSources: vi.fn(async () => {
        order.push('invoke');
        return { grantId: 'g1', label: 'System audio', canExcludeSelf: true };
      }),
    });
    const out = await r.client.request({ iframeKey: 'i1', toolName: 'Presence' });
    expect(order).toEqual(['expect', 'invoke']);
    expect(out?.result.grantId).toBe('g1');
    expect(r.requestAudioSources).toHaveBeenCalledWith({ requestId: 'r1', toolName: 'Presence' });
  });

  it('main returns null (cancelled/unsupported) → null, expectation discarded', async () => {
    const r = rig({ requestAudioSources: vi.fn(async () => null) });
    expect(await r.client.request({ iframeKey: 'i1', toolName: 'Presence' })).toBeNull();
    expect(r.client.grantIdsFor('i1')).toEqual([]);
  });

  it('port never arrives → stops the grant in main and rethrows', async () => {
    const r = rig({ expectPort: vi.fn(async () => { throw new Error('timed out'); }) });
    await expect(r.client.request({ iframeKey: 'i1', toolName: 'Presence' })).rejects.toThrow(/timed out/);
    expect(r.stopAudioSources).toHaveBeenCalledWith('g1', 'iframe-unloaded');
  });

  it('records the grant under its iframe key', async () => {
    const r = rig();
    await r.client.request({ iframeKey: 'i1', toolName: 'Presence' });
    expect(r.client.grantIdsFor('i1')).toEqual(['g1']);
  });
});

describe('AudioSourceGrantsClient.endForIframe', () => {
  it("stops every grant of that iframe with reason iframe-unloaded and forgets them", async () => {
    let n = 0;
    const r = rig({
      newRequestId: () => `r${++n}`,
      requestAudioSources: vi.fn(async ({ requestId }) => ({ grantId: `g-${requestId}`, label: 'x', canExcludeSelf: true })),
    });
    await r.client.request({ iframeKey: 'i1', toolName: 'A' });
    await r.client.request({ iframeKey: 'i1', toolName: 'A' });
    await r.client.request({ iframeKey: 'i2', toolName: 'B' });
    await r.client.endForIframe('i1');
    expect(r.stopAudioSources.mock.calls).toEqual([
      ['g-r1', 'iframe-unloaded'],
      ['g-r2', 'iframe-unloaded'],
    ]);
    expect(r.client.grantIdsFor('i1')).toEqual([]);
    expect(r.client.grantIdsFor('i2')).toEqual(['g-r3']);
  });

  it('is a no-op for an unknown iframe', async () => {
    const r = rig();
    await r.client.endForIframe('nope');
    expect(r.stopAudioSources).not.toHaveBeenCalled();
  });

  it('attempts every id even when one stop fails, keeps the failed id, and rethrows', async () => {
    let n = 0;
    const failure = new Error('stop failed');
    const stopAudioSources = vi.fn(async (grantId: string) => {
      if (grantId === 'g-r2') throw failure;
    });
    const r = rig({
      newRequestId: () => `r${++n}`,
      requestAudioSources: vi.fn(async ({ requestId }) => ({ grantId: `g-${requestId}`, label: 'x', canExcludeSelf: true })),
      stopAudioSources,
    });
    await r.client.request({ iframeKey: 'i1', toolName: 'A' });
    await r.client.request({ iframeKey: 'i1', toolName: 'A' });
    await r.client.request({ iframeKey: 'i1', toolName: 'A' });

    await expect(r.client.endForIframe('i1')).rejects.toBe(failure);
    expect(stopAudioSources.mock.calls).toEqual([
      ['g-r1', 'iframe-unloaded'],
      ['g-r2', 'iframe-unloaded'],
      ['g-r3', 'iframe-unloaded'],
    ]);
    expect(r.client.grantIdsFor('i1')).toEqual(['g-r2']);

    stopAudioSources.mockImplementation(async () => {});
    await r.client.endForIframe('i1');
    expect(r.client.grantIdsFor('i1')).toEqual([]);
  });
});
