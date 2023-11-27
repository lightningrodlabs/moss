import { ActionHash, EntryHash } from '@holochain/client';
import { Hrl, HrlWithContext } from '@lightningrodlabs/we-applet';

export interface AppOpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openCrossAppletMain(appletBundleHash: EntryHash): void;
  openCrossAppletBlock(appletBundleHash: ActionHash, block: string, context: any): void;
  openHrl(hrl: Hrl, context: any): void;
  userSelectHrl(): Promise<HrlWithContext | undefined>;
  toggleClipboard(): void;
}
