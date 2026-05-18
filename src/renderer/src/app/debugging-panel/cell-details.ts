import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { CellId, FullStateDump, InstalledAppId } from '@holochain/client';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../shared-styles.js';
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
  dumpData: FullStateDump | undefined;

  @state()
  showFullDetail = false;

  @state()
  showValidationLimbo = false;

  @state()
  showIntegrationLimbo = false;

  async dumpState() {
    this.dumpData = await this._mossStore.adminWebsocket.dumpFullState({ cell_id: this.cellId });
    console.log('dump data: ', this.dumpData);
  }

  renderDumpData() {
    return html`
      <div class="column">
        <div>
          Validation Limbo: ${this.dumpData?.integration_dump.validation_limbo.length}
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
              ${this.dumpData.integration_dump.validation_limbo.map(
                (dhtOp) =>
                  html`<dht-op-detail
                    @click=${() => {
                      console.log(dhtOp);
                      notify(msg('DhtOp logged to console.'));
                    }}
                    style="border: 1px solid black; border-radius: 5px; padding: 3px; cursor: pointer;"
                    .dhtOp=${dhtOp}
                  ></dht-op-detail>`,
              )}
            </div>`
          : html``}
        <div>
          Integration Limbo: ${this.dumpData?.integration_dump.integration_limbo.length}
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
              ${this.dumpData.integration_dump.integration_limbo.map(
                (dhtOp) =>
                  html`<dht-op-detail
                    @click=${() => {
                      console.log(dhtOp);
                      notify(msg('DhtOp logged to console.'));
                    }}
                    style="border: 1px solid black; border-radius: 5px; padding: 3px; cursor: pointer;"
                    .dhtOp=${dhtOp}
                  ></dht-op-detail>`,
              )}
            </div>`
          : html``}
        <div>Integrated: ${this.dumpData?.integration_dump.integrated.length}</div>
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
    mossStyles,
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
