import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

import { mossStyles } from '../../../shared-styles.js';
import { PersistedStore } from '../../../persisted-store.js';
import './profile-settings.js';
import './language-settings.js';
import './danger-zone-settings.js';

enum TabsState {
  Profile,
  Language,
  Feedback,
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

  @state()
  _designFeedbackMode: boolean = false;

  private _persistedStore = new PersistedStore();

  connectedCallback() {
    super.connectedCallback();
    this._designFeedbackMode = this._persistedStore.designFeedbackMode.value();
  }

  renderProfile() {
    return html`<moss-profile-settings style="margin-top: 45px;"></moss-profile-settings>`;
  }

  renderLanguage() {
    return html`<moss-language-settings style="margin-top: 45px;"></moss-language-settings>`;
  }

  renderFeedback() {
    return html`
      <div class="column" style="margin-top: 45px; padding: 0 20px; gap: 16px;">
        <h3 style="margin: 0;">${msg('Design Feedback')}</h3>
        <p style="margin: 0; opacity: 0.8;">
          ${msg('Enable Design Feedback Mode to show a feedback button in the top-right corner. Click it to capture a screenshot of any area and submit feedback.')}
        </p>
        <sl-switch
          ?checked=${this._designFeedbackMode}
          @sl-change=${(e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            this._designFeedbackMode = checked;
            this._persistedStore.designFeedbackMode.set(checked);
            this.dispatchEvent(new CustomEvent('design-feedback-mode-changed', {
              detail: checked,
              bubbles: true,
              composed: true,
            }));
          }}
        >
          ${msg('Enable Design Feedback Mode')}
        </sl-switch>
      </div>
    `;
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
      case TabsState.Feedback:
        return this.renderFeedback();
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
          class="tab ${this.tabsState === TabsState.Feedback ? 'tab-selected' : ''}"
          @click=${() => {
            this.tabsState = TabsState.Feedback;
          }}
        >
          ${msg('Feedback')}
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
