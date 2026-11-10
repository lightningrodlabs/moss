import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import { mossStyles } from '../../shared-styles.js';
import '../profile/profile-settings.js';
import './language-settings.js';
import './notification-settings.js';
import './danger-zone-settings.js';
import './services/services-settings.js';
import '../../app/design-feedback/feedback-settings.js';
import { badgeText } from '../../app/design-feedback/thread-view.js';

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

  @state()
  private _feedbackUnread = 0;

  private _feedbackUnreadUnsub: (() => void) | undefined;

  /** Lets the dashboard land on the Feedback tab before showing the dialog. */
  showFeedbackTab() {
    this.tabsState = TabsState.Feedback;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.electronAPI
      .getFeedbackUnreadCount()
      .then((count) => (this._feedbackUnread = count))
      .catch((e) => console.warn('Failed to read feedback unread count: ', e));
    this._feedbackUnreadUnsub = window.electronAPI.onFeedbackUnreadChanged((_, count) => {
      this._feedbackUnread = count;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._feedbackUnreadUnsub?.();
    this._feedbackUnreadUnsub = undefined;
  }

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
          <span class="feedback-tab-label">
            ${msg('Feedback')}
            ${this._feedbackUnread > 0
              ? html`<span
                  class="row center-content feedback-unread-dot ${this._feedbackUnread > 9
                    ? 'padded'
                    : ''}"
                >
                  ${badgeText(this._feedbackUnread)}
                </span>`
              : html``}
          </span>
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

  static styles = [
    mossStyles,
    css`
      .feedback-tab-label {
        position: relative;
        display: inline-block;
      }

      .feedback-unread-dot {
        position: absolute;
        top: -4px;
        right: -22px;
        font-weight: bold;
        background: var(--moss-purple);
        border-radius: 4px;
        height: 16px;
        min-width: 18px;
        color: white;
        font-size: 12px;
      }

      .feedback-unread-dot.padded {
        padding: 0 4px;
      }
    `,
  ];
}
