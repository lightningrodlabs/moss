import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { weStyles } from '../shared-styles.js';

@customElement('sidebar-button')
export class SidebarButton extends LitElement {
  @property()
  logoSrc!: string;

  @property()
  slIcon: boolean = false;

  @property()
  tooltipText!: string;

  @property()
  notificationCount: number | undefined = 23;

  @property()
  notificationUrgency: 'low' | 'medium' | 'high' | undefined;

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
        <div
          class="row center-content notification-dot
            ${this.notificationUrgency === 'high' ? 'urgent' : ''}
            ${this.notificationCount && this.notificationCount > 9 ? 'padded' : ''}
          "
          style="${!this.notificationUrgency ? 'display: none' : ''}"
        >
          ${this.notificationCount && this.notificationUrgency === 'high'
            ? this.notificationCount
            : undefined}
        </div>
        ${this.slIcon
          ? html` <div class="icon column center-content" style="opacity: 0.2; background: white;">
              <sl-icon
                .src=${this.logoSrc}
                alt=${this.tooltipText}
                style="height: 30px; width: 30px;"
              ></sl-icon>
            </div>`
          : html` <img class="icon" src=${this.logoSrc} alt=${this.tooltipText} /> `}
        ${this.indicated ? html`<div class="indicator"></div>` : html``}
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
        .icon {
          width: var(--size, 48px);
          height: var(--size, 48px);
          border-radius: var(--border-radius, 50%);
          background: white;
          /* object-fit: cover; */
        }
        /* .icon:hover {
        box-shadow: 0 0 0px 4px var(--hover-color, var(--sl-color-primary-200));
        background: var(--hover-color, var(--sl-color-primary-200));
      } */
        .indicator {
          position: absolute;
          right: 0;
          height: 32px;
          border-radius: 7px 0 0 7px;
          width: 7px;
          background: #f9502e;
        }

        .icon-container {
          cursor: pointer;
          position: relative;
          align-items: center;
          border-radius: 50% 0 0 50%;
          justify-content: center;
          height: var(--sidebar-width);
          width: var(--sidebar-width);
        }
        .icon-container:hover {
          background-color: var(--hover-color, var(--sl-color-primary-200));
        }
        .icon-container:hover::after {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          right: 0;
          bottom: -50px;
          height: 50px;
          width: 80px;
          border-radius: 0 30px 0 0;
          box-shadow: 30px 0 0 0 var(--hover-color, var(--sl-color-primary-200));
        }
        .icon-container:hover::before {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          right: 0;
          top: -50px;
          height: 50px;
          width: 80px;
          border-radius: 0 0 30px 0;
          box-shadow: 30px 0 0 0 var(--hover-color, var(--sl-color-primary-200));
        }
        .selected {
          background-color: var(--hover-color, var(--sl-color-primary-200));
          /* box-shadow: 0 0 0px 4px var(--hover-color, var(--sl-color-primary-200));
        background: var(--hover-color, var(--sl-color-primary-200)); */
        }
        .selected::after {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          right: 0;
          bottom: -50px;
          height: 50px;
          width: 80px;
          border-radius: 0 30px 0 0;
          box-shadow: 30px 0 0 0 var(--hover-color, var(--sl-color-primary-200));
        }
        .selected::before {
          pointer-events: none;
          content: '';
          position: absolute;
          display: block;
          background-color: transparent;
          right: 0;
          top: -50px;
          height: 50px;
          width: 80px;
          border-radius: 0 0 30px 0;
          box-shadow: 30px 0 0 0 var(--hover-color, var(--sl-color-primary-200));
        }

        .notification-dot {
          position: absolute;
          top: 5px;
          right: 5px;
          font-weight: bold;
          background: #355dfa;
          border-radius: 10px;
          height: 20px;
          min-width: 20px;
        }

        .urgent {
          background: #fcee2d;
        }

        .padded {
          padding: 0 4px;
        }
      `,
    ];
  }
}
