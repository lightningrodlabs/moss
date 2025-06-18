import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { mossStyles } from '../../shared-styles.js';

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
      <button class="icon-container ${this.selected ? 'selected' : ''}" @click=${this.handleClick}>
        <div class="column center-content">
          <div
            class="row center-content notification-dot
            ${this.notificationUrgency === 'high' ? 'urgent' : ''}
            ${this.notificationUrgency === 'high' &&
            this.notificationCount &&
            this.notificationCount > 9
              ? 'padded'
              : ''}
          "
            style="${!this.notificationUrgency || this.notificationUrgency === 'low'
              ? 'display: none'
              : ''}"
          >
            ${this.notificationCount && this.notificationUrgency === 'high'
              ? this.notificationCount
              : undefined}
          </div>
          ${this.slIcon
            ? html` <div
                class="icon column center-content"
                style="opacity: 0.2; background: white;"
              >
                <sl-icon
                  .src=${this.logoSrc}
                  alt=${this.tooltipText}
                  style="height: 30px; width: 30px;"
                ></sl-icon>
              </div>`
            : html` <img class="icon" src=${this.logoSrc} alt=${this.tooltipText} /> `}
          ${this.selected ? html`<div class="indicator"></div>` : html``}
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
        .icon {
          width: var(--size, 48px);
          height: var(--size, 48px);
          border-radius: var(--border-radius, 12px);
          background: var();
          box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
        }
        /* .icon:hover {
        box-shadow: 0 0 0px 4px var(--hover-color, var(--sl-color-primary-200));
        background: var(--hover-color, var(--sl-color-primary-200));
      } */
        .indicator {
          position: absolute;
          right: -12px;
          height: 36px;
          border-radius: 2px;
          width: 4px;
          background: var(--moss-main-green);
        }

        .icon-container {
          all: unset;
          cursor: pointer;
          position: relative;
          align-items: center;
          border-radius: 12px;
          justify-content: center;
          border: 4px solid transparent;
        }
        .icon-container:hover {
          border: 4px solid var(--moss-main-green);
        }
        .selected {
          border: 4px solid var(--moss-main-green);
        }

        .notification-dot {
          position: absolute;
          top: -5px;
          right: -5px;
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
