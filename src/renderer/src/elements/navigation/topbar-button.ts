import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { mossStyles } from '../../shared-styles.js';

@customElement('topbar-button')
export class TopBarButton extends LitElement {
  @property()
  tooltipText!: string;

  @property()
  placement:
    | 'top'
    | 'top-start'
    | 'top-end'
    | 'right'
    | 'right-start'
    | 'right-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'left-start'
    | 'left-end' = 'right';

  @property()
  selected = false;

  @property()
  indicated = false;

  @property()
  invertColors = false;

  @query('#tooltip')
  _tooltip!: SlTooltip;

  private handleClick(_e: any) {
    this._tooltip.hide();
  }

  render() {
    return html` <sl-tooltip
      hoist
      id="tooltip"
      placement="${this.placement}"
      .content=${this.tooltipText}
    >
      <button
        class="icon-container column ${this.selected ? 'selected' : ''} ${this.invertColors
          ? 'inverted'
          : ''}"
        @click=${this.handleClick}
      >
        <div class="column center-content">
          <slot></slot>
          ${this.selected
            ? html`<div class="indicator ${this.invertColors ? 'inverted' : ''}"></div>`
            : html``}
        </div>
      </button>
    </sl-tooltip>`;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          display: flex;
        }

        .indicator {
          position: absolute;
          bottom: -12px;
          height: 4px;
          border-radius: 2px;
          width: 36px;
          background: var(--moss-main-green);
        }

        .indicator:not(.inverted) {
          background: var(--moss-dark-green);
        }

        .icon-container {
          all: unset;
          cursor: pointer;
          position: relative;
          align-items: center;
          border-radius: 12px;
          justify-content: center;
          border: 4px solid transparent;
          margin: 0 4px;
        }

        .icon-container:hover {
          border: 4px solid var(--moss-main-green);
        }

        .icon-container:hover:not(.inverted) {
          border: 4px solid var(--moss-dark-green);
        }

        .selected {
          border: 4px solid var(--moss-main-green);
        }

        .selected:not(.inverted) {
          border: 4px solid var(--moss-dark-green);
        }
      `,
    ];
  }
}
