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

import '../../groups/elements/group-context.js';
import '../../applets/elements/applet-logo.js';
import '../dialogs/create-group-dialog.js';
import '../reusable/groups-for-applet.js';
import './state-dump.js';
import './net-info.js';
import './cell-details.js';
import './app-debugging-details.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { weStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { AppletId } from '@theweave/api';
import { getCellId, getCellName, groupModifiersToAppId } from '../../utils.js';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiBug } from '@mdi/js';
import { TOOLS_LIBRARY_APP_ID } from '@theweave/moss-types';
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
  _toolsLibraryCellIds: CellId[] = [];

  @state()
  _groupAppIds: Record<DnaHashB64, InstalledAppId> = {};

  @state()
  _showToolsLibraryDetails = false;

  @state()
  _appsWithDebug: InstalledAppId[] = [];

  @state()
  _toolLibraryTotalAgents: number | undefined;

  async firstUpdated() {
    // TODO add interval here to reload stuff
    this._refreshInterval = window.setInterval(() => this.requestUpdate(), 2000);
    try {
      const toolsLibraryAppClient = await this._mossStore.getAppClient(TOOLS_LIBRARY_APP_ID);
      const cellIds = await this.getCellIds(toolsLibraryAppClient);
      this._toolsLibraryCellIds = cellIds;
    } catch (e) {
      console.warn('Failed to get ToolsLibrary cellIds: ', e);
    }

    const toolLibraryAgents =
      await this._mossStore.toolsLibraryStore.toolsLibraryClient.getAllAgents();
    this._toolLibraryTotalAgents = toolLibraryAgents.length;
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

  renderZomeCallDetails(zomeCallCount: any) {
    return Object.keys(zomeCallCount.functionCalls).map(
      (fn_name) => html`
        <div class="row" style="align-items: center; margin-top: 5px; margin-bottom: 10px;">
          <div style="font-weight: bold; width: 280px; padding-left: 20px;">
            <div>${fn_name}</div>
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
            ${zomeCallCount ? zomeCallCount.functionCalls[fn_name] : ''}
          </div>
          <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
            ${zomeCallCount
              ? Math.round(
                  zomeCallCount.functionCalls[fn_name] /
                    ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                )
              : ''}
          </div>
        </div>
      `,
    );
  }

  renderDefaultApps() {
    const toolsLibraryZomeCallCount =
      this._toolsLibraryCellIds.length > 0
        ? window[`__mossZomeCallCount_${encodeHashToBase64(this._toolsLibraryCellIds[0][0])}`]
        : undefined;

    const showToolsLibraryDebug = this._appsWithDebug.includes(TOOLS_LIBRARY_APP_ID);

    return html`
      <div class="column" style="align-items: flex-start;">
        <div class="row" style="align-items: center;">
          <div style="align-items: center; width: 300px;"></div>
          <div style="font-weight: bold; text-align: right; width: 80px;">total zome calls</div>
          <div style="font-weight: bold; text-align: right; width: 80px;">
            avg. zome calls per minute
          </div>
          <div style="font-weight: bold; text-align: right; width: 90px;"></div>
        </div>
        <div class="column">
          <div class="row" style="align-items: center; flex: 1; margin-top: 10px;">
            <div class="row" style="align-items: center; width: 300px; font-weight: bold;">
              Tools Library (${this._toolLibraryTotalAgents} total peers)
            </div>
            <div style="display: flex; flex: 1;"></div>
            <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
              ${toolsLibraryZomeCallCount ? toolsLibraryZomeCallCount.totalCounts : ''}
            </div>
            <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
              ${toolsLibraryZomeCallCount
                ? Math.round(
                    toolsLibraryZomeCallCount.totalCounts /
                      ((Date.now() - toolsLibraryZomeCallCount.firstCall) / (1000 * 60)),
                  )
                : ''}
            </div>
            <span
              style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
              @click=${() => {
                this._showToolsLibraryDetails = !this._showToolsLibraryDetails;
              }}
              >${this._showToolsLibraryDetails ? 'Hide' : 'Details'}</span
            >

            <sl-icon-button
              @click=${async () => {
                this.toggleDebug(TOOLS_LIBRARY_APP_ID);
              }}
              .src=${wrapPathInSvg(mdiBug)}
            >
            </sl-icon-button>
          </div>
          ${this._showToolsLibraryDetails
            ? this.renderZomeCallDetails(toolsLibraryZomeCallCount)
            : html``}
        </div>
        ${showToolsLibraryDebug
          ? html`<app-debugging-details .appId=${TOOLS_LIBRARY_APP_ID}></app-debugging-details>`
          : html``}
      </div>
    `;
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
          <div style="font-weight: bold; text-align: right; width: 90px;"></div>
        </div>
        ${groups
          .sort((hash_a, hash_b) => {
            const id_a = encodeHashToBase64(hash_a);
            const id_b = encodeHashToBase64(hash_b);
            const zomeCallCount_a = window[`__mossZomeCallCount_${id_a}`]
              ? window[`__mossZomeCallCount_${id_a}`].totalCounts
              : undefined;
            const zomeCallCount_b = window[`__mossZomeCallCount_${id_b}`]
              ? window[`__mossZomeCallCount_${id_b}`].totalCounts
              : undefined;
            if (zomeCallCount_a && !zomeCallCount_b) return -1;
            if (!zomeCallCount_a && zomeCallCount_b) return 1;
            if (zomeCallCount_a && zomeCallCount_b) return zomeCallCount_b - zomeCallCount_a;
            return 0;
          })
          .map((groupDnaHash) => {
            const groupId = encodeHashToBase64(groupDnaHash);
            const zomeCallCount = window[`__mossZomeCallCount_${groupId}`];
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
                  <span
                    style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                    @click=${() => this.toggleGroupDetails(groupId)}
                    >${showDetails ? 'Hide' : 'Details'}</span
                  >

                  <sl-icon-button
                    @click=${async () => {
                      const groupAppId = await this.getGroupAppId(groupDnaHash);
                      const newGroupAppIds = this._groupAppIds;
                      newGroupAppIds[groupId] = groupAppId;
                      this._groupAppIds = newGroupAppIds;
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
          <div style="font-weight: bold; text-align: right; width: 90px;"></div>
          <div style="font-weight: bold; text-align: left; width: 80px;">Groups</div>
        </div>
        ${Array.from(applets.entries())
          .sort(([hash_a, _a], [hash_b, _b]) => {
            const id_a = encodeHashToBase64(hash_a);
            const id_b = encodeHashToBase64(hash_b);
            const zomeCallCount_a = window[`__appletZomeCallCount_${id_a}`]
              ? window[`__appletZomeCallCount_${id_a}`].totalCounts
              : undefined;
            const zomeCallCount_b = window[`__appletZomeCallCount_${id_b}`]
              ? window[`__appletZomeCallCount_${id_b}`].totalCounts
              : undefined;
            if (zomeCallCount_a && !zomeCallCount_b) return -1;
            if (!zomeCallCount_a && zomeCallCount_b) return 1;
            if (zomeCallCount_a && zomeCallCount_b) return zomeCallCount_b - zomeCallCount_a;
            return 0;
          })
          .map(([appletHash, appletStore]) => {
            const appletId = encodeHashToBase64(appletHash);
            const appId = appIdFromAppletHash(appletHash);
            const zomeCallCount = window[`__appletZomeCallCount_${appletId}`];
            const showDetails = this._appletsWithDetails.includes(appletId);
            const showDebug = this._appsWithDebug.includes(appId);
            return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div class="row" style="align-items: center; width: 300px;">
                    <applet-logo
                      .appletHash=${appletHash}
                      style="margin-top: 2px; margin-bottom: 2px; margin-right: 12px; --size: 48px"
                    ></applet-logo>
                    <div style="font-weight: bold; font-size: 18px;">
                      ${appletStore.applet.custom_name}
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
                  <span
                    style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                    @click=${() => this.toggleAppletDetails(appletId)}
                    >${showDetails ? 'Hide' : 'Details'}</span
                  >
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
        <h2 style="text-align: center;">Global Apps</h2>
        <sl-button
          @click=${async () => {
            await window.electronAPI.dumpNetworkStats();
            notify('Stats saved to logs folder (Help > Open Logs)', undefined, undefined, 7000);
          }}
        >
          Dump Network Stats
        </sl-button>
        <div class="row" style="padding: 4px; align-items: center; margin-bottom: 40px;">
          ${this.renderDefaultApps()}
        </div>
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
    `,
  ];
}
