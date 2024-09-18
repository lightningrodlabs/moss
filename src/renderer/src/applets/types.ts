import { FrameNotification } from '@theweave/api';
import { AppletId } from '../types.js';

export type NotificationTimestamp = number;

export type NotificationLevel = 'low' | 'medium' | 'high';

export type NotificationStorage = Record<
  AppletId,
  Record<NotificationLevel, Array<[FrameNotification, NotificationTimestamp]>>
>;

export type AppletNotificationSettings = {
  /**
   * Notification settings that get applied to the applet as a whole
   */
  applet: NotificationSettings;
  /**
   * Notification type specific notification settings. Get superseeded by applet-wide notification settings.
   */
  notificationTypes: Record<string, NotificationSettings>;
};

export type NotificationSettings = {
  allowOSNotification: boolean;
  showInSystray: boolean;
  showInGroupSidebar: boolean;
  showInAppletSidebar: boolean;
  showInFeed: boolean;
};
