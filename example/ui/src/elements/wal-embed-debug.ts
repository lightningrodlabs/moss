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
} from '@theweave/api';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { appletOrigin, urlFromAppletHash } from '@theweave/elements';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { DnaHash, EntryHash } from '@holochain/client';
import { HoloHashMap } from '@holochain-open-dev/utils';
import { mdiOpenInNew } from '@mdi/js';
import { localized, msg } from '@lit/localize';

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
  weaveClient!: WeaveClient;

  @property()
  src!: WeaveUrl;

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
      const assetInfo = await this.weaveClient.assetInfo(weaveLocation.wal);
      this.assetStatus = assetInfo ? { type: 'success', assetInfo } : { type: 'not found' };
      if (assetInfo) {
        const { appletInfo, groupProfiles } = await getAppletInfoAndGroupsProfiles(
          this.weaveClient,
          assetInfo?.appletHash
        );
        this.appletInfo = appletInfo;
        this.groupProfiles = groupProfiles;
      }
    }
    this.iframeId = Date.now().toString();
  }

  resizeIFrameToFitContent() {
    console.log('Resizing.');
    const iframe = this.shadowRoot?.getElementById(this.iframeId!.toString()) as
      | HTMLIFrameElement
      | null
      | undefined;
    console.log('@resizeIFrameToFitContent: got iframe: ', iframe);
    if (iframe && iframe.contentWindow) {
      console.log('scrollWidth: ', iframe.contentWindow.document.body.scrollWidth.toString());
      console.log('scrollHeight: ', iframe.contentWindow.document.body.scrollHeight.toString());
      iframe.width = iframe.contentWindow.document.body.scrollWidth.toString();
      iframe.height = iframe.contentWindow.document.body.scrollHeight.toString();
    }
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
    return html`
      <div class="container">
        <div class="top-bar row" style="align-items: center;">
          ${
            this.assetStatus.type === 'success'
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
              : html``
          }
          <span style="display: flex; flex: 1;"></span>
          ${
            this.appletInfo
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
              : html``
          }
          ${
            this.groupProfiles
              ? html` <div class="row" style="align-items: center; margin-left: 4px;">
                  ${Array.from(this.groupProfiles.values()).map(
                    (groupProfile) => html`
                      <sl-tooltip .content=${groupProfile.name}>
                        <img
                          src=${groupProfile.icon_src}
                          style="height: 26px; width: 26px; border-radius: 50%; margin-right: 2px;"
                        />
                      </sl-tooltip>
                    `
                  )}
                </div>`
              : html``
          }
            <sl-tooltip .content=${msg('Open in sidebar')}>
          <div class="column center-content open-btn" tabindex="0"
            @click=${async () => {
              if (this.wal) await this.weaveClient.openWal(this.wal, 'side');
            }}
            @keypress=${async (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (this.wal) await this.weaveClient.openWal(this.wal, 'side');
              }
            }}>
            <sl-icon .src=${wrapPathInSvg(mdiOpenInNew)} style="font-size: 24px;"></sl-icon>
          </div>
          <sl-tooltip>
        </div>
        ${this.renderContent()}
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
    `,
  ];
}

export async function getAppletInfoAndGroupsProfiles(
  weaveClient: WeaveClient,
  appletHash: EntryHash
): Promise<{
  appletInfo: AppletInfo | undefined;
  groupProfiles: ReadonlyMap<DnaHash, GroupProfile>;
}> {
  const groupProfiles = new HoloHashMap<DnaHash, GroupProfile>();
  const appletInfo = await weaveClient.appletInfo(appletHash);
  if (appletInfo) {
    for (const groupHash of appletInfo.groupsHashes) {
      if (!groupProfiles.has(groupHash)) {
        const groupProfile = await weaveClient.groupProfile(groupHash);

        if (groupProfile) {
          groupProfiles.set(groupHash, groupProfile);
        }
      }
    }
  }

  return {
    appletInfo,
    groupProfiles,
  };
}
