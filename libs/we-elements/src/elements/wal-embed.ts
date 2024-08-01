import { css, html, LitElement } from 'lit';
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
} from '@lightningrodlabs/we-applet';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { appletOrigin, urlFromAppletHash } from '../utils';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { DnaHash } from '@holochain/client';
import { mdiArrowCollapse, mdiArrowExpand, mdiClose, mdiOpenInNew } from '@mdi/js';
import { localized, msg } from '@lit/localize';
import { getAppletInfoAndGroupsProfiles } from '../utils';

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

  async firstUpdated() {
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
      const assetInfo = await window.__WEAVE_API__.assetInfo(weaveLocation.wal);
      this.assetStatus = assetInfo ? { type: 'success', assetInfo } : { type: 'not found' };
      if (assetInfo) {
        const { appletInfo, groupProfiles } = await getAppletInfoAndGroupsProfiles(
          window.__WEAVE_API__ as WeaveClient,
          assetInfo?.appletHash,
        );
        this.appletInfo = appletInfo;
        this.groupProfiles = groupProfiles;
      }
    }
    this.iframeId = Date.now().toString();
  }

  async openInSidebar() {
    if (this.wal) await window.__WEAVE_API__.openWal(this.wal, 'side');
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

  resizeIFrameToFitContent() {
    console.log('Resizing.');
    const iframe = this.shadowRoot?.getElementById(this.iframeId!.toString()) as
      | HTMLIFrameElement
      | null
      | undefined;
    console.log('@resizeIFrameToFitContent: got iframe: ', iframe);
    if (iframe && iframe.contentWindow) {
      iframe.width = iframe.contentWindow.document.body.scrollWidth.toString();
      iframe.height = iframe.contentWindow.document.body.scrollHeight.toString();
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
        return html`Asset not found.`;
      case 'invalid url':
        return html`invalid URL.`;
      case 'loading':
        return html` <sl-spinner></sl-spinner> `;
      case 'success':
        const queryString = `view=applet-view&view-type=asset&hrl=${stringifyHrl(this.wal!.hrl)}${
          this.wal!.context ? `&context=${encodeContext(this.wal!.context)}` : ''
        }`;
        const iframeSrc = this.assetStatus.assetInfo.appletDevPort
          ? `http://localhost:${
              this.assetStatus.assetInfo.appletDevPort
            }?${queryString}#${urlFromAppletHash(this.assetStatus.assetInfo.appletHash)}`
          : `${appletOrigin(this.assetStatus.assetInfo.appletHash)}?${queryString}`;

        return html`<iframe
          id="${this.iframeId}"
          frameborder="0"
          title="TODO"
          src="${iframeSrc}"
          style="flex: 1; display: block; padding: 5px; margin: 0; resize: both;"
          allow="clipboard-write;"
          @load=${() => {
            console.log('iframe loaded.');
            setTimeout(() => this.resizeIFrameToFitContent(), 1000);
          }}
        ></iframe>`;
    }
  }

  render() {
    return this.bare
      ? this.renderContent()
      : html`
          <div class="container">
            ${this.renderHeader()} ${this.collapsed ? '' : this.renderContent()}
          </div>
        `;
  }

  static styles = [
    sharedStyles,
    css`
      .container {
        border-right: 2px solid #8595bf;
        border-left: 2px solid #8595bf;
        border-bottom: 2px solid #8595bf;
        border-radius: 3px;
        resize: both;
        font-family: 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
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
    `,
  ];
}
