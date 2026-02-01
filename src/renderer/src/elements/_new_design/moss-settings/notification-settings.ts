import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiPlay } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { mossStyles } from '../../../shared-styles.js';
import {
  GlobalNotificationSoundSettings,
  NotificationSoundId,
  CustomSound,
} from '../../../applets/types.js';
import { notificationAudio, NotificationAudioService } from '../../../services/notification-audio.js';

type UrgencyLevel = 'high' | 'medium' | 'low';

@localized()
@customElement('moss-notification-settings')
export class MossNotificationSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  settings: GlobalNotificationSoundSettings = {
    masterEnabled: true,
    volume: 0.7,
    perUrgency: {
      high: { enabled: true, soundId: 'chime' },
      medium: { enabled: true, soundId: 'bell' },
      low: { enabled: false, soundId: 'pop' },
    },
    customSounds: [],
  };

  firstUpdated() {
    this.settings = this.mossStore.persistedStore.notificationSoundSettings.value();
  }

  private saveSettings() {
    this.mossStore.persistedStore.notificationSoundSettings.set(this.settings);
  }

  private handleMasterToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this.settings = { ...this.settings, masterEnabled: checked };
    this.saveSettings();
  }

  private handleVolumeChange(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this.settings = { ...this.settings, volume: parseInt(value) / 100 };
    this.saveSettings();
  }

  private handleUrgencyToggle(urgency: UrgencyLevel, e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this.settings = {
      ...this.settings,
      perUrgency: {
        ...this.settings.perUrgency,
        [urgency]: { ...this.settings.perUrgency[urgency], enabled: checked },
      },
    };
    this.saveSettings();
  }

  private handleSoundChange(urgency: UrgencyLevel, e: Event) {
    const soundId = (e.target as HTMLSelectElement).value as NotificationSoundId;
    this.settings = {
      ...this.settings,
      perUrgency: {
        ...this.settings.perUrgency,
        [urgency]: { ...this.settings.perUrgency[urgency], soundId },
      },
    };
    this.saveSettings();
  }

  private async previewSound(soundId: NotificationSoundId) {
    await notificationAudio.play(soundId, this.settings.volume, this.settings.customSounds);
  }

  private getSoundOptions(): Array<{ id: NotificationSoundId; label: string }> {
    const builtin = NotificationAudioService.getBuiltinSoundOptions();
    const custom = this.settings.customSounds.map((s) => ({
      id: `custom:${s.id}` as NotificationSoundId,
      label: `${s.name} (${msg('custom')})`,
    }));
    return [...builtin, ...custom];
  }

  private async addCustomSound() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mp3,audio/wav,audio/ogg,.mp3,.wav,.ogg';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // Validate file size (max 500KB)
      if (file.size > 500 * 1024) {
        notify(msg('Sound file must be under 500KB'));
        return;
      }

      // Convert to base64 data URL
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const customSound: CustomSound = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''), // Remove extension
          dataUrl,
        };

        this.settings = {
          ...this.settings,
          customSounds: [...this.settings.customSounds, customSound],
        };
        this.saveSettings();

        // Preload the new sound
        notificationAudio.preloadCustomSounds([customSound]);
        notify(msg('Custom sound added'));
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  private deleteCustomSound(id: string) {
    // Check if sound is in use
    const isInUse = Object.values(this.settings.perUrgency).some(
      (s) => s.soundId === `custom:${id}`,
    );

    if (isInUse) {
      notify(msg('Cannot delete sound while it is in use. Change urgency settings first.'));
      return;
    }

    this.settings = {
      ...this.settings,
      customSounds: this.settings.customSounds.filter((s) => s.id !== id),
    };
    this.saveSettings();
    notify(msg('Custom sound deleted'));
  }

  private getUrgencyLabel(urgency: UrgencyLevel): string {
    switch (urgency) {
      case 'high':
        return msg('High (OS notification)');
      case 'medium':
        return msg('Medium (systray icon)');
      case 'low':
        return msg('Low (activity feed only)');
    }
  }

  private renderUrgencyRow(urgency: UrgencyLevel) {
    const urgencySettings = this.settings.perUrgency[urgency];
    const soundOptions = this.getSoundOptions();

    return html`
      <div class="urgency-row">
        <div class="urgency-label">${this.getUrgencyLabel(urgency)}</div>
        <div class="urgency-controls">
          <sl-switch
            size="small"
            ?checked=${urgencySettings.enabled}
            @sl-change=${(e: Event) => this.handleUrgencyToggle(urgency, e)}
          ></sl-switch>
          <select
            class="moss-select"
            .value=${urgencySettings.soundId}
            ?disabled=${!urgencySettings.enabled}
            @change=${(e: Event) => this.handleSoundChange(urgency, e)}
          >
            ${soundOptions.map(
              (option) => html`
                <option value=${option.id} ?selected=${option.id === urgencySettings.soundId}>
                  ${option.label}
                </option>
              `,
            )}
          </select>
          <button
            class="moss-mini-button-primary play-button ${!urgencySettings.enabled || urgencySettings.soundId === 'none' ? 'moss-mini-button-disabled' : ''}"
            title=${msg('Play sound')}
            ?disabled=${!urgencySettings.enabled || urgencySettings.soundId === 'none'}
            @click=${() => this.previewSound(urgencySettings.soundId)}
          >
            <sl-icon .src=${wrapPathInSvg(mdiPlay)}></sl-icon>
          </button>
        </div>
      </div>
    `;
  }

  private renderCustomSoundsSection() {
    return html`
      <div class="section">
        <div class="section-header">
          <h4>${msg('Custom Sounds')}</h4>
          <button class="moss-mini-button-secondary" @click=${() => this.addCustomSound()}>
            ${msg('Add Sound')}
          </button>
        </div>
        ${this.settings.customSounds.length === 0
          ? html`<div class="no-custom-sounds">${msg('No custom sounds added yet.')}</div>`
          : html`
              <div class="custom-sounds-list">
                ${this.settings.customSounds.map(
                  (sound) => html`
                    <div class="custom-sound-item">
                      <span class="custom-sound-name">${sound.name}</span>
                      <div class="custom-sound-actions">
                        <button
                          class="moss-mini-button-primary play-button"
                          title=${msg('Play sound')}
                          @click=${() => this.previewSound(`custom:${sound.id}`)}
                        >
                          <sl-icon .src=${wrapPathInSvg(mdiPlay)}></sl-icon>
                        </button>
                        <sl-button
                          size="small"
                          variant="text"
                          @click=${() => this.deleteCustomSound(sound.id)}
                        >
                          ${msg('Delete')}
                        </sl-button>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `}
        <div class="custom-sounds-note">
          ${msg('Accepted formats: MP3, WAV, OGG. Maximum size: 500KB.')}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="column flex-1">
        <div style="margin-bottom: 24px; opacity: 0.8;">
          ${msg('Configure sounds for notifications. Sounds only play when the window is not focused.')}
        </div>

        <div class="section master-row">
          <sl-switch ?checked=${this.settings.masterEnabled} @sl-change=${this.handleMasterToggle}>
            ${msg('Enable notification sounds')}
          </sl-switch>
          <div class="volume-row" style="${!this.settings.masterEnabled ? 'opacity: 0.5; pointer-events: none;' : ''}">
            <label>${msg('Volume')}</label>
            <sl-range
              min="0"
              max="100"
              .value=${Math.round(this.settings.volume * 100)}
              @sl-change=${this.handleVolumeChange}
            ></sl-range>
            <span class="volume-value">${Math.round(this.settings.volume * 100)}%</span>
          </div>
        </div>

        <div class="section" style="${!this.settings.masterEnabled ? 'opacity: 0.5; pointer-events: none;' : ''}">
          <h4>${msg('Sound per urgency level')}</h4>
          ${this.renderUrgencyRow('high')}
          ${this.renderUrgencyRow('medium')}
          ${this.renderUrgencyRow('low')}
        </div>

        <div style="${!this.settings.masterEnabled ? 'opacity: 0.5; pointer-events: none;' : ''}">
          ${this.renderCustomSoundsSection()}
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }

      h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
      }

      .section {
        margin-bottom: 24px;
      }

      .master-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .section-header h4 {
        margin: 0;
      }

      .volume-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .volume-row label {
        min-width: 60px;
        font-weight: 500;
      }

      .volume-row sl-range {
        flex: 1;
        max-width: 200px;
      }

      .volume-value {
        min-width: 45px;
        text-align: right;
        font-size: 14px;
        opacity: 0.8;
      }

      .urgency-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid var(--sl-color-neutral-200);
      }

      .urgency-row:last-of-type {
        border-bottom: none;
      }

      .urgency-label {
        font-size: 14px;
      }

      .urgency-controls {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .moss-select {
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid var(--sl-color-neutral-300);
        background: var(--sl-color-neutral-0);
        font-size: 13px;
        min-width: 140px;
        cursor: pointer;
      }

      .moss-select:hover:not(:disabled) {
        border-color: var(--sl-color-neutral-400);
      }

      .moss-select:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .moss-select:focus {
        outline: none;
        border-color: var(--sl-color-primary-500);
        box-shadow: 0 0 0 3px var(--sl-color-primary-100);
      }

      .custom-sounds-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .custom-sound-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 6px;
      }

      .custom-sound-name {
        font-size: 14px;
      }

      .custom-sound-actions {
        display: flex;
        gap: 8px;
      }

      .no-custom-sounds {
        font-size: 13px;
        opacity: 0.6;
        padding: 8px 0;
      }

      .custom-sounds-note {
        font-size: 12px;
        opacity: 0.6;
        margin-top: 12px;
      }

      .play-button {
        min-width: 32px;
        padding: 8px;
      }

      .play-button sl-icon {
        font-size: 16px;
      }
    `,
  ];
}
