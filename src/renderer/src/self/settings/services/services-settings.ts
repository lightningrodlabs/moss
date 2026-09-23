import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mossStyles } from '../../../shared-styles.js';
import './audio-sources-settings.js';

enum ServiceTab {
  AudioSources,
}

/**
 * Host services Tools can be granted access to, one sub-tab each. Audio
 * Sources is the first; the Local AI tab joins here when that branch lands.
 */
@localized()
@customElement('moss-services-settings')
export class MossServicesSettings extends LitElement {
  @state() tab: ServiceTab = ServiceTab.AudioSources;

  renderContent() {
    switch (this.tab) {
      case ServiceTab.AudioSources:
        return html`<moss-audio-sources-settings></moss-audio-sources-settings>`;
    }
  }

  render() {
    return html`
      <div class="row items-center sub-tab-bar">
        <button class="tab ${this.tab === ServiceTab.AudioSources ? 'tab-selected' : ''}" @click=${() => (this.tab = ServiceTab.AudioSources)}>
          ${msg('Audio Sources')}
        </button>
      </div>
      <div class="column" style="margin-top: 16px;">${this.renderContent()}</div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .sub-tab-bar { gap: 4px; }
    `,
  ];
}
