import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import {encodeHashToBase64, EntryHash, HoloHashMap} from '@holochain/client';
import { hashState } from '@holochain-open-dev/elements';
import {AsyncStatus, pipe, sliceAndJoin, StoreSubscriber} from '@holochain-open-dev/stores';

import '@holochain-open-dev/elements/dist/elements/display-error.js';

import './applet-settings-card.js';
import './abandoned-applet-settings-card.js';
import './inactive-tools.js';

import { repeat } from 'lit/directives/repeat.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import {GetonlyMap} from "@holochain-open-dev/utils";

enum TabsState {
  Inactive,
  Active,
  Abandoned,
  Ignored,
}

@localized()
@customElement('tools-settings')
export class ToolsSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

    _groupApplets: StoreSubscriber<AsyncStatus<HoloHashMap<EntryHash, any>>> = new StoreSubscriber(
        this,
        () =>
            pipe(this._groupStore.allMyInstalledApplets, (myInstalledApplets) =>
                sliceAndJoin(this._groupStore.applets as GetonlyMap<any, any>, myInstalledApplets),
            ),
        () => [this._groupStore, this._mossStore],
    );

  _allMyEverJoinedApplets: StoreSubscriber<AsyncStatus<HoloHashMap<EntryHash, any>>> = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.allMyApplets, (allMyEverJoinedApplets) =>
        sliceAndJoin(this._groupStore.applets as GetonlyMap<any, any>, allMyEverJoinedApplets),
      ),
    () => [this._groupStore],
  );

  public showInactiveTools() {
    this.tabsState = TabsState.Inactive;
  }

  @state()
  tabsState: TabsState = TabsState.Active;

  @state(hashState())
  appletToUnarchive: EntryHash | undefined;

  @state()
  archiving = false;

  @state()
  unarchiving = false;

  async firstUpdated() {
    // Load group applets metadata to be used by <applet-detail-card> components
    await this._groupStore.groupAppletsMetaData.reload();
  }

  renderInstalledApplets() {
    switch (this._groupApplets.value?.status) {
      case 'pending':
        return html` <div class="column center-content" style="flex: 1;">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
        </div>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the Tools installed in this group')}
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        const applets = this._groupApplets.value.value;
        const groupDisabled = !!this._mossStore.persistedStore.disabledGroupApplets.value(
          this._groupStore.groupDnaHash,
        );
        if (applets.size === 0)
          return html`
            <div class="row center-content" style="flex: 1">
              <span
                class="placeholder"
                style="margin: 24px; text-align: center; max-width: 600px; font-size: 16px;"
                >${msg(
            "You don't have any Tools installed in this group. Go to the Tool Library to install Tools to this group.",
          )}
              </span>
            </div>
          `;
        return html`
          <div class="column" style="flex: 1;">
            ${repeat(
          Array.from(applets.entries()).sort(([_, a], [__, b]) =>
            a.custom_name.localeCompare(b.custom_name),
          ),
          ([appletHash, _applet]) => encodeHashToBase64(appletHash),
          ([appletHash, applet]) => html`
                <applet-settings-card
                  class="flex flex-1"
                  style="${groupDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}"
                  @applets-disabled=${(e) => {
              this.dispatchEvent(
                new CustomEvent('applets-disabled', {
                  detail: e.detail,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
                  .appletHash=${appletHash}
                  .applet=${applet}
                ></applet-settings-card>
              `,
        )}
          </div>
        `;
    }
  }

  renderToolsInactivate() {
    return html`<inactive-tools></inactive-tools>`;
  }
  renderToolsActive() {
    return html`${this.renderInstalledApplets()}`;
  }
  renderToolsAbandoned() {
    return html`${this.renderAbandonedApplets()}`;
  }
  renderToolsIgnored() {
    return html`<inactive-tools .showIgnoredOnly=${true}></inactive-tools>`;
  }

  renderContent() {
    switch (this.tabsState) {
      case TabsState.Inactive:
        return this.renderToolsInactivate();
      case TabsState.Active:
        return this.renderToolsActive();
      case TabsState.Abandoned:
        return this.renderToolsAbandoned();
      case TabsState.Ignored:
        return this.renderToolsIgnored();
    }
  }

  renderAbandonedApplets() {
    const isError =
      this._groupApplets.value.status === 'error' ||
      this._allMyEverJoinedApplets.value.status === 'error';
    if (isError) return html`<div>Error: Failed to get information about abandoned Tools.</div>`;
    const isPending =
      this._groupApplets.value.status === 'pending' ||
      this._allMyEverJoinedApplets.value.status === 'pending';
    if (isPending)
      return html` <div class="column center-content" style="flex: 1;">
        <sl-spinner style="font-size: 30px;"></sl-spinner>
      </div>`;
    if (
      this._groupApplets.value.status === 'complete' &&
      this._allMyEverJoinedApplets.value.status === 'complete'
    ) {
      const installedApplets = Array.from(this._groupApplets.value.value.keys()).map((appletHash) =>
        encodeHashToBase64(appletHash),
      );
      const abandonedApplets = Array.from(
        this._allMyEverJoinedApplets.value.value.entries(),
      ).filter(
        ([appletHash, _applet]) => !installedApplets.includes(encodeHashToBase64(appletHash)),
      );
      if (abandonedApplets.length === 0)
        return html`
          <div class="row center-content" style="flex: 1">
            <span
              class="placeholder"
              style="margin: 24px; text-align: center; max-width: 600px; font-size: 16px;"
              >${msg('No uninstalled tools.')}
            </span>
          </div>
        `;
      const groupDisabled = !!this._mossStore.persistedStore.disabledGroupApplets.value(
        this._groupStore.groupDnaHash,
      );
      return html`
        <div class="column" style="flex: 1;">
          ${repeat(
        abandonedApplets.sort(([_, a], [__, b]) => a.custom_name.localeCompare(b.custom_name)),
        ([appletHash, _applet]) => encodeHashToBase64(appletHash),
        ([appletHash, applet]) => html`
              <abandoned-applet-settings-card
                style="${groupDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}"
                .appletHash=${appletHash}
                .applet=${applet}
              ></abandoned-applet-settings-card>
            `,
      )}
        </div>
      `;
    }
    return html`<div>undefined state</div>`;
  }

  render() {
    return html`
      <div
        class="column flex-1"
        style="overflow: auto; --sl-border-radius-medium: 20px; max-height: 500px; padding: 2px;"
      >
        <div class="row items-center tab-bar flex-1">
          <button
            class="tab ${this.tabsState === TabsState.Inactive ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Inactive;
      }}
          >
            ${msg('To Activate')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Active ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Active;
      }}
          >
            ${msg('Active')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Abandoned ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Abandoned;
      }}
          >
            ${msg('Uninstalled')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Ignored ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Ignored;
      }}
          >
            ${msg('Ignored')}
          </button>
        </div>
        <div
          class="column"
          style="margin-top: 10px; overflow-y: auto; scrollbar-gutter: stable; scrollbar-width: thin;margin-right:-2px;"
        >
          ${this.renderContent()}
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
