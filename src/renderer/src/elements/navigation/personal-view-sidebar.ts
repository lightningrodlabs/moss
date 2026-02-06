import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../groups/elements/group-context.js';
import './topbar-button.js';
import '../dialogs/create-group-dialog.js';
import './tool-personal-bar-button.js';
import '../../applets/elements/applet-logo-raw.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletId } from '@theweave/api';
import { PersonalViewState } from '../main-dashboard.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiGraph, mdiHome } from '@mdi/js';
import { ToolCompatibilityId } from '@theweave/moss-types';


// Sidebar for the applet instances of a group
@localized()
@customElement('personal-view-sidebar')
export class PersonalViewSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property()
  selectedView?: PersonalViewState;

  @state()
  _experimentalMenuOpen = false;

  private _clickOutsideHandler = (e: MouseEvent) => {
    const path = e.composedPath();
    const dropdown = this.shadowRoot?.querySelector('.experimental-dropdown');
    const button = this.shadowRoot?.querySelector('.experimental-button');
    if (dropdown && button && !path.includes(dropdown) && !path.includes(button)) {
      this._experimentalMenuOpen = false;
    }
  };

  _appletClasses = new StoreSubscriber(
    this,
    () => this._mossStore.runningAppletClasses,
    () => [this, this._mossStore],
  );

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._clickOutsideHandler, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._clickOutsideHandler, true);
  }

  private _selectView(detail: PersonalViewState) {
    this._experimentalMenuOpen = false;
    this.dispatchEvent(
      new CustomEvent('personal-view-selected', {
        detail,
        bubbles: false,
        composed: true,
      }),
    );
  }

  renderToolMenuItems(
    tools: Record<ToolCompatibilityId, { appletIds: AppletId[]; toolName: string }>,
  ) {
    return html`${Object.entries(tools).map(
      ([toolCompatibilityId, info]) => html`
        <button
          class="home-menu-item"
          @click=${() => {
            this._selectView({
              type: 'tool',
              toolCompatibilityId,
            });
          }}
        >
          <applet-logo-raw
            .toolIdentifier=${{
              type: 'class' as const,
              toolCompatibilityId,
            }}
            style="--size: 32px; --border-radius: 6px;"
          ></applet-logo-raw>
          <span class="menu-item-label">${info.toolName} cross-group</span>
        </button>
      `,
    )}`;
  }

  renderExperimentalMenu() {
    if (!this._experimentalMenuOpen) return nothing;

    const toolItems =
      this._appletClasses.value.status === 'complete'
        ? this.renderToolMenuItems(this._appletClasses.value.value)
        : nothing;

    return html`
      <div class="experimental-dropdown">
        <button
          class="home-menu-item"
          @click=${() => {
            this._selectView({ type: 'moss', name: 'activity-view' });
          }}
        >
          <img src="mountain_stream.svg" style="height: 32px; width: 32px;" />
          <span class="menu-item-label">${msg('All streams')}</span>
        </button>

        <button
          class="home-menu-item"
          @click=${() => {
            this._selectView({ type: 'moss', name: 'assets-graph' });
          }}
        >
          <sl-icon
            .src=${wrapPathInSvg(mdiGraph)}
            style="font-size: 32px; color: var(--moss-dark-button);"
          ></sl-icon>
          <span class="menu-item-label">${msg('Artefacts graph')}</span>
        </button>

        ${toolItems}
      </div>
    `;
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
            this._selectView({ type: 'moss', name: 'welcome' });
          }}
        >
          <div class="column center-content">
            <sl-icon .src=${wrapPathInSvg(mdiHome)} style="font-size: 40px;"></sl-icon>
          </div>
        </button>
      </sl-tooltip>

      <div style="position: relative;">
        <sl-tooltip .content="${msg('Experimental features')}" placement="bottom" hoist>
          <button
            class="moss-item-button experimental-button ${this._experimentalMenuOpen
              ? 'selected'
              : ''}"
            style="position: relative;"
            @click=${() => {
              this._experimentalMenuOpen = !this._experimentalMenuOpen;
            }}
          >
            <div class="column center-content">
              <img src="clover.svg" style="height: 40px; width: 40px;" />
            </div>
          </button>
        </sl-tooltip>
        ${this.renderExperimentalMenu()}
      </div>
    `;
  }

  render() {
    return html`
      <div class="row" style="flex: 1; align-items: center;">
        ${this.renderMossButtons()}
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

      .experimental-dropdown {
        position: absolute;
        top: 56px;
        left: 0;
        z-index: 100;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px;
        border-radius: 16px;
        min-width: 240px;
        background: #b8b8c8;
        background-image: radial-gradient(
          circle at 60% 70%,
          rgba(116, 97, 235, 0.6) 0%,
          transparent 60%
        );
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }

      .home-menu-item {
        all: unset;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        white-space: nowrap;
      }

      .home-menu-item:hover {
        background: white;
      }

      .home-menu-item:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .menu-item-label {
        font-family: 'Inter Variable', sans-serif;
        font-weight: 500;
        font-size: 18px;
        color: var(--moss-dark-button);
      }

      .menu-item-badge {
        background: var(--moss-purple);
        border-radius: 4px;
        color: white;
        font-size: 14px;
        font-weight: 600;
        min-width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
      }
    `,
  ];
}
