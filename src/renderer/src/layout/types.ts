import { ActionHash, EntryHash } from '@holochain/client';
import { HrlWithContext, OpenHrlMode } from '@lightningrodlabs/we-applet';

export interface AppOpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openCrossAppletMain(appletBundleHash: EntryHash): void;
  openCrossAppletBlock(appletBundleHash: ActionHash, block: string, context: any): void;
  openHrl(hrlWithContext: HrlWithContext, mode?: OpenHrlMode): void;
  userSelectHrl(): Promise<HrlWithContext | undefined>;
  toggleClipboard(): void;
}
