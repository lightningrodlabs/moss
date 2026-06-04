import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AppletInfo,
  AssetLocationAndInfo,
  encodeContext,
  GroupProfile,
  WAL,
  stringifyHrl,
  WeaveLocation,
  WeaveUrl,
  weaveUrlToLocation,
  WeaveClient,
  IframeKind,
} from '@theweave/api';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { iframeOrigin } from '../utils';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { DnaHash } from '@holochain/client';
import { mdiArrowCollapse, mdiArrowExpand, mdiClose, mdiOpenInNew } from '@mdi/js';
import { localized, msg } from '@lit/localize';
import { getAppletInfoAndGroupsProfiles } from '../utils';
import { fromUint8Array } from 'js-base64';
import { encode } from '@msgpack/msgpack';

type AssetStatus =
  | {
    type: 'invalid url';
  }
  | {
    type: 'success';
    assetInfo: AssetLocationAndInfo;
  }
  | {
    type: 'loading';
  }
  | {
    type: 'not found';
  }
  | {
    type: 'tool not activated';
    appletHash: string;
    groupDnaHash: string;
  };

@localized()
@customElement('wal-embed')
export class WalEmbed extends LitElement {
  @property()
  src!: WeaveUrl;

  @property({ type: Boolean })
  closable = false;

  @property({ type: Boolean })
  collapsable = true;

  @property({ type: Boolean })
  collapsed = false;

  @property({ type: Boolean })
  bare = false;

  /**
   * Optional hint, captured by the embedding context (e.g. dashboard tile), that
   * identifies the applet whose cell holds this WAL. Used only when the asset
   * lookup fails: lets the embed render a "Tool not activated" prompt and an
   * Activate button targeting this applet instead of a generic "Asset not found".
   */
  @property({ attribute: 'src-applet-hash' })
  srcAppletHash: string | undefined;

  /**
   * Optional hint paired with `srcAppletHash`: base64 DnaHash of the group whose
   * registry contains the source applet. Required for the Activate button to
   * route to the right group.
   */
  @property({ attribute: 'src-group-dna-hash' })
  srcGroupDnaHash: string | undefined;

  @state()
  assetStatus: AssetStatus = { type: 'loading' };

  @state()
  wal: WAL | undefined;

  @state()
  appletInfo: AppletInfo | undefined;

  @state()
  groupProfiles: ReadonlyMap<DnaHash, GroupProfile> | undefined;

  @state()
  iframeId: string | undefined;

  private _onAppletInstalled = (_e: Event) => {
    // why: after the user activates the owning Tool via our Activate button,
    // the embed instance stays mounted with assetStatus='tool not activated'.
    // Re-run the lookup so the embed transitions to either the live asset
    // (if gossip already caught up) or the generic 'not found' fallback.
    void this._loadAsset();
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('applet-installed', this._onAppletInstalled);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('applet-installed', this._onAppletInstalled);
  }

  async firstUpdated() {
    await this._loadAsset();
  }

  updated(changed: PropertyValues<this>) {
    super.updated(changed);
    // why: dashboard tile editing reuses the same <wal-embed> instance and
    // just swaps `.src` to point at a different WAL. Without this hook
    // firstUpdated wouldn't fire again and the tile would keep showing the
    // previously-loaded asset. Reload whenever the source URL (or the
    // applet hints used by the not-activated fallback) actually change.
    const srcChanged = changed.has('src') && changed.get('src') !== undefined;
    const hintsChanged =
      (changed.has('srcAppletHash') && changed.get('srcAppletHash') !== undefined) ||
      (changed.has('srcGroupDnaHash') && changed.get('srcGroupDnaHash') !== undefined);
    if (srcChanged || hintsChanged) {
      this.assetStatus = { type: 'loading' };
      this.appletInfo = undefined;
      this.groupProfiles = undefined;
      void this._loadAsset();
    }
  }

