import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import {
  AgentPubKey,
  AppAgentClient,
  AppWebsocket,
  CellId,
  Dna,
  DnaHash,
  encodeHashToBase64,
  EntryHash,
  InstalledAppId,
  NetworkInfoRequest,
  Timestamp,
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
import { HoloHashMap } from '@holochain-open-dev/utils';
import { appIdFromAppletHash, getCellId } from '../utils.js';

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

  @state()
  _refreshInterval: number | undefined;

  @state()
  _appletsWithDetails: AppletId[] = [];

  firstUpdated() {
    // TODO add interval here to reload stuff
    this._refreshInterval = window.setInterval(() => this.requestUpdate(), 2000);
  }

  disconnectedCallback(): void {
    if (this._refreshInterval) {
      window.clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
  }

  toggleDetails(appletId: AppletId) {
    const appletsWithDetails = this._appletsWithDetails;
    if (appletsWithDetails.includes(appletId)) {
      this._appletsWithDetails = appletsWithDetails.filter((id) => id !== appletId);
    } else {
      appletsWithDetails.push(appletId);
      this._appletsWithDetails = Array.from(new Set(appletsWithDetails));
    }
  }

  renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
    return html`
      <div
        class="column flex-scrollable-y"
        style="align-items: flex-start; overflow-y: auto; height: calc(100vh - 140px); padding: 50px;"
      >
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
            const zomeCallCount_a = window[`__zomeCallCount_${id_a}`]
              ? window[`__zomeCallCount_${id_a}`].totalCounts
              : undefined;
            const zomeCallCount_b = window[`__zomeCallCount_${id_b}`]
              ? window[`__zomeCallCount_${id_b}`].totalCounts
              : undefined;
            if (zomeCallCount_a && !zomeCallCount_b) return -1;
            if (!zomeCallCount_a && zomeCallCount_b) return 1;
            if (zomeCallCount_a && zomeCallCount_b) return zomeCallCount_b - zomeCallCount_a;
            return 0;
          })
          .map(([appletHash, appletStore]) => {
            const appletId = encodeHashToBase64(appletHash);
            const zomeCallCount = window[`__zomeCallCount_${appletId}`];
            const showDetails = this._appletsWithDetails.includes(appletId);
            return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div
                    @click=${async () => {
                      const appInfo = await this._mossStore.appWebsocket.appInfo({
                        installed_app_id: appIdFromAppletHash(appletHash),
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

                      console.log('networkInfo: ', networkInfo);
                    }}
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
                    @click=${() => this.toggleDetails(appletId)}
                    >${showDetails ? 'Hide' : 'Details'}</span
                  >
                  <groups-for-applet
                    style="margin-left: 10px;"
                    .appletHash=${appletHash}
                  ></groups-for-applet>
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
        <div style="min-height: 100px;"></div>
      </div>
    `;
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
      <div class="row" style="flex: 1; padding: 4px; align-items: center;">
        ${this.renderAppletsLoading()}
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
