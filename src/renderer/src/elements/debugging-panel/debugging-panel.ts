import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import {
  AppClient,
  CellId,
  decodeHashFromBase64,
  DnaHash,
  DnaHashB64,
  DumpNetworkMetricsResponse,
  DumpNetworkStatsResponse,
  encodeHashToBase64,
  EntryHash,
  hashFrom32AndType,
  HoloHashType,
  InstalledAppId,
  TransportStats,
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
import './cell-details.js';
import './app-debugging-details.js';

import { mossStoreContext } from '../../context.js';
import { MossStore, ZomeCallCounts } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { AppletId } from '@theweave/api';
import { getCellName, groupModifiersToAppId } from '../../utils.js';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiBug } from '@mdi/js';
import { appIdFromAppletHash, getCellId } from '@theweave/utils';

const transformMetrics = (metrics: DumpNetworkMetricsResponse) => {
  if (!metrics) {
    return {};
  }

  let out = {} as Record<DnaHashB64, object>;
  for (const [key, value] of Object.entries(metrics)) {
    const peerMetaList: any = [];
    for (const [peerUrl, peerMeta] of Object.entries(value.gossip_state_summary.peer_meta)) {
      const pm: any = peerMeta;
      pm.last_gossip_timestamp = peerMeta.last_gossip_timestamp
        ? new Date(peerMeta.last_gossip_timestamp / 1000)
        : undefined;
      pm.storage_arc = pm.storage ? `${pm.storage_arc[0]}..${pm.storage_arc[1]}` : null;
      peerMetaList.push({
        peer_url: peerUrl,
        meta: pm,
      });
    }
    peerMetaList.sort((a, b) => a.peer_url.localeCompare(b.peer_url));
    const dht_summary: any = value.gossip_state_summary.dht_summary;
    // Convert hash arrays to base64 strings for all DHT segments
    for (const segmentKey of Object.keys(dht_summary)) {
      const segment = dht_summary[segmentKey];
      if (segment) {
        // Convert disc_top_hash to base64
        if (segment.disc_top_hash) {
          segment.disc_top_hash =
            typeof segment.disc_top_hash === 'string'
              ? segment.disc_top_hash
              : segment.disc_top_hash.length > 0
                ? encodeHashToBase64(segment.disc_top_hash)
                : '';
        }
        // Convert ring_top_hashes array to base64
        if (segment.ring_top_hashes) {
          segment.ring_top_hashes = segment.ring_top_hashes.map(
            (h: Uint8Array | string) =>
              typeof h === 'string' ? h : h.length > 0 ? encodeHashToBase64(h) : '',
          );
        }
      }
    }

    out[key] = {
      fetch_state_summary: value.fetch_state_summary,
      gossip_state_summary: {
        initiated_round: value.gossip_state_summary.initiated_round,
        accepted_rounds: value.gossip_state_summary.accepted_rounds,
        dht_summary,
        peer_meta: peerMetaList,
      },
      local_agents: value.local_agents.map((a) => {
        return {
          agent: encodeHashToBase64(a.agent),
          storage_arc: a.storage_arc ? `${a.storage_arc[0]}..${a.storage_arc[1]}` : null,
          target_arc: a.target_arc ? `${a.target_arc[0]}..${a.target_arc[1]}` : null,
        };
      }),
    };
  }

  return out;
};

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

  @state()
  _appsToPollNetworkStats: InstalledAppId[] = [];

  @state()
  _networkStats: Record<InstalledAppId, [TransportStats, DumpNetworkMetricsResponse]> = {};

  @state()
  _adminNetworkStats: DumpNetworkStatsResponse | null = null;

  @state()
  _appsWithMetricsExpanded: InstalledAppId[] = [];

  /**
   * Map of transport pub_key to AgentPubKey (base64) for each app.
   * Built from agentInfo which provides both the kitsune agent ID and peer URL.
   */
  @state()
  _transportToAgentMap: Record<InstalledAppId, Map<string, string>> = {};

  async firstUpdated() {
    // TODO add interval here to reload stuff
    this._refreshInterval = window.setInterval(() => {
      this.requestUpdate();
      setTimeout(() => this.pollNetworkStats());
    }, 2000);
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

  toggleMetricsExpanded(appId: InstalledAppId) {
    if (this._appsWithMetricsExpanded.includes(appId)) {
      this._appsWithMetricsExpanded = this._appsWithMetricsExpanded.filter((id) => id !== appId);
    } else {
      this._appsWithMetricsExpanded = [...this._appsWithMetricsExpanded, appId];
    }
  }

  /**
   * Decode URL-safe base64 string to Uint8Array.
   * URL-safe base64 uses - and _ instead of + and /.
   */
  decodeUrlSafeBase64(urlSafeBase64: string): Uint8Array {
    // Convert URL-safe base64 to standard base64
    let standardBase64 = urlSafeBase64.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if necessary
    while (standardBase64.length % 4 !== 0) {
      standardBase64 += '=';
    }
    // Decode base64 to bytes
    const binaryString = atob(standardBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Convert a Kitsune SpaceId (base64-encoded 32-byte hash) to a DNA hash.
   * The SpaceId is the core 32 bytes of the DNA hash without the type prefix and DHT location.
   * SpaceId uses URL-safe base64 encoding (with - and _ instead of + and /).
   */
  spaceIdToDnaHash(spaceId: string): DnaHash {
    const bytes = this.decodeUrlSafeBase64(spaceId);
    // Convert the 32-byte core to a full DNA hash (adds type prefix and DHT location)
    return hashFrom32AndType(bytes, HoloHashType.Dna);
  }

  /**
   * Convert a Kitsune pub_key (URL-safe base64-encoded 32-byte core) to a full AgentPubKey.
   * Uses hashFrom32AndType to properly construct the full 39-byte hash.
   */
  kitsuneAgentIdToAgentPubKey(kitsuneAgentId: string): Uint8Array {
    const bytes = this.decodeUrlSafeBase64(kitsuneAgentId);
    // Convert the 32-byte core to a full agent pub key (adds type prefix and DHT location)
    return hashFrom32AndType(bytes, HoloHashType.Agent);
  }

  /**
   * Extract the transport pub_key from a peer URL.
   * Peer URLs typically have format: wss://host/tx5-ws/sig/<transport_pub_key>
   * The transport pub_key is the last path segment.
   */
  extractTransportKeyFromUrl(peerUrl: string): string | null {
    try {
      const urlObj = new URL(peerUrl);
      const pathParts = urlObj.pathname.split('/').filter((p) => p.length > 0);
      // The transport key is the last segment after /tx5-ws/sig/ or similar
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1];
        // Transport keys are typically 40+ characters in URL-safe base64
        if (lastPart.length >= 40) {
          return lastPart;
        }
      }
    } catch {
      // If URL parsing fails, try direct string splitting
      const parts = peerUrl.split('/');
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.length >= 40) {
        return lastPart;
      }
    }
    return null;
  }

  /**
   * Build a mapping from transport pub_key to AgentPubKey by fetching agentInfo.
   * AgentInfo returns both the kitsune agent ID and the peer URL, allowing us to
   * map the transport key (from URL) to the actual AgentPubKey.
   */
  async buildTransportToAgentMap(appId: InstalledAppId): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const client = await this._mossStore.getAppClient(appId);
      const appClient = client[0];

      // Get app's DNA hashes from network metrics
      const networkMetrics = await appClient.dumpNetworkMetrics({ include_dht_summary: false });
      const dnaHashes = Object.keys(networkMetrics).map((b64) => decodeHashFromBase64(b64));

      if (dnaHashes.length === 0) return map;

      // Fetch agentInfo for these DNAs
      const agentInfoResponse = await appClient.agentInfo({ dna_hashes: dnaHashes });

      for (const agentInfoItem of agentInfoResponse) {
        try {
          // Parse the structure: { agentInfo: "{...json...}", signature: "..." }
          const parsed =
            typeof agentInfoItem === 'string' ? JSON.parse(agentInfoItem) : agentInfoItem;
          const agentInfoData =
            typeof parsed.agentInfo === 'string' ? JSON.parse(parsed.agentInfo) : parsed.agentInfo;

          const partialAgentId = agentInfoData.agent;
          const peerUrl = agentInfoData.url;

          if (!partialAgentId || !peerUrl) continue;

          // Extract transport key from the peer URL
          const transportKey = this.extractTransportKeyFromUrl(peerUrl);
          if (!transportKey) continue;

          // Convert partial agent ID to full AgentPubKey
          const fullAgentKey = this.kitsuneAgentIdToAgentPubKey(partialAgentId);
          const fullAgentKeyB64 = encodeHashToBase64(fullAgentKey);

          map.set(transportKey, fullAgentKeyB64);
        } catch (e) {
          // Skip invalid entries
        }
      }
    } catch (e) {
      console.warn('Failed to build transport to agent map:', e);
    }
    return map;
  }

  /**
   * Format a DNA hash to show beginning and end (e.g., "uhC0k...xyz")
   */
  formatDnaHash(dnaHash: DnaHash): string {
    const b64 = encodeHashToBase64(dnaHash);
    if (b64.length <= 16) return b64;
    return `${b64.slice(0, 8)}...${b64.slice(-6)}`;
  }

  async pollNetworkStats() {
    if (this._appsToPollNetworkStats.length > 0) {
      // Fetch admin stats (includes blocked message counts)
      try {
        this._adminNetworkStats = await this._mossStore.adminWebsocket.dumpNetworkStats();
      } catch (e) {
        console.error('Failed to fetch admin network stats:', e);
      }
    }
    await Promise.all(
      this._appsToPollNetworkStats.map(async (appId) => {
        const client = await this._mossStore.getAppClient(appId);
        const networkStats = await client[0].dumpNetworkStats();
        const networkMetrics = await client[0].dumpNetworkMetrics({
          include_dht_summary: true,
        });
        this._networkStats[appId] = [networkStats, networkMetrics];

        // Build transport to agent map from agentInfo
        const transportMap = await this.buildTransportToAgentMap(appId);
        this._transportToAgentMap[appId] = transportMap;
      }),
    );
    this.requestUpdate();
  }

  renderBlockedStats(appId: InstalledAppId) {
    if (!this._adminNetworkStats) return html``;
    const blockedCounts = this._adminNetworkStats.blocked_message_counts;

    // Get the app's network stats to filter by its DNA hashes and connections
    const appStats = this._networkStats[appId];
    if (!appStats) return html`<div class="stats-item"><em>No network stats available</em></div>`;

    const [transportStats, networkMetrics] = appStats;

    // Get the set of DNA hashes (as B64) for this app from network metrics keys
    const appDnaHashesB64 = new Set(Object.keys(networkMetrics));

    // Get the set of connected peer public keys
    const connectedPubKeys = new Set(transportStats.connections.map((c) => c.pub_key));

    // Build a map of SpaceId -> DnaHashB64 for quick lookup and filter to only app's DNAs
    const spaceIdToDnaHashB64 = new Map<string, string>();
    for (const peerUrl of Object.keys(blockedCounts)) {
      for (const spaceId of Object.keys(blockedCounts[peerUrl])) {
        if (!spaceIdToDnaHashB64.has(spaceId)) {
          try {
            const dnaHash = this.spaceIdToDnaHash(spaceId);
            const dnaHashB64 = encodeHashToBase64(dnaHash);
            // Only include if this DNA belongs to the current app
            if (appDnaHashesB64.has(dnaHashB64)) {
              spaceIdToDnaHashB64.set(spaceId, dnaHashB64);
            }
          } catch (e) {
            console.warn('Failed to convert SpaceId to DnaHash:', spaceId, e);
          }
        }
      }
    }

    // Extract pub_key from peer URL - typically the last path segment after /tx5-ws/ or similar
    const extractPubKeyFromUrl = (url: string): string | null => {
      try {
        // Try to parse as URL and get the last path segment
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter((p) => p.length > 0);
        // The pub_key is typically the last segment and is a base64-encoded key
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1];
          // Pub keys are typically 52+ characters in base64
          if (lastPart.length >= 40) {
            return lastPart;
          }
        }
      } catch {
        // If URL parsing fails, try to extract from the string directly
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length >= 40) {
          return lastPart;
        }
      }
      return null;
    };

    // Filter blocked counts to only include relevant spaces and connected peers
    const filteredPeerUrls: string[] = [];
    let totalIncoming = 0;
    let totalOutgoing = 0;

    for (const peerUrl of Object.keys(blockedCounts)) {
      const spaces = blockedCounts[peerUrl];
      // Filter to only spaces that belong to this app
      const relevantSpaces = Object.entries(spaces).filter(([spaceId]) =>
        spaceIdToDnaHashB64.has(spaceId),
      );

      if (relevantSpaces.length > 0) {
        // Extract pub_key from peer URL and check if it matches any connection
        const peerPubKey = extractPubKeyFromUrl(peerUrl);
        const isConnectedPeer = peerPubKey ? connectedPubKeys.has(peerPubKey) : false;

        // Include peer if it's connected OR if we have no connections yet (still discovering)
        if (isConnectedPeer || connectedPubKeys.size === 0) {
          filteredPeerUrls.push(peerUrl);
          for (const [, counts] of relevantSpaces) {
            totalIncoming += counts.incoming;
            totalOutgoing += counts.outgoing;
          }
        }
      }
    }

    // Count total blocked peers and spaces for diagnostics
    const totalBlockedPeers = Object.keys(blockedCounts).length;
    const allSpaceIds = new Set<string>();
    for (const peerUrl of Object.keys(blockedCounts)) {
      for (const spaceId of Object.keys(blockedCounts[peerUrl])) {
        allSpaceIds.add(spaceId);
      }
    }

    if (filteredPeerUrls.length === 0) {
      return html`<div class="stats-item">
        <em>No blocked messages for this app</em>
        <div style="font-size: 10px; color: #666; margin-top: 4px;">
          (Global: ${totalBlockedPeers} peers, ${allSpaceIds.size} spaces |
          App DNAs: ${appDnaHashesB64.size} |
          Matched spaces: ${spaceIdToDnaHashB64.size} |
          Connected peers: ${connectedPubKeys.size})
        </div>
      </div>`;
    }

    return html`
      <div class="stats-item">
        <div><b>Total blocked:</b> incoming: ${totalIncoming}, outgoing: ${totalOutgoing}</div>
        <div><b>Blocked peers:</b> ${filteredPeerUrls.length}
          <span style="font-size: 10px; color: #666;">
            (of ${totalBlockedPeers} global, ${connectedPubKeys.size} connected)
          </span>
        </div>
        ${filteredPeerUrls.map((peerUrl) => {
          const spaces = blockedCounts[peerUrl];
          // Filter to only relevant spaces for this app
          const relevantSpaces = Object.entries(spaces).filter(([spaceId]) =>
            spaceIdToDnaHashB64.has(spaceId),
          );
          // Look up agent key from transport pub_key in peer URL
          const transportKey = extractPubKeyFromUrl(peerUrl);
          const transportMap = this._transportToAgentMap[appId];
          const agentKeyB64 = transportKey ? transportMap?.get(transportKey) : null;
          const formattedAgentKey = agentKeyB64
            ? agentKeyB64.length > 16
              ? `${agentKeyB64.slice(0, 8)}...${agentKeyB64.slice(-6)}`
              : agentKeyB64
            : null;

          return html`
            <div style="margin-top: 8px; padding-left: 10px; border-left: 2px solid #666;">
              <div style="font-size: 12px;">
                <b>agent:</b>
                ${formattedAgentKey
                  ? html`<span title="${agentKeyB64}">${formattedAgentKey}</span>`
                  : html`<span style="color: #999;">(no mapping)</span>`}
              </div>
              <div style="font-size: 11px; color: #666; word-break: break-all;">${peerUrl}</div>
              ${relevantSpaces.map(([spaceId, counts]) => {
                const dnaHashB64 = spaceIdToDnaHashB64.get(spaceId)!;
                const formattedHash =
                  dnaHashB64.length > 16
                    ? `${dnaHashB64.slice(0, 8)}...${dnaHashB64.slice(-6)}`
                    : dnaHashB64;
                return html`
                  <div style="padding-left: 10px; font-size: 11px;">
                    <span style="color: #666;">DNA ${formattedHash}:</span>
                    incoming: ${counts.incoming}, outgoing: ${counts.outgoing}
                  </div>
                `;
              })}
            </div>
          `;
        })}
      </div>
    `;
  }

  renderAppNetworkStats(appId: InstalledAppId) {
    const stats = this._networkStats[appId];
    if (!stats) return html`No network stats polled (yet)`;
    const [networkStats, networkMetrics] = stats;

    // Get local agent (deduplicated since it's the same across DNAs in Moss)
    const localAgentSet = new Set<string>();
    for (const metrics of Object.values(networkMetrics)) {
      for (const a of metrics.local_agents) {
        localAgentSet.add(encodeHashToBase64(a.agent));
      }
    }
    const localAgent = Array.from(localAgentSet)[0]; // Should be just one in Moss
    const formattedLocalAgent = localAgent
      ? localAgent.length > 16
        ? `${localAgent.slice(0, 8)}...${localAgent.slice(-6)}`
        : localAgent
      : 'unknown';

    return html`
      <div
        class="column"
        style="border: 1px solid black; border-radius: 10px; padding: 20px; background: #9cb0e1;"
      >
        <div style="margin-bottom: 12px;">
          <b>Local Agent:</b> <span title="${localAgent}">${formattedLocalAgent}</span>
        </div>
        <div style="margin-bottom: 12px;">
          <b>Our Peer URL:</b>
          <div style="font-size: 11px; margin-top: 4px;">${networkStats.peer_urls[0] || 'none'}</div>
        </div>

        <h4>Connections: ${networkStats.connections.length}</h4>
        <div style="font-size: 10px; color: #666; margin-bottom: 8px;">
          (Agent mappings from agentInfo: ${this._transportToAgentMap[appId]?.size || 0})
        </div>
        ${networkStats.connections.map((connection) => {
      // Look up agent key from transport pub_key
      const transportMap = this._transportToAgentMap[appId];
      const agentKeyB64 = transportMap?.get(connection.pub_key);
      const formattedAgentKey = agentKeyB64
        ? agentKeyB64.length > 16
          ? `${agentKeyB64.slice(0, 8)}...${agentKeyB64.slice(-6)}`
          : agentKeyB64
        : null;

      return html`
            <div class="stats-item">
              <div>webrtc: ${connection.is_webrtc}</div>
              <div>
                <b>agent:</b>
                ${formattedAgentKey
          ? html`<span title="${agentKeyB64}">${formattedAgentKey}</span>`
          : html`<span style="color: #999;">(no mapping)</span>`}
              </div>
              <div style="font-size: 11px; color: #666;">pub_key: ${connection.pub_key}</div>
              <div>
                opened_at: ${connection.opened_at_s} (${new Date(connection.opened_at_s * 1000)})
              </div>
              <div>
                send: message_count: ${connection.send_message_count}; bytes:
                ${connection.send_bytes}
              </div>
              <div>
                recv: message_count: ${connection.recv_message_count}; bytes:
                ${connection.recv_bytes}
              </div>
            </div>
          `;
    })}

        <h4>Blocked Messages:</h4>
        ${this.renderBlockedStats(appId)}

        <h4
          style="cursor: pointer; user-select: none;"
          @click=${() => this.toggleMetricsExpanded(appId)}
        >
          <span style="display: inline-block; transition: transform 0.2s; transform: rotate(${this._appsWithMetricsExpanded.includes(appId) ? '90deg' : '0deg'});">&#9654;</span>
          Metrics
        </h4>
        ${this._appsWithMetricsExpanded.includes(appId)
        ? html`
              <div class="stats-item">
                <pre>${JSON.stringify(transformMetrics(networkMetrics), null, 4)}</pre>
              </div>
            `
        : html``}
      </div>
    `;
  }

  renderZomeCallDetails(zomeCallCount: ZomeCallCounts) {
    return Object.keys(zomeCallCount.functionCalls).map(
      (fn_name) => html`
        <div class="row" style="align-items: center; margin-top: 5px; margin-bottom: 10px;">
          <div class="item-title item-title-sub">
            <div>${fn_name}</div>
          </div>
          <div class="item-count item-count-detail">
            ${zomeCallCount ? zomeCallCount.functionCalls[fn_name].length : ''}
          </div>
          <div class="item-count item-count-detail">
            ${zomeCallCount
          ? Math.round(
            zomeCallCount.functionCalls[fn_name].length /
            ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
          )
          : ''}
          </div>
          <div class="item-count item-count-detail">
            ${zomeCallCount.functionCalls[fn_name][zomeCallCount.functionCalls[fn_name].length - 1]
          .durationMs}ms
          </div>
          <div class="item-count item-count-detail">
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

  renderCountsHeader() {
    return html`
    <div class="row item-row" style="">
          <div class="item-title">&nbsp;</div>
          <div class="item-count-title">total zome calls</div>
          <div class="item-count-title">
            avg. zome calls per minute
          </div>
          <div class="item-count-title">
            duration of last zome call (ms)
          </div>
          <div class="item-count-title">
            avg. zome call duration
          </div>
          <div class="item-extra"></div>
        </div>
    `
  }

  renderGroups(groups: DnaHash[]) {
    return html`
      <div class="column" style="align-items: flex-start;">
        ${this.renderCountsHeader()}
        ${groups
        .sort((hash_a, hash_b) => {
          const id_a = this._groupAppIds[encodeHashToBase64(hash_a)];
          const id_b = this._groupAppIds[encodeHashToBase64(hash_b)];
          const zomeCallCount_a = this._mossStore.zomeCallLogs[id_a]?.totalCounts;
          const zomeCallCount_b = this._mossStore.zomeCallLogs[id_b]?.totalCounts;
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
          const hasStats = this._appsToPollNetworkStats.includes(groupAppId);
          return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div class="row item-title" >
                    <sl-icon-button
                      @click=${async () => {
              this.toggleDebug(groupAppId);
            }}
                      .src=${wrapPathInSvg(mdiBug)}
                    >
                    </sl-icon-button>
                    <group-context .groupDnaHash=${groupDnaHash}>
                      <group-logo
                        .groupDnaHash=${groupDnaHash}
                        style="margin-right: 8px; --size: 40px"
                      ></group-logo
                    ></group-context>
                  </div>
                  <div style="display: flex; flex: 1;"></div>
                  <div class="item-count">
                    ${zomeCallCount ? zomeCallCount.totalCounts : ''}
                  </div>
                  <div class="item-count">
                    ${zomeCallCount
              ? Math.round(
                zomeCallCount.totalCounts /
                ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
              )
              : ''}
                  </div>
                  <div
                    class="item-count"
                  ></div>
                  <div
                    class="item-count"
                  ></div>
                  <div class="item-extra">
                    ${window.__ZOME_CALL_LOGGING_ENABLED__
              ? html`<span
                          style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                          @click=${() => this.toggleGroupDetails(groupId)}
                          >${showDetails ? 'Hide' : 'Details'}</span
                        >`
              : html`<span style="min-width: 60px;"></span>`}
                  </div>
                </div>
                ${showDetails ? this.renderZomeCallDetails(zomeCallCount) : html``}
              </div>
              ${showDebug
              ? html`
                    <div class="column">
                      <app-debugging-details .appId=${groupAppId}></app-debugging-details>
                      <sl-button
                        @click=${() => {
                  if (this._appsToPollNetworkStats.includes(groupAppId)) {
                    this._appsToPollNetworkStats = this._appsToPollNetworkStats.filter(
                      (appId) => appId !== groupAppId,
                    );
                  } else {
                    this._appsToPollNetworkStats = [
                      ...this._appsToPollNetworkStats,
                      groupAppId,
                    ];
                  }
                }}
                        >${hasStats ? 'Stop' : 'Start'} Polling Network Stats</sl-button
                      >
                      ${hasStats ? this.renderAppNetworkStats(groupAppId) : html``}
                    </div>
                  `
              : html``}
            `;
        })}
      </div>
    `;
  }

  renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
    return html`
      <div class="column" style="align-items: flex-start;">
        ${this.renderCountsHeader()}

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
          const hasStats = this._appsToPollNetworkStats.includes(appId);
          return html`
              <div class="column">
                <div class="row" style="align-items: center; flex: 1;">
                  <div class="row item-title">
                    <sl-icon-button
                      @click=${async () => {
              this.toggleDebug(appId);
            }}
                      .src=${wrapPathInSvg(mdiBug)}
                    >
                    </sl-icon-button>
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
                  <div class="item-count">
                    ${zomeCallCount ? zomeCallCount.totalCounts : ''}
                  </div>
                  <div class="item-count">
                    ${zomeCallCount
              ? Math.round(
                zomeCallCount.totalCounts /
                ((Date.now() - zomeCallCount.firstCall) / (1000 * 60)),
              )
              : ''}
                  </div>
                  <div
                    class="item-count"
                  ></div>
                  <div
                    class="item-count"
                  ></div>
                  <div class="item-extra">
                    ${window.__ZOME_CALL_LOGGING_ENABLED__
              ? html` <span
                          style="cursor: pointer; text-decoration: underline; color: blue; margin-left: 20px; min-width: 60px;"
                          @click=${() => this.toggleAppletDetails(appletId)}
                          >${showDetails ? 'Hide' : 'Details'}</span
                        >`
              : html`<span style="min-width: 60px;"></span>`}
                    <groups-for-applet
                      style="margin-left: 10px;"
                      .appletHash=${appletHash}
                    ></groups-for-applet>
                  </div>
                </div>
                ${showDetails ? this.renderZomeCallDetails(zomeCallCount) : html``}
              </div>
              ${showDebug
              ? html`
                    <div class="column">
                      <app-debugging-details .appId=${appId}></app-debugging-details>
                      <sl-button
                        @click=${() => {
                  if (this._appsToPollNetworkStats.includes(appId)) {
                    this._appsToPollNetworkStats = this._appsToPollNetworkStats.filter(
                      (appId) => appId !== appId,
                    );
                  } else {
                    this._appsToPollNetworkStats = [...this._appsToPollNetworkStats, appId];
                  }
                }}
                        >${hasStats ? 'Stop' : 'Start'} Polling Network Stats</sl-button
                      >
                      ${hasStats ? this.renderAppNetworkStats(appId) : html``}
                    </div>
                  `
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
      default:
        return html`invalid loading state.`;
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
      default:
        return html`invalid loading state.`;
    }
  }

  render() {
    return html`
      <div class="column container" style="padding: 30px;">
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
        <div class="column" v style="margin-top: 10px;">
          <div>
            Total number of applet iframes:
            <b>${this._mossStore.iframeStore.appletIframesTotalCount()}</b>
          </div>
          <div>
            Total number of cross-group iframes:
            <b>${this._mossStore.iframeStore.crossGroupIframesTotalCount()}</b>
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
    mossStyles,
    css`
      .container {
        display: flex;
        flex: 1;
      }

      .warning {
        background: #9fb0ff;
        border-radius: 12px;
        padding: 20px;
        border: 2px solid #03004c;
        font-weight: bold;
      }

      .stats-item {
        border: solid 1px gray;
        border-radius: 10px;
        padding: 10px;
        background-color: white;
        width: fit-content;
      }

      .item-row {
        align-items: center;
      }
      .item-title {
        width:300px;
        align-items: center;
      }
      .item-title-sub {
        font-weight: bold; width: 260px; padding-left: 40px;
      }
      .item-count-title {
        font-weight: bold; text-align: right; width: 80px;
      }
      .item-count {
        font-weight: bold; text-align: right; width: 80px; font-size: 18px;
      }
      .item-count-detail {
        color: blue;
      }
      .item-extra {
        width: 90px;
      }

    `,
  ];
}
