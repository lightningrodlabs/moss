import { AppletId } from '@theweave/api';
import { ToolCompatibilityId } from '@theweave/moss-types';

export type IframeInfo = {
  id: string; // RNG
  subType: string;
  source: MessageEventSource | null | 'wal-window';
};

/**
 * Registry of the applet and cross-group iframes a window knows about, by
 * applet and by tool. Frames that live in a WAL window appear in the main
 * window's registry with the source `'wal-window'`.
 */
export class IframeStore {
  constructor() {}

  appletIframes: Record<AppletId, Array<IframeInfo>> = {};
  crossGroupIframes: Record<ToolCompatibilityId, Array<IframeInfo>> = {};

  registerAppletIframe(appletId: AppletId, iframeInfo: IframeInfo): void {
    // TODO: Check if iframeInfo.id is already in use
    let iframes = this.appletIframes[appletId];
    if (!iframes) iframes = [];
    iframes.push(iframeInfo);
    this.appletIframes[appletId] = iframes;
  }

  unregisterAppletIframe(appletId: AppletId, idToRemove: string): void {
    let iframes = this.appletIframes[appletId];
    this.appletIframes[appletId] = iframes.filter(({ id }) => id !== idToRemove);
  }

  registerCrossGroupIframe(toolCompatibilityId: ToolCompatibilityId, iframeInfo: IframeInfo): void {
    // TODO: Check if iframeInfo.id is already in use
    let iframes = this.crossGroupIframes[toolCompatibilityId];
    if (!iframes) iframes = [];
    iframes.push(iframeInfo);
    this.crossGroupIframes[toolCompatibilityId] = iframes;
  }

  unregisterCrossGroupIframe(toolCompatibilityId: ToolCompatibilityId, idToRemove: string): void {
    let iframes = this.crossGroupIframes[toolCompatibilityId];
    this.crossGroupIframes[toolCompatibilityId] = iframes.filter(({ id }) => id !== idToRemove);
  }

  /** The registered id of the iframe whose window is `source`, across applet and cross-group iframes. */
  findIframeIdBySource(source: MessageEventSource | null | 'wal-window'): string | undefined {
    if (!source) return undefined;
    for (const iframes of [
      ...Object.values(this.appletIframes),
      ...Object.values(this.crossGroupIframes),
    ]) {
      const hit = iframes.find((i) => i.source === source);
      if (hit) return hit.id;
    }
    return undefined;
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
}
