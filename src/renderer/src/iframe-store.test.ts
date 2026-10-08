import { describe, expect, it } from 'vitest';

import { IframeStore } from './iframe-store.js';

/** Stand-in for an iframe's contentWindow: the store only compares identity. */
const fakeSource = (name: string) => ({ name }) as unknown as MessageEventSource;

describe('IframeStore.findIframeIdBySource', () => {
  it('finds an applet iframe by its window identity', () => {
    const store = new IframeStore();
    const src = fakeSource('a');
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source: src });
    store.registerCrossGroupIframe('tool1', { id: 'c1', subType: 'main', source: fakeSource('c') });
    expect(store.findIframeIdBySource(src)).toBe('i1');
  });

  it('finds a cross-group iframe too', () => {
    const store = new IframeStore();
    const src = fakeSource('c');
    store.registerCrossGroupIframe('tool1', { id: 'c1', subType: 'main', source: src });
    expect(store.findIframeIdBySource(src)).toBe('c1');
  });

  it('returns undefined for an unknown or null source', () => {
    const store = new IframeStore();
    store.registerAppletIframe('applet1', { id: 'i1', subType: 'main', source: fakeSource('a') });
    expect(store.findIframeIdBySource(fakeSource('zzz'))).toBeUndefined();
    expect(store.findIframeIdBySource(null)).toBeUndefined();
  });
});
