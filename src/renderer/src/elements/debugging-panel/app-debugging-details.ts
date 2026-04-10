import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import { CellId, DnaHashB64, DumpNetworkMetricsResponse, encodeHashToBase64, InstalledAppId, NetworkMetrics } from '@holochain/client';

import '@shoelace-style/shoelace/dist/components/card/card.js';

import '../../groups/elements/group-context.js';
import '../../applets/elements/applet-logo.js';
import '../dialogs/create-group-dialog.js';
import '../reusable/groups-for-applet.js';
import './cell-details.js';

import { mossStyles } from '../../shared-styles.js';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { getCellName } from '../../utils.js';
import { getCellId } from '@theweave/utils';

function formatTimeAgo(timestampMicros: number): string {
  if (!timestampMicros) return 'never';
  const nowMs = Date.now();
  const thenMs = timestampMicros / 1000;
  const diffMs = nowMs - thenMs;
  if (diffMs < 0) return 'future';
  if (diffMs < 1000) return '<1s ago';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function extractPeerShortId(peerUrl: string): string {
  // Extract last 5 chars of the hash portion from peer URLs like wss://host/tx5-ws/HASH
  const parts = peerUrl.split('/');
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.length >= 5) {
    return `..${lastPart.slice(-5)}`;
  }
  return peerUrl.length > 10 ? `..${peerUrl.slice(-5)}` : peerUrl;
}

