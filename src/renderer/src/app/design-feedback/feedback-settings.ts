import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { unreadTeamComments } from '@theweave/utils';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { mossStyles } from '../../shared-styles.js';
import { PersistedStore } from '../../persisted-store.js';
import type { FeedbackRecordSummary } from '../../electron-api.js';
import './feedback-history.js';

/**
 * The Feedback tab in Settings: the Design Feedback Mode switch, the reporter
 * id, and the reporter's issue threads. Owns the feedback records and keeps
 * them current from the main process.
 *
 * @element feedback-settings
 */
@localized()
@customElement('feedback-settings')
export class FeedbackSettings extends LitElement {
  @state()
  _designFeedbackMode = false;

  @state()
  _records: FeedbackRecordSummary[] = [];

  @state()
  _reporterId?: string;

  @state()
  _loadingHistory = true;

  private _persistedStore = new PersistedStore();

  private _unsubscribeUnread?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this._designFeedbackMode = this._persistedStore.designFeedbackMode.value();
    window.addEventListener(
      'design-feedback-mode-changed',
      this._onDesignFeedbackModeChanged as EventListener,
    );
    this._unsubscribeUnread = window.electronAPI.onFeedbackUnreadChanged(() => {
      void this._reloadRecords();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      'design-feedback-mode-changed',
      this._onDesignFeedbackModeChanged as EventListener,
    );
    this._unsubscribeUnread?.();
    this._unsubscribeUnread = undefined;
  }

  firstUpdated() {
    void this._load();
  }

  private _onDesignFeedbackModeChanged = (e: CustomEvent<boolean>) => {
    this._designFeedbackMode = e.detail;
  };

  /** Shows the stored records first, then replaces them with a fresh sync from the worker. */
  private async _load() {
    this._loadingHistory = true;
    const [history, status] = await Promise.allSettled([
      window.electronAPI.listFeedback(),
      window.electronAPI.getFeedbackReporterStatus(),
    ]);
    if (history.status === 'fulfilled') {
      this._records = history.value;
    } else {
      console.error('Failed to load feedback history:', history.reason);
      this._records = [];
    }
    if (status.status === 'fulfilled') {
      this._reporterId = status.value.reporterId;
    } else {
      console.error('Failed to load feedback reporter status:', status.reason);
      this._reporterId = undefined;
    }
    this._loadingHistory = false;
    try {
      const synced = await window.electronAPI.syncFeedbackNow();
      this._records = synced.records;
    } catch (e) {
      console.error('Failed to sync feedback threads:', e);
    }
  }

  private async _reloadRecords() {
    try {
      this._records = await window.electronAPI.listFeedback();
    } catch (e) {
      console.error('Failed to reload feedback history:', e);
    }
  }

  private _onFeedbackChanged = (e: CustomEvent<FeedbackRecordSummary>) => {
    const updated = e.detail;
    this._records = this._records.map((r) => (r.id === updated.id ? updated : r));
  };

  private _unreadByRecord(): Record<string, number> {
    const unread: Record<string, number> = {};
    for (const r of this._records) {
      unread[r.id] = unreadTeamComments(r.comments ?? [], r.lastReadAt);
    }
    return unread;
  }

  render() {
    return html`
      <div class="column" style="padding: 0 20px; gap: 16px;">
        <h3 style="margin: 0;">${msg('Design Feedback')}</h3>
        <p style="margin: 0; opacity: 0.8;">
          ${msg(
            'Enable Design Feedback Mode to show a feedback button in the top-left corner. Click it to capture a screenshot of any area and submit feedback.',
          )}
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
        ${this._reporterId !== undefined
          ? html`<sl-tooltip
              content=${msg('A pseudonymous id included on your issues so the team can follow up.')}
            >
              <span class="feedback-date">${msg('Your reporter id:')} ${this._reporterId}</span>
            </sl-tooltip>`
          : this._loadingHistory
            ? html``
            : html`<p class="muted">${msg('The feedback key could not be loaded.')}</p>`}

        <h4 style="margin: 16px 0 0 0;">${msg('Feedback History')}</h4>
        ${this._loadingHistory
          ? html`<p class="muted">${msg('loading...')}</p>`
          : this._records.length === 0
            ? html`<p class="muted">${msg('No feedback submitted yet.')}</p>`
            : html`<feedback-history
                .records=${this._records}
                .unreadByRecord=${this._unreadByRecord()}
                @feedback-changed=${this._onFeedbackChanged}
              ></feedback-history>`}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .feedback-date {
        font-size: 12px;
        opacity: 0.6;
      }

      .muted {
        margin: 0;
        opacity: 0.6;
        font-size: 14px;
      }
    `,
  ];
}
