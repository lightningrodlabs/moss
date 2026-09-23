import type { AudioSourceRequestResult } from '@theweave/moss-types';

export interface AudioSourceGrantsClientBindings {
  /** The persisted "Allow tools to request audio sources" switch. */
  isEnabled: () => boolean;
  newRequestId: () => string;
  requestAudioSources: (req: { requestId: string; toolName: string }) => Promise<AudioSourceRequestResult | null>;
  stopAudioSources: (grantId: string, reason: 'user-stopped' | 'iframe-unloaded') => Promise<void>;
  /** Resolves the port main delivers for `requestId`; rejects once a deadline is armed and elapses. */
  expectPort: (requestId: string) => Promise<MessagePort>;
  /** Bounds the port relay itself, once the invoke has actually answered. */
  armPortDeadline: (requestId: string) => void;
  /** Gives up on a port that will never be asked for again. */
  cancelPortExpectation: (requestId: string) => void;
}

export interface AudioSourceGrantHandle {
  result: AudioSourceRequestResult;
  port: MessagePort;
}

/**
 * The renderer side of a Tool's audio-source request: gates on the user's
 * switch, correlates the invoke with the port delivery, and remembers which
 * iframe holds which grant so an unloading iframe releases its capture.
 */
export class AudioSourceGrantsClient {
  private byIframe = new Map<string, string[]>();

  constructor(private readonly b: AudioSourceGrantsClientBindings) {}

  grantIdsFor(iframeKey: string): string[] {
    return [...(this.byIframe.get(iframeKey) ?? [])];
  }

  /**
   * `iframeKey` is the iframe's registered id; an unregistered iframe is
   * refused before main is asked, since no grant may be created that nothing
   * can later release.
   */
  async request(req: { iframeKey: string | undefined; toolName: string }): Promise<AudioSourceGrantHandle | null> {
    const iframeKey = req.iframeKey;
    if (iframeKey === undefined) {
      throw new Error('The requesting iframe is not registered with the host; call get-iframe-config first.');
    }
    if (!this.b.isEnabled()) return null;
    const requestId = this.b.newRequestId();
    // Armed before the invoke: the port message and the invoke reply are
    // separate IPC deliveries with no ordering guarantee between them. The
    // DEADLINE is armed later, only once the invoke has actually answered —
    // the invoke itself does not resolve until the user closes the picker,
    // and that wait must not count against a timeout meant to bound the
    // sub-second port relay, not the user's decision.
    const portPromise = this.b.expectPort(requestId);
    portPromise.catch(() => undefined);
    let result: AudioSourceRequestResult | null;
    try {
      result = await this.b.requestAudioSources({ requestId, toolName: req.toolName });
    } catch (e) {
      this.b.cancelPortExpectation(requestId);
      throw e;
    }
    if (!result) {
      this.b.cancelPortExpectation(requestId);
      return null;
    }
    // Recorded as soon as main says the grant exists, not once the port has
    // arrived: an iframe that unloads during the port relay must still find
    // this grant to release it.
    this.record(iframeKey, result.grantId);
    this.b.armPortDeadline(requestId);
    let port: MessagePort;
    try {
      port = await portPromise;
    } catch (e) {
      if (this.forget(iframeKey, result.grantId)) {
        await this.b.stopAudioSources(result.grantId, 'iframe-unloaded');
      }
      throw e;
    }
    if (!this.holds(iframeKey, result.grantId)) {
      // The iframe unloaded while the port was in flight, so there is nobody
      // to hand it to. The stop is issued rather than assumed — an
      // `endForIframe` pass that had already snapshotted its list would not
      // have seen this id — and stopping twice is a no-op in main.
      port.close();
      await this.b.stopAudioSources(result.grantId, 'iframe-unloaded').catch(() => undefined);
      return null;
    }
    return { result, port };
  }

  private record(iframeKey: string, grantId: string): void {
    this.byIframe.set(iframeKey, [...(this.byIframe.get(iframeKey) ?? []), grantId]);
  }

  private holds(iframeKey: string, grantId: string): boolean {
    return this.byIframe.get(iframeKey)?.includes(grantId) ?? false;
  }

  /** Drops `grantId` from the iframe's list; false when it was already gone. */
  private forget(iframeKey: string, grantId: string): boolean {
    const ids = this.byIframe.get(iframeKey);
    if (!ids || !ids.includes(grantId)) return false;
    const rest = ids.filter((id) => id !== grantId);
    if (rest.length > 0) this.byIframe.set(iframeKey, rest);
    else this.byIframe.delete(iframeKey);
    return true;
  }

  async endForIframe(iframeKey: string): Promise<void> {
    const ids = this.byIframe.get(iframeKey);
    if (!ids) return;
    // Every id gets a stop attempt regardless of earlier failures in this
    // same pass: a rejection must not leave a later grant's stop unattempted
    // in main while the client has already forgotten it existed. Ids whose
    // stop failed stay recorded so a retry can find them.
    const stillGranted: string[] = [];
    let firstError: unknown;
    for (const id of ids) {
      try {
        await this.b.stopAudioSources(id, 'iframe-unloaded');
      } catch (e) {
        stillGranted.push(id);
        if (firstError === undefined) firstError = e;
      }
    }
    if (stillGranted.length > 0) {
      this.byIframe.set(iframeKey, stillGranted);
    } else {
      this.byIframe.delete(iframeKey);
    }
    if (firstError !== undefined) throw firstError;
  }
}
