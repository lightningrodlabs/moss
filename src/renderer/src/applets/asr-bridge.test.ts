import { describe, expect, it, vi } from 'vitest';

import type { AppletId, AsrIncomingEvent, ParentToAppletMessage } from '@theweave/api';

import { AsrRendererBridge } from './asr-bridge.js';
import type { MossStore } from '../moss-store.js';

type Emitted = { message: ParentToAppletMessage; forApplets: AppletId[] };

/** The bridge only touches `emitParentToAppletMessage`; record what it sends. */
function fakeMossStore(): { store: MossStore; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const store = {
    emitParentToAppletMessage: async (message: ParentToAppletMessage, forApplets: AppletId[]) => {
      emitted.push({ message, forApplets });
    },
  } as unknown as MossStore;
  return { store, emitted };
}

function makeBridge() {
  const { store, emitted } = fakeMossStore();
  const closeSession = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
  const bridge = new AsrRendererBridge(store, closeSession);
  return { bridge, emitted, closeSession };
}

const finalEvent = (sessionId: string) => ({
  sessionId,
  eventType: 'final' as const,
  text: 'hello',
  tStart: 0,
  tEnd: 1,
});

const errorEvent = (sessionId: string) => ({
  sessionId,
  eventType: 'error' as const,
  error: 'boom',
});

function revokeErrors(emitted: Emitted[]) {
  return emitted.filter(
    (e) =>
      e.message.type === 'asr-event' &&
      e.message.event.eventType === 'error' &&
      e.message.event.error === 'Local ASR access revoked by user',
  );
}

describe('AsrRendererBridge session registry', () => {
  it('registers and looks up the owning applet', () => {
    const { bridge } = makeBridge();
    bridge.registerSession('s1', 'appletA');
    expect(bridge.appletIdForSession('s1')).toBe('appletA');
    expect(bridge.appletIdForSession('nope')).toBeUndefined();
    expect(bridge.size).toBe(1);
  });

  it('forgets a session on unregister', () => {
    const { bridge } = makeBridge();
    bridge.registerSession('s1', 'appletA');
    bridge.unregisterSession('s1');
    expect(bridge.appletIdForSession('s1')).toBeUndefined();
    expect(bridge.size).toBe(0);
  });
});

describe('AsrRendererBridge.forwardEvent', () => {
  it('routes an event to the applet that owns the session', () => {
    const { bridge, emitted } = makeBridge();
    bridge.registerSession('s1', 'appletA');
    bridge.registerSession('s2', 'appletB');
    bridge.forwardEvent(finalEvent('s2'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].forApplets).toEqual(['appletB']);
    expect(emitted[0].message).toEqual({ type: 'asr-event', event: finalEvent('s2') });
  });

  it('ignores events for unknown sessions', () => {
    const { bridge, emitted } = makeBridge();
    bridge.registerSession('s1', 'appletA');
    bridge.forwardEvent(finalEvent('unknown'));
    expect(emitted).toHaveLength(0);
  });

  it('keeps the session registered after a final event', () => {
    const { bridge } = makeBridge();
    bridge.registerSession('s1', 'appletA');
    bridge.forwardEvent(finalEvent('s1'));
    expect(bridge.appletIdForSession('s1')).toBe('appletA');
  });

  it('forwards an error event and then unregisters the session', () => {
    const { bridge, emitted } = makeBridge();
    bridge.registerSession('s1', 'appletA');
    bridge.forwardEvent(errorEvent('s1'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].forApplets).toEqual(['appletA']);
    expect(bridge.appletIdForSession('s1')).toBeUndefined();
    // A second event for the now-closed session is dropped.
    bridge.forwardEvent(finalEvent('s1'));
    expect(emitted).toHaveLength(1);
  });
});

describe('AsrRendererBridge.closeSessionsForApplet', () => {
  it('closes only the sessions of that applet and tells the applet why', async () => {
    const { bridge, emitted, closeSession } = makeBridge();
    bridge.registerSession('a1', 'appletA');
    bridge.registerSession('a2', 'appletA');
    bridge.registerSession('b1', 'appletB');

    await bridge.closeSessionsForApplet('appletA');

    expect(closeSession.mock.calls.map((c) => c[0]).sort()).toEqual(['a1', 'a2']);
    expect(bridge.appletIdForSession('a1')).toBeUndefined();
    expect(bridge.appletIdForSession('a2')).toBeUndefined();
    expect(bridge.appletIdForSession('b1')).toBe('appletB');

    const revoked = revokeErrors(emitted);
    expect(revoked).toHaveLength(2);
    for (const e of revoked) expect(e.forApplets).toEqual(['appletA']);
    const sessionIds = revoked.map((e) =>
      e.message.type === 'asr-event' ? e.message.event.sessionId : '',
    );
    expect(sessionIds.sort()).toEqual(['a1', 'a2']);
  });

  it('is a no-op for an applet with no sessions', async () => {
    const { bridge, emitted, closeSession } = makeBridge();
    bridge.registerSession('b1', 'appletB');
    await bridge.closeSessionsForApplet('appletA');
    expect(closeSession).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
    expect(bridge.size).toBe(1);
  });

  it('still unregisters when the main-side close rejects', async () => {
    const { bridge, closeSession } = makeBridge();
    closeSession.mockRejectedValue(new Error('already closed'));
    bridge.registerSession('a1', 'appletA');
    await expect(bridge.closeSessionsForApplet('appletA')).resolves.toBeUndefined();
    expect(bridge.appletIdForSession('a1')).toBeUndefined();
  });
});

