import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import {
  CellId,
  DumpFullStateRequest,
  encodeHashToBase64,
  InstalledAppId,
} from '@holochain/client';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import { weStyles } from '../../shared-styles.js';
import { DumpData } from '../../types.js';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';

import './dht-op-detail.js';
import { notify } from '@holochain-open-dev/elements';

@localized()
@customElement('cell-details')
export class CellDetails extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  @property()
  appId!: InstalledAppId;

  @property()
  cellId!: CellId;

  @state()
  dumpData: DumpData | undefined;

  @state()
  showFullDetail = false;

  @state()
  showValidationLimbo = false;

  @state()
  showIntegrationLimbo = false;

  async dumpState() {
    let currentDump = this.dumpData;
    const req: DumpFullStateRequest = {
      cell_id: this.cellId,
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
    this.dumpData = currentDump;
    console.log('dump data: ', this.dumpData);
  }

  renderDumpData() {
    return html`
      <div class="column">
        <div>
          Validation Limbo: ${this.dumpData?.dump.integration_dump.validation_limbo.length}
          <button
            @click=${() => {
              this.showValidationLimbo = !this.showValidationLimbo;
            }}
          >
            ${this.showValidationLimbo ? 'Hide' : 'Show'} DhtOps
          </button>
        </div>
        ${this.showValidationLimbo && this.dumpData
          ? html` <div class="column">
              ${this.dumpData.dump.integration_dump.validation_limbo.map(
                (dhtOp) =>
                  html`<dht-op-detail
                    @click=${() => {
                      console.log(dhtOp);
                      notify('DhtOp logged to console.');
                    }}
                    style="border: 1px solid black; border-radius: 5px; padding: 3px; cursor: pointer;"
                    .dhtOp=${dhtOp}
                  ></dht-op-detail>`,
              )}
            </div>`
          : html``}
        <div>
          Integration Limbo: ${this.dumpData?.dump.integration_dump.integration_limbo.length}
          <button
            @click=${() => {
              this.showIntegrationLimbo = !this.showIntegrationLimbo;
            }}
          >
            ${this.showIntegrationLimbo ? 'Hide' : 'Show'} DhtOps
          </button>
        </div>
        ${this.showIntegrationLimbo && this.dumpData
          ? html` <div class="column">
              ${this.dumpData.dump.integration_dump.integration_limbo.map(
                (dhtOp) =>
                  html`<dht-op-detail
                    @click=${() => {
                      console.log(dhtOp);
                      notify('DhtOp logged to console.');
                    }}
                    style="border: 1px solid black; border-radius: 5px; padding: 3px; cursor: pointer;"
                    .dhtOp=${dhtOp}
                  ></dht-op-detail>`,
              )}
            </div>`
          : html``}
        <div>Integrated: ${this.dumpData?.dump.integration_dump.integrated.length}</div>
        <button
          style="margin-top: 5px;"
          @click=${() => {
            this.showFullDetail = !this.showFullDetail;
          }}
        >
          ${this.showFullDetail ? 'Hide Full Dump' : 'Show Full Dump'}
        </button>
        ${this.showFullDetail ? html`<state-dump .dump=${this.dumpData}></state-dump>` : html``}
      </div>
    `;
  }

  render() {
    return html`
      <div class="debug-data">
        <div style="padding: 5px;">
          <div class="column" style="margin-bottom: 10px;">
            <div><b>Dna Hash:</b> ${encodeHashToBase64(this.cellId[0])}</div>
            <div><b>Public key:</b> ${encodeHashToBase64(this.cellId[1])}</div>
          </div>
          <div class="column">
            <div style="display: flex; align-items: center; flex: 1;">
              <span class="debug-title">State Dump</span>
              <span style="display: flex; flex: 1;"></span>
              <sl-button
                size="small"
                style="margin-left:5px;"
                @click=${async () => {
                  await this.dumpState();
                }}
                >Query</sl-button
              >
            </div>
            ${this.dumpData ? this.renderDumpData() : html``}
          </div>
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
        margin-top: 10px;
        width: 100%;
        display: flex;
        flex: 1;
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
