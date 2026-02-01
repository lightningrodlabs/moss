import {
  NotificationSoundId,
  GlobalNotificationSoundSettings,
  BuiltinSoundId,
  CustomSound,
} from '../applets/types.js';

const BUILTIN_SOUNDS: Record<BuiltinSoundId, string | null> = {
  none: null,
  chime: '/sounds/chime.wav',
  bell: '/sounds/bell.wav',
  pop: '/sounds/pop.wav',
  ding: '/sounds/ding.wav',
};

export class NotificationAudioService {
  private audioCache: Map<string, HTMLAudioElement> = new Map();

  /**
   * Preload all built-in sound files for faster playback
   */
  preloadBuiltinSounds(): void {
    Object.entries(BUILTIN_SOUNDS).forEach(([id, path]) => {
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

    if (!audio) return;

    try {
      // Clone the audio element to allow overlapping plays
      const clone = audio.cloneNode() as HTMLAudioElement;
      clone.volume = Math.max(0, Math.min(1, volume));
      await clone.play();
    } catch (e) {
      console.warn('Failed to play notification sound:', e);
    }
  }

  /**
   * Get available built-in sound options for UI
   */
  static getBuiltinSoundOptions(): Array<{ id: BuiltinSoundId; label: string }> {
    return [
      { id: 'none', label: 'None' },
      { id: 'chime', label: 'Chime' },
      { id: 'bell', label: 'Bell' },
      { id: 'pop', label: 'Pop' },
      { id: 'ding', label: 'Ding' },
    ];
  }
}

// Singleton instance
export const notificationAudio = new NotificationAudioService();