@localized()
@customElement('app-debugging-details')
export class AppDebuggingDetails extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  @property()
  appId!: InstalledAppId;

  @property({ attribute: false })
  networkMetrics: DumpNetworkMetricsResponse | null = null;

  @state()
  cellsAndIds: Record<string, CellId> = {};

  @state()
  _expandedFetchQueues: Set<DnaHashB64> = new Set();

  async firstUpdated() {
    const [appClient, _] = await this._mossStore.getAppClient(this.appId);
    const appInfo = await appClient.appInfo();
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

  toggleFetchQueue(dnaHashB64: DnaHashB64) {
    const next = new Set(this._expandedFetchQueues);
    if (next.has(dnaHashB64)) {
      next.delete(dnaHashB64);
    } else {
      next.add(dnaHashB64);
    }
    this._expandedFetchQueues = next;
  }

  renderGossipForDna(dnaHashB64: DnaHashB64, metrics: NetworkMetrics) {
    const gossip = metrics.gossip_state_summary;
    const fetch = metrics.fetch_state_summary;
    const initiatedCount = gossip.initiated_round ? 1 : 0;
    const acceptedCount = gossip.accepted_rounds.length;
    const pendingFetchCount = Object.keys(fetch.pending_requests).length;
    const backoffCount = fetch.peers_on_backoff instanceof Map
      ? fetch.peers_on_backoff.size
      : Object.keys(fetch.peers_on_backoff || {}).length;

    const localAgent = metrics.local_agents[0];
    const arcStr = localAgent?.storage_arc
      ? `${localAgent.storage_arc[0]}..${localAgent.storage_arc[1]}`
      : 'none';

    const peerEntries = Object.entries(gossip.peer_meta)
      .sort(([, a], [, b]) => {
        const aTime = a.last_gossip_timestamp ?? 0;
        const bTime = b.last_gossip_timestamp ?? 0;
        return bTime - aTime;
      });

    const totalCompleted = peerEntries.reduce((sum, [, pm]) =>
      sum + (pm.completed_rounds ?? 0), 0);
    const totalErrors = peerEntries.reduce((sum, [, pm]) =>
      sum + (pm.peer_behavior_errors ?? 0) + (pm.local_errors ?? 0), 0);
    const totalTimeouts = peerEntries.reduce((sum, [, pm]) =>
      sum + (pm.peer_timeouts ?? 0), 0);

    return html`
      <div style="margin: 8px 0; padding: 8px; background: #f0f4ff; border-radius: 4px;">
        <div style="font-size: 11px; margin-bottom: 6px; display: flex; gap: 12px; flex-wrap: wrap;">
          <span>Rounds: <b>${initiatedCount}</b> init, <b>${acceptedCount}</b> accept</span>
          <span>Fetch: <b>${pendingFetchCount}</b> pending${backoffCount > 0 ? html`, <span style="color: #c44;">${backoffCount} backoff</span>` : ''}</span>
          <span>Arc: ${arcStr}</span>
          <span>Peers: <b>${peerEntries.length}</b></span>
          <span>Done: <b>${totalCompleted}</b></span>
          ${totalErrors > 0 ? html`<span style="color: #c44;">Err: ${totalErrors}</span>` : html``}
          ${totalTimeouts > 0 ? html`<span style="color: #c44;">T/O: ${totalTimeouts}</span>` : html``}
        </div>

        ${peerEntries.length > 0 ? html`
          <table style="font-size: 11px; border-collapse: collapse; width: 100%;">
            <thead>
              <tr style="border-bottom: 1px solid #999; text-align: left;">
                <th style="padding: 2px 4px;">Peer</th>
                <th style="padding: 2px 4px;">Last Gossip</th>
                <th style="padding: 2px 4px;">Done</th>
                <th style="padding: 2px 4px;">Err</th>
                <th style="padding: 2px 4px;">Busy</th>
                <th style="padding: 2px 4px;">T/O</th>
                <th style="padding: 2px 4px;">Term</th>
              </tr>
            </thead>
            <tbody>
              ${peerEntries.map(([peerUrl, pm]) => {
                const lastGossip = pm.last_gossip_timestamp
                  ? formatTimeAgo(pm.last_gossip_timestamp)
                  : 'never';
                const hasErrors = (pm.peer_behavior_errors ?? 0) > 0 || (pm.local_errors ?? 0) > 0;
                const hasTimeouts = (pm.peer_timeouts ?? 0) > 0;

                return html`
                  <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 2px 4px; font-family: monospace;" title="${peerUrl}">${extractPeerShortId(peerUrl)}</td>
                    <td style="padding: 2px 4px;">${lastGossip}</td>
                    <td style="padding: 2px 4px;">${pm.completed_rounds ?? 0}</td>
                    <td style="padding: 2px 4px; ${hasErrors ? 'color: #c44;' : ''}">${(pm.peer_behavior_errors ?? 0) + (pm.local_errors ?? 0)}</td>
                    <td style="padding: 2px 4px;">${pm.peer_busy ?? 0}</td>
                    <td style="padding: 2px 4px; ${hasTimeouts ? 'color: #c44;' : ''}">${pm.peer_timeouts ?? 0}</td>
                    <td style="padding: 2px 4px;">${pm.peer_terminated ?? 0}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        ` : html`<div style="font-size: 11px; color: #999;">No peers discovered yet</div>`}

        ${pendingFetchCount > 0 || backoffCount > 0 ? html`
          <div
            style="margin-top: 4px; font-size: 11px; cursor: pointer; user-select: none;"
            @click=${() => this.toggleFetchQueue(dnaHashB64)}
          >
            <span style="display: inline-block; transition: transform 0.2s; transform: rotate(${this._expandedFetchQueues.has(dnaHashB64) ? '90deg' : '0deg'});">&#9654;</span>
            Fetch Queue Details
          </div>
          ${this._expandedFetchQueues.has(dnaHashB64) ? html`
            <div style="margin-top: 4px; padding-left: 12px; font-size: 11px;">
              ${pendingFetchCount > 0 ? html`
                <div style="margin-bottom: 4px;"><b>Pending (${pendingFetchCount}):</b></div>
                ${Object.entries(fetch.pending_requests).slice(0, 20).map(([opHash, peerUrls]) => html`
                  <div style="padding-left: 8px; margin-bottom: 2px; font-family: monospace;">
                    ${opHash.length > 16 ? `${opHash.slice(0, 12)}...` : opHash}
                    <span style="color: #666;"> from ${(peerUrls as string[]).length} peer(s)</span>
                  </div>
                `)}
                ${pendingFetchCount > 20 ? html`<div style="color: #999;">...and ${pendingFetchCount - 20} more</div>` : html``}
              ` : html``}
              ${backoffCount > 0 ? html`
                <div style="margin-top: 4px; margin-bottom: 4px;"><b>Backoff (${backoffCount}):</b></div>
                ${(fetch.peers_on_backoff instanceof Map
                  ? Array.from(fetch.peers_on_backoff.entries())
                  : Object.entries(fetch.peers_on_backoff || {})
                ).map(([url, expiry]) => {
                  const expiryNum = typeof expiry === 'number' ? expiry : 0;
                  return html`
                  <div style="padding-left: 8px; font-family: monospace;">
                    ${extractPeerShortId(String(url))}
                    <span style="color: #666;"> expires ${new Date(expiryNum / 1000).toLocaleTimeString()}</span>
                  </div>`;
                })}
              ` : html``}
            </div>
          ` : html``}
        ` : html``}
      </div>
    `;
  }

  render() {
    return html` <div class="column">
      ${Object.entries(this.cellsAndIds)
        .sort(([name_a, _a], [name_b, _b]) => name_a.localeCompare(name_b))
        .map(
          ([cellName, cellId]) => {
            const dnaHashB64 = encodeHashToBase64(cellId[0]);
            const dnaMetrics = this.networkMetrics?.[dnaHashB64] ?? null;
            return html`
          <sl-card style="margin: 5px 0;">
            <div class="column" style="gap: 0;">
              <div
                style="font-weight: bold; margin-bottom: 4px;"
              >
                ${cellName}
                <span style="font-weight: normal; font-size: 11px; color: #666; margin-left: 8px;" title="${dnaHashB64}">${dnaHashB64.slice(0, 6)}...${dnaHashB64.slice(-4)}</span>
              </div>
              ${dnaMetrics ? this.renderGossipForDna(dnaHashB64, dnaMetrics) : html``}
              <cell-details .appId=${this.appId} .cellId=${cellId}></cell-details>
            </div>
          </sl-card>
      `;
          },
        )}
    </div>`;
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
