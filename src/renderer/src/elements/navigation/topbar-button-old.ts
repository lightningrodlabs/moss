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
      <div
        class="icon-container column ${this.selected ? 'selected' : ''} ${this.invertColors
          ? 'inverted'
          : ''}"
        @click=${this.handleClick}
      >
        <slot></slot>
        ${this.indicated ? html`<div class="indicator"></div>` : html``}
      </div>
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
          bottom: 0;
          height: 5px;
          border-radius: 7px 7px 0 0;
          width: 32px;
          background: var(--sl-color-tertiary-50);
          box-shadow: 0 0 1px 2px var(--sl-color-tertiary-400);
        }

        .icon-container {
          cursor: pointer;
          position: relative;
          align-items: center;
          justify-content: center;
          border-radius: 20% 20% 0 0;
          height: var(--sidebar-width);
          margin: 0 2px;
          width: var(--sidebar-width);
        }
        .icon-container:hover {
          background-color: var(--hover-color, var(--sl-color-primary-900));
        }
        .selected:not(.inverted),
        .icon-container:hover {
          background: linear-gradient(180deg, #dbe755 0%, #588121 100%);
        }

        .inverted:hover {
          background: linear-gradient(180deg, #002800 0%, #224b21 100%);
          background: linear-gradient(180deg, #002800 0%, var(--moss-dark-green) 100%);
        }
        .selected {
          /* background: linear-gradient(180deg, #002800 0%, #224b21 100%); */
          background: linear-gradient(180deg, #002800 0%, var(--moss-dark-green) 100%);
        }
      `,
    ];
  }
}
