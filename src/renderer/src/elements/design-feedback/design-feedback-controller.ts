import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';

import './area-selector.js';
import './feedback-dialog.js';
import { FeedbackDialog } from './feedback-dialog.js';
import { PersistedStore } from '../../persisted-store.js';

type FeedbackState = 'idle' | 'capturing' | 'selecting' | 'dialog';

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

  @query('feedback-dialog')
  private _feedbackDialog!: FeedbackDialog;

  private _persistedStore = new PersistedStore();

  connectedCallback() {
    super.connectedCallback();
    this._enabled = this._persistedStore.designFeedbackMode.value();
    // Listen for changes from settings
    window.addEventListener('design-feedback-mode-changed', this._onModeChanged as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('design-feedback-mode-changed', this._onModeChanged as EventListener);
  }

  private _onModeChanged = (e: CustomEvent<boolean>) => {
    this._enabled = e.detail;
  };

  /** Re-check persisted store (called externally if needed) */
  refresh() {
    this._enabled = this._persistedStore.designFeedbackMode.value();
  }

  private async _startCapture() {
    this._state = 'capturing';
    try {
      // Capture the full screen via Electron IPC
      this._fullScreenshot = await window.electronAPI.captureScreen();
      this._state = 'selecting';
    } catch (e) {
      console.error('Failed to capture screen:', e);
      this._state = 'idle';
    }
  }

  private async _onAreaSelected(e: CustomEvent<{ x: number; y: number; width: number; height: number }>) {
    const { x, y, width, height } = e.detail;
    try {
      // Crop the full screenshot to the selected area
      this._croppedScreenshot = await this._cropImage(this._fullScreenshot, x, y, width, height);
      this._state = 'dialog';
      // Wait a tick for the dialog element to be ready
      await this.updateComplete;
      this._feedbackDialog.screenshot = this._croppedScreenshot;
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

  private _onFeedbackSubmitted(e: CustomEvent<{ screenshot: string; text: string }>) {
    const { screenshot, text } = e.detail;
    // Stub submission: log to console
    console.log('[Design Feedback] Submitted:', { text, screenshotLength: screenshot.length });
    notify(msg('Feedback recorded. Thank you.'));
    this._state = 'idle';
    this._fullScreenshot = '';
    this._croppedScreenshot = '';
  }

  private _onFeedbackCancelled() {
    this._state = 'idle';
    this._fullScreenshot = '';
    this._croppedScreenshot = '';
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
        // Account for device pixel ratio
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
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
      top: 8px;
      right: 44px;
      z-index: 9999;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: rgba(0, 0, 0, 0.6);
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
