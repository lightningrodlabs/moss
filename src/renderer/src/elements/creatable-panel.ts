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
import './group-applets-row.js';

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

  @query('#creatable-selection-dialog')
  _creatableSelectionDialog!: SlDialog;

  @state()
  clipboardContent: Array<string> = [];

  _groupsProfiles = new StoreSubscriber(
    this,
    () => this._weStore.allGroupsProfiles,
    () => [this._weStore],
  );

  _allCreatableTypes = new StoreSubscriber(
    this,
    () => this._weStore.allCreatableTypes(),
    () => [this._weStore],
  );

  @state()
  _showCreatableView: CreatableInfo | undefined;

  @state()
  _showCreatablesSelection: AppletId | undefined;

  @state()
  _activeDialogId: string | undefined;

  show() {
    this._dialog.show();
  }

  hide() {
    this._dialog.hide();
  }

  async handleContextResponse(e: CustomEvent) {
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

  renderAppletMatrix() {
    switch (this._groupsProfiles.value.status) {
      case 'error':
        console.error('Failed to load group profiles: ', this._groupsProfiles.value.error);
        return html`Failed to load group profiles. See console for details.`;
      case 'pending':
        return html`Loading...`;
      case 'complete':
        const knownGroups = Array.from(this._groupsProfiles.value.value.entries()).filter(
          ([_, groupProfile]) => !!groupProfile,
        ) as Array<[DnaHash, GroupProfile]>;

        let customGroupOrder = this._weStore.persistedStore.groupOrder.value();
        if (!customGroupOrder) {
          customGroupOrder = knownGroups
            .sort(([_, a], [__, b]) => a.name.localeCompare(b.name))
            .map(([hash, _profile]) => encodeHashToBase64(hash));
          this._weStore.persistedStore.groupOrder.set(customGroupOrder);
        }
        knownGroups.forEach(([hash, _]) => {
          if (!customGroupOrder!.includes(encodeHashToBase64(hash))) {
            customGroupOrder!.splice(0, 0, encodeHashToBase64(hash));
          }
          this._weStore.persistedStore.groupOrder.set(customGroupOrder!);
          this.requestUpdate();
        });

        return html`
          <div class="column" style="align-items: flex-start; flex: 1;">
            ${knownGroups
              .sort(
                ([a_hash, _a], [b_hash, _b]) =>
                  customGroupOrder!.indexOf(encodeHashToBase64(a_hash)) -
                  customGroupOrder!.indexOf(encodeHashToBase64(b_hash)),
              )
              .map(
                ([groupDnaHash, groupProfile], idx) => html`
                  <group-context
                    .groupDnaHash=${groupDnaHash}
                    .debug=${true}
                    style="display: flex; flex: 1;"
                  >
                    <div
                      class="row"
                      style="align-items: center; flex: 1; padding: 5px; border-radius: 5px; ${idx %
                        2 !==
                      0
                        ? 'background: var(--sl-color-primary-300);'
                        : ''}"
                    >
                      <sl-tooltip content="${groupProfile.name}" placement="left" hoist>
                        <img
                          src="${groupProfile.logo_src}"
                          style="height: 50px; width: 50px; border-radius: 50%; margin-right: 5px;"
                        />
                      </sl-tooltip>
                      <group-applets-row
                        style="display: flex; flex: 1;"
                        .activeApplets=${Object.keys(this._allCreatableTypes.value)}
                        @applet-chosen=${(e) => {
                          console.log('applet chosen: ', encodeHashToBase64(e.detail.appletHash));
                          this._showCreatablesSelection = encodeHashToBase64(e.detail.appletHash);
                          setTimeout(() => this._creatableSelectionDialog.show());
                        }}
                      ></group-applets-row>
                    </div>
                  </group-context>
                `,
              )}
          </div>
        `;
    }
  }

  render() {
    return html`
      <sl-dialog
        id="creatable-dialog"
        style="--width: 800px;"
        no-header
      >
          <div class="row" style="font-size: 25px; margin-top: 30px; align-items: center; flex: 1; justify-content: center; margin-bottom: 30px;">
            ${msg('Where do you want to create something?')}
          </div>
        <div class="column" style="align-items: center; position: relative; padding-bottom: 30px;">
          ${this.renderAppletMatrix()}
          ${
            this._showCreatableView
              ? html`
                  <sl-dialog
                    id="context-dialog"
                    label="${msg('Create New')} ${this._showCreatableView.creatableName}"
                    @sl-hide=${() => {
                      this._showCreatableView = undefined;
                    }}
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
                    <div class="column" style="margin-top: 10px;">
                      ${Object.entries(
                        this._allCreatableTypes.value[this._showCreatablesSelection],
                      ).map(
                        ([creatableName, creatable]) =>
                          html` <div
                            class="row creatable-item"
                            style="align-items: center; cursor: pointer;"
                            tabindex="0"
                            @click=${() => {
                              this._showCreatableView = {
                                appletHash: decodeHashFromBase64(this._showCreatablesSelection!),
                                creatableName,
                              };
                              this._creatableSelectionDialog.hide();
                              setTimeout(() => this._contextDialog.show());
                            }}
                            @keypress=${(e: KeyboardEvent) => {
                              if (e.key === 'Enter') {
                                this._showCreatableView = {
                                  appletHash: decodeHashFromBase64(this._showCreatablesSelection!),
                                  creatableName,
                                };
                                this._creatableSelectionDialog.hide();
                                setTimeout(() => this._contextDialog.show());
                              }
                            }}
                          >
                            <img src="${creatable.icon_src}" style="height: 35px; width: 35px;" />
                            <div style="margin-left: 5px;">${creatable.label}</div>
                          </div>`,
                      )}
                    </div>
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