  private async _loadAsset() {
    // why: ensure the UI shows the spinner during the (potentially slow)
    // assetInfo lookup, even when called from the Retry button — without
    // resetting state here the previous "not found" view would linger
    // until the lookup resolved, making the click feel unresponsive.
    this.assetStatus = { type: 'loading' };
    let weaveLocation: WeaveLocation | undefined;
    try {
      weaveLocation = weaveUrlToLocation(this.src);
    } catch (e) {
      this.assetStatus = { type: 'invalid url' };
      return;
    }
    if (weaveLocation.type !== 'asset') {
      this.assetStatus = { type: 'invalid url' };
    } else {
      this.wal = weaveLocation.wal;
      let assetInfo;
      try {
        assetInfo = await window.__WEAVE_API__.assets.assetInfo(weaveLocation.wal);
      } catch (e) {
        console.warn('[wal-embed] assetInfo() failed:', e);
      }
      if (assetInfo) {
        this.assetStatus = { type: 'success', assetInfo };
      } else if (this.srcAppletHash && this.srcGroupDnaHash) {
        // why: assetInfo() returns undefined for two unrelated reasons —
        // (a) the owning Tool isn't installed locally, or (b) it is, but
        // the entry hasn't gossiped in yet. We only want the Activate
        // prompt for (a); for (b) (e.g. immediately after activation,
        // before DHT sync catches up) we fall through to the generic
        // "Asset not found" so the user isn't pushed back into a flow
        // they just completed.
        const isAppletInstalled = (window.__WEAVE_API__ as any)?.assets?.isAppletInstalled as
          | ((appletHashB64: string) => Promise<boolean>)
          | undefined;
        let installed = false;
        try {
          installed = isAppletInstalled ? await isAppletInstalled(this.srcAppletHash) : false;
        } catch (e) {
          console.warn('[wal-embed] isAppletInstalled check failed:', e);
        }
        if (installed) {
          this.assetStatus = { type: 'not found' };
        } else {
          this.assetStatus = {
            type: 'tool not activated',
            appletHash: this.srcAppletHash,
            groupDnaHash: this.srcGroupDnaHash,
          };
        }
      } else {
        this.assetStatus = { type: 'not found' };
      }
      if (assetInfo) {
        try {
          const { appletInfo, groupProfiles } = await getAppletInfoAndGroupsProfiles(
            window.__WEAVE_API__ as WeaveClient,
            assetInfo?.appletHash,
          );
          this.appletInfo = appletInfo;
          this.groupProfiles = groupProfiles;
        } catch (e) {
          console.warn('[wal-embed] getAppletInfoAndGroupsProfiles failed:', e);
        }
      }
    }
    this.iframeId = Date.now().toString();
  }

  async openInSidebar() {
    if (this.wal) await window.__WEAVE_API__.openAsset(this.wal, 'side');
    this.dispatchEvent(
      new CustomEvent('open-in-sidebar', {
        detail: this.wal,
      }),
    );
  }

  emitClose() {
    this.dispatchEvent(
      new CustomEvent('close', {
        detail: this.wal,
      }),
    );
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
  }

  /**
   * Ask the host to open its "activate this Tool" flow for the embed's source
   * applet. We dispatch a dedicated event (not `open-tool-info` directly)
   * because that dialog's input requires raw hash bytes and the full Applet
   * entry, neither of which this library element can synthesize from the
   * base64 hint strings alone. The host (e.g. group-dashboard) decodes and
   * fetches what's needed before invoking the dialog.
   */
  requestActivate(appletHash: string, groupDnaHash: string) {
    this.dispatchEvent(
      new CustomEvent('request-tool-activation', {
        detail: { appletHash, groupDnaHash },
        bubbles: true,
        composed: true,
      }),
    );
  }

  resizeIFrameToFitContent() {
    const iframe = this.shadowRoot?.getElementById(this.iframeId!.toString()) as
      | HTMLIFrameElement
      | null
      | undefined;
    if (!iframe || !iframe.contentWindow) return;
    // why: applet iframes load from a different origin (a custom protocol
    // for packaged tools, or a localhost dev-port for hot-reload tools).
    // Reading contentWindow.document across origins is blocked by the
    // browser and throws a SecurityError. Catch and silently skip the
    // auto-size — the iframe stays at the CSS-driven size set by the
    // surrounding wal-embed layout, which is what users want anyway.
    try {
      iframe.width = iframe.contentWindow.document.body.scrollWidth.toString();
      iframe.height = iframe.contentWindow.document.body.scrollHeight.toString();
    } catch (e) {
      // Cross-origin iframe — auto-size not possible. Leave the iframe at
      // its CSS-sized dimensions.
    }
  }

