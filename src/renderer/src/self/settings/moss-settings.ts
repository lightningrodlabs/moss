import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import { mossStyles } from '../../shared-styles.js';
import '../profile/profile-settings.js';
import './language-settings.js';
import './notification-settings.js';
import './danger-zone-settings.js';
import './services/services-settings.js';
import '../../app/design-feedback/feedback-settings.js';

enum TabsState {
  Profile,
  Language,
  Notifications,
  Services,
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

  renderProfile() {
    return html`<moss-profile-settings></moss-profile-settings>`;
  }

  renderLanguage() {
    return html`<moss-language-settings></moss-language-settings>`;
  }

  renderNotifications() {
    return html`<moss-notification-sound-settings></moss-notification-sound-settings>`;
  }

  renderServices() {
    return html`<moss-services-settings></moss-services-settings>`;
  }

  renderFeedback() {
    return html`<feedback-settings></feedback-settings>`;
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
      case TabsState.Notifications:
        return this.renderNotifications();
      case TabsState.Services:
        return this.renderServices();
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
          class="tab ${this.tabsState === TabsState.Notifications ? 'tab-selected' : ''}"
          @click=${() => {
            this.tabsState = TabsState.Notifications;
          }}
        >
          ${msg('Notifications')}
        </button>
        <button
          class="tab ${this.tabsState === TabsState.Services ? 'tab-selected' : ''}"
          @click=${() => {
            this.tabsState = TabsState.Services;
          }}
        >
          ${msg('Services')}
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
      <div class="column" style="margin-top: 20px; min-height: 380px; overflow-y: auto;">
        ${this.renderContent()}
      </div>
    `;
  }

  static styles = [mossStyles];
}
