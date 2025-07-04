import { customElement, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { notify, notifyError, sharedStyles } from '@holochain-open-dev/elements';
import { v4 as uuidv4 } from 'uuid';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@theweave/elements/dist/elements/weave-client-context.js';

import { decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import {
  AppletHash,
  AppletId,
  CreatableResult,
  CreatableName,
  WAL,
  CreatableType,
} from '@theweave/api';
import { SlDialog } from '@shoelace-style/shoelace';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import './group-applets-creatables.js';
import '../pocket/wal-element.js';
import '../pocket/pocket-search.js';
import './creatable-view.js';
import '../navigation/group-applets-row.js';
import '../reusable/group-selector.js';

import { StoreSubscriber } from '@holochain-open-dev/stores';
import { mossStyles } from '../../shared-styles.js';

export type CreatableInfo = {
  appletHash: AppletHash;
  creatableName: CreatableName;
  creatable: CreatableType;
};

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('creatable-palette')
export class CreatablePalette extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @query('#creatable-dialog')
  _dialog!: SlDialog;

  @query('#creatable-view-dialog')
  _creatableViewDialog!: SlDialog | null;

  @query('#creatable-selection-dialog')
  _creatableSelectionDialog!: SlDialog | null;

  _groupsProfiles = new StoreSubscriber(
    this,
    () => this._mossStore.allGroupsProfiles,
    () => [this._mossStore],
  );

  @state()
  groupDnaHash: DnaHash | undefined;

  @state()
  _showCreatableView: CreatableInfo | undefined;

  @state()
  _showCreatablesSelection: AppletId | undefined;

  @state()
  _activeDialogId: string | undefined;

  show(groupDnaHash: DnaHash | undefined) {
    this.groupDnaHash = groupDnaHash;
    this._dialog.show();
  }

  hide() {
    this._dialog.hide();
  }

  creatableWidth(width: string | undefined) {
    switch (width) {
      case 'medium':
        return '--width: 600px;';
      case 'large':
        return '--width: 800px;';
      default:
        return '';
    }
  }

  creatableHeight(height: string | undefined) {
    switch (height) {
      case 'medium':
        return 'height: 400px;';
      case 'large':
        return 'height: 600px;';
      default:
        return '';
    }
  }

  async handleCreatableResponse(e: CustomEvent) {
    const creatableResult: CreatableResult = e.detail;
    if (this._creatableViewDialog) this._creatableViewDialog.hide();
    switch (creatableResult.type) {
      case 'error':
        notifyError(
          `Failed to create new ${this._showCreatableView?.creatable.label}: ${creatableResult.error}`,
        );
        console.error(
          'Failed to create new ',
          this._showCreatableView?.creatable.label,
          ': ',
          creatableResult.error,
        );
        this._activeDialogId = undefined;
        this._showCreatableView = undefined;
        return;
      case 'cancel':
        this._activeDialogId = undefined;
        this._showCreatableView = undefined;
        return;
      case 'success':
        this._mossStore.walToRecentlyCreated(creatableResult.wal);
        notify(`New ${this._showCreatableView?.creatable.label} created.`);
        this._mossStore.clearCreatableDialogResult(this._activeDialogId);
        this.dispatchEvent(
          new CustomEvent('wal-selected', {
            detail: { wal: creatableResult.wal },
            bubbles: true,
            composed: true,
          }),
        );
        this._activeDialogId = undefined;
        this._showCreatableView = undefined;
        this._dialog.hide();
    }
  }

  async handleCreatableSelected(creatableInfo: CreatableInfo) {
    this._showCreatableView = creatableInfo;
    this._activeDialogId = uuidv4();
    if (this._creatableSelectionDialog) this._creatableSelectionDialog.hide();
    setTimeout(() => this._creatableViewDialog!.show());
  }

  walToPocket(wal: WAL) {
    console.log('Adding hrl to clipboard: ', wal);
    this._mossStore.walToPocket(wal);
  }

  renderCreatables() {
    if (!this.groupDnaHash) return html`${msg('No group selected.')}`;
    return html`
      <group-context
        .groupDnaHash=${this.groupDnaHash}
        .debug=${true}
        style="display: flex; flex: 1;"
      >
        <group-applets-creatables
          @creatable-selected=${(e: { detail: CreatableInfo }) => {
            this.handleCreatableSelected(e.detail);
          }}
        ></group-applets-creatables>
      </group-context>
    `;
  }

  render() {
    return html`
      <sl-dialog
        id="creatable-dialog"
        class="moss-dialog"
        style="--width: 800px;"
        no-header
      >
          <div class="row center-content" style="font-size: 25px; margin-top: 30px;">
            <img
              class="magic-wand"
              src="magic-wand.svg"
              style="width: 30px; height: 30px; margin-top: -3px; margin-right: 6px; filter: invert(100%);"
              />
            <span>${msg('Create New Asset')}</span>
          </div>
        <div class="column" style="align-items: center; position: relative; padding-bottom: 30px;">
          <div class="row flex-1 items-center" style="width: 650px;">
            <span style="display: flex; flex: 1;"></span>
            <group-selector .groupDnaHashB64=${this.groupDnaHash ? encodeHashToBase64(this.groupDnaHash) : undefined}
              @group-selected=${(e) => {
                this.groupDnaHash = decodeHashFromBase64(e.detail);
              }}
            ></group-selector>
          </div>
          ${this.renderCreatables()}
          ${
            this._showCreatableView
              ? html`
                  <sl-dialog
                    id="creatable-view-dialog"
                    style="${this.creatableWidth(this._showCreatableView.creatable.width)}"
                    label="${msg('Create New')} ${this._showCreatableView.creatable.label}"
                    @sl-hide=${() => {
                      this._showCreatableView = undefined;
                    }}
                  >
                    <creatable-view
                      style="${this.creatableHeight(this._showCreatableView.creatable.height)}"
                      .creatableInfo=${this._showCreatableView}
                      .dialogId=${this._activeDialogId}
                      @creatable-response-received=${(e) => this.handleCreatableResponse(e)}
                    ></creatable-view>
                  </sl-dialog>
                `
              : html``
          }
          ${
            this._showCreatablesSelection
              ? html`
                  <sl-dialog
                    id="creatable-selection-dialog"
                    label="${msg('What do you want to create?')}"
                    @sl-hide=${() => {
                      this._showCreatablesSelection = undefined;
                    }}
                  >
                    <div class="row" style="justify-content: flex-end; margin-top: -20px;">
                      <applet-title
                        .appletHash=${decodeHashFromBase64(this._showCreatablesSelection)}
                      ></applet-title>
                    </div>
                  </sl-dialog>
                `
              : html``
          }
      </sl-dialog>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      sharedStyles,
      css`
        :host {
          display: flex;
        }

        .creatable-item {
          border-radius: 5px;
          padding: 5px;
        }

        .creatable-item:hover {
          background: var(--sl-color-primary-200);
        }
      `,
    ];
  }
}
