import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mossStyles } from '../../../shared-styles.js';
import './audio-sources-settings.js';

enum CapabilityTab {
  AudioSources,
}

/**
 * Host capabilities Tools can be granted, one sub-tab each. Audio Sources is
 * the first; the Local AI tab joins here when that branch lands.
 */
@localized()
@customElement('moss-capabilities-settings')
export class MossCapabilitiesSettings extends LitElement {
  @state() tab: CapabilityTab = CapabilityTab.AudioSources;

  renderContent() {
    switch (this.tab) {
      case CapabilityTab.AudioSources:
        return html`<moss-audio-sources-settings></moss-audio-sources-settings>`;
    }
  }

  render() {
    return html`
      <div class="row items-center sub-tab-bar">
        <button class="tab ${this.tab === CapabilityTab.AudioSources ? 'tab-selected' : ''}" @click=${() => (this.tab = CapabilityTab.AudioSources)}>
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
