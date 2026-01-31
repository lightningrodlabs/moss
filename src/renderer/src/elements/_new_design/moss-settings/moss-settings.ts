import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

import { mossStyles } from '../../../shared-styles.js';
import { PersistedStore } from '../../../persisted-store.js';
import './profile-settings.js';
import './language-settings.js';
import './danger-zone-settings.js';

type FeedbackRecord = {
  id: string;
  text: string;
  mossVersion: string;
  os: string;
  timestamp: number;
  issueUrl?: string;
};

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

  @state()
  _feedbackHistory: FeedbackRecord[] = [];

  @state()
  _loadingHistory = false;

  private _persistedStore = new PersistedStore();

  connectedCallback() {
    super.connectedCallback();
    this._designFeedbackMode = this._persistedStore.designFeedbackMode.value();
    window.addEventListener('design-feedback-mode-changed', this._onDesignFeedbackModeChanged as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('design-feedback-mode-changed', this._onDesignFeedbackModeChanged as EventListener);
  }

  private _onDesignFeedbackModeChanged = (e: CustomEvent<boolean>) => {
    this._designFeedbackMode = e.detail;
  };

  private async _loadFeedbackHistory() {
    this._loadingHistory = true;
    try {
      this._feedbackHistory = await window.electronAPI.listFeedback();
    } catch (e) {
      console.error('Failed to load feedback history:', e);
      this._feedbackHistory = [];
    }
    this._loadingHistory = false;
  }

  private async _copyFeedback(id: string) {
    try {
      const feedback = await window.electronAPI.getFeedback(id);
      if (!feedback) return;
      const markdown = `## Design Feedback\n\n${feedback.text}\n\n### Screenshot\n\n![screenshot](${feedback.screenshot})\n\n### Environment\n- **Moss version:** ${feedback.mossVersion}\n- **OS:** ${feedback.os}`;
      await navigator.clipboard.writeText(markdown);
      notify(msg('Copied to clipboard'));
    } catch (e) {
      console.error('Failed to copy feedback:', e);
    }
  }

  private _formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
            this.dispatchEvent(
              new CustomEvent('design-feedback-mode-changed', {
                detail: checked,
                bubbles: true,
                composed: true,
              }),
            );
          }}
        >
          ${msg('Enable Design Feedback Mode')}
        </sl-switch>

        <h4 style="margin: 16px 0 0 0;">${msg('Feedback History')}</h4>
        ${this._feedbackHistory.length === 0 && !this._loadingHistory
          ? html`<p style="margin: 0; opacity: 0.6; font-size: 14px;">
              ${msg('No feedback submitted yet.')}
            </p>`
          : html``}
        ${this._loadingHistory
          ? html`<p style="margin: 0; opacity: 0.6; font-size: 14px;">
              ${msg('loading...')}
            </p>`
          : html``}
        <div class="column" style="gap: 8px;">
          ${this._feedbackHistory.map(
            (item) => html`
              <div class="feedback-item row" style="gap: 12px; align-items: center;">
                <div class="column" style="flex: 1; min-width: 0;">
                  <span class="feedback-text">${item.text.length > 80 ? item.text.substring(0, 77) + '...' : item.text}</span>
                  <span class="feedback-date">${this._formatDate(item.timestamp)}</span>
                </div>
                ${item.issueUrl
                  ? html`<sl-button
                      variant="text"
                      size="small"
                      href=${item.issueUrl}
                      target="_blank"
                      >${msg('View Issue')}</sl-button
                    >`
                  : html`<sl-button
                      variant="text"
                      size="small"
                      @click=${() => this._copyFeedback(item.id)}
                      >${msg('Copy')}</sl-button
                    >`}
              </div>
            `,
          )}
        </div>
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
            this._designFeedbackMode = this._persistedStore.designFeedbackMode.value();
            this._loadFeedbackHistory();
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

  static styles = [
    mossStyles,
    css`
      .feedback-item {
        padding: 8px 12px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.05);
      }

      .feedback-text {
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .feedback-date {
        font-size: 12px;
        opacity: 0.6;
      }
    `,
  ];
}
