import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import {
  AgentPubKey,
  CellId,
  DhtOp,
  DnaHash,
  DumpFullStateRequest,
  encodeHashToBase64,
  EntryHash,
  InstalledAppId,
  FullStateDump,
  HoloHash,
  Timestamp,
  NetworkInfo,
  Entry,
  SourceChainJsonRecord,
  CreateLink,
  Action,
  DnaHashB64,
} from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../applets/elements/applet-logo.js';
import './create-group-dialog.js';
import './groups-for-applet.js';

import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { weStyles } from '../shared-styles.js';
import { AppletStore } from '../applets/applet-store.js';
import { AppletId } from '@lightningrodlabs/we-applet';
import { appIdFromAppletHash, getCellId } from '../utils.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiBug, mdiLan } from '@mdi/js';
import { decode } from '@msgpack/msgpack';
import { json } from 'stream/consumers';

type DumpData = {
  dump: FullStateDump;
  newOpsCount: number;
};
function dateStr(timestamp: Timestamp) {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
@localized()
@customElement('zome-call-panel')
export class ZomeCallPanel extends LitElement {
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

  async firstUpdated() {
    // TODO add interval here to reload stuff
    this._refreshInterval = window.setInterval(() => this.requestUpdate(), 2000);

    const feedbackBoardAppInfo = await this._mossStore.appWebsocket.appInfo({
      installed_app_id: 'default-app#feedback-board',
    });
    if (!feedbackBoardAppInfo) {
      console.warn('feedback-board appInfo undefined.');
    } else {
      const cellIds = Object.values(feedbackBoardAppInfo.cell_info)
        .flat()
        .map((cellInfo) => getCellId(cellInfo))
        .filter((id) => !!id);
      this._feedbackBoardCellIds = cellIds as CellId[];
    }

    const toolsLibraryAppInfo = await this._mossStore.appWebsocket.appInfo({
      installed_app_id: 'AppstoreLight',
    });
    if (!toolsLibraryAppInfo) {
      console.warn('AppstoreLight appInfo undefined.');
    } else {
      const cellIds = Object.values(toolsLibraryAppInfo.cell_info)
        .flat()
        .map((cellInfo) => getCellId(cellInfo))
        .filter((id) => !!id);
      this._toolsLibraryCellIds = cellIds as CellId[];
    }
  }

  async logNetworkInfo(appId: InstalledAppId): Promise<void> {
    const appInfo = await this._mossStore.appWebsocket.appInfo({
      installed_app_id: appId,
    });
    if (!appInfo) throw new Error('AppInfo undefined.');
    const cellIds = Object.values(appInfo.cell_info)
      .flat()
      .map((cellInfo) => getCellId(cellInfo))
      .filter((id) => !!id);
    const networkInfo = await this._mossStore.appWebsocket.networkInfo({
      agent_pub_key: cellIds[0]![1],
      dnas: cellIds.map((id) => id![0]),
      last_time_queried: (Date.now() - 60000) * 1000, // get bytes from last 60 seconds
    });
    console.log('Network Info for app with appId ', appId, ': ', networkInfo);
  }

  disconnectedCallback(): void {
    if (this._refreshInterval) {
      window.clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
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

  @state()
  _appletsWithDebug: AppletId[] = [];

  @state()
  _appletsWithDumps: { [key: AppletId]: DumpData } = {};

  @state()
  _appletsWithNetInfo: { [key: AppletId]: NetworkInfo } = {};

  toggleDebug(appletId: AppletId) {
    const appletsWithDebug = this._appletsWithDebug;
    if (appletsWithDebug.includes(appletId)) {
      this._appletsWithDebug = appletsWithDebug.filter((id) => id !== appletId);
    } else {
      appletsWithDebug.push(appletId);
      this._appletsWithDebug = Array.from(new Set(appletsWithDebug));
    }
  }

  async dumpState(appletId, appletHash) {
    const cellIds = await this.getCellIds(appletHash);
    const cell_id = cellIds[0]!;

    let currentDump = this._appletsWithDumps[appletId];

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
    this._appletsWithDumps[appletId] = currentDump;
    console.log('NEW OPS COUNT', newOpsCount);
    console.log('RESP', currentDump);
  }

  async getCellIds(appletHash) {
    const appInfo = await this._mossStore.appWebsocket.appInfo({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    if (!appInfo) throw new Error('AppInfo undefined.');
    const cellIds = Object.values(appInfo.cell_info)
      .flat()
      .map((cellInfo) => getCellId(cellInfo))
      .filter((id) => !!id);
    return cellIds;
  }

  async networkInfo(appletId, appletHash) {
    const cellIds = await this.getCellIds(appletHash);
    const networkInfo = await this._mossStore.appWebsocket.networkInfo({
      agent_pub_key: cellIds[0]![1],
      dnas: cellIds.map((id) => id![0]),
      last_time_queried: (Date.now() - 60000) * 1000, // get bytes from last 60 seconds
    });
    this._appletsWithNetInfo[appletId] = networkInfo[0];

    console.log('networkInfo: ', networkInfo);
  }

  renderCreateLink(createLink: CreateLink) {
    return html` Base: ${this.renderHash(createLink.base_address)}; Target:
    ${this.renderHash(createLink.target_address)}`;
  }

  renderDhtOp(op: DhtOp) {
    const opName = Object.keys(op)[0];
    const opValue = Object.values(op)[0];
    const action: Action = opValue[1];

    let entry: Entry | undefined;
    if (opName == 'StoreEntry') {
      entry = opValue[2];
    } else if (opName == 'StoreRecord' && action.type == 'Create') {
      if (opValue[2]['Present']) {
        entry = opValue[2]['Present'];
      }
    }

    return html`
      <div class="dht-op">
        ${opName}: ${action.type} ${action.author ? html`by ${this.renderHash(action.author)}` : ''}
        ${action.type == 'CreateLink' ? this.renderCreateLink(action) : ''}
        ${entry ? this.renderEntry(entry) : ''}
        ${opName == 'RegisterAddLink' ? this.renderCreateLink(action as CreateLink) : ''}
      </div>
    `;
  }

  renderHash(hash: HoloHash) {
    const hashB64 = encodeHashToBase64(hash);
    return html` <span class="hash" title="${hashB64}">${hashB64.slice(0, 8)}</span> `;
  }

  renderObjectWithHashes(object: Object) {
    return Object.entries(object).map(
      ([key, value]) =>
        html`${key}:${value && value['0'] === 132 && value['1'] == '32' && value['2'] == 36
          ? this.renderHash(value)
          : JSON.stringify(value)}; `,
    );
  }

  renderUnknownSerializedObject(object: Object) {
    try {
      // @ts-ignore
      return JSON.stringify(decode(object));
    } catch (e) {
      // @ts-ignore
      const x = Array.from(object);
      // @ts-ignore
      return String.fromCharCode.apply(null, x);
    }
  }

  renderEntry(entry: Entry) {
    const entry_type = Object.keys(entry.entry_type)[0]; // Fixme in version 0.4
    const entry_data = entry.entry;
    let entryHtml: undefined | TemplateResult;
    if (entry_type === 'App') {
      const decoded = decode(entry_data as Uint8Array) as Object;
      if (decoded['document_hash'] && decoded['name'])
        entryHtml = html`<span class="syn"
          >Syn-Workspace Doc:${this.renderHash(decoded['document_hash'])}: ${decoded['name']}</span
        >`;
      else if (decoded['initial_state'] && decoded['meta']) {
        const state = decode(decoded['initial_state']) as Object;
        const meta = decode(decoded['meta']) as Object;
        entryHtml = html`<span class="syn"
          >Syn-Document
          Meta->${this.renderObjectWithHashes(
            meta,
          )}--InitialState:${this.renderUnknownSerializedObject(state)}</span
        >`;
      } else if (decoded['document_hash'] && decoded['state']) {
        const state = decode(decoded['state']) as object;
        entryHtml = html` <div class="syn">
          Syn-Commit Doc:${this.renderHash(decoded['document_hash'])}---
          <span
            >previous commits:
            ${decoded['previous_commit_hashes'].map((h) => this.renderHash(h))}</span
          >
          <div>${this.renderUnknownSerializedObject(state)}</div>
        </div>`;
      } else {
        entryHtml = html`<span class="app-entry">${JSON.stringify(decoded)}</span>`;
      }
    }
    return html`
      <div class="entry">
        ${entry_type}--${entry_type == 'Agent' ? this.renderHash(entry_data as AgentPubKey) : ''}
        ${entryHtml ? entryHtml : ''}
        ${entry_type === 'App' && !entryHtml ? JSON.stringify(entry_data) : ''}
      </div>
    `;
  }
  renderRecord(record: SourceChainJsonRecord) {
    return html`
      <span class="record">
        <span class="action-type">${record.action.type}</span>
        ${this.renderHash(record.action_address)}
        <span class="date">${dateStr(record.action.timestamp)}</span>
        ${record.entry ? this.renderEntry(record.entry) : ''}
        ${record.action.type == 'CreateLink' ? this.renderCreateLink(record.action) : ''}
      </span>
    `;
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

  renderDefaultApps() {
    const toolsLibraryZomeCallCount =
      this._toolsLibraryCellIds.length > 0
        ? window[`__mossZomeCallCount_${encodeHashToBase64(this._toolsLibraryCellIds[0][0])}`]
        : undefined;
    const feedbackBoardZomeCallCount =
      this._feedbackBoardCellIds.length > 0
        ? window[`__mossZomeCallCount_${encodeHashToBase64(this._feedbackBoardCellIds[0][0])}`]
        : undefined;
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
          <div
            class="row"
            style="align-items: center; flex: 1; margin-bottom: 20px; margin-top: 10px;"
          >
            <div class="row" style="align-items: center; width: 300px; font-weight: bold;">
              Applet Library
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
            <button
              style="cursor: pointer;"
              title="Log network info to console"
              @click=${() => this.logNetworkInfo('AppstoreLight')}
            >
              <sl-icon .src=${wrapPathInSvg(mdiLan)}></sl-icon>
            </button>
          </div>
          ${this._showToolsLibraryDetails
            ? Object.keys(toolsLibraryZomeCallCount.functionCalls).map(
                (fn_name) => html`
                  <div
                    class="row"
                    style="align-items: center; margin-top: 5px; margin-bottom: 10px;"
                  >
                    <div style="font-weight: bold; width: 280px; padding-left: 20px;">
                      <div>${fn_name}</div>
                    </div>
                    <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
                      ${toolsLibraryZomeCallCount
                        ? toolsLibraryZomeCallCount.functionCalls[fn_name]
                        : ''}
                    </div>
                    <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
                      ${toolsLibraryZomeCallCount
                        ? Math.round(
                            toolsLibraryZomeCallCount.functionCalls[fn_name] /
                              ((Date.now() - toolsLibraryZomeCallCount.firstCall) / (1000 * 60)),
                          )
                        : ''}
                    </div>
                  </div>
                `,
              )
            : html``}
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
            <span
              style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
              @click=${() => {
                this._showFeedbackBoardDetails = !this._showFeedbackBoardDetails;
              }}
              >${this._showFeedbackBoardDetails ? 'Hide' : 'Details'}</span
            >
            <button
              style="cursor: pointer;"
              title="Log network info to console"
              @click=${() => this.logNetworkInfo('default-app#feedback-board')}
            >
              <sl-icon .src=${wrapPathInSvg(mdiLan)}></sl-icon>
            </button>
          </div>
          ${this._showFeedbackBoardDetails
            ? Object.keys(feedbackBoardZomeCallCount.functionCalls).map(
                (fn_name) => html`
                  <div
                    class="row"
                    style="align-items: center; margin-top: 5px; margin-bottom: 10px;"
                  >
                    <div style="font-weight: bold; width: 280px; padding-left: 20px;">
                      <div>${fn_name}</div>
                    </div>
                    <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
                      ${feedbackBoardZomeCallCount
                        ? feedbackBoardZomeCallCount.functionCalls[fn_name]
                        : ''}
                    </div>
                    <div style="font-weight: bold; text-align: right; width: 80px; color: blue;">
                      ${feedbackBoardZomeCallCount
                        ? Math.round(
                            feedbackBoardZomeCallCount.functionCalls[fn_name] /
                              ((Date.now() - feedbackBoardZomeCallCount.firstCall) / (1000 * 60)),
                          )
                        : ''}
                    </div>
                  </div>
                `,
              )
            : html``}
        </div>
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
                  <button
                    style="cursor: pointer;"
                    title="Log network info to console"
                    @click=${async () => {
                      const groupStore = await (
                        await toPromise(this._mossStore.groupStores)
                      ).get(groupDnaHash);
                      await this.logNetworkInfo(groupStore.appAgentWebsocket.installedAppId);
                    }}
                  >
                    <sl-icon .src=${wrapPathInSvg(mdiLan)}></sl-icon>
                  </button>
                </div>
                ${showDetails
                  ? Object.keys(zomeCallCount.functionCalls).map(
                      (fn_name) => html`
                        <div
                          class="row"
                          style="align-items: center; margin-top: 5px; margin-bottom: 10px;"
                        >
                          <div style="font-weight: bold; width: 280px; padding-left: 20px;">
                            <div>${fn_name}</div>
                          </div>
                          <div
                            style="font-weight: bold; text-align: right; width: 80px; color: blue;"
                          >
                            ${zomeCallCount ? zomeCallCount.functionCalls[fn_name] : ''}
                          </div>
                          <div
                            style="font-weight: bold; text-align: right; width: 80px; color: blue;"
                          >
                            ${zomeCallCount
                              ? Math.round(
                                  zomeCallCount.functionCalls[fn_name] /
                                    ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                                )
                              : ''}
                          </div>
                        </div>
                      `,
                    )
                  : html``}
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
          <div style="font-weight: bold; text-align: right; width: 120px;"></div>
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
            const zomeCallCount = window[`__appletZomeCallCount_${appletId}`];
            const showDetails = this._appletsWithDetails.includes(appletId);
            const dump = this._appletsWithDumps[appletId];
            const netInfo = this._appletsWithNetInfo[appletId];
            const showDebug = this._appletsWithDebug.includes(appletId);
            return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div
                    class="row"
                    style="align-items: center; width: 300px;"
                  >
                      <applet-logo
                        .appletHash=${appletHash}
                        style="margin-top: 2px; margin-bottom: 2px; margin-right: 12px; --size: 48px"
                      ></applet-logo>
                      <div style="font-weight: bold; font-size: 18px;">
                        ${appletStore.applet.custom_name}
                      </div>
                    </div>
                    <div style="display: flex; flex: 1;"></div>
                    <div
                      style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;"
                    >
                      ${zomeCallCount ? zomeCallCount.totalCounts : ''}
                    </div>
                    <div
                      style="font-weight: bold; text-align: right; width: 80px; font-size: 18px;"
                    >
                      ${
                        zomeCallCount
                          ? Math.round(
                              zomeCallCount.totalCounts /
                                ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                            )
                          : ''
                      }
                    </div>
                    <span
                      style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                      @click=${() => this.toggleAppletDetails(appletId)}
                      >${showDetails ? 'Hide' : 'Details'}</span
                    >
                    <sl-icon-button
                      @click=${async () => {
                        this.toggleDebug(appletId);
                      }}
                      .src=${wrapPathInSvg(mdiBug)}
                    >
                    </sl-icon-button>
                    <groups-for-applet
                      style="margin-left: 10px;"
                      .appletHash=${appletHash}
                    ></groups-for-applet>
                  </div>
                  ${
                    showDetails
                      ? Object.keys(zomeCallCount.functionCalls).map(
                          (fn_name) => html`
                            <div
                              class="row"
                              style="align-items: center; margin-top: 5px; margin-bottom: 10px;"
                            >
                              <div style="font-weight: bold; width: 280px; padding-left: 20px;">
                                <div>${fn_name}</div>
                              </div>
                              <div
                                style="font-weight: bold; text-align: right; width: 80px; color: blue;"
                              >
                                ${zomeCallCount ? zomeCallCount.functionCalls[fn_name] : ''}
                              </div>
                              <div
                                style="font-weight: bold; text-align: right; width: 80px; color: blue;"
                              >
                                ${zomeCallCount
                                  ? Math.round(
                                      zomeCallCount.functionCalls[fn_name] /
                                        ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
                                    )
                                  : ''}
                              </div>
                            </div>
                          `,
                        )
                      : html``
                  }
                  ${
                    showDebug
                      ? html` <div class="debug-data">
                          <div style="display:flex;align-items:center;">
                            <span class="debug-title">Network Info</span>
                            <sl-button
                              size="small"
                              style="margin-left:5px;"
                              @click=${async () => {
                                this.networkInfo(appletId, appletHash);
                              }}
                              >Query</sl-button
                            >
                          </div>
                          ${netInfo
                            ? html`
                                <span> Arc Size: ${netInfo.arc_size}</span>
                                <span> Current peer count: ${netInfo.current_number_of_peers}</span>
                                <span> Total network peers: ${netInfo.total_network_peers}</span>
                                <span>
                                  Bytes since last query:
                                  ${netInfo.bytes_since_last_time_queried}</span
                                >
                                <span>
                                  Rounds since last query:
                                  ${netInfo.completed_rounds_since_last_time_queried}</span
                                >

                                <span>
                                  Fetch-pool ops to fetch:
                                  ${netInfo.fetch_pool_info.num_ops_to_fetch}</span
                                >
                                <span>
                                  Fetch-pool bytes to fetch:
                                  ${netInfo.fetch_pool_info.op_bytes_to_fetch}</span
                                >
                              `
                            : ''}
                          <div style="display:flex;align-items:center;">
                            <span class="debug-title">State Dump</span>
                            <sl-button
                              size="small"
                              style="margin-left:5px;"
                              @click=${async () => {
                                this.dumpState(appletId, appletHash);
                              }}
                              >Query</sl-button
                            >
                          </div>
                          ${dump
                            ? html`
                                <div class="debug-dump">
                                  <span>
                                    Peers: (${Object.keys(dump.dump.peer_dump.peers).length})
                                    <div class="long-list">
                                      ${Object.entries(dump.dump.peer_dump.peers).map(
                                        (p) =>
                                          html` <div class="list-item">
                                            ${p[0]}: ${this.renderHash(p[1].kitsune_agent)}--
                                            ${p[1].dump}
                                          </div>`,
                                      )}
                                    </div>
                                  </span>

                                  <span> integrated Ops since last Dump: ${dump.newOpsCount}</span>
                                  <span
                                    >Integrated Ops: ${dump.dump.integration_dump.dht_ops_cursor}
                                    <div class="long-list">
                                      ${dump.dump.integration_dump.integrated.map(
                                        (p) =>
                                          html` <div class="list-item">
                                            ${this.renderDhtOp(p)}
                                          </div>`,
                                      )}
                                    </div>
                                  </span>

                                  <span>
                                    published ops count:
                                    ${dump.dump.source_chain_dump.published_ops_count}</span
                                  >
                                  <div>
                                    Source Chain: (${dump.dump.source_chain_dump.records.length}
                                    records)
                                    <div class="long-list">
                                      ${dump.dump.source_chain_dump.records.map(
                                        (r) =>
                                          html` <div class="list-item">
                                            ${this.renderRecord(r)}
                                          </div>`,
                                      )}
                                    </div>
                                  </div>
                                </div>
                              `
                            : ''}
                        </div>`
                      : ''
                  }
                </div>
              </div>
            `;
          })}
        <div style="min-height: 100px;"></div>
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
        <h2 style="text-align: center;">Applets</h2>
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
        .debug-dump {
          display: flex;
          flex-direction: column;
        }
        .debug-title {
          font-weight: bold;
          font-size: 105%;
        }
        .long-list {
          border: solid 1px #aaa;
          max-height: 300px;
          overflow-y: auto;
          border-radius: 5px;
        }
        .list-item {
          margin-left: 5px;
          border-bottom: solid 1px #ddd;
          padding: 2px;
          overflow-x: auto;
          width: 2000px;
        }
        .hash {
          background-color: #ccc;
          font-size: 80%;
          border-radius: 5px;
          padding: 2px;
        }
        .action-type {
          font-weight: bold;
        }
        .entry {
          margin-left: 10px;
        }
        .syn {
          padding: 4px;
          background-color: lightcoral;
        }
        .app-entry {
          padding: 4px;
          background-color: lightblue;
        }
      }
    `,
  ];
}
