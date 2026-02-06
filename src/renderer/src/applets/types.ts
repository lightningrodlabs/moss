import { FrameNotification, AppletId } from '@theweave/api';

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

// ============================================
// Notification Sound Types
// ============================================

/** Built-in sound IDs */
export type BuiltinSoundId = 'none' | 'chime' | 'bell' | 'pop' | 'ding';

/** Custom sound stored by user */
export type CustomSound = {
  id: string; // UUID
  name: string; // User-provided name
  dataUrl: string; // base64 data URL (e.g., "data:audio/mp3;base64,...")
};

/** Sound ID can be built-in or custom (prefixed with "custom:") */
export type NotificationSoundId = BuiltinSoundId | `custom:${string}`;

/** Sound settings for a single urgency level */
export type NotificationSoundSettings = {
  enabled: boolean;
  soundId: NotificationSoundId;
};

/** Global notification sound settings */
export type GlobalNotificationSoundSettings = {
  masterEnabled: boolean;
  volume: number; // 0.0 to 1.0
  perUrgency: {
    high: NotificationSoundSettings;
    medium: NotificationSoundSettings;
    low: NotificationSoundSettings;
  };
  customSounds: CustomSound[]; // User-added sounds
};

// ============================================
// Foyer Notification Settings
// ============================================

/** Urgency level for foyer messages, or 'none' to disable */
export type FoyerMessageUrgency = NotificationLevel | 'none';

/** Foyer notification settings - per message type urgency */
export type FoyerNotificationSettings = {
  /** Urgency level when you are mentioned */
  mentions: FoyerMessageUrgency;
  /** Urgency level for all other messages */
  allMessages: FoyerMessageUrgency;
};

/** Default foyer notification settings */
export const DEFAULT_FOYER_NOTIFICATION_SETTINGS: FoyerNotificationSettings = {
  mentions: 'high',
  allMessages: 'medium',
};
