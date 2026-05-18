import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { localized } from '@lit/localize';

/**
 * Full-screen overlay that lets the user click-and-drag to select a rectangular area.
 * Dispatches 'area-selected' with { x, y, width, height } or 'area-cancelled'.
 *
 * @element feedback-area-selector
 * @fires area-selected - { detail: { x: number, y: number, width: number, height: number } }
 * @fires area-cancelled
 */
@localized()
@customElement('feedback-area-selector')
export class FeedbackAreaSelector extends LitElement {
  @state() private _selecting = false;
  @state() private _startX = 0;
  @state() private _startY = 0;
  @state() private _currentX = 0;
  @state() private _currentY = 0;
  @state() private _done = false;

  private get _rect() {
    const x = Math.min(this._startX, this._currentX);
    const y = Math.min(this._startY, this._currentY);
    const width = Math.abs(this._currentX - this._startX);
    const height = Math.abs(this._currentY - this._startY);
    return { x, y, width, height };
  }

  private _onMouseDown = (e: MouseEvent) => {
    if (this._done) return;
    this._selecting = true;
    this._startX = e.clientX;
    this._startY = e.clientY;
    this._currentX = e.clientX;
    this._currentY = e.clientY;
  };

  private _onMouseMove = (e: MouseEvent) => {
    if (!this._selecting) return;
    this._currentX = e.clientX;
    this._currentY = e.clientY;
  };

  private _onMouseUp = (_e: MouseEvent) => {
    if (!this._selecting) return;
    this._selecting = false;
    const { width, height } = this._rect;
    if (width < 10 || height < 10) {
      // Too small, reset
      this._startX = 0;
      this._startY = 0;
      this._currentX = 0;
      this._currentY = 0;
      return;
    }
    this._done = true;
  };

  private _confirm() {
    this.dispatchEvent(
      new CustomEvent('area-selected', {
        detail: this._rect,
        bubbles: true,
        composed: true,
      }),
    );
    this._reset();
  }

  private _cancel() {
    this.dispatchEvent(
      new CustomEvent('area-cancelled', {
        bubbles: true,
        composed: true,
      }),
    );
    this._reset();
  }

  private _reset() {
    this._selecting = false;
    this._done = false;
    this._startX = 0;
    this._startY = 0;
    this._currentX = 0;
    this._currentY = 0;
  }

  render() {
    const { x, y, width, height } = this._rect;
    const showRect = this._selecting || this._done;

    return html`
      <div
        class="overlay"
        @mousedown=${this._onMouseDown}
        @mousemove=${this._onMouseMove}
        @mouseup=${this._onMouseUp}
      >
        ${showRect
          ? html`
              <div
                class="selection-rect"
                style="left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px;"
              ></div>
            `
          : html``}
        ${this._done
          ? html`
              <div
                class="action-buttons row"
                style="left: ${x + width / 2}px; top: ${y + height + 12}px;"
              >
                <button class="capture-btn" @click=${this._confirm}>
                  ${msg('Capture')}
                </button>
                <button class="cancel-btn" @click=${this._cancel}>
                  ${msg('Cancel')}
                </button>
              </div>
            `
          : html`
              <div class="instruction">
                ${msg('Click and drag to select an area')}
                <button class="cancel-link" @click=${this._cancel}>${msg('Cancel')}</button>
              </div>
            `}
      </div>
    `;
  }

  static styles = css`
    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10000;
      cursor: crosshair;
      background: rgba(0, 0, 0, 0.3);
    }

    .selection-rect {
      position: absolute;
      border: 2px solid #4caf50;
      background: rgba(76, 175, 80, 0.1);
      pointer-events: none;
    }

    .action-buttons {
      position: absolute;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 10001;
    }

    .capture-btn,
    .cancel-btn {
      padding: 6px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }

    .capture-btn {
      background: #4caf50;
      color: white;
    }

    .capture-btn:hover {
      background: #388e3c;
    }

    .cancel-btn {
      background: #757575;
      color: white;
    }

    .cancel-btn:hover {
      background: #616161;
    }

    .instruction {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      z-index: 10001;
    }

    .cancel-link {
      background: none;
      border: 1px solid rgba(255, 255, 255, 0.5);
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    .cancel-link:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  `;
}