  renderHeader() {
    return html`
      <div class="top-bar row" style="align-items: center;">
        ${this.assetStatus.type === 'success'
        ? html`
              <div class="row" style="align-items: center;">
                <div class="row">
                  <sl-icon
                    style="font-size: 24px;"
                    .src=${this.assetStatus.assetInfo.assetInfo.icon_src}
                  ></sl-icon>
                </div>
                <div
                  class="column"
                  style="font-size: 18px; margin-left: 3px; height: 20px; overflow: hidden;"
                  title=${this.assetStatus.assetInfo.assetInfo.name}
                >
                  ${this.assetStatus.assetInfo.assetInfo.name}
                </div>
              </div>
            `
        : html``}
        <span style="display: flex; flex: 1;"></span>
        ${this.appletInfo
        ? html`
              <div
                class="row"
                style="align-items: center; ${this.groupProfiles
            ? 'border-right: 2px solid black;'
            : ''}"
              >
                <sl-tooltip .content=${this.appletInfo.appletName}>
                  <img
                    style="height: 26px; margin-right: 4px; border-radius: 3px;"
                    .src=${this.appletInfo.appletIcon}
                  />
                </sl-tooltip>
              </div>
            `
        : html``}
        ${this.groupProfiles
        ? html` <div class="row" style="align-items: center; margin-left: 4px;">
              ${Array.from(this.groupProfiles.values()).map(
          (groupProfile) => html`
                  <sl-tooltip .content=${groupProfile.name}>
                    <img
                      src=${groupProfile.icon_src}
                      style="height: 26px; width: 26px; border-radius: 50%; margin-right: 2px;"
                    />
                  </sl-tooltip>
                `,
        )}
            </div>`
        : html``}
        ${this.collapsable
        ? html`
              <sl-tooltip .content=${msg(this.collapsed ? 'Expand' : 'Collapse')}>
                <div
                  class="column center-content open-btn"
                  tabindex="0"
                  @click=${async () => await this.toggleCollapse()}
                  @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              await this.toggleCollapse();
            }
          }}
                >
                  <sl-icon
                    .src=${wrapPathInSvg(this.collapsed ? mdiArrowExpand : mdiArrowCollapse)}
                    style="font-size: 24px;"
                  ></sl-icon>
                </div>
              </sl-tooltip>
            `
        : ''}
        <sl-tooltip .content=${msg('Open in sidebar')}>
          <div
            class="column center-content open-btn"
            tabindex="0"
            @click=${async () => await this.openInSidebar()}
            @keypress=${async (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          await this.openInSidebar();
        }
      }}
          >
            <sl-icon .src=${wrapPathInSvg(mdiOpenInNew)} style="font-size: 24px;"></sl-icon>
          </div>
        </sl-tooltip>
        ${this.closable
        ? html`
              <sl-tooltip .content=${msg('Close')}>
                <div
                  class="column center-content close-btn"
                  tabindex="0"
                  @click=${async () => await this.emitClose()}
                  @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              await this.emitClose();
            }
          }}
                >
                  <sl-icon .src=${wrapPathInSvg(mdiClose)} style="font-size: 24px;"></sl-icon>
                </div>
              </sl-tooltip>
            `
        : html``}
      </div>
    `;
  }

  renderContent() {
    switch (this.assetStatus.type) {
      case 'not found':
        return html`
          <div class="centered-message">
            <div class="centered-message-title">${msg('Asset not found.')}</div>
            <div class="centered-message-text">
              ${msg('It may not yet have been synchronized from other peers.')}
            </div>
            <button class="activate-button" @click=${() => this._loadAsset()}>
              ${msg('Retry')}
            </button>
          </div>
        `;
      case 'tool not activated': {
        const { appletHash, groupDnaHash } = this.assetStatus;
        return html`
          <div class="centered-message">
            <div class="centered-message-text">
              ${msg('This asset cannot be loaded until the Tool that created it is activated.')}
            </div>
            <button
              class="activate-button"
              @click=${() => this.requestActivate(appletHash, groupDnaHash)}
            >
              ${msg('Activate')}
            </button>
          </div>
        `;
      }
      case 'invalid url':
        return html`invalid URL.`;
      case 'loading':
        return html` <sl-spinner></sl-spinner> `;
      case 'success':
        const queryString = `view=applet-view&view-type=asset&hrl=${stringifyHrl(this.wal!.hrl)}${this.wal!.context ? `&context=${encodeContext(this.wal!.context)}` : ''
          }&view-location=embedded`;
        // why: firstUpdated sets assetStatus='success' before awaiting the
        // appletInfo fetch, so Lit can re-render between the two and reach
        // here with appletInfo still undefined. Show the spinner during that
        // window instead of throwing — throwing rejects the unhandled
        // promise chain and breaks rendering of any other tile in the page.
        if (!this.appletInfo) return html` <sl-spinner></sl-spinner> `;
        const groupHash = this.appletInfo.groupsHashes[0];
        const iframeKind: IframeKind = {
          type: 'applet',
          appletHash: this.assetStatus.assetInfo.appletHash,
          groupHash,
          subType: 'asset',
        };
        const iframeSrc = this.assetStatus.assetInfo.appletDevPort
          ? `http://localhost:${this.assetStatus.assetInfo.appletDevPort
          }?${queryString}#${fromUint8Array(encode(iframeKind))}`
          : `${iframeOrigin(iframeKind)}?${queryString}`;

        // why: in bare (embedded) mode the iframe must fill its container
        // exactly — no padding/resize/width-inset — otherwise it overflows
        // the tile and the container's scrollbar + border become visible.
        // In non-bare mode keep the original look (small padding, resizable).
        return html`<iframe
          id="${this.iframeId}"
          frameborder="0"
          title="TODO"
          style=${this.bare
            ? 'flex: 1; display: block; margin: 0; padding: 0; border: none; width: 100%; height: 100%;'
            : 'flex: 1; display: block; padding: 5px; margin: 0; width: calc(100% - 10px);'}
          src="${iframeSrc}"
          allow="camera *; microphone *; clipboard-write *;"
          @load=${() => {
            setTimeout(() => this.resizeIFrameToFitContent(), 1000);
          }}
        ></iframe>`;
    }
  }

  render() {
    return this.bare
      ? html`<div class="container bare">${this.renderContent()}</div>`
      : this.collapsed
        ? html` <div class="container">${this.renderHeader()}</div> `
        : html` <div class="container">${this.renderHeader()} ${this.renderContent()}</div> `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
      .container {
        border-right: 2px solid #8595bf;
        border-left: 2px solid #8595bf;
        border-bottom: 2px solid #8595bf;
        border-radius: 3px;
        font-family: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
        overflow: auto;
        display: flex;
        flex-direction: column;
        /* why: previously had no defined height, so the inner iframe (flex:1)
           collapsed to the HTML default ~150px and the embedded asset view
           was clipped or invisible. Fill the host's box instead. */
        height: 100%;
      }

      /* why: bare mode is for embedding inside a host that provides its own
         chrome (e.g. group-dashboard tiles). Drop the decorative border and
         clip overflow so the iframe fills the container exactly without a
         scrollbar or revealed border edge. */
      .container.bare {
        border: none;
        border-radius: 0;
        overflow: hidden;
      }

      .top-bar {
        height: 30px;
        background: #8595bf;
        position: relative;
      }

      .open-btn {
        height: 26px;
        margin-left: 5px;
        border-radius: 3px;
        background: #e7eeff;
        cursor: pointer;
      }

      .open-btn:hover {
        background: #b1bedf;
      }

      .close-btn {
        height: 26px;
        margin-left: 5px;
        border-radius: 3px;
        background: #ed3c3c;
        cursor: pointer;
      }

      .close-btn:hover {
        background: #f57373;
      }

      .centered-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 16px;
        height: 100%;
        text-align: center;
        font-family: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
        color: #283c70;
      }

      .centered-message-title {
        font-size: 16px;
        font-weight: 600;
        line-height: 1.3;
        max-width: 320px;
      }

      .centered-message-text {
        font-size: 14px;
        line-height: 1.4;
        max-width: 320px;
        opacity: 0.85;
      }

      .activate-button {
        background: #283c70;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 6px 18px;
        font-size: 14px;
        font-family: inherit;
        cursor: pointer;
      }

      .activate-button:hover {
        background: #3a528f;
      }
    `,
  ];
}
