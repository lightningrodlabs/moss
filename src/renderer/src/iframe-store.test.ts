import { describe, expect, it, vi } from 'vitest';

import { IframeStore } from './iframe-store.js';

/** Stand-in for an iframe's contentWindow: the store only compares identity. */
const fakeSource = (name: string) => ({ name }) as unknown as MessageEventSource;

describe('IframeStore readiness', () => {
  it('registers iframes as not ready', () => {
    const store = new IframeStore();
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source: fakeSource('a') });
    expect(store.appletIframes['applet1'][0].ready).toBe(false);
  });

  it('resolves immediately when the iframe is already ready', async () => {
    const store = new IframeStore();
    const source = fakeSource('a');
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source });
    store.markAppletIframeReady('applet1', source);
    const info = await store.waitForReadyAppletIframe('applet1', 'main', 1000);
    expect(info?.id).toBe('i1');
  });

  it('resolves when readiness arrives after the wait started', async () => {
    const store = new IframeStore();
    const source = fakeSource('a');
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source });
    const pending = store.waitForReadyAppletIframe('applet1', 'main', 1000);
    store.markAppletIframeReady('applet1', source);
    expect((await pending)?.id).toBe('i1');
  });

  it('resolves when the iframe registers and readies after the wait started', async () => {
    const store = new IframeStore();
    const source = fakeSource('a');
    const pending = store.waitForReadyAppletIframe('applet1', 'main', 1000);
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source });
    store.markAppletIframeReady('applet1', source);
    expect((await pending)?.id).toBe('i1');
  });

  it('resolves undefined when readiness never arrives', async () => {
    vi.useFakeTimers();
    try {
      const store = new IframeStore();
      store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source: fakeSource('a') });
      const pending = store.waitForReadyAppletIframe('applet1', 'main', 1000);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not satisfy a main-view wait with a ready asset-view iframe', async () => {
    vi.useFakeTimers();
    try {
      const store = new IframeStore();
      const assetSource = fakeSource('asset');
      store.registerAppletIframe('applet1', { id: 'i2', subType: 'asset', source: assetSource });
      const pending = store.waitForReadyAppletIframe('applet1', 'main', 1000);
      store.markAppletIframeReady('applet1', assetSource);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not satisfy a wait for one applet with another applet becoming ready', async () => {
    vi.useFakeTimers();
    try {
      const store = new IframeStore();
      const otherSource = fakeSource('other');
      store.registerAppletIframe('applet2', { id: 'i3', subType: 'main', source: otherSource });
      const pending = store.waitForReadyAppletIframe('applet1', 'main', 1000);
      store.markAppletIframeReady('applet2', otherSource);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops readiness when the iframe unregisters', async () => {
    vi.useFakeTimers();
    try {
      const store = new IframeStore();
      const source = fakeSource('a');
      store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source });
      store.markAppletIframeReady('applet1', source);
      store.unregisterAppletIframe('applet1', 'i1');
      const pending = store.waitForReadyAppletIframe('applet1', 'main', 1000);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores readiness from an unregistered source', () => {
    const store = new IframeStore();
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source: fakeSource('a') });
    store.markAppletIframeReady('applet1', fakeSource('stranger'));
    expect(store.appletIframes['applet1'][0].ready).toBe(false);
  });

  it('tracks cross-group iframe readiness independently', () => {
    const store = new IframeStore();
    const source = fakeSource('cg');
    store.registerCrossGroupIframe('tool1', { id: 'i1', subType: 'main', source });
    expect(store.crossGroupIframes['tool1'][0].ready).toBe(false);
    store.markCrossGroupIframeReady('tool1', source);
    expect(store.crossGroupIframes['tool1'][0].ready).toBe(true);
  });
});
