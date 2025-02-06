import { consume } from '@lit/context';
import { LitElement, html, css } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';

// Make sure to import Vis.js if using npm
import * as vis from 'vis-network/standalone';
import { mossStoreContext } from '../../context';
import { MossStore } from '../../moss-store';
import { toPromise } from '@holochain-open-dev/stores';
import { AppInfo, DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { AppletId, AssetInfo, deStringifyWal, stringifyWal } from '@theweave/api';
import { appIdFromAppletHash } from '@theweave/utils';
import { getCellId } from '../../utils';
import { weStyles } from '../../shared-styles';

@customElement('assets-graph')
export class AssetsGraph extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  nodes: vis.Node[] = [];
  @state()
  edges: vis.Edge[] = [];

  @state()
  loading = true;

  @query('#graph-container')
  graphContainer!: HTMLElement;

  @state()
  network: vis.Network | undefined;

  async load() {
    await this.loadGraphContent();
  }

  async loadGraphContent() {
    const groupStores = await toPromise(this.mossStore.groupStores);
    // For each group, get all AssetRelationWithTags[] and add them to the array of nodes and edges
    const nodes: vis.Node[] = [];
    const edges: vis.Edge[] = [];

    const dnaToAppletMap: Record<DnaHashB64, AppletId> = {};
    const appletToAssetMap: Record<AppletId, string[]> = {};

    // First round to create all group and applet nodes and figure create the dnaToAppletMap
    // which will need to contain the dnas of all applets across groups in order to be able to
    // add cross-group edges as well
    await Promise.all(
      Array.from(groupStores.entries()).map(async ([dnaHash, groupStore]) => {
        // Add group node
        const groupProfile = await toPromise(groupStore.groupProfile);
        const groupId = encodeHashToBase64(dnaHash);
        const groupNodeId = `group#${groupId}`;
        nodes.push({
          id: groupNodeId,
          label: groupProfile ? groupProfile.name : 'Unknown Group',
          image: groupProfile ? groupProfile.icon_src : undefined,
          shape: groupProfile?.icon_src ? 'image' : undefined,
          size: 50,
          mass: 12,
          shadow: true,
        });
        // Add applet nodes and
        const appletStores = await toPromise(groupStore.activeAppletStores);
        // For each applet, get all associated dnas
        await Promise.all(
          Array.from(appletStores.entries()).map(async ([appletHash, appletStore]) => {
            // Get dna hash to applet mapping in order to be able to link WALs to their associated applets
            const appletId = encodeHashToBase64(appletHash);
            const appletClient = await this.mossStore.getAppClient(appIdFromAppletHash(appletHash));
            let appInfo: AppInfo | undefined | null;
            try {
              appInfo = await appletClient.appInfo();
            } catch (e: any) {
              if (e.toString && !e.toString().includes('CellDisabled')) {
                console.warn('Failed to get AppInfo for applet', appletId, ':', e);
              }
            }
            if (appInfo) {
              Object.values(appInfo.cell_info)
                .flat()
                .forEach((cellInfo) => {
                  const cellId = getCellId(cellInfo);
                  if (cellId) {
                    dnaToAppletMap[encodeHashToBase64(cellId[0])] = appletId;
                  }
                });
            }

            const appletIcon = await toPromise(this.mossStore.appletLogo.get(appletHash));
            // console.log('GOT APPLET ICON: ', appletIcon);
            nodes.push({
              id: `applet#${appletId}`,
              label: appletStore.applet.custom_name,
              image: appletIcon ? appletIcon : undefined,
              shape: appletIcon ? 'image' : undefined,
              shapeProperties: {
                borderRadius: 20,
              },
              size: 35,
              mass: 8,
              shadow: true,
            });
            // Create a connection between the group node and the applet node
            edges.push({
              from: groupNodeId,
              to: `applet#${appletId}`,
              width: 8,
              color: 'darkblue',
            });
          }),
        );
      }),
    );

    console.log('@assets-graph settled #1');

    await Promise.all(
      Array.from(groupStores.values()).map(async (groupStore) => {
        // Get all WALs from the group and link them appropriately
        const allGroupAssets = await toPromise(groupStore.allAssetRelations);
        await Promise.all(
          allGroupAssets.map(async (assetRelationWithTags) => {
            const srcWalStringified = stringifyWal(assetRelationWithTags.src_wal);
            const dstWalStringified = stringifyWal(assetRelationWithTags.dst_wal);
            // TODO make fail-safe here
            let assetInfoSrc: AssetInfo | undefined;
            let assetInfoDst: AssetInfo | undefined;

            try {
              assetInfoSrc = await toPromise(this.mossStore.assetInfo.get(srcWalStringified));
            } catch (e) {}
            try {
              assetInfoDst = await toPromise(this.mossStore.assetInfo.get(dstWalStringified));
            } catch (e) {}

            // Add the src's asset node if it doesn't exist yet
            if (!nodes.find((node) => node.id === srcWalStringified)) {
              nodes.push({
                id: srcWalStringified,
                label: assetInfoSrc ? assetInfoSrc.name : 'Unknown Asset',
                image: assetInfoSrc ? assetInfoSrc.icon_src : undefined,
                shape: assetInfoSrc ? 'image' : 'triangleDown',
                shadow: true,
                size: 20,
              });
            }
            // Add the dst's asset node if it doesn't exist yet
            if (!nodes.find((node) => node.id === dstWalStringified)) {
              nodes.push({
                id: dstWalStringified,
                label: assetInfoDst ? assetInfoDst.name : 'Unknown Asset',
                image: assetInfoDst ? assetInfoDst.icon_src : undefined,
                shape: assetInfoDst ? 'image' : 'triangleDown',
                shadow: true,
                size: 20,
              });
            }

            // One edge between the WALs (unless it's a self-referential link) and one for each tag
            // and one from each WAL's parent applet to the WAL
            if (srcWalStringified !== dstWalStringified) {
              edges.push({
                from: srcWalStringified,
                to: dstWalStringified,
                arrows: { to: true },
                color: 'black',
              });
            }
            assetRelationWithTags.tags.forEach((tag) => {
              edges.push({
                from: srcWalStringified,
                to: dstWalStringified,
                label: tag,
                arrows: { to: true },
                color: 'black',
              });
            });

            const appletIdSrc =
              dnaToAppletMap[encodeHashToBase64(assetRelationWithTags.src_wal.hrl[0])];
            const appletIdDst =
              dnaToAppletMap[encodeHashToBase64(assetRelationWithTags.dst_wal.hrl[0])];

            // Add an edge to the containing applet if there is none yet
            if (
              !appletToAssetMap[appletIdSrc] ||
              !appletToAssetMap[appletIdSrc].includes(srcWalStringified)
            ) {
              edges.push({
                from: `applet#${appletIdSrc}`,
                to: srcWalStringified,
                width: 6,
                color: '#a00101',
              });
              const existingEdges = appletToAssetMap[appletIdSrc];
              appletToAssetMap[appletIdSrc] = existingEdges
                ? [...appletToAssetMap[appletIdSrc], srcWalStringified]
                : [srcWalStringified];
            }
            if (
              !appletToAssetMap[appletIdDst] ||
              !appletToAssetMap[appletIdDst].includes(dstWalStringified)
            ) {
              edges.push({
                from: `applet#${appletIdDst}`,
                to: dstWalStringified,
                width: 6,
                color: '#a00101',
              });
              const existingEdges = appletToAssetMap[appletIdDst];
              appletToAssetMap[appletIdDst] = existingEdges
                ? [...appletToAssetMap[appletIdDst], dstWalStringified]
                : [dstWalStringified];
            }
          }),
        );
      }),
    );

    this.nodes = nodes;
    this.edges = edges;

    console.log('nodes size: ', nodes.length);
    console.log('edges size: ', edges.length);
    this.renderGraph();
  }

  // updated(changedProperties) {
  //   super.updated(changedProperties);

  //   // Initialize the network when the component is updated or first rendered
  //   if (changedProperties.has('nodes') || changedProperties.has('edges')) {
  //     this.renderGraph();
  //   }
  // }

  renderGraph() {
    if (!this.nodes || !this.edges) return;
    console.log('rendering graph');

    const nodes = new vis.DataSet(this.nodes);
    const edges = new vis.DataSet(this.edges);

    const data = { nodes, edges };
    const options = {
      nodes: {
        shape: 'dot',
        size: 15,
      },
      edges: {
        width: 2,
      },
      physics: {
        enabled: true,
        // repulsion: {
        //   springConstant: 1000,
        //   damping: 0.9,
        // },
      },
      // https://visjs.github.io/vis-network/docs/network/layout.html
      layout: {
        randomSeed: 1,
      },
    };

    const network = new vis.Network(this.graphContainer, data, options);
    network.on('click', (e) => {
      const maybeNodeId = e.nodes[0];
      if (
        maybeNodeId &&
        typeof maybeNodeId === 'string' &&
        !maybeNodeId.startsWith('applet#') &&
        !maybeNodeId.startsWith('group#')
      ) {
        console.log('Calling emit on moss store');
        this.mossStore.emit('open-asset', deStringifyWal(maybeNodeId));
      }
    });

    // Create a network only if it's not already created
    if (!this.network) {
      this.network = network;
    } else {
      this.network.setData(data);
    }
    this.loading = false;
  }

  render() {
    return html`
      ${this.loading
        ? html`<div class="column center-content flex-1">
            <sl-spinner style="font-size: 50px; --track-width: 10px;"></sl-spinner>
            <span style="margin-top: 10px;">Loading...</span>
          </div>`
        : html``}
      <div
        id="graph-container"
        style="${this.loading ? 'display: none;' : ''}"
        @click=${(e) => {
          console.log('Got click event: ', e);
        }}
      ></div>
      <sl-button
        variant="success"
        style="position: absolute; top: 5px; right: 5px;"
        @click=${() => this.loadGraphContent()}
        >Reload</sl-button
      >
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: block;
        width: calc(100vw - 74px);
        height: calc(100vh - 74px);
        background: white;
      }
      #graph-container {
        width: 100%;
        height: 100%;
      }
    `,
  ];
}
