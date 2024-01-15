import { ActionHash, EntryHash } from '@holochain/client';
import { HrlWithContext } from '@lightningrodlabs/we-applet';

export interface AppOpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openCrossAppletMain(appletBundleHash: EntryHash): void;
  openCrossAppletBlock(appletBundleHash: ActionHash, block: string, context: any): void;
  openHrl(hrlWithContext: HrlWithContext): void;
  userSelectHrl(): Promise<HrlWithContext | undefined>;
  toggleClipboard(): void;
}
