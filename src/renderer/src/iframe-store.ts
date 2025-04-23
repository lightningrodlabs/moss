import { AppletId, ParentToAppletMessage } from '@theweave/api';
import { ToolCompatibilityId } from '@theweave/moss-types';

/**
 * Stores references to iframes and allows to send iframe messages
 * to them
 */
export class IframeStore {
  constructor() {}

  appletIframes: Record<
    AppletId,
    Array<{ id: string; subType: string; source: MessageEventSource | null | 'wal-window' }>
  > = {};

  crossGroupIframes: Record<
    ToolCompatibilityId,
    Array<{ id: string; subType: string; source: MessageEventSource | null | 'wal-window' }>
  > = {};

  registerAppletIframe(
    appletId: AppletId,
    id: string,
    subType: string,
    source: MessageEventSource | null | 'wal-window',
  ): void {
    // console.log(`### Registering ${subType} iframe for applet ${appletId}`);
    let iframes = this.appletIframes[appletId];
    if (!iframes) iframes = [];
    iframes.push({ id, subType, source });
    this.appletIframes[appletId] = iframes;
  }

  unregisterAppletIframe(appletId: AppletId, idToRemove: string): void {
    let iframes = this.appletIframes[appletId];
    this.appletIframes[appletId] = iframes.filter(({ id }) => id !== idToRemove);
  }

  registerCrossGroupIframe(
    toolCompatibilityId: ToolCompatibilityId,
    id: string,
    subType: string,
    source: MessageEventSource | null | 'wal-window',
  ): void {
    let iframes = this.crossGroupIframes[toolCompatibilityId];
    if (!iframes) iframes = [];
    iframes.push({ id, subType, source });
    this.crossGroupIframes[toolCompatibilityId] = iframes;
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
