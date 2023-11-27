import { ActionHash, DnaHash } from '@holochain/client';
import { WeNotification } from '@lightningrodlabs/we-applet';
import { AppletId } from '../types.js';

export interface Applet {
  custom_name: string; // name of the applet instance as chosen by the person adding it to the group,
  description: string;

  appstore_app_hash: ActionHash;
  devhub_dna_hash: DnaHash;
  devhub_happ_entry_action_hash: ActionHash; // Potentially useful to check for newer happ releases
  devhub_happ_release_hash: ActionHash;
  initial_devhub_gui_release_hash: ActionHash | undefined;

  network_seed: string | undefined;

  properties: Record<string, Uint8Array>; // Segmented by RoleId
}

export type NotificationTimestamp = number;

export type NotificationLevel = 'low' | 'medium' | 'high';

export type NotificationStorage = Record<
  AppletId,
  Record<NotificationLevel, Array<[WeNotification, NotificationTimestamp]>>
>;

export interface AppletNotificationSettings {
  allowOSNotification: boolean;
  showInSystray: boolean;
  showInGroupSidebar: boolean;
  showInAppletSidebar: boolean;
  showInGroupHomeFeed: boolean;
}
