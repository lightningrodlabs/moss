import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { CellId, InstalledAppId } from '@holochain/client';

import '@shoelace-style/shoelace/dist/components/card/card.js';

import '../../groups/elements/group-context.js';
import '../../applets/elements/applet-logo.js';
import '../dialogs/create-group-dialog.js';
import '../reusable/groups-for-applet.js';
import './cell-details.js';

import { weStyles } from '../../shared-styles.js';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { getCellId, getCellName } from '../../utils.js';

@localized()
@customElement('app-debugging-details')
export class AppDebuggingDetails extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  @property()
  appId!: InstalledAppId;

  @state()
  cellsAndIds: Record<string, CellId> = {};

  async firstUpdated() {
    const appClient = await this._mossStore.getAppClient(this.appId);
    const appInfo = await appClient.appInfo();
    // if (!appInfo) throw new Error(`AppInfo of app '${appClient}' undefined.`);
    const cellInfos = Object.values(appInfo!.cell_info).flat();
    const cellsAndIds: Record<string, CellId> = {};

    cellInfos.forEach((cellInfo) => {
      const cellName = getCellName(cellInfo);
      const cellId = getCellId(cellInfo);
      if (cellName && cellId) {
        cellsAndIds[cellName] = cellId;
      }
    });
    this.cellsAndIds = cellsAndIds;
  }

  render() {
    return html` <div class="column">
      ${Object.entries(this.cellsAndIds)
        .sort(([name_a, _a], [name_b, _b]) => name_a.localeCompare(name_b))
        .map(
          ([cellName, cellId]) => html`
          <sl-card style="width: 570px; position: relative; margin: 5px 0;">
            <div
              style="font-weight: bold; position: absolute; top: 6px; right: 10px;"
              title="${msg('cell name')}"
            >
              ${cellName}
            </div>
            <cell-details class="flex flex-1" .appId=${this.appId} .cellId=${cellId}></cell-details>
          </sl-card>
        </div>
      `,
        )}
    </div>`;
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
