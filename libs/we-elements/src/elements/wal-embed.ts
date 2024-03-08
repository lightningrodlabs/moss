import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AppletInfo,
  AttachableLocationAndInfo,
  encodeContext,
  GroupProfile,
  HrlWithContext,
  stringifyHrl,
  WeaveLocation,
  WeaveUrl,
  weaveUrlToLocation,
  WeClient,
} from '@lightningrodlabs/we-applet';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { appletOrigin, urlFromAppletHash } from '../utils';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { DnaHash } from '@holochain/client';
import { mdiOpenInNew } from '@mdi/js';
import { localized, msg } from '@lit/localize';
import { getAppletInfoAndGroupsProfiles } from '../utils';

type AssetStatus =
  | {
      type: 'invalid url';
    }
  | {
      type: 'success';
      attachableInfo: AttachableLocationAndInfo;
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

  @state()
  assetStatus: AssetStatus = { type: 'loading' };

  @state()
  hrlWithContext: HrlWithContext | undefined;

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
      this.hrlWithContext = weaveLocation.hrlWithContext;
      const attachableInfo = await window.__WE_API__.attachableInfo(weaveLocation.hrlWithContext);
      this.assetStatus = attachableInfo
        ? { type: 'success', attachableInfo }
        : { type: 'not found' };
      if (attachableInfo) {
        const { appletInfo, groupProfiles } = await getAppletInfoAndGroupsProfiles(
          window.__WE_API__ as WeClient,
          attachableInfo?.appletHash,
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
        const queryString = `view=applet-view&view-type=attachable&hrl=${stringifyHrl(
          this.hrlWithContext!.hrl,
        )}${
          this.hrlWithContext!.context
            ? `&context=${encodeContext(this.hrlWithContext!.context)}`
            : ''
        }`;
        const iframeSrc = this.assetStatus.attachableInfo.appletDevPort
          ? `http://localhost:${
              this.assetStatus.attachableInfo.appletDevPort
            }?${queryString}#${urlFromAppletHash(this.assetStatus.attachableInfo.appletHash)}`
          : `${appletOrigin(this.assetStatus.attachableInfo.appletHash)}?${queryString}`;

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
                        .src=${this.assetStatus.attachableInfo.attachableInfo.icon_src}
                      ></sl-icon>
                    </div>
                    <div
                      class="column"
                      style="font-size: 18px; margin-left: 3px; height: 20px; overflow: hidden;"
                      title=${this.assetStatus.attachableInfo.attachableInfo.name}
                    >
                      ${this.assetStatus.attachableInfo.attachableInfo.name}
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
                          src=${groupProfile.logo_src}
                          style="height: 26px; width: 26px; border-radius: 50%; margin-right: 2px;"
                        />
                      </sl-tooltip>
                    `,
                  )}
                </div>`
              : html``
          }
            <sl-tooltip .content=${msg('Open in sidebar')}>
          <div class="column center-content open-btn" tabindex="0"
            @click=${async () => {
              if (this.hrlWithContext) await window.__WE_API__.openHrl(this.hrlWithContext, 'side');
            }}
            @keypress=${async (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (this.hrlWithContext)
                  await window.__WE_API__.openHrl(this.hrlWithContext, 'side');
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
