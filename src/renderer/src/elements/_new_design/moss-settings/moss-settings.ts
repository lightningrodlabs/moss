import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../../shared-styles.js';
import './profile-settings.js';
import './language-settings.js';
import './danger-zone-settings.js';

enum TabsState {
  Profile,
  Language,
  DangerZone,
}

/**
 * @element moss-settings
 */
@localized()
@customElement('moss-settings')
export class MossSettings extends LitElement {
  @state()
  tabsState: TabsState = TabsState.Profile;

  renderProfile() {
    return html`<moss-profile-settings style="margin-top: 45px;"></moss-profile-settings>`;
  }

  renderLanguage() {
    return html`<moss-language-settings style="margin-top: 45px;"></moss-language-settings>`;
  }

  renderDangerZone() {
    return html`<moss-danger-zone-settings></moss-danger-zone-settings>`;
  }

  renderContent() {
    switch (this.tabsState) {
      case TabsState.Profile:
        return this.renderProfile();
      case TabsState.Language:
        return this.renderLanguage();
      case TabsState.DangerZone:
        return this.renderDangerZone();
    }
  }

  render() {
    return html`
      <div class="row items-center tab-bar flex-1">
        <button
          class="tab ${this.tabsState === TabsState.Profile ? 'tab-selected' : ''}"
          @click=${() => {
            this.tabsState = TabsState.Profile;
          }}
        >
          ${msg('Profile')}
        </button>
        <button
          class="tab ${this.tabsState === TabsState.Language ? 'tab-selected' : ''}"
          @click=${() => {
            this.tabsState = TabsState.Language;
          }}
        >
          ${msg('Language')}
        </button>
        <button
          class="tab ${this.tabsState === TabsState.DangerZone ? 'tab-selected' : ''}"
          @click=${() => {
            this.tabsState = TabsState.DangerZone;
          }}
        >
          ${msg('Danger Zone')}
        </button>
      </div>
      <div class="column" style="margin-top: 0px; min-height: 380px; overflow-y: auto;">
        ${this.renderContent()}
      </div>
    `;
  }

  static styles = [mossStyles, css``];
}
