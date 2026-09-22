import type { AudioSourceRequestResult } from '@theweave/moss-types';

export interface AudioSourceGrantsClientBindings {
  /** The persisted "Allow tools to request audio sources" switch. */
  isEnabled: () => boolean;
  newRequestId: () => string;
  requestAudioSources: (req: { requestId: string; toolName: string }) => Promise<AudioSourceRequestResult | null>;
  stopAudioSources: (grantId: string, reason: 'user-stopped' | 'iframe-unloaded') => Promise<void>;
  /** Resolves the port main delivers for `requestId`; rejects on timeout. */
  expectPort: (requestId: string) => Promise<MessagePort>;
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

  async request(req: { iframeKey: string; toolName: string }): Promise<AudioSourceGrantHandle | null> {
    if (!this.b.isEnabled()) return null;
    const requestId = this.b.newRequestId();
    // Armed before the invoke: the port message and the invoke reply are
    // separate IPC deliveries with no ordering guarantee between them.
    const portPromise = this.b.expectPort(requestId);
    portPromise.catch(() => undefined);
    const result = await this.b.requestAudioSources({ requestId, toolName: req.toolName });
    if (!result) return null;
    let port: MessagePort;
    try {
      port = await portPromise;
    } catch (e) {
      await this.b.stopAudioSources(result.grantId, 'iframe-unloaded');
      throw e;
    }
    this.byIframe.set(req.iframeKey, [...(this.byIframe.get(req.iframeKey) ?? []), result.grantId]);
    return { result, port };
  }

  async endForIframe(iframeKey: string): Promise<void> {
    const ids = this.byIframe.get(iframeKey);
    if (!ids) return;
    this.byIframe.delete(iframeKey);
    for (const id of ids) await this.b.stopAudioSources(id, 'iframe-unloaded');
  }
}
