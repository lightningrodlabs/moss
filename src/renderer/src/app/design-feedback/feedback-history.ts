import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';

import { mossStyles } from '../../shared-styles.js';
import type { FeedbackRecordSummary } from '../../electron-api.js';
import { badgeText, splitByState } from './thread-view.js';
import './feedback-issue-card.js';

/**
 * The reporter's feedback split into Open and Closed tabs, newest first.
 * Card `feedback-changed` events bubble through to the owner of the records.
 *
 * @element feedback-history
 */
@localized()
@customElement('feedback-history')
export class FeedbackHistory extends LitElement {
  @property({ attribute: false })
  records: FeedbackRecordSummary[] = [];

  /** Unread team comments per record id. */
  @property({ attribute: false })
  unreadByRecord: Record<string, number> = {};

  private _renderCards(records: FeedbackRecordSummary[]) {
    return html`<div class="column" style="gap: 8px;">
      ${repeat(
        records,
        (r) => r.id,
        (r) =>
          html`<feedback-issue-card
            .record=${r}
            .unread=${this.unreadByRecord[r.id] ?? 0}
          ></feedback-issue-card>`,
      )}
    </div>`;
  }

  private _renderBadge(count: number) {
    if (count === 0) return html``;
    return html`<div
      class="row center-content notification-dot urgent ${count > 9 ? 'padded' : ''}"
    >
      ${badgeText(count)}
    </div>`;
  }

  render() {
    const { open, closed } = splitByState(this.records);
    const openUnread = open.reduce((sum, r) => sum + (this.unreadByRecord[r.id] ?? 0), 0);
    return html`
      <sl-tab-group>
        <sl-tab slot="nav" panel="open">
          <span class="tab-label">${msg('Open')} ${this._renderBadge(openUnread)}</span>
        </sl-tab>
        <sl-tab slot="nav" panel="closed">${msg('Closed')}</sl-tab>
        <sl-tab-panel name="open">
          ${open.length === 0
            ? html`<p class="muted">${msg('No open feedback.')}</p>`
            : this._renderCards(open)}
        </sl-tab-panel>
        <sl-tab-panel name="closed">
          ${closed.length === 0
            ? html`<p class="muted">${msg('No closed feedback.')}</p>`
            : this._renderCards(closed)}
        </sl-tab-panel>
      </sl-tab-group>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .tab-label {
        position: relative;
        padding-right: 12px;
      }

      .muted {
        margin: 0;
        opacity: 0.6;
        font-size: 14px;
      }

      .notification-dot {
        position: absolute;
        top: -4px;
        right: -8px;
        font-weight: bold;
        background: var(--moss-purple);
        border-radius: 10px;
        height: 10px;
        min-width: 10px;
        z-index: 1;
      }

      .urgent {
        height: 16px;
        min-width: 18px;
        border-radius: 4px;
        color: white;
        font-size: 12px;
      }

      .padded {
        padding: 0 4px;
      }
    `,
  ];
}
