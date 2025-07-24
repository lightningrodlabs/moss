import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../groups/elements/group-context.js';
import './topbar-button.js';
import '../dialogs/create-group-dialog.js';
import './tool-personal-bar-button.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletId } from '@theweave/api';
import { PersonalViewState } from '../main-dashboard.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiGraph, mdiHome } from '@mdi/js';
import { ToolCompatibilityId } from '@theweave/moss-types';
import { appStoreIcon } from '../../icons/icons.js';

// Sidebar for the applet instances of a group
@localized()
@customElement('personal-view-sidebar')
export class PersonalViewSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property()
  selectedView?: PersonalViewState;

  _appletClasses = new StoreSubscriber(
    this,
    () => this._mossStore.runningAppletClasses,
    () => [this, this._mossStore],
  );

  renderTools(tools: Record<ToolCompatibilityId, { appletIds: AppletId[]; toolName: string }>) {
    return html`${Object.keys(tools).map(
      (toolCompatibilityId) => html`
        <!-- <sl-tooltip content=""> -->
        <tool-personal-bar-button
          .toolCompatibilityId=${toolCompatibilityId}
          .selected=${this.selectedView &&
          this.selectedView.type === 'tool' &&
          this.selectedView.toolCompatibilityId === toolCompatibilityId}
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('personal-view-selected', {
                detail: {
                  type: 'tool',
                  toolCompatibilityId: toolCompatibilityId,
                },
                bubbles: false,
                composed: true,
              }),
            );
          }}
        ></tool-personal-bar-button>
      `,
    )}`;
  }

  renderAppletsLoading() {
    switch (this._appletClasses.value.status) {
      case 'pending':
        return html`<sl-skeleton
            style="height: 48px; width: 48px; margin-right: 10px; --border-radius: 8px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 48px; width: 48px; margin-right: 10px; --border-radius: 8px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 48px; width: 48px; margin-right: 10px; --border-radius: 8px;"
            effect="pulse"
          ></sl-skeleton> `;
      case 'error':
        console.error('ERROR: ', this._appletClasses.value.error);
        return html`<display-error
          .headline=${msg('Error displaying the tool classes')}
          tooltip
          .error=${this._appletClasses.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderTools(this._appletClasses.value.value);
      default:
        return html`Invalid async status.`;
    }
  }

  renderMossButtons() {
    return html`
      <sl-tooltip .content="${msg('Home')}" placement="bottom" hoist>
        <button
          class="moss-item-button ${this.selectedView &&
          this.selectedView.type === 'moss' &&
          this.selectedView.name === 'welcome'
            ? 'selected'
            : ''}"
          style="margin-left: -4px; position: relative;"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('personal-view-selected', {
                detail: {
                  type: 'moss',
                  name: 'welcome',
                },
                bubbles: false,
                composed: true,
              }),
            );
          }}
        >
          <div class="column center-content">
            <sl-icon .src=${wrapPathInSvg(mdiHome)} style="font-size: 40px;"></sl-icon>
          </div>
        </button>
      </sl-tooltip>

      <sl-tooltip .content="${msg('Activity Stream')}" placement="bottom" hoist>
        <button
          class="moss-item-button ${this.selectedView &&
          this.selectedView.type === 'moss' &&
          this.selectedView.name === 'activity-view'
            ? 'selected'
            : ''}"
          style="position: relative;"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('personal-view-selected', {
                detail: {
                  type: 'moss',
                  name: 'activity-view',
                },
                bubbles: false,
                composed: true,
              }),
            );
          }}
        >
          <div class="column center-content">
            <img src="mountain_stream.svg" style="height: 38px;" />
          </div>
        </button>
      </sl-tooltip>

      <sl-tooltip .content="${msg('Assets Graph')}" placement="bottom" hoist>
        <button
          class="moss-item-button ${this.selectedView &&
          this.selectedView.type === 'moss' &&
          this.selectedView.name === 'assets-graph'
            ? 'selected'
            : ''}"
          style="position: relative;"
          placement="bottom"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('personal-view-selected', {
                detail: {
                  type: 'moss',
                  name: 'assets-graph',
                },
                bubbles: false,
                composed: true,
              }),
            );
          }}
        >
          <div class="column center-content">
            <sl-icon
              .src=${wrapPathInSvg(mdiGraph)}
              style="font-size: 40px; margin-top: -3px"
            ></sl-icon>
          </div>
        </button>
      </sl-tooltip>

      <sl-tooltip .content="${msg('Tool Library')}" placement="bottom" hoist>
        <button
          class="moss-item-button ${this.selectedView &&
          this.selectedView.type === 'moss' &&
          this.selectedView.name === 'tool-library'
            ? 'selected'
            : ''}"
          style="position: relative; margin-right: 8px;"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('personal-view-selected', {
                detail: {
                  type: 'moss',
                  name: 'tool-library',
                },
                bubbles: false,
                composed: true,
              }),
            );
          }}
        >
          <div class="column center-content">${appStoreIcon(30)}</div>
        </button>
      </sl-tooltip>
    `;
  }

  render() {
    return html`
      <div class="row" style="flex: 1; align-items: center;">
        ${this.renderMossButtons()} ${this.renderAppletsLoading()}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }

      .moss-item-button {
        all: unset;
        /* background: linear-gradient(0deg, #203923 0%, #527a22 100%); */
        /* background: var(--moss-dark-button); */
        background: none;
        border-radius: 8px;
        width: 48px;
        height: 48px;
        cursor: pointer;
        color: white;
        margin: 4px;
      }

      .moss-item-button:hover {
        background: var(--moss-dark-button);
      }

      .moss-item-button:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .selected {
        background: var(--moss-dark-button);
      }

      /* .black-svg {
        filter: invert(15%) sepia(16%) saturate(2032%) hue-rotate(71deg) brightness(94%)
          contrast(90%);
      } */
    `,
  ];
}
