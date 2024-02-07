import { customElement, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { notify, notifyError, sharedStyles } from '@holochain-open-dev/elements';
import { v4 as uuidv4 } from 'uuid';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@lightningrodlabs/we-elements/dist/elements/we-client-context.js';

import { EntryHash, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import {
  AppletHash,
  AppletId,
  AppletInfo,
  AttachableLocationAndInfo,
  CreatableContextResult,
  CreatableName,
  GroupProfile,
  HrlWithContext,
} from '@lightningrodlabs/we-applet';
import { SlDialog } from '@shoelace-style/shoelace';
import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import './hrl-element.js';
import './clipboard-search.js';
import './creatable-context-view.js';
import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';

export interface SearchResult {
  hrlsWithInfo: Array<[HrlWithContext, AttachableLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

export type CreatableInfo = {
  appletHash: AppletHash;
  creatableName: CreatableName;
};

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('creatable-panel')
export class CreatablePanel extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @query('#creatable-dialog')
  _dialog!: SlDialog;

  @query('#context-dialog')
  _contextDialog!: SlDialog;

  @state()
  clipboardContent: Array<string> = [];

  _allCreatableTypes = new StoreSubscriber(
    this,
    () => this._weStore.allCreatableTypes(),
    () => [this._weStore],
  );

  @state()
  _showCreatableView: CreatableInfo | undefined;

  @state()
  _activeDialogId: string | undefined;

  show() {
    this._dialog.show();
  }

  hide() {
    this._dialog.hide();
  }

  async handleContextResponse(e: CustomEvent) {
    console.log('HANDLING CONTEXT RESPONSE');
    const contextResult: CreatableContextResult = e.detail;
    this._contextDialog.hide();
    if (contextResult.type === 'error') {
      notifyError(
        `Failed to create new ${this._showCreatableView?.creatableName}: ${contextResult.reason}`,
      );
      console.error(
        'Failed to create new ',
        this._showCreatableView?.creatableName,
        ': ',
        contextResult.reason,
      );
      this._activeDialogId = undefined;
      this._showCreatableView = undefined;
      return;
    }
    const appletId = this._showCreatableView
      ? encodeHashToBase64(this._showCreatableView.appletHash)
      : undefined;
    const creatableName = this._showCreatableView
      ? this._showCreatableView.creatableName
      : undefined;
    if (appletId && creatableName && contextResult.type === 'success') {
      await this.createCreatable(appletId, creatableName, contextResult.creatableContext);
      notify(`New ${creatableName} created.`);
      this._weStore.clearCreatableDialogResult(this._activeDialogId);
      this._activeDialogId = undefined;
      this._showCreatableView = undefined;
    }
  }

  async createCreatable(appletId: AppletId, creatableName: CreatableName, creatableContext: any) {
    const appletStore = await toPromise(
      this._weStore.appletStores.get(decodeHashFromBase64(appletId)),
    );
    const host = await toPromise(appletStore.host);
    if (!host) throw Error('No applet host found.');
    await host.createCreatable(creatableName, creatableContext);
  }

  hrlToClipboard(hrlWithContext: HrlWithContext) {
    console.log('Adding hrl to clipboard: ', hrlWithContext);
    this._weStore.hrlToClipboard(hrlWithContext);
  }

  renderCreatables() {
    return html`
      ${Object.entries(this._allCreatableTypes.value).map(([appletId, creatables]) => {
        return Object.entries(creatables).map(
          ([creatableName, creatable]) => html`
            <div
              class="row"
              style="align-items: center; justify-content: center; cursor: pointer;"
              @click=${() => {
                this._showCreatableView = {
                  appletHash: decodeHashFromBase64(appletId),
                  creatableName,
                };
                this._activeDialogId = uuidv4();
                setTimeout(() => this._contextDialog.show());
                console.log('this._showCreatableView: ', this._showCreatableView);
                // this.createCreatable(appletId, creatableName)
              }}
            >
              <img src="${creatable.icon_src}" style="height: 30px; width: 30px;" />
              <span>${creatable.label}</span>
            </div>
          `,
        );
      })}
    `;
  }

  render() {
    return html`
      <sl-dialog
        id="creatable-dialog"
        style="--width: 800px;"
        no-header
      >
          <div class="row" style="font-size: 25px; margin-top: 30px; align-items: center; flex: 1; justify-content: center;">
            ${msg('Select Creatable:')}
          </div>
        <div class="column" style="align-items: center; position: relative; padding-bottom: 30px;">
          ${this.renderCreatables()}
          ${
            this._showCreatableView
              ? html`
                  <sl-dialog
                    id="context-dialog"
                    label="${msg('Create New')} ${this._showCreatableView.creatableName}"
                  >
                    <creatable-context-view
                      .creatableInfo=${this._showCreatableView}
                      .dialogId=${this._activeDialogId}
                      @context-response-received=${(e) => this.handleContextResponse(e)}
                    ></creatable-context-view>
                  </sl-dialog>
                `
              : html``
          }
          <div class="row" style="font-size: 25px; margin-top: 30px; align-items: center;">
            <img src="magic_hat.svg" style="height: 45px; margin-right: 10px; margin-bottom: 10px;">
            ${msg('Recently created:')}
          </div>
      </sl-dialog>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
        }
      `,
    ];
  }
}
