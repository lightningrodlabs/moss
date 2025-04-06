import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import {
  AppClient,
  CellId,
  DnaHash,
  DnaHashB64,
  encodeHashToBase64,
  EntryHash,
  InstalledAppId,
} from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

import '../../groups/elements/group-context.js';
import '../../applets/elements/applet-logo.js';
import '../dialogs/create-group-dialog.js';
import '../reusable/groups-for-applet.js';
import './state-dump.js';
import './net-info.js';
import './cell-details.js';
import './app-debugging-details.js';

import { mossStoreContext } from '../../context.js';
import { MossStore, ZomeCallCounts } from '../../moss-store.js';
import { weStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { AppletId } from '@theweave/api';
import { getCellId, getCellName, groupModifiersToAppId } from '../../utils.js';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiBug } from '@mdi/js';
import { appIdFromAppletHash } from '@theweave/utils';

@localized()
@customElement('debugging-panel')
export class DebuggingPanel extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  _applets = new StoreSubscriber(
    this,
    () => this._mossStore.allRunningApplets,
    () => [],
  );

  _groups = new StoreSubscriber(
    this,
    () => this._mossStore.groupsDnaHashes,
    () => [],
  );

  @state()
  _refreshInterval: number | undefined;

  @state()
  _appletsWithDetails: AppletId[] = [];

  @state()
  _groupsWithDetails: DnaHashB64[] = [];

  @state()
  _groupAppIds: Record<DnaHashB64, InstalledAppId> = {};

  @state()
  _appsWithDebug: InstalledAppId[] = [];

  async firstUpdated() {
    // TODO add interval here to reload stuff
    this._refreshInterval = window.setInterval(() => this.requestUpdate(), 2000);
    // populate group app ids
    const groupDnaHashes = await toPromise(this._mossStore.groupsDnaHashes);
    await Promise.all(
      groupDnaHashes.map(async (groupDnaHash) => {
        const groupAppId = await this.getGroupAppId(groupDnaHash);
        const newGroupAppIds = this._groupAppIds;
        newGroupAppIds[encodeHashToBase64(groupDnaHash)] = groupAppId;
        this._groupAppIds = newGroupAppIds;
      }),
    );
    console.log('groupAppIds: ', this._groupAppIds);
  }

  disconnectedCallback(): void {
    if (this._refreshInterval) {
      window.clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
  }

  async getCellIds(appClient: AppClient): Promise<CellId[]> {
    const appInfo = await appClient.appInfo();
    // if (!appInfo) throw new Error(`AppInfo of app '${appClient}' undefined.`);
    const cellIds = Object.values(appInfo!.cell_info)
      .flat()
      .map((cellInfo) => getCellId(cellInfo))
      .filter((id) => !!id);
    return cellIds as CellId[];
  }

  async getCellsAndIds(appClient: AppClient): Promise<Record<string, CellId>> {
    const appInfo = await appClient.appInfo();
    // if (!appInfo) throw new Error(`AppInfo of app '${appClient}' undefined.`);
    const cellInfos = Object.values(appInfo!.cell_info).flat();
    const cellAndIds: Record<string, CellId> = {};

    cellInfos.forEach((cellInfo) => {
      const cellName = getCellName(cellInfo);
      const cellId = getCellId(cellInfo);
      if (cellName && cellId) {
        cellAndIds[cellName] = cellId;
      }
    });
    return cellAndIds;
  }

  async getGroupAppId(groupDnaHash: Uint8Array) {
    const groupStore = await this._mossStore.groupStore(groupDnaHash);
    if (!groupStore) throw new Error('No group store found for dna hash');
    const modifiers = await toPromise(groupStore.modifiers);
    const appId = await groupModifiersToAppId(modifiers);
    console.log('Got group app id: ', appId);
    return appId;
  }

  toggleAppletDetails(appletId: AppletId) {
    const appletsWithDetails = this._appletsWithDetails;
    if (appletsWithDetails.includes(appletId)) {
      this._appletsWithDetails = appletsWithDetails.filter((id) => id !== appletId);
    } else {
      appletsWithDetails.push(appletId);
      this._appletsWithDetails = Array.from(new Set(appletsWithDetails));
    }
  }

  toggleGroupDetails(groupId: DnaHashB64) {
    const groupWithDetails = this._groupsWithDetails;
    if (groupWithDetails.includes(groupId)) {
      this._groupsWithDetails = groupWithDetails.filter((id) => id !== groupId);
    } else {
      groupWithDetails.push(groupId);
      this._groupsWithDetails = Array.from(new Set(groupWithDetails));
    }
  }

  toggleDebug(appId: InstalledAppId) {
    const appsWithDebug = this._appsWithDebug;
    if (appsWithDebug.includes(appId)) {
      this._appsWithDebug = appsWithDebug.filter((id) => id !== appId);
    } else {
      appsWithDebug.push(appId);
      this._appsWithDebug = Array.from(new Set(appsWithDebug));
    }
  }

  renderZomeCallDetails(zomeCallCount: ZomeCallCounts) {
    return Object.keys(zomeCallCount.functionCalls).map(
      (fn_name) => html`
        <div class="row" style="align-items: center; margin-top: 5px; margin-bottom: 10px;">
          <div style="font-weight: bold; width: 280px; padding-left: 20px;">
            <div>${fn_name}</div>
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
            ${zomeCallCount ? zomeCallCount.functionCalls[fn_name].length : ''}
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
            ${zomeCallCount
              ? Math.round(
                  zomeCallCount.functionCalls[fn_name].length /
                    ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                )
              : ''}
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
            ${zomeCallCount.functionCalls[fn_name][zomeCallCount.functionCalls[fn_name].length - 1]
              .durationMs}ms
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
            ${zomeCallCount.functionCalls[fn_name].length
              ? Math.round(
                  zomeCallCount.functionCalls[fn_name].reduce(
                    (sum, item) => sum + item.durationMs,
                    0,
                  ) / zomeCallCount.functionCalls[fn_name].length,
                )
              : 'NaN'}ms
          </div>
        </div>
      `,
    );
  }

  renderGroups(groups: DnaHash[]) {
    return html`
      <div class="column flex-scrollable-y" style="align-items: flex-start;">
        <div class="row" style="align-items: center;">
          <div style="align-items: center; width: 300px;"></div>
          <div style="font-weight: bold; text-align: right; width: 80px;">total zome calls</div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            avg. zome calls per minute
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            duration of last zome call (ms)
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            avg. zome call duration
          </div>
          <div style="font-weight: bold; text-align: right; width: 90px;"></div>
        </div>
        ${groups
          .sort((hash_a, hash_b) => {
            const id_a = this._groupAppIds[encodeHashToBase64(hash_a)];
            const id_b = this._groupAppIds[encodeHashToBase64(hash_b)];
            const zomeCallCount_a = this._mossStore.zomeCallLogs[id_a].totalCounts;
            const zomeCallCount_b = this._mossStore.zomeCallLogs[id_b].totalCounts;
            if (zomeCallCount_a && !zomeCallCount_b) return -1;
            if (!zomeCallCount_a && zomeCallCount_b) return 1;
            if (zomeCallCount_a && zomeCallCount_b) return zomeCallCount_b - zomeCallCount_a;
            return 0;
          })
          .map((groupDnaHash) => {
            const groupId = encodeHashToBase64(groupDnaHash);
            const appId = this._groupAppIds[groupId];
            const zomeCallCount = this._mossStore.zomeCallLogs[appId];
            const showDetails = this._groupsWithDetails.includes(groupId);
            const groupAppId = this._groupAppIds[groupId];
            const showDebug = this._appsWithDebug.includes(groupAppId);
            return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div class="row" style="align-items: center; width: 300px;">
                    <group-context .groupDnaHash=${groupDnaHash}>
                      <group-logo
                        .groupDnaHash=${groupDnaHash}
                        style="margin-right: 8px; --size: 40px"
                      ></group-logo
                    ></group-context>
                  </div>
                  <div style="display: flex; flex: 1;"></div>
                  <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
                    ${zomeCallCount ? zomeCallCount.totalCounts : ''}
                  </div>
                  <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
                    ${zomeCallCount
                      ? Math.round(
                          zomeCallCount.totalCounts /
                            ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                        )
                      : ''}
                  </div>
                  <div
                    style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;"
                  ></div>
                  <div
                    style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;"
                  ></div>
                  ${window.__ZOME_CALL_LOGGING_ENABLED__
                    ? html`<span
                        style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                        @click=${() => this.toggleGroupDetails(groupId)}
                        >${showDetails ? 'Hide' : 'Details'}</span
                      >`
                    : html`<span style="min-width: 60px;"></span>`}

                  <sl-icon-button
                    @click=${async () => {
                      const groupAppId = this._groupAppIds[encodeHashToBase64(groupDnaHash)];
                      this.toggleDebug(groupAppId);
                    }}
                    .src=${wrapPathInSvg(mdiBug)}
                  >
                  </sl-icon-button>
                </div>
                ${showDetails ? this.renderZomeCallDetails(zomeCallCount) : html``}
              </div>
              ${showDebug
                ? html`<app-debugging-details .appId=${groupAppId}></app-debugging-details>`
                : html``}
            `;
          })}
      </div>
    `;
  }

  renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
    return html`
      <div class="column flex-scrollable-y" style="align-items: flex-start;">
        <div class="row" style="align-items: center;">
          <div style="align-items: center; width: 300px;"></div>
          <div style="font-weight: bold; text-align: right; width: 80px;">total zome calls</div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            avg. zome calls per minute
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            duration of last zome call (ms)
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            avg. zome call duration
          </div>
          <div style="font-weight: bold; text-align: right; width: 90px;"></div>
          <div style="font-weight: bold; text-align: left; width: 80px;">Groups</div>
        </div>
        ${Array.from(applets.entries())
          .sort(([hash_a, _a], [hash_b, _b]) => {
            const id_a = appIdFromAppletHash(hash_a);
            const id_b = appIdFromAppletHash(hash_b);
            const zomeCallCount_a = this._mossStore.zomeCallLogs[id_a]?.totalCounts;
            const zomeCallCount_b = this._mossStore.zomeCallLogs[id_b]?.totalCounts;
            if (zomeCallCount_a && !zomeCallCount_b) return -1;
            if (!zomeCallCount_a && zomeCallCount_b) return 1;
            if (zomeCallCount_a && zomeCallCount_b) return zomeCallCount_b - zomeCallCount_a;
            return 0;
          })
          .map(([appletHash, appletStore]) => {
            const appletId = encodeHashToBase64(appletHash);
            const appId = appIdFromAppletHash(appletHash);
            const zomeCallCount = this._mossStore.zomeCallLogs[appId];
            const showDetails = this._appletsWithDetails.includes(appletId);
            const showDebug = this._appsWithDebug.includes(appId);
            const iframeCounts = this._mossStore.iframeStore.appletIframesCounts(appletId);
            return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div class="row" style="align-items: center; width: 300px;">
                    <applet-logo
                      .appletHash=${appletHash}
                      style="margin-top: 2px; margin-bottom: 2px; margin-right: 12px; --size: 48px"
                    ></applet-logo>
                    <div class="column">
                      <div style="font-weight: bold; font-size: 18px;">
                        ${appletStore.applet.custom_name}
                      </div>
                      <div>
                        <b>iframes:</b>
                        ${iframeCounts
                          ? Object.entries(iframeCounts).map(
                              ([viewType, count]) => html`${viewType} (${count}) `,
                            )
                          : html``}
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; flex: 1;"></div>
                  <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
                    ${zomeCallCount ? zomeCallCount.totalCounts : ''}
                  </div>
                  <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
                    ${zomeCallCount
                      ? Math.round(
                          zomeCallCount.totalCounts /
                            ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                        )
                      : ''}
                  </div>
                  <div
                    style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;"
                  ></div>
                  <div
                    style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;"
                  ></div>
                  ${window.__ZOME_CALL_LOGGING_ENABLED__
                    ? html` <span
                        style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                        @click=${() => this.toggleAppletDetails(appletId)}
                        >${showDetails ? 'Hide' : 'Details'}</span
                      >`
                    : html`<span style="min-width: 60px;"></span>`}
                  <sl-icon-button
                    @click=${async () => {
                      this.toggleDebug(appId);
                    }}
                    .src=${wrapPathInSvg(mdiBug)}
                  >
                  </sl-icon-button>
                  <groups-for-applet
                    style="margin-left: 10px;"
                    .appletHash=${appletHash}
                  ></groups-for-applet>
                </div>
                ${showDetails ? this.renderZomeCallDetails(zomeCallCount) : html``}
              </div>
              ${showDebug
                ? html`<app-debugging-details .appId=${appId}></app-debugging-details>`
                : html``}
            `;
          })}
      </div>
    `;
  }

  renderGroupsLoading() {
    switch (this._groups.value.status) {
      case 'pending':
        return html`Loading...`;
      case 'error':
        return html`<display-error
          .headline=${msg('Failed to get groups.')}
          tooltip
          .error=${this._groups.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderGroups(this._groups.value.value);
    }
  }

  renderAppletsLoading() {
    switch (this._applets.value.status) {
      case 'pending':
        return html`Loading...`;
      case 'error':
        return html`<display-error
          .headline=${msg('Failed to get running applets.')}
          tooltip
          .error=${this._applets.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderApplets(this._applets.value.value);
    }
  }

  render() {
    return html`
      <div class="column" style="height: calc(100vh - 140px); padding: 30px; overflow-y: auto;">
        <div class="warning column center-content">
          <div class="row items-center">
            <div>
              ${window.__ZOME_CALL_LOGGING_ENABLED__
                ? 'Disable zome call logging (will reload Moss)'
                : 'Enable zome call logging (will reload Moss)'}
            </div>
            <sl-switch
              style="margin-bottom: 5px; margin-left: 12px;"
              .checked=${window.__ZOME_CALL_LOGGING_ENABLED__}
              @sl-change=${() => {
                if (window.__ZOME_CALL_LOGGING_ENABLED__) {
                  window.sessionStorage.removeItem('__ZOME_CALL_LOGGING_ENABLED__');
                } else {
                  window.sessionStorage.setItem('__ZOME_CALL_LOGGING_ENABLED__', 'true');
                }
                window.location.reload();
              }}
            ></sl-switch>
          </div>
        </div>
        <h2 style="text-align: center;">Global Apps</h2>
        <div class="center-content" style="text-align: center;">No global apps installed.</div>
        <sl-button
          @click=${async () => {
            await window.electronAPI.dumpNetworkStats();
            notify('Stats saved to logs folder (Help > Open Logs)', undefined, undefined, 7000);
          }}
          style="margin-top: 20px;"
        >
          Dump Network Stats
        </sl-button>
        <h2 style="text-align: center;">Groups DNAs</h2>
        <div class="row" style="padding: 4px; align-items: center; margin-bottom: 40px;">
          ${this.renderGroupsLoading()}
        </div>
        <h2 style="text-align: center;">Tools</h2>
        <div class="row" style="padding: 4px; align-items: center; margin-bottom: 100px;">
          ${this.renderAppletsLoading()}
        </div>
      </div>
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }

      .warning {
        background: #9fb0ff;
        border-radius: 12px;
        padding: 20px;
        border: 2px solid #03004c;
        font-weight: bold;
      }
    `,
  ];
}
