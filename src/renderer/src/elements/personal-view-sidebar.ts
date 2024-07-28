import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { ActionHashB64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../elements/topbar-button.js';
import './create-group-dialog.js';
import './tool-personal-bar-button.js';

import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { weStyles } from '../shared-styles.js';
import { AppletId } from '@lightningrodlabs/we-applet';
import { PersonalViewState } from './main-dashboard.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiHome, mdiStoreSearch, mdiUpload } from '@mdi/js';

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

  renderTools(tools: Record<ActionHashB64, AppletId[]>) {
    return html`${Object.keys(tools).map(
      (actionHash) => html`
        <!-- <sl-tooltip content=""> -->
        <tool-personal-bar-button
          .originalToolActionHash=${actionHash}
          .selected=${this.selectedView &&
          this.selectedView.type === 'tool' &&
          this.selectedView.originalToolActionHash === actionHash}
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('personal-view-selected', {
                detail: {
                  type: 'tool',
                  originalToolActionHash: actionHash,
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
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
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
      <topbar-button
        .invertColors=${true}
        style="margin-left: -4px; position: relative;"
        .selected=${this.selectedView &&
        this.selectedView.type === 'moss' &&
        this.selectedView.name === 'welcome'}
        .tooltipText=${'Home'}
        placement="bottom"
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
        <div class="moss-item-button">
          <sl-icon .src=${wrapPathInSvg(mdiHome)} style="font-size: 40px;"></sl-icon>
        </div>
      </topbar-button>

      <topbar-button
        .invertColors=${true}
        style="margin-left: -4px; position: relative;"
        .selected=${this.selectedView &&
        this.selectedView.type === 'moss' &&
        this.selectedView.name === 'tool-library'}
        .tooltipText=${'Tool Library'}
        placement="bottom"
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
        <div class="moss-item-button">
          <sl-icon
            .src=${wrapPathInSvg(mdiStoreSearch)}
            style="font-size: 40px; margin-left: 3px; margin-top: 3px;"
          ></sl-icon>
        </div>
      </topbar-button>

      <topbar-button
        .invertColors=${true}
        style="margin-left: -4px; position: relative;"
        .selected=${this.selectedView &&
        this.selectedView.type === 'moss' &&
        this.selectedView.name === 'publisher-panel'}
        .tooltipText=${'Publish Tool'}
        placement="bottom"
        @click=${() => {
          this.dispatchEvent(
            new CustomEvent('personal-view-selected', {
              detail: {
                type: 'moss',
                name: 'publisher-panel',
              },
              bubbles: false,
              composed: true,
            }),
          );
        }}
      >
        <div class="moss-item-button">
          <sl-icon .src=${wrapPathInSvg(mdiUpload)} style="font-size: 40px;"></sl-icon>
        </div>
      </topbar-button>
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
    weStyles,
    css`
      :host {
        display: flex;
      }

      .moss-item-button {
        display: flex;
        justify-content: center;
        align-items: center;
        border-radius: 50%;
        /* color: #0b2f00; */
        color: #173917;
        background: #dbe755;
        width: 58px;
        height: 58px;
        box-shadow: 1px 2px 10px 0px #102520ab;
      }
    `,
  ];
}
