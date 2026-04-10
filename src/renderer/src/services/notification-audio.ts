import {
  NotificationSoundId,
  GlobalNotificationSoundSettings,
  BuiltinSoundId,
  CustomSound,
} from '../applets/types.js';

export const BUILTIN_SOUNDS: Record<BuiltinSoundId, { path: string | null; label: string }> = {
  none: { path: null, label: 'None' },
  chime: { path: '/sounds/chime.wav', label: 'Chime' },
  bell: { path: '/sounds/bell.wav', label: 'Bell' },
  pop: { path: '/sounds/pop.wav', label: 'Pop' },
  ding: { path: '/sounds/ding.wav', label: 'Ding' },
};

/**
 * Default notification sound settings - single source of truth
 */
export const DEFAULT_NOTIFICATION_SOUND_SETTINGS: GlobalNotificationSoundSettings = {
  masterEnabled: true,
  volume: 0.7,
  perUrgency: {
    high: { enabled: true, soundId: 'ding' },
    medium: { enabled: true, soundId: 'bell' },
    low: { enabled: false, soundId: 'pop' },
  },
  customSounds: [],
};

export class NotificationAudioService {
  private audioCache: Map<string, HTMLAudioElement> = new Map();
  private currentlyPlaying: HTMLAudioElement | null = null;

  /**
   * Preload all built-in sound files for faster playback
   */
  preloadBuiltinSounds(): void {
    Object.entries(BUILTIN_SOUNDS).forEach(([id, { path }]) => {
      if (path) {
        const audio = new Audio(path);
        audio.preload = 'auto';
        this.audioCache.set(id, audio);
      }
    });
  }

  /**
   * Preload custom sounds from settings
   */
  preloadCustomSounds(customSounds: CustomSound[]): void {
    customSounds.forEach((sound) => {
      const audio = new Audio(sound.dataUrl);
      audio.preload = 'auto';
      this.audioCache.set(`custom:${sound.id}`, audio);
    });
  }

  /**
   * Play a notification sound based on urgency and settings
   */
  async playForUrgency(
    urgency: 'low' | 'medium' | 'high',
    settings: GlobalNotificationSoundSettings,
  ): Promise<void> {
    if (!settings.masterEnabled) return;

    const urgencySettings = settings.perUrgency[urgency];
    if (!urgencySettings.enabled || urgencySettings.soundId === 'none') return;

    await this.play(urgencySettings.soundId, settings.volume, settings.customSounds);
  }

  /**
   * Play a specific sound (useful for settings preview)
   */
  async play(
    soundId: NotificationSoundId,
    volume: number = 0.7,
    customSounds: CustomSound[] = [],
  ): Promise<void> {
    if (soundId === 'none') return;

    let audio = this.audioCache.get(soundId);

    // If not cached, try to load custom sound
    if (!audio && soundId.startsWith('custom:')) {
      const customId = soundId.replace('custom:', '');
      const customSound = customSounds.find((s) => s.id === customId);
      if (customSound) {
        audio = new Audio(customSound.dataUrl);
        this.audioCache.set(soundId, audio);
      }
    }

    if (!audio) {
      console.warn(`Notification sound not found: ${soundId}`);
      return;
    }

    try {
      // Stop any currently playing notification sound to prevent overlap
      if (this.currentlyPlaying) {
        this.currentlyPlaying.pause();
        this.currentlyPlaying.currentTime = 0;
      }

      // Clone to allow the same sound to be triggered again quickly
      const clone = audio.cloneNode() as HTMLAudioElement;
      clone.volume = Math.max(0, Math.min(1, volume));
      this.currentlyPlaying = clone;
      await clone.play();
    } catch (e) {
      console.warn('Failed to play notification sound:', e);
    }
  }

  /**
   * Get available built-in sound options for UI (generated from BUILTIN_SOUNDS)
   */
  static getBuiltinSoundOptions(): Array<{ id: BuiltinSoundId; label: string }> {
    return Object.entries(BUILTIN_SOUNDS).map(([id, { label }]) => ({
      id: id as BuiltinSoundId,
      label,
    }));
  }
}

// Singleton instance
export const notificationAudio = new NotificationAudioService();
