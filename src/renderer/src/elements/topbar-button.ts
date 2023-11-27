import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { weStyles } from '../shared-styles.js';

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
      <div
        class="icon-container column ${this.selected ? 'selected' : ''}"
        @click=${this.handleClick}
      >
        <slot></slot>
      </div>
    </sl-tooltip>`;
  }

  static get styles() {
    return [
      weStyles,
      css`
        :host {
          display: flex;
        }

        .icon-container {
          cursor: pointer;
          position: relative;
          align-items: center;
          justify-content: center;
          border-radius: 50% 50% 0 0;
          height: var(--sidebar-width);
          width: var(--sidebar-width);
        }
        .icon-container:hover {
          background-color: var(--hover-color, var(--sl-color-primary-900));
        }
        .icon-container:hover::after {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          bottom: 0;
          right: -60px;
          height: 30px;
          width: 60px;
          border-radius: 0 0 0 30px;
          box-shadow: -30px 0 0 0 var(--hover-color, var(--sl-color-primary-900));
        }
        .icon-container:hover::before {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          bottom: 0;
          left: -60px;
          height: 30px;
          width: 60px;
          border-radius: 0 0 30px 0;
          box-shadow: 30px 0 0 0 var(--hover-color, var(--sl-color-primary-900));
        }
        .selected {
          background-color: var(--hover-color, var(--sl-color-primary-900));
        }
        .selected::after {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          bottom: 0;
          right: -60px;
          height: 30px;
          width: 60px;
          border-radius: 0 0 0 30px;
          box-shadow: -30px 0 0 0 var(--hover-color, var(--sl-color-primary-900));
        }
        .selected::before {
          pointer-events: transparent;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          bottom: 0;
          left: -60px;
          height: 30px;
          width: 60px;
          border-radius: 0 0 30px 0;
          box-shadow: 30px 0 0 0 var(--hover-color, var(--sl-color-primary-900));
        }
      `,
    ];
  }
}
