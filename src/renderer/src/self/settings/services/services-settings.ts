import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mossStyles } from '../../../shared-styles.js';
import './audio-sources-settings.js';
import './transcription-settings.js';
import './lan-discovery-settings.js';

enum ServiceTab {
  AudioSources,
  Transcription,
  LocalDiscovery,
}

/**
 * Services Moss provides on this device, one sub-tab each: those Tools can be
 * granted access to, and Moss's own local network discovery.
 */
@localized()
@customElement('moss-services-settings')
export class MossServicesSettings extends LitElement {
  @state() tab: ServiceTab = ServiceTab.AudioSources;

  renderContent() {
    switch (this.tab) {
      case ServiceTab.AudioSources:
        return html`<moss-audio-sources-settings></moss-audio-sources-settings>`;
      case ServiceTab.Transcription:
        return html`<moss-transcription-settings></moss-transcription-settings>`;
      case ServiceTab.LocalDiscovery:
        return html`<moss-lan-discovery-settings></moss-lan-discovery-settings>`;
    }
  }

  render() {
    return html`
      <div class="row items-center sub-tab-bar">
        <button
          class="tab ${this.tab === ServiceTab.AudioSources ? 'tab-selected' : ''}"
          @click=${() => (this.tab = ServiceTab.AudioSources)}
        >
          ${msg('Audio Sources')}
        </button>
        <button
          class="tab ${this.tab === ServiceTab.Transcription ? 'tab-selected' : ''}"
          @click=${() => (this.tab = ServiceTab.Transcription)}
        >
          ${msg('Transcription')}
        </button>
        <button
          class="tab ${this.tab === ServiceTab.LocalDiscovery ? 'tab-selected' : ''}"
          @click=${() => (this.tab = ServiceTab.LocalDiscovery)}
        >
          ${msg('Local Discovery')}
        </button>
      </div>
      <div class="column" style="margin-top: 16px;">${this.renderContent()}</div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      /* Wrap rather than scroll: a scrolled tab bar shifts the pane below it. */
      .sub-tab-bar {
        gap: 4px;
        flex-wrap: wrap;
      }
    `,
  ];
}