describe('AsrRendererBridge.closeAllSessions', () => {
  it('closes every session across applets', async () => {
    const { bridge, emitted, closeSession } = makeBridge();
    bridge.registerSession('a1', 'appletA');
    bridge.registerSession('b1', 'appletB');

    await bridge.closeAllSessions();

    expect(closeSession.mock.calls.map((c) => c[0]).sort()).toEqual(['a1', 'b1']);
    expect(bridge.size).toBe(0);
    const revoked = revokeErrors(emitted);
    expect(revoked.map((e) => e.forApplets[0]).sort()).toEqual(['appletA', 'appletB']);
  });
});

describe('AsrRendererBridge session origins', () => {
  it('closes only the sessions opened from an iframe that unregistered', async () => {
    const { bridge, emitted, closeSession } = makeBridge();
    bridge.registerSession('s-main', 'applet-a' as AppletId, { iframeId: 'iframe-1' });
    bridge.registerSession('s-other', 'applet-a' as AppletId, { iframeId: 'iframe-2' });
    bridge.registerSession('s-wal', 'applet-a' as AppletId, { walWebContentsId: 7 });

    await bridge.closeSessionsForIframe('iframe-1');

    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(closeSession).toHaveBeenCalledWith('s-main');
    expect(bridge.appletIdForSession('s-main')).toBeUndefined();
    expect(bridge.appletIdForSession('s-other')).toBe('applet-a');
    expect(bridge.appletIdForSession('s-wal')).toBe('applet-a');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].message).toMatchObject({
      type: 'asr-event',
      event: { sessionId: 's-main', eventType: 'error' },
    });
  });

  it('closes only the sessions opened from a WAL window that closed', async () => {
    const { bridge, closeSession } = makeBridge();
    bridge.registerSession('s-main', 'applet-a' as AppletId, { iframeId: 'iframe-1' });
    bridge.registerSession('s-wal-7', 'applet-a' as AppletId, { walWebContentsId: 7 });
    bridge.registerSession('s-wal-9', 'applet-b' as AppletId, { walWebContentsId: 9 });

    await bridge.closeSessionsForWalWindow(7);

    expect(closeSession.mock.calls.map((c) => c[0])).toEqual(['s-wal-7']);
    expect(bridge.appletIdForSession('s-main')).toBe('applet-a');
    expect(bridge.appletIdForSession('s-wal-9')).toBe('applet-b');
  });

  it('leaves sessions with no recorded origin alone on iframe and window closes', async () => {
    const { bridge, closeSession } = makeBridge();
    bridge.registerSession('s-unknown', 'applet-a' as AppletId);
    await bridge.closeSessionsForIframe('iframe-1');
    await bridge.closeSessionsForWalWindow(7);
    expect(closeSession).not.toHaveBeenCalled();
    expect(bridge.appletIdForSession('s-unknown')).toBe('applet-a');
  });
});

describe('AsrRendererBridge local sessions', () => {
  it('gives a local session its events and sends nothing to applets', () => {
    const { bridge, emitted } = makeBridge();
    const received: AsrIncomingEvent[] = [];
    bridge.registerLocalSession('local-1', (ev) => received.push(ev));
    bridge.forwardEvent(finalEvent('local-1'));
    expect(received).toEqual([finalEvent('local-1')]);
    expect(emitted).toHaveLength(0);
  });

  it('keeps routing applet sessions to their applet', () => {
    const { bridge, emitted } = makeBridge();
    const received: AsrIncomingEvent[] = [];
    bridge.registerLocalSession('local-1', (ev) => received.push(ev));
    bridge.registerSession('s1', 'appletA');
    bridge.forwardEvent(finalEvent('s1'));
    expect(received).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].forApplets).toEqual(['appletA']);
  });

  it('does not treat a local session as owned by an applet', () => {
    const { bridge } = makeBridge();
    bridge.registerLocalSession('local-1', () => undefined);
    expect(bridge.appletIdForSession('local-1')).toBeUndefined();
  });

  it('removes a local session after its error event', () => {
    const { bridge } = makeBridge();
    const received: AsrIncomingEvent[] = [];
    bridge.registerLocalSession('local-1', (ev) => received.push(ev));
    bridge.forwardEvent(errorEvent('local-1'));
    bridge.forwardEvent(finalEvent('local-1'));
    expect(received).toEqual([errorEvent('local-1')]);
    expect(bridge.size).toBe(0);
  });

  it('stops delivering after unregister', () => {
    const { bridge } = makeBridge();
    const received: AsrIncomingEvent[] = [];
    bridge.registerLocalSession('local-1', (ev) => received.push(ev));
    bridge.unregisterSession('local-1');
    bridge.forwardEvent(finalEvent('local-1'));
    expect(received).toHaveLength(0);
  });

  it('closes local sessions when every session is closed, and tells the listener', async () => {
    const { bridge, closeSession } = makeBridge();
    const received: AsrIncomingEvent[] = [];
    bridge.registerLocalSession('local-1', (ev) => received.push(ev));
    bridge.registerSession('a1', 'appletA');

    await bridge.closeAllSessions();

    expect(closeSession.mock.calls.map((c) => c[0]).sort()).toEqual(['a1', 'local-1']);
    expect(received).toEqual([
      { sessionId: 'local-1', eventType: 'error', error: 'Local ASR access revoked by user' },
    ]);
    expect(bridge.size).toBe(0);
  });

  it('leaves local sessions open when one applet is revoked', async () => {
    const { bridge, closeSession } = makeBridge();
    bridge.registerLocalSession('local-1', () => undefined);
    bridge.registerSession('a1', 'appletA');
    await bridge.closeSessionsForApplet('appletA');
    expect(closeSession.mock.calls.map((c) => c[0])).toEqual(['a1']);
    expect(bridge.size).toBe(1);
  });
});
