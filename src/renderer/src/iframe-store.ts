import { AppletId, ParentToAppletMessage } from '@theweave/api';
import { ToolCompatibilityId } from '@theweave/moss-types';

export type IframeInfo = {
  id: string; // RNG
  subType: string;
  source: MessageEventSource | null | 'wal-window';
  /**
   * Set once the iframe has registered its ParentToApplet message handlers.
   * Before that point the iframe cannot answer requests: window.postMessage
   * does not queue for listeners that do not exist yet, so anything sent
   * earlier is discarded without a reply.
   */
  ready: boolean;
};

type ReadyWaiter = {
  key: string;
  subType: string;
  resolve: (info: IframeInfo | undefined) => void;
};

const appletKey = (appletId: AppletId) => `applet:${appletId}`;
const crossGroupKey = (toolCompatibilityId: ToolCompatibilityId) =>
  `cross-group:${toolCompatibilityId}`;

/**
 * Stores references to iframes and allows to send iframe messages
 * to them
 */
export class IframeStore {
  constructor() {}

  appletIframes: Record<AppletId, Array<IframeInfo>> = {};
  crossGroupIframes: Record<ToolCompatibilityId, Array<IframeInfo>> = {};

  private readyWaiters: Array<ReadyWaiter> = [];

  registerAppletIframe(appletId: AppletId, iframeInfo: Omit<IframeInfo, 'ready'>): void {
    // TODO: Check if iframeInfo.id is already in use
    let iframes = this.appletIframes[appletId];
    if (!iframes) iframes = [];
    iframes.push({ ...iframeInfo, ready: false });
    this.appletIframes[appletId] = iframes;
  }

  unregisterAppletIframe(appletId: AppletId, idToRemove: string): void {
    let iframes = this.appletIframes[appletId];
    this.appletIframes[appletId] = iframes.filter(({ id }) => id !== idToRemove);
  }

  registerCrossGroupIframe(
    toolCompatibilityId: ToolCompatibilityId,
    iframeInfo: Omit<IframeInfo, 'ready'>,
  ): void {
    // TODO: Check if iframeInfo.id is already in use
    let iframes = this.crossGroupIframes[toolCompatibilityId];
    if (!iframes) iframes = [];
    iframes.push({ ...iframeInfo, ready: false });
    this.crossGroupIframes[toolCompatibilityId] = iframes;
  }

  markAppletIframeReady(appletId: AppletId, source: MessageEventSource | 'wal-window'): void {
    this.markReady(this.appletIframes[appletId], appletKey(appletId), source);
  }

  markCrossGroupIframeReady(
    toolCompatibilityId: ToolCompatibilityId,
    source: MessageEventSource | 'wal-window',
  ): void {
    this.markReady(
      this.crossGroupIframes[toolCompatibilityId],
      crossGroupKey(toolCompatibilityId),
      source,
    );
  }

  /**
   * Resolves with the iframe of the given subType once it is able to answer
   * messages, or with undefined if that has not happened within timeoutMs.
   */
  async waitForReadyAppletIframe(
    appletId: AppletId,
    subType: string,
    timeoutMs: number,
  ): Promise<IframeInfo | undefined> {
    const alreadyReady = (this.appletIframes[appletId] ?? []).find(
      (info) => info.ready && info.subType === subType,
    );
    if (alreadyReady) return alreadyReady;

    return new Promise<IframeInfo | undefined>((resolve) => {
      const waiter: ReadyWaiter = { key: appletKey(appletId), subType, resolve };
      this.readyWaiters.push(waiter);
      setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
        resolve(undefined);
      }, timeoutMs);
    });
  }

  private markReady(
    iframes: Array<IframeInfo> | undefined,
    key: string,
    source: MessageEventSource | 'wal-window',
  ): void {
    const info = (iframes ?? []).find((candidate) => candidate.source === source);
    if (!info) return;
    info.ready = true;
    this.readyWaiters = this.readyWaiters.filter((waiter) => {
      if (waiter.key !== key || waiter.subType !== info.subType) return true;
      waiter.resolve(info);
      return false;
    });
  }

  unregisterCrossGroupIframe(toolCompatibilityId: ToolCompatibilityId, idToRemove: string): void {
    let iframes = this.crossGroupIframes[toolCompatibilityId];
    this.crossGroupIframes[toolCompatibilityId] = iframes.filter(({ id }) => id !== idToRemove);
  }

  appletIframesTotalCount(): number {
    return Object.values(this.appletIframes).flat().length;
  }

  crossGroupIframesTotalCount(): number {
    return Object.values(this.crossGroupIframes).flat().length;
  }

  appletIframesCounts(appletId: AppletId): Record<string, number> {
    const iframes = this.appletIframes[appletId];
    const iframeCounts = {};
    if (!iframes) return iframeCounts;
    iframes.forEach(({ subType }) => {
      let count = iframeCounts[subType];
      if (!count) count = 0;
      count += 1;
      iframeCounts[subType] = count;
    });
    return iframeCounts;
  }

  crossGroupIframesCounts(toolCompatibilityId: ToolCompatibilityId): Record<string, number> {
    const iframes = this.crossGroupIframes[toolCompatibilityId];
    const iframeCounts = {};
    if (!iframes) return iframeCounts;
    iframes.forEach(({ subType }) => {
      let count = iframeCounts[subType];
      if (!count) count = 0;
      count += 1;
      iframeCounts[subType] = count;
    });
    return iframeCounts;
  }

  /**
   * Posts a message to all iframes of the specified AppletIds and returns the settled promises.
   * This includes iframes of assets associated to the AppletIds, not only the main view.
   *
   * TODO: Add option to only target main view or specific views
   *
   * @param appletIds
   * @param message
   * @returns
   */
  async postMessageToAppletIframes(
    appletIds: { type: 'all' } | { type: 'some'; ids: AppletId[] },
    message: ParentToAppletMessage,
  ) {
    const relevantIframes: MessageEventSource[] = [];
    const relevantAppletIds =
      appletIds.type === 'all' ? Object.keys(this.appletIframes) : appletIds.ids;

    relevantAppletIds.forEach((appletId) => {
      const iframes = this.appletIframes[appletId];
      if (iframes) {
        iframes.forEach(({ source }) => {
          if (source && source !== 'wal-window') relevantIframes.push(source);
        });
      }
    });

    return Promise.allSettled(
      relevantIframes.map(async (iframe) => {
        await iframe.postMessage(message, { targetOrigin: '*' });
      }),
    );
  }
}
