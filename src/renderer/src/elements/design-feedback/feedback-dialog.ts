import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

/**
 * Dialog showing a captured screenshot with a text area for feedback.
 *
 * @element feedback-dialog
 * @fires feedback-submitted - { detail: { screenshot: string, text: string } }
 * @fires feedback-cancelled
 */
@localized()
@customElement('feedback-dialog')
export class FeedbackDialog extends LitElement {
  @property({ type: String })
  screenshot: string = '';

  @state()
  private _feedbackText: string = '';

  @state()
  private _submitting = false;

  @query('sl-dialog')
  private _dialog!: SlDialog;

  show() {
    this._feedbackText = '';
    this._submitting = false;
    this._dialog.show();
  }

  hide() {
    this._dialog.hide();
  }

  private _submit() {
    this._submitting = true;
    this.dispatchEvent(
      new CustomEvent('feedback-submitted', {
        detail: {
          screenshot: this.screenshot,
          text: this._feedbackText,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this._submitting = false;
    this.hide();
  }

  private _cancel() {
    this.dispatchEvent(
      new CustomEvent('feedback-cancelled', {
        bubbles: true,
        composed: true,
      }),
    );
    this.hide();
  }

  render() {
    return html`
      <sl-dialog label="${msg('Submit Feedback')}" style="--width: 700px;">
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
        </div>
        <div slot="footer" class="row" style="gap: 8px; justify-content: flex-end;">
          <sl-button variant="default" @click=${this._cancel}>
            ${msg('Cancel')}
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
    }

    .screenshot-img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: contain;
      max-height: 400px;
    }
  `;
}
