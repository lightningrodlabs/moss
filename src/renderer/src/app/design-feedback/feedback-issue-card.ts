import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { localized, msg } from '@lit/localize';
import { notify, notifyError } from '@holochain-open-dev/elements';
import { commentRole } from '@theweave/utils';

import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import type SlTextarea from '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { mossStyles } from '../../shared-styles.js';
import { feedbackIssueCardStyles } from './feedback-issue-card-styles.js';
import { markdownParseSafe } from '../../utils.js';
import type {
  FeedbackActionResult,
  FeedbackCommentWire,
  FeedbackRecordSummary,
} from '../../electron-api.js';
import { actionNotice, badgeText, cardTitle, imagesToLinks } from './thread-view.js';

const REPLY_MAX_LENGTH = 10000;

/**
 * One feedback report: a collapsed summary row that expands into the original
 * text, the issue thread, and reply and resolve controls. Fires
 * `feedback-changed` with the updated summary whenever the record changes.
 *
 * @element feedback-issue-card
 */
@localized()
@customElement('feedback-issue-card')
export class FeedbackIssueCard extends LitElement {
  @property({ attribute: false })
  record!: FeedbackRecordSummary;

  /** Unread team comments on this record. */
  @property({ type: Number })
  unread = 0;

  @state()
  _expanded = false;

  @state()
  _reply = '';

  @state()
  _busy = false;

  private _emitChanged(record: FeedbackRecordSummary) {
    this.dispatchEvent(
      new CustomEvent<FeedbackRecordSummary>('feedback-changed', {
        detail: record,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _toggle() {
    this._expanded = !this._expanded;
    if (!this._expanded || this.unread === 0) return;
    try {
      const updated = await window.electronAPI.markFeedbackRead(this.record.id);
      if (updated) this._emitChanged(updated);
    } catch (e) {
      console.error('Failed to mark feedback read:', e);
    }
  }

  /** Shows the notice for an action and propagates the updated record on success. */
  private _handleResult(result: FeedbackActionResult, successNotice: string): boolean {
    switch (actionNotice(result)) {
      case 'success':
        notify(successNotice);
        if (result.ok) this._emitChanged(result.record);
        return true;
      case 'already-closed':
        notifyError(msg('This issue is already closed.'));
        return false;
      case 'rejected':
        notifyError(msg('The reply was not accepted. Check its length and try again.'));
        return false;
      case 'unreachable':
        notifyError(msg('Could not reach the feedback service. Nothing was sent.'));
        return false;
    }
  }

  private async _send() {
    const text = this._reply.trim();
    if (text === '' || this._busy) return;
    this._busy = true;
    try {
      const result = await window.electronAPI.replyFeedback(this.record.id, text);
      if (this._handleResult(result, msg('Reply posted.'))) this._reply = '';
    } catch (e) {
      console.error('Failed to send feedback reply:', e);
      notifyError(msg('Could not reach the feedback service. Nothing was sent.'));
    } finally {
      this._busy = false;
    }
  }

  private async _resolve() {
    if (this._busy) return;
    this._busy = true;
    try {
      const result = await window.electronAPI.resolveFeedback(this.record.id);
      this._handleResult(result, msg('Issue marked resolved.'));
    } catch (e) {
      console.error('Failed to resolve feedback issue:', e);
      notifyError(msg('Could not reach the feedback service. Nothing was sent.'));
    } finally {
      this._busy = false;
    }
  }

  private async _copyFeedback() {
    try {
      const feedback = await window.electronAPI.getFeedback(this.record.id);
      if (!feedback) return;
      const markdown = `## Design Feedback\n\n${feedback.text}\n\n### Screenshot\n\n![screenshot](${feedback.screenshot})\n\n### Environment\n- **Moss version:** ${feedback.mossVersion}\n- **OS:** ${feedback.os}`;
      await navigator.clipboard.writeText(markdown);
      notify(msg('Copied to clipboard'));
    } catch (e) {
      console.error('Failed to copy feedback:', e);
    }
  }

  private _formatDate(timestampMs: number): string {
    return new Date(timestampMs).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private _renderComment(c: FeedbackCommentWire) {
    return html`<div class="comment ${commentRole(c)}">
      <div class="row comment-meta" style="gap: 8px;">
        <span class="comment-author">${c.authorLogin}</span>
        <span class="feedback-date">${this._formatDate(c.createdAt * 1000)}</span>
      </div>
      ${c.deleted
        ? html`<div class="deleted">${msg('Comment deleted')}</div>`
        : html`<div class="comment-body">
            ${unsafeHTML(markdownParseSafe(imagesToLinks(c.body)))}
          </div>`}
    </div>`;
  }

  private _renderExpanded() {
    const r = this.record;
    const filed = r.issueNumber !== undefined;
    return html`<div class="column details" style="gap: 8px;">
      <div class="original">${r.text}</div>
      ${(r.comments ?? []).map((c) => this._renderComment(c))}
      ${filed
        ? html`<sl-textarea
              .value=${this._reply}
              maxlength=${REPLY_MAX_LENGTH}
              rows="3"
              resize="auto"
              @sl-input=${(e: Event) => {
                this._reply = (e.target as SlTextarea).value;
              }}
            ></sl-textarea>
            <div class="row" style="gap: 8px; justify-content: flex-end;">
              ${r.state === 'open'
                ? html`<sl-tooltip
                    content=${msg(
                      'Closes the GitHub issue as completed. You cannot reopen it from Moss.',
                    )}
                  >
                    <button
                      class="moss-button-secondary"
                      ?disabled=${this._busy}
                      @click=${this._resolve}
                    >
                      ${msg('Mark resolved')}
                    </button>
                  </sl-tooltip>`
                : html``}
              <button
                class="moss-button"
                ?disabled=${this._busy || this._reply.trim() === ''}
                @click=${this._send}
              >
                ${msg('Send')}
              </button>
            </div>`
        : html``}
    </div>`;
  }

  render() {
    const r = this.record;
    return html`<div class="card column">
      <div class="row" style="gap: 12px; align-items: center;">
        <button
          class="summary column"
          aria-expanded=${this._expanded ? 'true' : 'false'}
          @click=${this._toggle}
        >
          <span class="row" style="gap: 8px; align-items: center;">
            <span class="title">${cardTitle(r)}</span>
            ${this.unread > 0
              ? html`<span class="row center-content notification-dot urgent">
                  ${badgeText(this.unread)}
                </span>`
              : html``}
          </span>
          <span class="feedback-date">${this._formatDate(r.timestamp)}</span>
        </button>
        ${r.issueUrl
          ? html`<a class="link" href=${r.issueUrl} target="_blank">${msg('View on GitHub')}</a>`
          : r.issueNumber === undefined
            ? html`<button class="moss-button-secondary" @click=${this._copyFeedback}>
                ${msg('Copy')}
              </button>`
            : html``}
      </div>
      ${this._expanded ? this._renderExpanded() : html``}
    </div>`;
  }

  static styles = [mossStyles, feedbackIssueCardStyles];
}
