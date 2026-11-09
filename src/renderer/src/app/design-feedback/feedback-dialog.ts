import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';

import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';

import { PersistedStore } from '../../persisted-store.js';
import { isValidGithubHandle } from './submit-result.js';

/** Detail of the feedback-submitted and feedback-copied events. */
export interface FeedbackDialogDetail {
  screenshot: string;
  text: string;
  mossVersion: string;
  os: string;
  /** Trimmed GitHub username, empty when the user gave none. */
  githubHandle: string;
}

/**
 * Dialog showing a captured screenshot with a text area for feedback.
 *
 * @element feedback-dialog
 * @fires feedback-submitted - { detail: FeedbackDialogDetail }
 * @fires feedback-copied - { detail: FeedbackDialogDetail }
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
  private _githubHandle: string = '';

  @state()
  private _submitting = false;

  private _persistedStore = new PersistedStore();

  /** Tracks whether we're closing due to submit/copy (don't emit cancelled) */
  private _closingIntentionally = false;

  @query('sl-dialog')
  private _dialog!: SlDialog;

  @query('sl-input')
  private _handleInput!: SlInput;

  show() {
    this._feedbackText = '';
    this._githubHandle = this._persistedStore.feedbackGithubHandle.value();
    this._submitting = false;
    this._closingIntentionally = false;
    // The prefilled handle was valid when saved, so clear any error left from a cancelled edit.
    this._handleInput.setCustomValidity('');
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

  private get _trimmedHandle(): string {
    return this._githubHandle.trim();
  }

  private get _handleValid(): boolean {
    return isValidGithubHandle(this._trimmedHandle);
  }

  private _detail(): FeedbackDialogDetail {
    return {
      screenshot: this.screenshot,
      text: this._feedbackText,
      mossVersion: this.mossVersion,
      os: this.os,
      githubHandle: this._trimmedHandle,
    };
  }

  private _submit() {
    this._submitting = true;
    this._closingIntentionally = true;
    this._persistedStore.feedbackGithubHandle.set(this._trimmedHandle);
    this.dispatchEvent(
      new CustomEvent<FeedbackDialogDetail>('feedback-submitted', {
        detail: this._detail(),
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
      new CustomEvent<FeedbackDialogDetail>('feedback-copied', {
        detail: this._detail(),
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
          <sl-input
            label="${msg('GitHub username (optional)')}"
            help-text="${msg('Not verified. Lets the team mention you on the issue.')}"
            .value=${this._githubHandle}
            @sl-input=${(e: Event) => {
              const input = e.target as SlInput;
              this._githubHandle = input.value;
              input.setCustomValidity(
                isValidGithubHandle(input.value.trim()) ? '' : msg('Not a valid GitHub username'),
              );
            }}
          ></sl-input>
          <div class="disclaimer">
            ${msg(
              'This screenshot and text, along with Moss version and OS info, will be added as a public GitHub issue to the',
            )}
            <a href="https://github.com/lightningrodlabs/moss" target="_blank"
              >${msg('Moss GitHub repo')}</a
            >.
            ${msg(
              'A pseudonymous reporter id, the same for every issue from this Moss profile, is included so the team can follow up. It cannot be traced back to you or your groups.',
            )}
            ${msg(
              'If you want to send it privately, press "Copy" to copy the feedback to your clipboard and email it to moss.0.15.feedback@theweave.social.',
            )}
          </div>
        </div>
        <div slot="footer" class="row" style="gap: 8px; justify-content: flex-end;">
          <sl-button variant="default" @click=${this._cancel}> ${msg('Cancel')} </sl-button>
          <sl-button
            variant="default"
            ?disabled=${!this._feedbackText.trim() || !this._handleValid}
            @click=${this._copyToClipboard}
          >
            ${msg('Copy')}
          </sl-button>
          <sl-button
            variant="primary"
            ?loading=${this._submitting}
            ?disabled=${!this._feedbackText.trim() || !this._handleValid}
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

    sl-input[data-user-invalid]::part(base) {
      border-color: var(--sl-color-danger-600);
    }

    sl-input[data-user-invalid]::part(form-control-help-text) {
      color: var(--sl-color-danger-700);
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
