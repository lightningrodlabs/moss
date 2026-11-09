import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';

import './area-selector.js';
import './feedback-dialog.js';
import { FeedbackDialog, type FeedbackDialogDetail } from './feedback-dialog.js';
import { noticeForResult, type SubmitNotice } from './submit-result.js';
import { PersistedStore } from '../../persisted-store.js';
import { getAppVersion, type FeedbackSubmitInput } from '../../electron-api.js';
import { commentHeartIconFilled } from '../../icons/icons.js';

type FeedbackState = 'idle' | 'capturing' | 'selecting' | 'dialog';

/** The handle is optional, so a blank one is left out of the request entirely. */
function submitInput(detail: FeedbackDialogDetail): FeedbackSubmitInput {
  const { githubHandle, ...rest } = detail;
  return githubHandle ? { ...rest, githubHandle } : rest;
}

function noticeText(notice: SubmitNotice): string {
  switch (notice) {
    case 'created':
      return msg('Feedback submitted. GitHub issue created.');
    case 'saved-locally':
      return msg('Feedback saved locally. Could not reach the feedback service.');
    case 'saved-locally-no-group':
      return msg('Feedback saved locally. Join or create a group to enable submitting feedback.');
    case 'saved-locally-clock':
      return msg(
        'Feedback saved locally. Your system clock seems to be off; please check it and try again.',
      );
    case 'saved-locally-rate-limited':
      return msg(
        'Feedback saved locally. You have submitted a lot recently; please try again later.',
      );
  }
}

/**
 * Controller that manages the design feedback workflow:
 * idle -> capture screenshot -> select area -> show dialog -> submit
 *
 * Reads designFeedbackMode from PersistedStore to show/hide the trigger icon.
 *
 * @element design-feedback-controller
 */
@localized()
@customElement('design-feedback-controller')
export class DesignFeedbackController extends LitElement {
  @state() private _state: FeedbackState = 'idle';
  @state() private _enabled = false;
  @state() private _fullScreenshot: string = '';
  @state() private _croppedScreenshot: string = '';
  @state() private _mossVersion: string = '';
  @state() private _os: string = '';

  @query('feedback-dialog')
  private _feedbackDialog!: FeedbackDialog;

  private _persistedStore = new PersistedStore();

  connectedCallback() {
    super.connectedCallback();
    this._enabled = this._persistedStore.designFeedbackMode.value();
    this._os = navigator.userAgent;
    getAppVersion().then((v) => {
      this._mossVersion = v;
    });
    window.addEventListener('design-feedback-mode-changed', this._onModeChanged as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      'design-feedback-mode-changed',
      this._onModeChanged as EventListener,
    );
  }

  private _onModeChanged = (e: CustomEvent<boolean>) => {
    this._enabled = e.detail;
  };

  refresh() {
    this._enabled = this._persistedStore.designFeedbackMode.value();
  }

  private async _startCapture() {
    this._state = 'capturing';
    try {
      this._fullScreenshot = await window.electronAPI.captureScreen();
      this._state = 'selecting';
    } catch (e) {
      console.error('Failed to capture screen:', e);
      this._state = 'idle';
    }
  }

  private async _onAreaSelected(
    e: CustomEvent<{ x: number; y: number; width: number; height: number }>,
  ) {
    const { x, y, width, height } = e.detail;
    try {
      this._croppedScreenshot = await this._cropImage(this._fullScreenshot, x, y, width, height);
      this._state = 'dialog';
      await this.updateComplete;
      this._feedbackDialog.screenshot = this._croppedScreenshot;
      this._feedbackDialog.mossVersion = this._mossVersion;
      this._feedbackDialog.os = this._os;
      this._feedbackDialog.show();
    } catch (err) {
      console.error('Failed to crop screenshot:', err);
      this._state = 'idle';
    }
  }

  private _onAreaCancelled() {
    this._state = 'idle';
    this._fullScreenshot = '';
  }

  private async _onFeedbackSubmitted(e: CustomEvent<FeedbackDialogDetail>) {
    try {
      const result = await window.electronAPI.submitFeedback(submitInput(e.detail));
      notify(noticeText(noticeForResult(result)));
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      notify(noticeText('saved-locally'));
    }
    this._reset();
  }

  private async _onFeedbackCopied(e: CustomEvent<FeedbackDialogDetail>) {
    try {
      await window.electronAPI.submitFeedback({ ...submitInput(e.detail), localOnly: true });
    } catch (err) {
      console.error('Failed to save feedback locally:', err);
    }
    this._reset();
  }

  private _reset() {
    this._state = 'idle';
    this._fullScreenshot = '';
    this._croppedScreenshot = '';
  }

  private _onFeedbackCancelled() {
    this._reset();
  }

  private _cropImage(
    dataUrl: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        ctx.drawImage(
          img,
          x * dpr,
          y * dpr,
          width * dpr,
          height * dpr,
          0,
          0,
          width * dpr,
          height * dpr,
        );
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load screenshot image'));
      img.src = dataUrl;
    });
  }

  render() {
    return html`
      ${this._enabled && this._state === 'idle'
        ? html`
            <button
              class="feedback-trigger"
              title="${msg('Give Design Feedback')}"
              @click=${this._startCapture}
            >
              ${commentHeartIconFilled(20)}
            </button>
          `
        : html``}
      ${this._state === 'selecting'
        ? html`
            <feedback-area-selector
              @area-selected=${this._onAreaSelected}
              @area-cancelled=${this._onAreaCancelled}
            ></feedback-area-selector>
          `
        : html``}
      <feedback-dialog
        @feedback-submitted=${this._onFeedbackSubmitted}
        @feedback-copied=${this._onFeedbackCopied}
        @feedback-cancelled=${this._onFeedbackCancelled}
      ></feedback-dialog>
    `;
  }

  static styles = css`
    :host {
      display: contents;
    }

    .feedback-trigger {
      position: fixed;
      top: 15px;
      left: 48px;
      z-index: 9999;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }

    .feedback-trigger:hover {
      background: rgba(0, 0, 0, 0.8);
    }
  `;
}
