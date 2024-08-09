import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import {
  AppClient,
  CellId,
  DnaHash,
  DnaHashB64,
  DumpFullStateRequest,
  encodeHashToBase64,
  EntryHash,
  InstalledAppId,
  NetworkInfo,
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

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { weStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { AppletId } from '@lightningrodlabs/we-applet';
import { appIdFromAppletHash, getCellId } from '../../utils.js';
import { DumpData } from '../../types.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiBug } from '@mdi/js';

const TOOLS_LIBRARY_APP_ID = 'default-app#tool-library';
const FEEDBACK_BOARD_APP_ID = 'default-app#feedback-board';

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
  _feedbackBoardCellIds: CellId[] = [];

  @state()
  _toolsLibraryCellIds: CellId[] = [];

  @state()
  _showFeedbackBoardDetails = false;

  @state()
  _showToolsLibraryDetails = false;

  @state()
  _appsWithDebug: InstalledAppId[] = [];

  @state()
  _appsWithDumps: { [key: InstalledAppId]: DumpData } = {};

  @state()
  _appsWithNetInfo: { [key: InstalledAppId]: NetworkInfo } = {};

  @state()
  _toolLibraryTotalAgents: number | undefined;

  async firstUpdated() {
    // TODO add interval here to reload stuff
    this._refreshInterval = window.setInterval(() => this.requestUpdate(), 2000);
    try {
      const feedbackAppClient = await this._mossStore.getAppClient(FEEDBACK_BOARD_APP_ID);
      const cellIds = await this.getCellIds(feedbackAppClient);
      this._feedbackBoardCellIds = cellIds;
    } catch (e) {
      console.warn('Failed to get feedback-board cellIds: ', e);
    }

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

  async dumpState(appId: InstalledAppId) {
    const appClient = await this._mossStore.getAppClient(appId);
    const cellIds = await this.getCellIds(appClient);
    const cell_id = cellIds[0]!;

    let currentDump = this._appsWithDumps[appClient.installedAppId];

    const req: DumpFullStateRequest = {
      cell_id,
      dht_ops_cursor: currentDump ? currentDump.dump.integration_dump.dht_ops_cursor : 0,
    };
    const resp = await this._mossStore.adminWebsocket.dumpFullState(req);
    let newOpsCount = 0;
    if (!currentDump) {
      newOpsCount = resp.integration_dump.dht_ops_cursor;
      currentDump = {
        dump: resp,
        newOpsCount,
      };
    } else {
      newOpsCount =
        resp.integration_dump.dht_ops_cursor - currentDump.dump.integration_dump.dht_ops_cursor;
      if (newOpsCount > 0) {
        const currentIntegrated = currentDump.dump.integration_dump.integrated;
        currentIntegrated.concat([...currentDump.dump.integration_dump.integrated]);
      }
      currentDump.dump.peer_dump = resp.peer_dump;
      currentDump.dump.source_chain_dump = resp.source_chain_dump;
      currentDump.newOpsCount = newOpsCount;
    }
    this._appsWithDumps[appClient.installedAppId] = currentDump;
  }

  async networkInfo(appId: InstalledAppId) {
    const appClient = await this._mossStore.getAppClient(appId);
    const cellIds = await this.getCellIds(appClient);
    const networkInfo = await appClient.networkInfo({
      dnas: cellIds.map((id) => id![0]),
      last_time_queried: (Date.now() - 60000) * 1000, // get bytes from last 60 seconds
    });
    this._appsWithNetInfo[appClient.installedAppId] = networkInfo[0];

    console.log('networkInfo: ', networkInfo);
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

  renderDebugInfo(appId: InstalledAppId, netInfo: NetworkInfo, dump: DumpData) {
    return html`
      <div class="debug-data">
        <div class="row" style="align-items: center;">
          <span class="debug-title">Network Info</span>
          <sl-button
            size="small"
            style="margin-left:5px;"
            @click=${async () => {
              this.networkInfo(appId);
            }}
            >Query</sl-button
          >
        </div>
        ${netInfo ? html`<net-info .networkInfo=${netInfo}></net-info>` : html``}
        <div style="display:flex;align-items:center;">
          <span class="debug-title">State Dump</span>
          <sl-button
            size="small"
            style="margin-left:5px;"
            @click=${async () => {
              await this.dumpState(appId);
            }}
            >Query</sl-button
          >
        </div>
        ${dump ? html`<state-dump .dump=${dump}></state-dump>` : html``}
      </div>
    `;
  }

  renderDefaultApps() {
    const toolsLibraryZomeCallCount =
      this._toolsLibraryCellIds.length > 0
        ? window[`__mossZomeCallCount_${encodeHashToBase64(this._toolsLibraryCellIds[0][0])}`]
        : undefined;
    const feedbackBoardZomeCallCount =
      this._feedbackBoardCellIds.length > 0
        ? window[`__mossZomeCallCount_${encodeHashToBase64(this._feedbackBoardCellIds[0][0])}`]
        : undefined;

    const showToolsLibraryDebug = this._appsWithDebug.includes(TOOLS_LIBRARY_APP_ID);
    const toolsLibraryNetInfo = this._appsWithNetInfo[TOOLS_LIBRARY_APP_ID];
    const toolsLibraryDump = this._appsWithDumps[TOOLS_LIBRARY_APP_ID];

    const showfeedbackBoardDebug = this._appsWithDebug.includes(FEEDBACK_BOARD_APP_ID);
    const feedbackBoardNetInfo = this._appsWithNetInfo[FEEDBACK_BOARD_APP_ID];
    const feedbackBoardDump = this._appsWithDumps[FEEDBACK_BOARD_APP_ID];

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
          ? this.renderDebugInfo(TOOLS_LIBRARY_APP_ID, toolsLibraryNetInfo, toolsLibraryDump)
          : html``}

        <div class="column" style="margin-top: 20px;">
          <div class="row" style="align-items: center; flex: 1;">
            <div class="row" style="align-items: center; width: 300px; font-weight: bold;">
              Feedback Board
            </div>
            <div style="display: flex; flex: 1;"></div>
            <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
              ${feedbackBoardZomeCallCount ? feedbackBoardZomeCallCount.totalCounts : ''}
            </div>
            <div style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;">
              ${feedbackBoardZomeCallCount
                ? Math.round(
                    feedbackBoardZomeCallCount.totalCounts /
                      ((Date.now() - feedbackBoardZomeCallCount.firstCall) / (1000 * 60)),
                  )
                : ''}
            </div>
            ${feedbackBoardZomeCallCount
              ? html`
                  <span
                    style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                    @click=${() => {
                      this._showFeedbackBoardDetails = !this._showFeedbackBoardDetails;
                    }}
                    >${this._showFeedbackBoardDetails ? 'Hide' : 'Details'}</span
                  >
                  <sl-icon-button
                    @click=${async () => {
                      this.toggleDebug(TOOLS_LIBRARY_APP_ID);
                    }}
                    .src=${wrapPathInSvg(mdiBug)}
                  >
                  </sl-icon-button>
                `
              : html``}
          </div>
          ${this._showFeedbackBoardDetails
            ? this.renderZomeCallDetails(feedbackBoardZomeCallCount)
            : html``}
        </div>
        ${showfeedbackBoardDebug
          ? this.renderDebugInfo(FEEDBACK_BOARD_APP_ID, feedbackBoardNetInfo, feedbackBoardDump)
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
                </div>
                ${showDetails ? this.renderZomeCallDetails(zomeCallCount) : html``}
              </div>
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
            const dump = this._appsWithDumps[appId];
            const netInfo = this._appsWithNetInfo[appId];
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
              ${showDebug ? this.renderDebugInfo(appId, netInfo, dump) : html``}
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

      .debug-data {
        padding: 5px;
        display: flex;
        flex-direction: column;
        background-color: #fff;
        border-radius: 5px;
      }

      .debug-title {
        font-weight: bold;
        font-size: 105%;
      }
    `,
  ];
}
