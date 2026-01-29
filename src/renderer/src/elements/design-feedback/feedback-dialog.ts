import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

/**
 * Dialog showing a captured screenshot with a text area for feedback.
 *
 * @element feedback-dialog
 * @fires feedback-submitted - { detail: { screenshot: string, text: string, mossVersion: string, os: string } }
 * @fires feedback-copied - { detail: { screenshot: string, text: string, mossVersion: string, os: string } }
 * @fires feedback-cancelled
 */
@localized()
@customElement('feedback-dialog')
export class FeedbackDialog extends LitElement {
  @property({ type: String })
  screenshot: string = '';

  @property({ type: String })
  mossVersion: string = '';

  @property({ type: String })
  os: string = '';

  @state()
  private _feedbackText: string = '';

  @state()
  private _submitting = false;

  /** Tracks whether we're closing due to submit/copy (don't emit cancelled) */
  private _closingIntentionally = false;

  @query('sl-dialog')
  private _dialog!: SlDialog;

  show() {
    this._feedbackText = '';
    this._submitting = false;
    this._closingIntentionally = false;
    this._dialog.show();
  }

  hide() {
    this._dialog.hide();
  }

  /**
   * Handle sl-request-close: prevent closing by clicking outside if user has typed feedback
   */
  private _onRequestClose(e: CustomEvent<{ source: string }>) {
    // If user has typed feedback and tries to close by clicking overlay, prevent it
    if (e.detail.source === 'overlay' && this._feedbackText.trim()) {
      e.preventDefault();
    }
  }

  /**
   * Handle sl-hide: emit feedback-cancelled unless we're closing intentionally (submit/copy)
   */
  private _onDialogHide() {
    if (!this._closingIntentionally) {
      this.dispatchEvent(
        new CustomEvent('feedback-cancelled', {
          bubbles: true,
          composed: true,
        }),
      );
    }
    this._closingIntentionally = false;
  }

  private _submit() {
    this._submitting = true;
    this._closingIntentionally = true;
    this.dispatchEvent(
      new CustomEvent('feedback-submitted', {
        detail: {
          screenshot: this.screenshot,
          text: this._feedbackText,
          mossVersion: this.mossVersion,
          os: this.os,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this._submitting = false;
    this.hide();
  }

  private async _copyToClipboard() {
    const markdown = `## Design Feedback\n\n${this._feedbackText}\n\n### Screenshot\n\n![screenshot](${this.screenshot})\n\n### Environment\n- **Moss version:** ${this.mossVersion}\n- **OS:** ${this.os}`;
    await navigator.clipboard.writeText(markdown);
    notify(msg('Copied to clipboard'));
    this._closingIntentionally = true;
    this.dispatchEvent(
      new CustomEvent('feedback-copied', {
        detail: {
          screenshot: this.screenshot,
          text: this._feedbackText,
          mossVersion: this.mossVersion,
          os: this.os,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.hide();
  }

  private _cancel() {
    // _onDialogHide will emit feedback-cancelled
    this.hide();
  }

  render() {
    return html`
      <sl-dialog
        label="${msg('Submit Feedback')}"
        style="--width: 700px;"
        @sl-request-close=${this._onRequestClose}
        @sl-hide=${this._onDialogHide}
      >
        <div class="column" style="gap: 16px;">
          ${this.screenshot
            ? html`
                <div class="screenshot-container">
                  <img src=${this.screenshot} alt="Screenshot" class="screenshot-img" />
                </div>
              `
            : html``}
          <sl-textarea
            label="${msg('Describe your feedback')}"
            placeholder="${msg('What would you like to share about this part of the UI?')}"
            rows="4"
            .value=${this._feedbackText}
            @sl-input=${(e: Event) => {
              this._feedbackText = (e.target as HTMLTextAreaElement).value;
            }}
          ></sl-textarea>
          <div class="disclaimer">
            ${msg('This screenshot and text, along with Moss version and OS info, will be added as a public GitHub issue to the')}
            <a href="https://github.com/lightningrodlabs/moss" target="_blank"
              >${msg('Moss GitHub repo')}</a
            >.
            ${msg('If you want to send it privately, press "Copy" to copy the feedback to your clipboard and email it to moss.0.15.feedback@theweave.social.')}
          </div>
        </div>
        <div slot="footer" class="row" style="gap: 8px; justify-content: flex-end;">
          <sl-button variant="default" @click=${this._cancel}>
            ${msg('Cancel')}
          </sl-button>
          <sl-button
            variant="default"
            ?disabled=${!this._feedbackText.trim()}
            @click=${this._copyToClipboard}
          >
            ${msg('Copy')}
          </sl-button>
          <sl-button
            variant="primary"
            ?loading=${this._submitting}
            ?disabled=${!this._feedbackText.trim()}
            @click=${this._submit}
          >
            ${msg('Submit')}
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  static styles = css`
    .screenshot-container {
      border: 1px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
      max-height: 400px;
      padding: 8px;
    }

    .screenshot-img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: contain;
      max-height: 400px;
    }

    .disclaimer {
      font-size: 13px;
      opacity: 0.7;
      line-height: 1.4;
    }

    .disclaimer a {
      color: var(--sl-color-primary-600, #4c8cf5);
    }
  `;
}
